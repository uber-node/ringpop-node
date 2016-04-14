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

var timerShim = require('timer-shim');

// make a simple wrapper to timerShim which is mostly better than time-mock,
// but lacks its .now function. This has everything that require('timers')
// provides, PLUS .now().  Would be better to add .now to timer-shim, but
// that's for another moment.
function makeTimersMock(start) {
    start = start || 0;

    var t = new timerShim.Timer();
    t.pause();
    var cur = start;
    if (start) {
        t.wind(start);
    }
    return {
        setTimeout: t.setTimeout.bind(t),
        clearTimeout: t.clearTimeout.bind(t),
        setInterval: t.setInterval.bind(t),
        clearInterval: t.clearInterval.bind(t),
        now: function() { return cur; },
        advance: function(s) {
            cur += s;
            t.wind(s);
        }
    }
}

module.exports = makeTimersMock;
