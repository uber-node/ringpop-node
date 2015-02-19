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

var numOrDefault = require('./util.js').numOrDefault;
var TypedError = require('error/typed');
var safeParse = require('./util.js').safeParse;

var InvalidOptionError = TypedError({
    type: 'ringpop.invalid-option',
    message: '`{option}` option is invalid because {reason}',
    option: null,
    reason: null
});

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

var OptionRequiredError = TypedError({
    type: 'ringpop.option-required',
    message: 'Expected `{option}` to be present',
    option: null
});

var HOST_CAPTURE = /(\d+\.\d+\.\d+\.\d+):\d+/;
var JOIN_SIZE = 3;
var JOIN_TIMEOUT = 1000;
var MAX_JOIN_DURATION = 120000;
var PARALLELISM_FACTOR = 2;

function captureHostPart(hostPort) {
    var match = HOST_CAPTURE.exec(hostPort);
    return match && match[1];
}

function isEmptyArray(array) {
    return !Array.isArray(array) || array.length === 0;
}

function isSingleNodeCluster(ringpop) {
    return Array.isArray(ringpop.bootstrapHosts) &&
        ringpop.bootstrapHosts.length === 1 &&
        ringpop.bootstrapHosts[0] === ringpop.hostPort;
}

function takeNode(hosts) {
    var index = Math.floor(Math.random() * hosts.length);
    var host = hosts[index];
    hosts.splice(index, 1);
    return host;
}

function JoinCluster(opts) {
    opts = opts || {};

    if (!opts.ringpop) {
        throw OptionRequiredError({
            option: 'ringpop'
        });
    }

    if (isEmptyArray(opts.ringpop.bootstrapHosts)) {
        throw InvalidOptionError({
            option: 'ringpop',
            reason: '`bootstrapHosts` is expected to be an array of size 1 or more'
        });
    }

    this.ringpop = opts.ringpop;
    this.potentialNodes = this.collectPotentialNodes();
    this.joinSize = Math.min(numOrDefault(opts.joinSize, JOIN_SIZE), this.potentialNodes.length);
    this.parallelismFactor = numOrDefault(opts.parallelismFactor, PARALLELISM_FACTOR);
    this.joinTimeout = numOrDefault(opts.joinTimeout, JOIN_TIMEOUT);
    this.hostPart = captureHostPart(this.ringpop.hostPort);
    this.maxJoinDuration = numOrDefault(opts.maxJoinDuration, MAX_JOIN_DURATION);
    this.preferredNodes = null;
    this.nonPreferredNodes = null;

    // A round is defined as a complete cycle through all potential join targets.
    // Once a round is completed, we start all over again. A full-cycle should be
    // pretty darned rare.
    this.roundPotentialNodes = null;
    this.roundPreferredNodes = null;
}

JoinCluster.prototype.collectPotentialNodes = function collectPotentialNodes() {
    var self = this;

    // Potential nodes are those that are not this instance of ringpop.
    return this.ringpop.bootstrapHosts.filter(function filterHost(hostPort) {
        return self.ringpop.hostPort !== hostPort;
    });
};

JoinCluster.prototype.destroy = function destroy() {
    this.isDestroyed = true;
};

JoinCluster.prototype.init = function init(nodesJoined) {
    nodesJoined = nodesJoined || [];

    var self = this;

    this.potentialNodes = this.potentialNodes.filter(function filterNode(node) {
        return nodesJoined.indexOf(node) === -1;
    });

    // Preferred nodes are those that are not on the same host as this
    // instance of ringpop.
    this.preferredNodes = this.potentialNodes.filter(function filterHost(hostPort) {
        return self.hostPart !== captureHostPart(hostPort);
    });

    // Non-preferred nodes are everyone else.
    if (isEmptyArray(this.preferredNodes)) {
        this.nonPreferredNodes = this.potentialNodes.slice(0);
    } else {
        this.nonPreferredNodes = this.potentialNodes.filter(function filterHost(hostPort) {
            return self.preferredNodes.indexOf(hostPort) === -1;
        });
    }

    this.roundPotentialNodes = this.potentialNodes.slice(0);
    this.roundPreferredNodes = this.preferredNodes.slice(0);
    this.roundNonPreferredNodes = this.nonPreferredNodes.slice(0);
};

