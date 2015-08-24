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

var Member = require('./membership/member.js');

module.exports = function createListener(ringpop) {
    return function onMembershipUpdated(updates) {
        var serversToAdd = [];
        var serversToRemove = [];

        for (var i = 0; i < updates.length; i++) {
            var update = updates[i];

            ringpop.stat('increment', 'membership-update.' + (update.status || 'unknown'));

            if (update.status === Member.Status.alive) {
                serversToAdd.push(update.address);
                ringpop.suspicion.stop(update);
            } else if (update.status === Member.Status.suspect) {
                ringpop.suspicion.start(update);
            } else if (update.status === Member.Status.faulty) {
                serversToRemove.push(update.address);
                ringpop.suspicion.stop(update);
            } else if (update.status === Member.Status.leave) {
                serversToRemove.push(update.address);
                ringpop.suspicion.stop(update);
            }

            ringpop.dissemination.recordChange(update);

            ringpop.logger.debug('member updated', {
                local: ringpop.whoami(),
                address: update.address,
                incarnationNumber: update.incarnationNumber,
                status: update.status
            });
        }

        // Must add/remove servers from ring in batch. There are
        // efficiency gains when only having to compute the ring
        // checksum once.
        if (serversToAdd.length > 0 || serversToRemove.length > 0) {
            var ringChanged = ringpop.ring.addRemoveServers(serversToAdd, serversToRemove);

            if (ringChanged) {
                ringpop.emit('ringChanged');
            }
        }

        ringpop.membershipUpdateRollup.trackUpdates(updates);

        ringpop.stat('gauge', 'num-members', ringpop.membership.members.length);
        ringpop.stat('timing', 'updates', updates.length);

        ringpop.emit('membershipChanged');
        ringpop.emit('changed'); // Deprecated
    };
};
