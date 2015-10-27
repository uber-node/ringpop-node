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

var RequestResponse = require('../../request_response.js');
var safeParse = require('../../lib/util.js').safeParse;
var zlib = require('zlib');

var SyncResponseHeaders = RequestResponse.SyncResponseHeaders;

module.exports = function createSyncHandler(ringpop) {
    return function handleSync(arg2, arg3, hostInfo, callback) {
        ringpop.stat('increment', 'sync.recv');

        var head = safeParse(arg2 && arg2.toString());
        var body = safeParse(arg3 && arg3.toString());
        if (!body || !body.membershipChecksum) {
            callback(new Error('Bad request: membershipChecksum is required'));
            return;
        }

        var respHead = new SyncResponseHeaders(head && head.gzip);
        var respHeadStr = JSON.stringify(respHead);
        var payload = JSON.stringify({
            membershipChecksum: ringpop.membership.checksum,
            membershipChanges: ringpop.dissemination.maybeFullSync(
                body.membershipChecksum)
        });

        if (respHead.gzip === true) {
            var start = Date.now();
            var prezip = new Buffer(payload);
            ringpop.stat('gauge', 'sync.size.prezip', prezip.length);
            zlib.gzip(prezip, function onZip(err, postzip) {
                ringpop.stat('timing', 'sync.gzip', Date.now() - start);
                if (err) {
                    ringpop.logger.warn('ringpop sync gzip error', {
                        local: ringpop.whoami(),
                        err: err
                    });
                    callback(err);
                    return;
                }

                ringpop.stat('gauge', 'sync.size.postzip', postzip.length);
                callback(null, respHeadStr, postzip);
            });
            return;
        }

        callback(null, respHeadStr, payload);
    };
};
