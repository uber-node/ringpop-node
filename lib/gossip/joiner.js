// Copyright (c) 2016 Uber Technologies, Inc.
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
var globalTimers = require('timers');
var isEmptyArray = require('../util.js').isEmptyArray;
var mergeJoinResponses = require('./join-response-merge.js');
var numOrDefault = require('../util.js').numOrDefault;
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

var JOIN_SIZE = 3;
var JOIN_TIMEOUT = 1000;
var PARALLELISM_FACTOR = 2;

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

function Joiner(opts) {
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
    this.logger = this.ringpop.loggerFactory.getLogger('join');
    this.timers = opts.timers || globalTimers;
    this.host = captureHost(this.ringpop.hostPort);
    this.joinTimeout = numOrDefault(opts.joinTimeout, JOIN_TIMEOUT);

    // This is used as a multiple of the required nodes left
    // to join to satisfy `joinSize`. Additional parallelism
    // can be applied in order for `joinSize` to be satisified
    // faster.
    this.parallelismFactor = numOrDefault(opts.parallelismFactor,
        PARALLELISM_FACTOR);

    // Potential nodes are nodes in the ringpop bootstrap
    // list that can be joined. Upon instantiation, this step
    // simply filters out a node from attempting to join itself.
    this.potentialNodes = this.collectPotentialNodes();
    this.preferredNodes = null;
    this.nonPreferredNodes = null;

    // We either join the number of nodes defined by `joinSize`
    // or limit it to the number of `potentialNodes`. After all,
    // we can't join more than there are to join in the first place.
    var joinSize = numOrDefault(opts.joinSize, JOIN_SIZE);
    this.joinSize = Math.min(joinSize, this.potentialNodes.length);

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

    this.joinDelay = this.ringpop.config.get('joinDelayMin');
    this.joinRetries = 0;
}

// Potential nodes are those that are not this instance of ringpop.
Joiner.prototype.collectPotentialNodes = function collectPotentialNodes(nodesJoined) {
    nodesJoined = nodesJoined || [];

    var self = this;
    return this.ringpop.bootstrapHosts.filter(function filterHost(hostPort) {
        return self.ringpop.hostPort !== hostPort && nodesJoined.indexOf(hostPort) === -1;
    });
};

// Preferred nodes are those that are not on the same host as this instance of ringpop.
Joiner.prototype.collectPreferredNodes = function collectPreferredNodes() {
    var self = this;
    return this.potentialNodes.filter(function filterHost(hostPort) {
        return self.host !== captureHost(hostPort);
    });
};

// Non-preferred nodes are everyone else.
Joiner.prototype.collectNonPreferredNodes = function collectNonPreferredNodes() {
    var self = this;

    if (isEmptyArray(this.preferredNodes)) {
        return this.potentialNodes;
    } else {
        return this.potentialNodes.filter(function filterHost(hostPort) {
            return self.preferredNodes.indexOf(hostPort) === -1;
        });
    }
};

