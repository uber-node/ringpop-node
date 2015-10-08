// Copyright (c) 2015 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
'use strict';

var captureHost = require('../util.js').captureHost;
var errors = require('../errors.js');
var isEmptyArray = require('../util.js').isEmptyArray;
var mergeJoinResponses = require('./join-response-merge.js');
var numOrDefault = require('../util.js').numOrDefault;
var safeParse = require('../util.js').safeParse;
var TypedError = require('error/typed');

var JoinAbortedError = TypedError({
    type: 'ringpop.join-aborted',
    message: 'Join aborted because `{reason}`',
    reason: null
});

var JoinDurationExceededError = TypedError({
    type: 'ringpop.join-duration-exceeded',
    message: 'Join duration of `{duration}` exceeded max `{max}`',
    duration: null,
    max: null
});

var JoinAttemptsExceededError = TypedError({
    type: 'ringpop.join-attempts-exceeded',
    message: 'Join attempts of `{joinAttempts}` ' +
        'exceeded max `{maxJoinAttempts}`.\n',
    joinAttempts: null,
    maxJoinAttempts: null
});

function isSingleNodeCluster(ringpop) {
    return Array.isArray(ringpop.bootstrapHosts) &&
        ringpop.bootstrapHosts.length === 1 &&
        ringpop.bootstrapHosts[0] === ringpop.hostPort;
}

// Note that this function mutates the array passed in.
function takeNode(hosts) {
    var index = Math.floor(Math.random() * hosts.length);
    var host = hosts[index];
    hosts.splice(index, 1);
    return host;
}

function JoinCluster(opts) {
    opts = opts || {};

    if (!opts.ringpop) {
        throw errors.OptionRequiredError({
            context: 'ringpop',
            option: 'ringpop'
        });
    }

    if (isEmptyArray(opts.ringpop.bootstrapHosts)) {
        throw errors.InvalidOptionError({
            option: 'ringpop',
            reason: '`bootstrapHosts` is expected to be an array of size 1 or more'
        });
    }

    this.ringpop = opts.ringpop;
    this.host = captureHost(this.ringpop.hostPort);
    this.joinTimeout = numOrDefault(opts.joinTimeout, this.ringpop.config.get('joinRequestTimeout'));

    // This is used as a multiple of the required nodes left
    // to join to satisfy `joinSize`. Additional parallelism
    // can be applied in order for `joinSize` to be satisified
    // faster.
    this.parallelismFactor = numOrDefault(
        opts.parallelismFactor, this.ringpop.config.get('joinRequestParallelFactor'));

    // Potential nodes are nodes in the ringpop bootstrap
    // list that can be joined. Upon instantiation, this step
    // simply filters out a node from attempting to join itself.
    this.potentialNodes = this.collectPotentialNodes();
    this.preferredNodes = null;
    this.nonPreferredNodes = null;

    // A round is defined as a complete cycle through all
    // potential join targets. Once a round is completed,
    // we start all over again. A full-cycle should be pretty
    // darned rare. We will try and try to join other nodes
    // until `joinSize` is reached or `maxJoinDuration` is
    // exceeded.
    this.roundPotentialNodes = null;
    this.roundPreferredNodes = null;

    // Changes received by other nodes will be aggregated and
    // applied once the join process is complete.
    this.joinResponses = [];
}

// Potential nodes are those that are not this instance of ringpop.
JoinCluster.prototype.collectPotentialNodes = function collectPotentialNodes(nodesJoined) {
    nodesJoined = nodesJoined || [];

    var self = this;
    return this.ringpop.bootstrapHosts.filter(function filterHost(hostPort) {
        return self.ringpop.hostPort !== hostPort && nodesJoined.indexOf(hostPort) === -1;
    });
};

// Preferred nodes are those that are not on the same host as this instance of ringpop.
JoinCluster.prototype.collectPreferredNodes = function collectPreferredNodes() {
    var self = this;
    return this.potentialNodes.filter(function filterHost(hostPort) {
        return self.host !== captureHost(hostPort);
    });
};

// Non-preferred nodes are everyone else.
JoinCluster.prototype.collectNonPreferredNodes = function collectNonPreferredNodes() {
    var self = this;

    if (isEmptyArray(this.preferredNodes)) {
        return this.potentialNodes;
    } else {
        return this.potentialNodes.filter(function filterHost(hostPort) {
            return self.preferredNodes.indexOf(hostPort) === -1;
        });
    }
};

JoinCluster.prototype.init = function init(nodesJoined) {
    // TODO The "collect" operations are fairly inefficient. This
    // can be improved by indexing by host/port values.
    this.potentialNodes = this.collectPotentialNodes(nodesJoined);
    this.preferredNodes = this.collectPreferredNodes();
    this.nonPreferredNodes = this.collectNonPreferredNodes();

    // Note that these are copies. During the process of joining
    // the "round"-prefixed collections are mutated.
    this.roundPotentialNodes = this.potentialNodes.slice(0);
    this.roundPreferredNodes = this.preferredNodes.slice(0);
    this.roundNonPreferredNodes = this.nonPreferredNodes.slice(0);
};

