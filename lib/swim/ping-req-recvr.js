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

var sendPing = require('./ping-sender.js');
var TypedError = require('error/typed');

var PingReqTargetUnreachableError = TypedError({
    type: 'ringpop.ping-req.target-unreachable',
    message: 'Ping-req target is unreachable',
    changes: null,
    nameAsThrift: 'pingReqTargetUnreachable'
});

module.exports = function recvPingReq(opts, callback) {
    var ringpop = opts.ringpop;

    ringpop.stat('increment', 'ping-req.recv');

    var target = opts.target;
    var changes = opts.changes;
    var checksum = opts.checksum;

    ringpop.serverRate.mark();
    ringpop.totalRate.mark();
    ringpop.membership.update(changes);

    ringpop.debugLog('ping-req send ping target=' + target, 'p');

    var start = new Date();
    sendPing({
        ringpop: ringpop,
        target: target
    }, function (isOk, res) {
        var err = !isOk;

        ringpop.stat('timing', 'ping-req-ping', start);
        ringpop.debugLog('ping-req recv ping target=' + target + ' isOk=' + isOk, 'p');

        if (err) {
            callback(PingReqTargetUnreachableError({
                changes: ringpop.dissemination.issueChanges(checksum)
            }));
            return;
        }

        ringpop.membership.update(res.changes);

        callback(null, {
            changes: ringpop.dissemination.issueChanges(checksum)
        });
    });
};
