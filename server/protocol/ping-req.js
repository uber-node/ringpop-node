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

var safeParse = require('../../lib/util').safeParse;
var sendPing = require('../../lib/swim/ping-sender.js');

module.exports = function createPingReqHandler(ringpop) {
    return function handlePingReq(arg1, arg2, hostInfo, callback) {
        ringpop.stat('increment', 'ping-req.recv');

        var body = safeParse(arg2);

        // NOTE sourceIncarnationNumber is an optional argument. It was not present
        // until after the v9.8.12 release.
        if (body === null || !body.source || !body.target || !body.changes || !body.checksum) {
            return callback(new Error('need req body with source, target, changes, and checksum'));
        }

        var source = body.source;
        var sourceIncarnationNumber = body.sourceIncarnationNumber;
        var target = body.target;
        var changes = body.changes;
        var checksum = body.checksum;

        ringpop.serverRate.mark();
        ringpop.totalRate.mark();
        ringpop.membership.update(changes);

        ringpop.debugLog('ping-req send ping source=' + source + ' target=' + target, 'p');

        var start = new Date();
        sendPing({
            ringpop: ringpop,
            target: target
        }, function (isOk, body) {
            ringpop.stat('timing', 'ping-req-ping', start);
            ringpop.debugLog('ping-req recv ping source=' + source + ' target=' + target + ' isOk=' + isOk, 'p');

            if (isOk) {
                ringpop.membership.update(body.changes);
            }

            callback(null, null, JSON.stringify({
                changes: ringpop.dissemination.issueAsReceiver(source,
                    sourceIncarnationNumber, checksum),
                pingStatus: isOk,
                target: target
            }));
        });
    };
};