JoinCluster.prototype.join = function join(callback) {
    var self = this;

    if (this.ringpop.destroyed) {
        process.nextTick(function onTick() {
            callback(JoinAbortedError({
                reason: 'joiner was destroyed'
            }));
        });
        return;
    }

    // No need to go through the join process if you're the only one in the cluster.
    if (isSingleNodeCluster(this.ringpop)) {
        this.ringpop.logger.info('ringpop received a single node cluster join', {
            local: this.ringpop.whoami()
        });

        process.nextTick(function onTick() {
            callback();
        });
        return;
    }

    var nodesJoined = [];
    var numGroups = 0;
    var numJoined = 0;
    var numFailed = 0;
    var startTime = Date.now();
    var calledBack = false;
    var maxJoinAttempts = this.ringpop.config.get('maxJoinAttempts');

    function onJoin(err, nodes) {
        if (calledBack) {
            return;
        }

        if (self.ringpop.destroyed) {
            calledBack = true;
            callback(JoinAbortedError({
                reason: 'joiner was destroyed',
            }));
            return;
        }

        if (err) {
            calledBack = true;
            callback(err);
            return;
        }

        nodesJoined = nodesJoined.concat(nodes.successes);
        numJoined += nodes.successes.length;
        numFailed += nodes.failures.length;
        numGroups++;

        if (numJoined >= self.joinSize) {
            var joinTime = Date.now() - startTime;

            var updates = mergeJoinResponses(self.ringpop, self.joinResponses);

            // Update membership only once, when join is complete and successful.
            self.ringpop.membership.update(updates);

            // No need to keep this data hanging around.
            self.joinResponses = null;

            self.ringpop.stat('timing', 'join', joinTime);
            self.ringpop.stat('increment', 'join.complete');
            self.ringpop.logger.debug('ringpop join complete', {
                local: self.ringpop.whoami(),
                joinSize: self.joinSize,
                joinTime: joinTime,
                numJoined: numJoined,
                numGroups: numGroups,
                numFailed: numFailed
            });

            calledBack = true;
            callback(null, nodesJoined);
        } else if (numFailed >= maxJoinAttempts) {
            self.ringpop.logger.warn('ringpop max join attempts exceeded', {
                local: self.ringpop.whoami(),
                joinAttempts: numFailed,
                maxJoinAttempts: maxJoinAttempts,
                numJoined: numJoined,
                numFailed: numFailed,
                startTime: startTime
            });

            calledBack = true;
            callback(JoinAttemptsExceededError({
                joinAttempts: numFailed,
                maxJoinAttempts: maxJoinAttempts
            }));
            return;
        } else {
            var joinDuration = Date.now() - startTime;
            if (joinDuration > self.maxJoinDuration) {
                self.ringpop.logger.warn('ringpop max join duration exceeded', {
                    local: self.ringpop.whoami(),
                    joinDuration: joinDuration,
                    maxJoinDuration: self.maxJoinDuration,
                    numJoined: numJoined,
                    numFailed: numFailed,
                    startTime: startTime
                });

                calledBack = true;
                callback(JoinDurationExceededError({
                    joinDuration: joinDuration,
                    maxJoinDuration: self.maxJoinDuration
                }));
                return;
            }

            self.ringpop.logger.debug('ringpop join not yet complete', {
                local: self.ringpop.whoami(),
                joinSize: self.joinSize,
                numJoined: numJoined,
                numFailed: numFailed,
                numNodesLeft: self.joinSize - numJoined
            });

            setTimeout(reJoin, self.joinRetryDelay);
        }

        function reJoin() {
            self.joinGroup(nodesJoined, onJoin);
        }
    }

    this.joinGroup(nodesJoined, onJoin);
};

JoinCluster.prototype.joinGroup = function joinGroup(totalNodesJoined, callback) {
    var self = this;
    var group = this.selectGroup(totalNodesJoined);

    this.ringpop.logger.debug('ringpop selected join group', {
        local: self.ringpop.whoami(),
        group: group,
        numNodes: group.length
    });

    var nodesJoined = [];
    var nodesFailed = [];
    var numNodesLeft = this.joinSize - totalNodesJoined.length;
    var calledBack = false;
    var startTime = Date.now();

    function onJoin(err, node) {
        if (calledBack) {
            return;
        }

        if (err) {
            nodesFailed.push(node);
        } else {
            nodesJoined.push(node);
        }

        var numCompleted = nodesJoined.length + nodesFailed.length;

        // Finished when either all joins have completed or enough to satisfy
        // the join requirements as defined by `joinSize`.
        if (nodesJoined.length >= numNodesLeft || numCompleted >= group.length) {
            self.ringpop.logger.debug('ringpop join group complete', {
                local: self.ringpop.whoami(),
                groupSize: group.length,
                joinSize: self.joinSize,
                joinTime: Date.now() - startTime,
                numFailures: nodesFailed.length,
                numSuccesses: nodesJoined.length,
                numNodesLeft: numNodesLeft,
                failures: nodesFailed,
                successes: nodesJoined
            });

            calledBack = true;
            callback(null, {
                successes: nodesJoined,
                failures: nodesFailed
            });
        }
    }

    for (var i = 0; i < group.length; i++) {
        this.joinNode(group[i], onJoin);
    }
};

