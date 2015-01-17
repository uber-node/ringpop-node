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

var TChannel = require('tchannel');

var DebuglogLogger = require('../../lib/debug-log-logger.js');
var RingPop = require('../../index.js');

module.exports = allocRingpop;

function allocRingpop(name, options) {
    var host = 'localhost';
    var port = semiRandPort();

    var hostPort = host + ':' + String(port);

    var tchannel = TChannel({
        host: host,
        port: port,
        timers: options && options.timers,
        logger: DebuglogLogger('proxy_req_test:' + name, 'tchannel')
    });
    var ringpop = RingPop({
        app: 'test.ringpop.proxy_req_test',
        hostPort: hostPort,
        logger: DebuglogLogger('proxy_req_test: ' + name),
        channel: tchannel
    });

    ringpop.setupChannel();
    return ringpop;
}

function semiRandPort() {
    var base = 20000;
    var rand = Math.floor(Math.random() * 20000);

    return base + rand;
}
