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
var TimeMock = require('time-mock');

var DebuglogLogger = require('debug-logtron');
var RingPop = require('../../index.js');

module.exports = allocRingpop;

function allocRingpop(name, options) {
    options = options || {};

    var host = '127.0.0.1';
    var port = semiRandPort();

    var hostPort = host + ':' + String(port);

    var tchannel = TChannel({
        timers: options && options.timers,
        logger: DebuglogLogger((name && name + 'tchannel') || 'tchannel')
    });

    var timers = TimeMock(Date.now());
    var ringpop = RingPop({
        app: 'test.ringpop.proxy_req_test',
        hostPort: hostPort,
        channel: tchannel,
        logger: DebuglogLogger(name || 'ringpop'),
        requestProxyMaxRetries: options.requestProxyMaxRetries,
        requestProxyRetrySchedule: options.requestProxyRetrySchedule,
        setTimeout: options.useFakeTimers && timers.setTimeout
    });

    ringpop.setupChannel();
    ringpop.timers = timers;
    return ringpop;
}

function semiRandPort() {
    var base = 20000;
    var rand = Math.floor(Math.random() * 20000);

    return base + rand;
}
