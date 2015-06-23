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
var largeMembership = require('./large-membership.json');
var Ringpop = require('../index.js');
var Suite = require('benchmark').Suite;

function init(size) {
    var ringpop = new Ringpop({
        app: 'ringpop-bench',
        hostPort: '127.0.0.1:3000'
    });

    ringpop.membership.update(largeMembership.slice(0, size));

    return ringpop;
}

function reportPerformance(event) {
    console.log(event.target.toString());
}

function runBenchmark(title, benchmark) {
    var suite = new Suite();
    suite.add(title, benchmark);
    suite.on('cycle', reportPerformance);
    suite.run();
}

function run100MemberBenchmark() {
    var ringpop = init(100);

    runBenchmark('compute checksum for 100 members', function benchmark() {
        ringpop.membership.computeChecksum();
    });
}

function run1kMemberBenchmark() {
    var ringpop = init(1000);

    runBenchmark('compute checksum for 1000 members', function benchmark() {
        ringpop.membership.computeChecksum();
    });
}

run100MemberBenchmark();
run1kMemberBenchmark();