JoinCluster.prototype.join = function join(callback) {
    var self = this;

    if (this.isDestroyed) {
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
    var joinStartTime = Date.now();
    var groupStartTime = joinStartTime;

    function onJoin(err, nodes) {
        numGroups++;

        if (self.isDestroyed) {
            callback(JoinAbortedError({
                reason: 'joiner was destroyed'
            }));
            return;
        }

        if (err) {
            return callback(err);
        }

        nodesJoined = nodesJoined.concat(nodes.successes);
        numJoined += nodes.successes.length;
        numFailed += nodes.failures.length;

        if (numJoined >= self.joinSize) {
            self.ringpop.logger.info('ringpop join complete', {
                local: self.ringpop.whoami(),
                numJoined: numJoined,
                numFailed: numFailed,
                joinSize: self.joinSize,
                numGroups: numGroups,
                joinTime: Date.now() - joinStartTime
            });

            callback(null, nodesJoined);
        } else {
            var joinDuration = Date.now() - joinStartTime;
            if (joinDuration > self.maxJoinDuration) {
                self.ringpop.logger.info('ringpop max join duration exceeded', {
                    local: self.ringpop.whoami(),
                    numJoined: numJoined,
                    numFailed: numFailed,
                    joinDuration: joinDuration,
                    joinStartTime: joinStartTime,
                    maxJoinDuration: self.maxJoinDuration
                });

                callback(JoinDurationExceededError({
                    duration: joinDuration,
                    max: self.maxJoinDuration
                }));
                return;
            }

            self.ringpop.logger.info('ringpop join not yet complete', {
                local: self.ringpop.whoami(),
                numJoined: numJoined,
                numFailed: numFailed,
                numNodesLeft: self.joinSize - numJoined,
                joinSize: self.joinSize
            });

            groupStartTime = Date.now();

            self.joinGroup(nodesJoined, onJoin);
        }
    }

    this.joinGroup(nodesJoined, onJoin);
};

JoinCluster.prototype.joinGroup = function joinGroup(totalNodesJoined, callback) {
    var self = this;
    var group = this.selectGroup(totalNodesJoined);

    this.ringpop.logger.info('ringpop selected join group', {
        local: self.ringpop.whoami(),
        group: group,
        numNodes: group.length
    });

    var nodesCompleted = 0;
    var nodesJoined = [];
    var nodesFailed = [];

    function onJoin(err, node) {
        nodesCompleted++;

        if (err) {
            nodesFailed.push(node);
        } else {
            nodesJoined.push(node);
        }

        if (nodesCompleted >= group.length) {
            self.ringpop.logger.info('ringpop join group complete', {
                local: self.ringpop.whoami(),
                failures: nodesFailed,
                numFailures: nodesFailed.length,
                successes: nodesJoined,
                numSuccesses: nodesJoined.length,
                joinSize: self.joinSize
            });

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

    var joinOpts = { host: node, timeout: this.joinTimeout };
    var joinBody = {
        app: this.ringpop.app,
        source: this.ringpop.membership.localMember.address,
        incarnationNumber: this.ringpop.membership.localMember.incarnationNumber
    };

    this.ringpop.channel.send(joinOpts, '/protocol/join', null, joinBody, function onSend(err, head, json) {
        if (err) {
            return callback(err, node);
        }

        var body = safeParse(json.toString());

        if (body) {
            self.ringpop.membership.update(body.membership);
        }

        callback(null, node);
    });
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

// Algorithm for joining is to find the first `joinSize` hosts where
// join is successful. The selection process for target join hosts
// is implemented about in `selectJoinTargets`. Joins happen in parallel.
// The entire join process times out after `maxJoinDuration`.
function createJoiner(opts) {
    return new JoinCluster(opts);
}

function joinCluster(opts, callback) {
    var joiner = createJoiner(opts);
    joiner.join(callback);
    return joiner;
}

module.exports = {
    createJoiner: createJoiner,
    joinCluster: joinCluster
};
