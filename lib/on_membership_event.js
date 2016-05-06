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

var Member = require('./membership/member.js');
var MembershipEvents = require('./membership/events.js');

function createChecksumComputedHandler(ringpop) {
    var membershipLogger = ringpop.loggerFactory.getLogger('membership');

    return function onMembershipChecksumComputed(event) {
        ringpop.stat('increment', 'membership.checksum-computed');
        ringpop.stat('gauge', 'membership.checksum', event.checksum);
        ringpop.emit('membershipChecksumComputed');

        if (event.oldChecksum !== event.checksum) {
            membershipLogger.debug('ringpop membership computed new checksum', {
                local: ringpop.whoami(),
                checksum: event.checksum,
                oldChecksum: event.oldChecksum,
                timestamp: event.timestamp
            });
        }
    };
}

function createEventHandler(ringpop) {
    return function onEvent(event) {
        switch (event.name) {
            case MembershipEvents.LocalMemberLeaveEvent.name:
                ringpop.gossip.stop();
                ringpop.stateTransitions.disable();
                break;
        }
    };
}

function createSetHandler(ringpop) {
    return function onMembershipSet(updates) {
        var serversToAdd = [];

        for (var i = 0; i < updates.length; i++) {
            var update = updates[i];

            ringpop.stat('increment', 'membership-set.' + (update.status || 'unknown'));

            if (update.status === Member.Status.alive) {
                serversToAdd.push(update.address);
            } else if (update.status === Member.Status.suspect) {
                serversToAdd.push(update.address);
                ringpop.stateTransitions.scheduleSuspectToFaulty(update);
            }
        }

        // Must add/remove servers from ring in batch. There are
        // efficiency gains when only having to compute the ring
        // checksum once.
        if (serversToAdd.length > 0) {
            ringpop.ring.addRemoveServers(serversToAdd, []);
        }
    };
}

function createSuppressLimitExceededHandler(ringpop) {
    return function onSuppressLimitExceeded(event) {
        ringpop.damper.addFlapper(event.member);
    };
}

function createReusableHandler(ringpop) {
    return function onReusable(event) {
        ringpop.damper.removeFlapper(event.member);
    };
}

function createUpdatedHandler(ringpop) {
    return function onMembershipUpdated(updates) {
        for (var i = 0; i < updates.length; i++) {
            var update = updates[i];
            ringpop.stat('increment', 'membership-update.' +
                (update.status || 'unknown'));
        }

        if (ringpop.config.get('membershipUpdateRollupEnabled')) {
            ringpop.membershipUpdateRollup.trackUpdates(updates);
        }

        ringpop.stat('gauge', 'num-members', ringpop.membership.members.length);
        ringpop.stat('timing', 'updates', updates.length);
        ringpop.emit('membershipChanged');
        ringpop.emit('changed'); // Deprecated
    };
}

function createUpdatedHandlerForGossip(ringpop) {
    return function onUpdated(updates) {
        for (var i = 0; i < updates.length; i++) {
            var update = updates[i];
            switch (update.status) {
                case Member.Status.alive:
                case Member.Status.leave:
                    ringpop.stateTransitions.cancel(update);
                    break;
                case Member.Status.suspect:
                    ringpop.stateTransitions.scheduleSuspectToFaulty(update);
                    break;
                case Member.Status.faulty:
                    ringpop.stateTransitions.scheduleFaultyToTombstone(update);
                    break;
                case Member.Status.tombstone:
                    ringpop.stateTransitions.scheduleTombstoneToEvict(update);
                    break;
            }

            ringpop.dissemination.recordChange(update);
        }
    };
}

function createUpdatedHandlerForRing(ringpop) {
    return function onUpdated(updates) {
        var serversToAdd = [], serversToRemove = [];
        for (var i = 0; i < updates.length; i++) {
            var update = updates[i];
            switch (update.status) {
                case Member.Status.alive:
                case Member.Status.suspect:
                    serversToAdd.push(update.address);
                    break;
                case Member.Status.faulty:
                case Member.Status.leave:
                case Member.Status.tombstone:
                    serversToRemove.push(update.address);
                    break;
            }
        }

        // Must add/remove servers from ring in batch. There are
        // efficiency gains when only having to compute the ring
        // checksum once.
        if (serversToAdd.length > 0 || serversToRemove.length > 0) {
            ringpop.ring.addRemoveServers(serversToAdd,
                serversToRemove);
        }
    };
}

function register(ringpop) {
    var membership = ringpop.membership;
    membership.on('checksumComputed', createChecksumComputedHandler(ringpop));
    membership.on('event', createEventHandler(ringpop));
    membership.on('memberReusable', createReusableHandler(ringpop));
    membership.on('memberSuppressLimitExceeded',
        createSuppressLimitExceededHandler(ringpop));
    membership.on('set', createSetHandler(ringpop));
    membership.on('updated', createUpdatedHandler(ringpop));
    membership.on('updated', createUpdatedHandlerForGossip(ringpop));
    membership.on('updated', createUpdatedHandlerForRing(ringpop));
}

module.exports = {
    createChecksumComputedHandler: createChecksumComputedHandler,
    createEventHandler: createEventHandler,
    createReusableHandler: createReusableHandler,
    createSetHandler: createSetHandler,
    createSuppressLimitExceededHandler: createSuppressLimitExceededHandler,
    createUpdatedHandler: createUpdatedHandler,
    createUpdatedHandlerForGossip: createUpdatedHandlerForGossip,
    createUpdatedHandlerForRing: createUpdatedHandlerForRing,
    register: register
};
