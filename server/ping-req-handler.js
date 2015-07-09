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

var sendPing = require('../lib/swim/ping-sender.js');
var thriftUtils = require('./thrift-utils.js');
var TypedError = require('error/typed');

var respondWithBadRequest = thriftUtils.respondWithBadRequest;
var validateBodyParams = thriftUtils.validateBodyParams;
var wrapCallbackAsThrift = thriftUtils.wrapCallbackAsThrift;

var PingReqTargetUnreachableError = TypedError({
    type: 'ringpop.ping-req.target-unreachable',
    message: 'Ping-req target is unreachable',
    changes: null,
    nameAsThrift: 'pingReqTargetUnreachable'
});

module.exports = function createPingReqHandler(ringpop) {
    /* jshint maxparams: 6 */
    return function handlePingReq(opts, req, head, body, callback) {
        ringpop.stat('increment', 'ping-req.recv');

        if (!body) {
            respondWithBadRequest(callback, 'body is required');
            return;
        }

        if (!validateBodyParams(body, ['target', 'changes', 'checksum',
            'source', 'sourceIncarnationNumber'], callback)) {
            return;
        }

        ringpop.serverRate.mark();
        ringpop.totalRate.mark();
        ringpop.membership.update(body.changes);

        ringpop.debugLog('ping-req send ping target=' + body.target, 'p');

        var start = new Date();

        sendPing({
            ringpop: ringpop,
            target: body.target
        }, onPing);

        function onPing(isOk, res) {
            var err = !isOk;

            ringpop.stat('timing', 'ping-req-ping', start);
            ringpop.debugLog('ping-req recv ping target=' + body.target + ' isOk=' + isOk, 'p');

            var changes = ringpop.dissemination.issueAsReceiver(body.source,
                body.sourceIncarnationNumber, body.checksum);

            var thriftCallback = wrapCallbackAsThrift(callback);

            if (err) {
                thriftCallback(PingReqTargetUnreachableError({
                    changes: changes
                }));
                return;
            }

            ringpop.membership.update(res.changes);

            thriftCallback(null, {
                changes: changes
            });
        }
    };
};