Joiner.prototype.init = function init(nodesJoined) {
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

Joiner.prototype.join = function join(callback) {
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
        this.logger.info('ringpop received a single node cluster join', {
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

    this.joinGroup(nodesJoined, onJoin);

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

            self.ringpop.stat('gauge', 'join.retries', self.joinRetries);
            self.ringpop.stat('timing', 'join', joinTime);
            self.ringpop.stat('increment', 'join.complete');
            self.logger.info('ringpop join complete', {
                local: self.ringpop.whoami(),
                joinSize: self.joinSize,
                joinTime: joinTime,
                numJoined: numJoined,
                numGroups: numGroups,
                numFailed: numFailed
            });

            calledBack = true;
            callback(null, nodesJoined);
        } else {
            var joinDuration = Date.now() - startTime;
            var maxJoinDuration = self.ringpop.config.get('maxJoinDuration');
            if (joinDuration > maxJoinDuration) {
                self.ringpop.stat('gauge', 'join.retries', self.joinRetries);
                self.logger.warn('ringpop max join duration exceeded', {
                    local: self.ringpop.whoami(),
                    joinDuration: joinDuration,
                    maxJoinDuration: maxJoinDuration,
                    numJoined: numJoined,
                    numFailed: numFailed,
                    startTime: startTime
                });

                calledBack = true;
                callback(JoinDurationExceededError({
                    joinDuration: joinDuration,
                    maxJoinDuration: maxJoinDuration
                }));
                return;
            }

            // Compute a join delay that grows exponentially with
            // each join retry that is performed. Add a randomized
            // fuzz to the delay that is between 1x and 1.5x its
            // value.
            var oldJoinDelay = self.joinDelay;
            var delayMax = self.ringpop.config.get('joinDelayMax');
            var delayMin = self.ringpop.config.get('joinDelayMin');
            var newDelay = delayMin * Math.pow(2, self.joinRetries);
            var withFuzz = Math.floor(Math.random() *
                ((newDelay * 1.5) - newDelay)) + newDelay;
            self.joinDelay = Math.min(delayMax, withFuzz);

            // Determine if the join delay has exceeded the maximum
            // delay and send out a warning letting developers know
            // that Ringpop is having trouble.
            if (self.ringpop.config.get('joinTroubleErrorEnabled') &&
                oldJoinDelay < delayMax &&
                self.joinDelay >= delayMax) {
                var errorMsg = 'ringpop joiner reached max retry delay. ' +
                    'this is a strong indication that ringpop is having ' +
                    'trouble joining a cluster and could be due to a ' +
                    'misconfiguration of your environment. ringpop will ' +
                    'continue to join up to the max join duration.';
                self.logger.error(errorMsg, {
                    local: self.ringpop.whoami(),
                    retriesSoFar: self.joinRetries,
                    joinDelayMax: delayMax,
                    maxJoinDuration: maxJoinDuration
                });
            }

            self.logger.info('ringpop joiner not yet complete; will attempt retry after delay', {
                local: self.ringpop.whoami(),
                retriesSoFar: self.joinRetries,
                delay: self.joinDelay,
                maxJoinDuration: maxJoinDuration,
                timeJoiningSoFar: Date.now() - startTime,
                delayWithoutFuzz: newDelay,
                delayWithFuzz: self.joinDelay,
                joinSize: self.joinSize,
                numNodesJoined: numJoined,
                numNodesFailed: numFailed,
                numNodesLeft: self.joinSize - numJoined
            });
            // Attempt to retry the join after applying the delay backoff.
            self.timers.setTimeout(function onTimeout() {
                self.joinRetries++;
                self.joinGroup(nodesJoined, onJoin);
            }, self.joinDelay);
        }
    }
};

Joiner.prototype.joinGroup = function joinGroup(totalNodesJoined, callback) {
    var self = this;
    var group = this.selectGroup(totalNodesJoined);

    this.logger.debug('ringpop selected join group', {
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
            self.logger.info('ringpop join group complete', {
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

Joiner.prototype.joinNode = function joinNode(node, callback) {
    var self = this;
    self.ringpop.client.protocolJoin({
        host: node,
        retryLimit: self.ringpop.config.get('tchannelRetryLimit'),
        timeout: this.joinTimeout
    }, {
        app: this.ringpop.app,
        source: this.ringpop.whoami(),
        incarnationNumber: this.ringpop.membership.localMember.incarnationNumber
    }, function onJoin(err, res) {
        if (err) {
            callback(err, node);
            return;
        }

        // Verify that `joinResponses` is not null. It is set
        // to null upon completion of the join process. There may,
        // however, be in-flight /protocol/join requests that have
        // yet to complete.
        if (res && self.joinResponses !== null) {
            self.joinResponses.push({
                checksum: res.membershipChecksum,
                members: res.membership
            });
        }

        callback(null, node);
    });
};

Joiner.prototype.selectGroup = function selectGroup(nodesJoined) {
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
    return new Joiner(opts);
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
