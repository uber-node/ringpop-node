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

var RingPop = require('../index.js');
var Suite = require('benchmark').Suite;

var ringpop;

function init() {
    ringpop = new RingPop({
        app: 'ringpop-bench',
        hostPort: '127.0.0.1:3000'
    });
}

function reportPerformance(event) {
    console.log(event.target.toString());
}

function benchThis() {
    ringpop.stat('gauge', 'num-members', 10);
    ringpop.statKeys = {}; // benchmark does not support setup/teardown per sample
}

var benchmark = new Suite();
benchmark.add('stat() without caching', benchThis)
    .on('start', init)
    .on('cycle', reportPerformance)
    .run();
