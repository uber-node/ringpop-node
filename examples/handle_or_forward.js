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

var logger = require('winston');
var RelayRequest = require('tchannel/relay_handler').RelayRequest;

/* jshint maxparams: 7 */
module.exports = function handleOrForward(ringpop, key, req, res, arg2, arg3, handle) {
    var dest = ringpop.lookup(key);
    if (dest === ringpop.whoami()) {
        logger.info(ringpop.whoami() + ' handling request...');
        handle(ringpop, key, res, arg2, arg3);
        return;
    }

    logger.info(ringpop.whoami() + ' forwarding request to ' + dest + '...');
    var channel = ringpop.channel;
    var peer = channel.peers.add(dest);
    var outreq = new RelayRequest(channel, peer, req, function buildRes(options) {
        res.headers = options.headers;
        res.code = options.code;
        res.ok = options.ok;
        return res;
    });
    outreq.createOutRequest();
};