JoinCluster.prototype.joinNode = function joinNode(node, callback) {
    var self = this;
    var joinOpts = {
        host: node,
        timeout: this.joinTimeout,
        serviceName: 'ringpop',
        hasNoParent: true,
        retryLimit: 1,
        trace: false,
        headers: {
            'as': 'raw',
            'cn': 'ringpop'
        }
    };
    var joinBody = JSON.stringify({
        app: this.ringpop.app,
        source: this.ringpop.whoami(),
        incarnationNumber: this.ringpop.membership.localMember.incarnationNumber
    });

    self.ringpop.channel
        .waitForIdentified({
            host: joinOpts.host
        }, onIdentified);

    function onIdentified(err) {
        if (err) {
            callback(err);
        } else {
            self.ringpop.channel
                .request(joinOpts)
                .send('/protocol/join', null, joinBody, function onSend(err, res, arg2, arg3) {
                    if (!err && !res.ok) {
                        err = new Error(String(arg3));
                    }

                    if (err) {
                        return callback(err, node);
                    }

                    var bodyObj = safeParse(arg3.toString());

                    // Verify that `joinResponses` is not null. It is set
                    // to null upon completion of the join process. There may,
                    // however, be in-flight /protocol/join requests that have
                    // yet to complete.
                    if (bodyObj && self.joinResponses !== null) {
                        self.joinResponses.push({
                            checksum: bodyObj.membershipChecksum,
                            members: bodyObj.membership
                        });
                    }

                    callback(null, node);
                });
        }
    }
};

JoinCluster.prototype.selectGroup = function selectGroup(nodesJoined) {
    nodesJoined = nodesJoined || [];

    var self = this;

    // If fully exhausted or first round, initialize this rounds' nodes.
    if (isEmptyArray(this.roundPreferredNodes) && isEmptyArray(this.roundNonPreferredNodes)) {
        this.init(nodesJoined);
    }

    var preferredNodes = this.roundPreferredNodes;
    var nonPreferredNodes = this.roundNonPreferredNodes;
    var numNodesLeft = self.joinSize - nodesJoined.length;
    var group = [];

    function continueSelect() {
        var numNodesSelected = group.length;
        if (numNodesSelected === numNodesLeft * self.parallelismFactor) {
            return false;
        }

        var numNodesAvailable = preferredNodes.length + nonPreferredNodes.length;
        if (numNodesAvailable === 0) {
            return false;
        }

        return true;
    }

    while (continueSelect()) {
        if (preferredNodes.length > 0) {
            group.push(takeNode(preferredNodes));
        } else if (nonPreferredNodes.length > 0) {
            group.push(takeNode(nonPreferredNodes));
        }
    }

    return group;
};

function createJoiner(opts) {
    return new JoinCluster(opts);
}

function joinCluster(opts, callback) {
    var joiner = createJoiner(opts);
    joiner.join(callback);
    return joiner;
}

function sendJoin(target, opts, callback) {
    var joinOpts = {
        host: target,
        timeout: opts.joinTimeout,
        serviceName: 'ringpop',
        hasNoParent: true,
        retryLimit: 0,
        trace: false,
        headers: {
            'as': 'raw',
            'cn': 'ringpop'
        }
    };
    var joinBody = JSON.stringify({
        app: opts.ringpop.app,
        source: opts.ringpop.whoami(),
        incarnationNumber: opts.ringpop.membership.localMember.incarnationNumber
    });

    console.log('Idenfity');
    opts.ringpop.channel
        .waitForIdentified({host: joinOpts.host}, onIdentified);

    function onIdentified(err) {
        if (err) {
            callback(err);
            return;
        }
        console.log('Identified');
        opts.ringpop.channel
            .request(joinOpts)
            .send('/protocol/join', null, joinBody, onSent);
    }

    function onSent(err, res, head, body) {
        if (!err && !res.ok) {
            err = new Error(String(body));
        }
        if (err) {
            return callback(err, target);
        }

        console.log('Sent');
        var bodyObj = safeParse(body.toString());
        if (bodyObj) {
            bodyObj = {
                checksum: bodyObj.membershipChecksum,
                members: bodyObj.membership
            };
        }
        callback(null, target, bodyObj);
    }
}

module.exports = {
    createJoiner: createJoiner,
    joinCluster: joinCluster,
    sendJoin: sendJoin
};
