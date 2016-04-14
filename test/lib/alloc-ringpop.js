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

var TChannel = require('tchannel');

var makeTimersMock = require('../lib/timers-mock');

var globalTimers = {
    setTimeout: require('timers').setTimeout,
    clearTimeout: require('timers').clearTimeout,
    now: Date.now
};
var DebuglogLogger = require('debug-logtron');
var RingPop = require('../../index.js');

module.exports = allocRingpop;

function allocRingpop(name, options) {
    options = options || {};

    var host = '127.0.0.1';
    var port = semiRandPort();

    var tchannel = TChannel({
        timers: (options && options.timers) || globalTimers,
        logger: DebuglogLogger((name && name + 'tchannel') || 'tchannel')
    });

    var timers = makeTimersMock();
    var ringpop = new RingPop({
        app: 'test.ringpop.proxy_req_test',
        hostPort: host + ':' + String(port),
        channel: tchannel.makeSubChannel({
            serviceName: 'ringpop',
            trace: false
        }),
        logger: DebuglogLogger(name || 'ringpop'),
        requestProxyMaxRetries: options.requestProxyMaxRetries,
        requestProxyRetrySchedule: options.requestProxyRetrySchedule,
        enforceConsistency: options.enforceConsistency,
        setTimeout: options.useFakeTimers && timers.setTimeout
    });

    ringpop.setupChannel();
    ringpop.timers = timers;
    return ringpop;
}

function semiRandPort() {
    var base = 10000;
    var rand = Math.floor(Math.random() * 10000);

    return base + rand;
}
