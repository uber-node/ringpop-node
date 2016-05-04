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
var async = require('async');

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
 * result in a heal ff there are nodes that need to be reincarnated to take precedence
 * over the faulty declarations. A cluster may need some time and multiple heal attempts
 * before it is successfully healed.
 *
 * @param {string} target The address of the target node of the heal-attempt.
 * @param {Healer~attemptHealCallback} callback called when the heal attempt is done.
 * @protected
 */
Healer.prototype.attemptHeal = function attemptHeal(target, callback) {
    var self = this;

    var remoteMembership = null;
    var localMembership = self.ringpop.dissemination.fullSync();

    async.waterfall([
        sendJoinRequest,
        generateChanges,
        processChanges
    ], function done(err) {
        if (err) {
            callback(err);
            return;
        }

        var pingableHosts = _.chain(remoteMembership).filter(function isPingable(change) {
            return Member.isStatusPingable(change.status);
        }).pluck('address').value();

        callback(null, pingableHosts);
    });

    function sendJoinRequest(next) {
        self.ringpop.client.protocolJoin({
            host: target,
            retryLimit: self.ringpop.config.get('tchannelRetryLimit'),
            timeout: 1000
        }, {
            app: self.ringpop.app,
            source: self.ringpop.whoami(),
            incarnationNumber: self.ringpop.membership.localMember.incarnationNumber
        }, next);
    }

    function generateChanges(joinResponse, next) {
        remoteMembership = joinResponse.membership;

        // Index local membership by address for faster lookups.
        var localMembershipMap = _.indexBy(localMembership, 'address');

        var localChanges = [];
        var remoteChanges = [];

        for (var i = 0; i < remoteMembership.length; i++) {
            var remoteMember = remoteMembership[i];
            var localMember = localMembershipMap[remoteMember.address];

            if (!localMember) {
                continue;
            }

            // if the local member would become un-pingable after applying the remote change
            if (nodeWouldBecomeUnPingable(localMember, remoteMember)) {
                // mark it locally as suspect
                localChanges.push(_.extend({}, remoteMember, {status: Member.Status.suspect}));
            }

            // if the remote member would become un-pingable after applying the local change
            if (nodeWouldBecomeUnPingable(remoteMember, localMember)) {
                // mark it remotely as suspect
                remoteChanges.push(_.extend({}, localMember, {status: Member.Status.suspect}));
            }
        }

        next(null, localChanges, remoteChanges);
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

    function processChanges(localChanges, remoteChanges, next) {
        if (localChanges.length > 0 || remoteChanges.length > 0) {
            // reincarnate
            reincarnate(localChanges, remoteChanges, next);
        } else {
            // merge
            merge(remoteMembership, next);
        }
    }

    function reincarnate(localChanges, remoteChanges, next) {
        // process local changes
        if (localChanges.length > 0) {
            self.ringpop.membership.update(localChanges);
        }

        // send remote changes
        if (remoteChanges.length > 0) {
            new PingSender(self.ringpop, target).sendChanges(remoteChanges, next);
        } else {
            next(null);
        }
    }

    function merge(remoteMembership, next) {
        // apply remote changes to local member ship
        self.ringpop.membership.update(remoteMembership);

        // sent full local membership to target
        new PingSender(self.ringpop, target).sendChanges(localMembership, next);
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
