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

var errors = require('../../lib/errors.js');

module.exports = function createPingHandler(ringpop) {
    return function handlePing(arg1, arg2, hostInfo, callback) {
        ringpop.stat('increment', 'ping.recv');

        if (!ringpop.isReady) {
            ringpop.stat('increment', 'not-ready.ping');
            callback(new errors.RingpopIsNotReadyError());
            return;
        }

        var body = arg2;

        // NOTE sourceIncarnationNumber is an optional argument. It was not present
        // until after the v9.8.12 release.
        if (body === null || !body.source || !body.changes || !body.checksum) {
            return callback(new Error('need req body with source, changes, and checksum'));
        }

        var source = body.source;
        var sourceIncarnationNumber = body.sourceIncarnationNumber;
        var changes = body.changes;
        var checksum = body.checksum;

        ringpop.serverRate.mark();
        ringpop.totalRate.mark();

        ringpop.membership.update(changes);

        var res = ringpop.dissemination.issueAsReceiver(source,
            sourceIncarnationNumber, checksum);

        if (res.fullSync) {
            ringpop.dissemination.tryStartReverseFullSync(source, ringpop.maxJoinDuration);
        }
        callback(null, null, {
            changes: res.changes,
        });
    };
};
