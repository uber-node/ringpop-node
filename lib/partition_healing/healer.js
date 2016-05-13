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

var _ = require('underscore');

var Member = require('../membership/member');
var PingSender = require('../gossip/ping-sender');

/**
 *
 * Healer implements an algorithm to heal a partitioned ringpop cluster.
 *
 * @param ringpop
 *
 * @constructor
 */
function Healer(ringpop) {
    this.ringpop = ringpop;
    this.logger = this.ringpop.loggerFactory.getLogger('healer');
}

/**
 * Attempt a heal between the current and target node. Calling this function does not
 * result in a heal if there are nodes that need to be reincarnated to take precedence
 * over the faulty declarations. A cluster may need some time and multiple heal attempts
 * before it is successfully healed.
 *
 * @param {string} target The address of the target node of the heal-attempt.
 * @param {Healer~attemptHealCallback} callback called when the heal attempt is done.
 * @protected
 */
Healer.prototype.attemptHeal = function attemptHeal(target, callback) {
    var self = this;

    self.ringpop.stat('increment', 'heal.attempt');
    this.logger.info('ringpop attempt heal', {
        local: self.ringpop.whoami(),
        target: target
    });

    var membershipB = null; //The membership of the target-node.

    sendJoinRequest();

    function sendJoinRequest() {
        self.ringpop.client.protocolJoin({
            host: target,
            retryLimit: self.ringpop.config.get('tchannelRetryLimit'),
            timeout: 1000
        }, {
            app: self.ringpop.app,
            source: self.ringpop.whoami(),
            incarnationNumber: self.ringpop.membership.localMember.incarnationNumber
        }, function onJoin(err, res) {
            if (err) {
                done(err);
            } else {
                generateChanges(res);
            }
        });
    }

    function generateChanges(joinResponse) {
        membershipB = joinResponse.membership;

        // Index membership of this node by address for faster lookups.
        var membershipA = _.indexBy(self.ringpop.dissemination.membershipAsChanges(), 'address');

        var changesForA = [];
        var changesForB = [];

        for (var i = 0; i < membershipB.length; i++) {
            var b = membershipB[i];
            var a = membershipA[b.address];

            if (!a) {
                continue;
            }

            // if a would become un-pingable after applying the change
            if (nodeWouldBecomeUnPingable(a, b)) {
                // mark it as suspect for partition A
                changesForA.push(createSuspectChange(b));
            }

            // if b would become un-pingable after applying the change
            if (nodeWouldBecomeUnPingable(b, a)) {
                // mark it as suspect for partition B
                changesForB.push(createSuspectChange(a));
            }
        }

        processChanges(changesForA, changesForB);
    }

    function createSuspectChange(member) {
        // don't send source and sourceIncarnationNumber fields to prevent bi-directional full sync
        return {
            address: member.address,
            incarnationNumber: member.incarnationNumber,
            status: Member.Status.suspect
        };
    }

    function nodeWouldBecomeUnPingable(currentState, newState) {
        if (!Member.isStatusPingable(currentState.status)) {
            // already un-pingable
            return false;
        }

        if (Member.isStatusPingable(newState.status)) {
            // new state is pingable
            return false;
        }

        if (currentState.incarnationNumber > newState.incarnationNumber) {
            // current state is newer than new state
            return false;
        }

        if (currentState.incarnationNumber < newState.incarnationNumber) {
            // new state is newer than current state
            return true;
        }

        return Member.statusPrecedence(newState.status) > Member.statusPrecedence(currentState.status);
    }

    function processChanges(changesForA, changesForB) {
        if (changesForA.length > 0 || changesForB.length > 0) {
            // reincarnate
            reincarnate(changesForA, changesForB, done);
        } else {
            // merge
            merge(membershipB, done);
        }
    }

    function reincarnate(changesForA, changesForB, next) {
        // process local changes
        if (changesForA.length > 0) {
            self.ringpop.membership.update(changesForA);
        }

        // send remote changes
        if (changesForB.length > 0) {
            new PingSender(self.ringpop, target).sendChanges(changesForB, next);
        } else {
            next(null);
        }
    }

    function merge(membershipB, next) {
        // apply target's membership to local membership
        self.ringpop.membership.update(membershipB);

        // sent full local membership to target
        new PingSender(self.ringpop, target).sendChanges(self.ringpop.dissemination.membershipAsChanges(), next);
    }

    function done(err) {
        if (err) {
            callback(err);
            return;
        }

        var pingableHosts = _.chain(membershipB).filter(function isPingable(change) {
            return Member.isStatusPingable(change.status);
        }).pluck('address').value();

        callback(null, pingableHosts);
    }
};

/**
 * This is the callback of the {Healer~heal} function.
 *
 * @callback Healer~healCallback
 * @param {Error} error not-null when the heal operation failed.
 * @param {string[]} [targets] an array of peers that were targeted during the heal attempt.
 */

/**
 * This is the callback of the {Healer~attemptHeal} function.
 *
 * @callback Healer~attemptHealCallback
 * @param {Error} error not-null when the heal attempt failed.
 * @param {string[]} [pingableHosts] the hosts of target's membership that are now pingable in the current node's membership list
 */

module.exports = Healer;
