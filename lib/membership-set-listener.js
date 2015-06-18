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

var Member = require('./member.js');

module.exports = function createMembershipSetListener(ringpop) {
    return function onMembershipSet(updates) {
        var serversToAdd = [];

        for (var i = 0; i < updates.length; i++) {
            var update = updates[i];

            if (update.status === Member.Status.alive) {
                ringpop.stat('increment', 'membership-update.alive');
                serversToAdd.push(update.address);
            } else if (update.status === Member.Status.suspect) {
                ringpop.stat('increment', 'membership-update.suspect');
                ringpop.suspicion.start(update);
            } else if (update.status === Member.Status.faulty) {
                ringpop.stat('increment', 'membership-update.faulty');
            } else if (update.status === Member.Status.leave) {
                ringpop.stat('increment', 'membership-update.leave');
            }
        }

        // Must add/remove servers from ring in batch. There are
        // efficiency gains when only having to compute the ring
        // checksum once.
        if (serversToAdd.length > 0) {
            ringpop.ring.addRemoveServers(serversToAdd);
        }
    };
};
