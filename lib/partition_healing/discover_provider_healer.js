// Copyright (c) 2017 Uber Technologies, Inc.
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

var _ = require('underscore');
var globalTimers = require('timers');
var Member = require('../membership/member');
var Healer = require('./healer');
var TypedError = require('error/typed');

var Errors = {
    RingpopIsNotReadyError: require('../errors').RingpopIsNotReadyError,
    DiscoverProviderNotAvailableError: TypedError({
        type: 'ringpop.partition-healing.discover-provider-not-available',
        message: 'discoverProvider not available to healer'
    })
};

/**
 *
 *
 * @extends Healer
 * @param ringpop
 * @constructor
 */
function DiscoverProviderHealer(ringpop) {
    DiscoverProviderHealer.super_.call(this, ringpop);
    this.timers = ringpop.timers || globalTimers;

    this.maxNumberOfFailures = ringpop.config.get('discoverProviderHealerMaxFailures');
    this.healPeriod = ringpop.config.get('discoverProviderHealerPeriod');
    this.baseProbability = ringpop.config.get('discoverProviderHealerBaseProbability');

    this.previousHostListSize = 0;
    this.healTimer = null;
    this.isStopped = true;
}
require('util').inherits(DiscoverProviderHealer, Healer);

DiscoverProviderHealer.prototype.start = function start() {
    if (this.healTimer) {
        return;
    }
    this.isStopped = false;
    this._run();
};

DiscoverProviderHealer.prototype.stop = function stop() {
    this.isStopped = true;
    if (this.healTimer) {
        this.timers.clearTimeout(this.healTimer);
        this.healTimer = null;
    }
};

DiscoverProviderHealer.prototype._run = function _run() {
    var self = this;

    if (self.isStopped) {
        return;
    }

    if (self.healTimer && Math.random() < probability()) {
        self.heal(function onHeal() {
            scheduleNext();
        });
    } else {
        scheduleNext();
    }

    function scheduleNext() {
        self.healTimer = self.timers.setTimeout(function onHealTimer() {
            self._run();
        }, self.healPeriod);
    }

    function probability() {
        var membership = self.ringpop.membership;
        var pingableMembers = _.filter(membership.members, membership.isPingable.bind(membership)).length;

        return self.baseProbability / Math.max(1, pingableMembers, self.previousHostListSize);
    }
};

/**
 * Perform a heal-operation using the discover provider (@see RingPop#discoverProvider).
 * Briefly explained the heal-operation consists of the following steps:
 *
 * 1. get a target list by filtering the list of hosts from the {DiscoverProvider};
 * 2. remove a host from the target list and try to join it;
 * 3. merge the two membership lists when possible and gossip changes around when necessary;
 * 4. remove the hosts that are alive according to target's membership list from the target list.
 * 5. goto 2 until the target list is empty or the number of failures reached a configurable maximum (discoverProviderHealerMaxFailures)
 *
 * A full description of the algorithm is available in ringpop-common/docs.
 *
 * @param {Healer~healCallback} callback the callback when the heal operation is completed.
 */
DiscoverProviderHealer.prototype.heal = function heal(callback) {
    var self = this;
    self.ringpop.stat('increment', 'heal.triggered');

    if(!self.ringpop.isReady) {
        callback(Errors.RingpopIsNotReadyError());
        return;
    }
    if (!self.ringpop.discoverProvider) {
        var error = Errors.DiscoverProviderNotAvailableError();
        self.logger.warn(error.message, {
            local: self.ringpop.whoami()
        });
        callback(error);
        return;
    }

    self.ringpop.discoverProvider(onHostsDiscovered);

    function onHostsDiscovered(err, hosts) {
        if (err) {
            self.logger.warn('ringpop unable to retrieve host list from discover provider during heal', {
                local: self.ringpop.whoami(),
                err: err
            });
            return callback(err);
        }
        self.previousHostListSize = hosts.length;

        var potentialTargets = self._getTargets(hosts);
        var targets = [];
        var numberOfFailures = 0;

        healNext();

        function healNext() {
            if (potentialTargets.length > 0 && numberOfFailures < self.maxNumberOfFailures) {
                healTarget();
            } else {
                healingDone();
            }
        }

        function healTarget() {
            var target = potentialTargets.pop();

            self.attemptHeal(target, function onHealAttempt(err, reachableNodes) {
                if (err) {
                    numberOfFailures++;
                    self.logger.warn('ringpop heal attempt failed', {
                        local: self.ringpop.whoami(),
                        target: target,
                        numberOfFailures: numberOfFailures,
                        maxNumberOfFailures: self.maxNumberOfFailures,
                        err: err
                    });

                    // continue
                    healNext();
                    return;
                }

                targets.push(target);
                // Remove all reachable nodes from the list of potential targets.
                potentialTargets = _.difference(potentialTargets, reachableNodes);

                healNext();
            });
        }

        function healingDone(err) {
            if (numberOfFailures >= self.maxNumberOfFailures) {
                self.logger.warn('ringpop heal reached maximum number of failures', {
                    local: self.ringpop.whoami(),
                    failures: numberOfFailures,
                    successes: targets.length
                });
            }

            callback(err, targets);
        }
    }
};

/**
 * Get the valid targets for healing from a list of hosts. A valid target is a host
 * that's not in the current membership list or the status of it in the membership list
 * is of the same or higher precedence as faulty (@see Member.statusPrecedence).
 *
 * @param hosts the hosts to filter
 * @return a shuffled, filtered list of hosts that valid targets.
 * @private
 */
DiscoverProviderHealer.prototype._getTargets = function _getTargets(hosts) {
    var ringpop = this.ringpop;
    var membership = ringpop.membership;

    return _.chain(hosts)
        .filter(isHostAValidTarget)
        .shuffle()
        .value();

    function isHostAValidTarget(host) {
        if (host === ringpop.whoami()){
            return false;
        }
        var member = membership.findMemberByAddress(host);
        if (!member) {
            // host isn't known in current membership.
            return true;
        }
        return Member.statusPrecedence(member.status) >= Member.statusPrecedence(Member.Status.faulty);
    }
};

DiscoverProviderHealer.Errors = Errors;

module.exports = DiscoverProviderHealer;
