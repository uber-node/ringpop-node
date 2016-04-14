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

var largeMembership = require('./large-membership.json');
var mergeJoinResponses = require('../lib/swim/join-response-merge.js');
var Suite = require('benchmark').Suite;

function reportPerformance(event) {
    console.log(event.target.toString());
}

function benchMerge(title, checksum) {
    var responses = [];

    var suite = new Suite();
    suite.add(title, benchThis);
    suite.on('start', init);
    suite.on('cycle', reportPerformance);
    suite.run();

    function benchThis() {
        mergeJoinResponses(responses);
    }

    function init() {
        var members1k = largeMembership.slice(0, 1000);

        for (var i = 0; i < 3; i++) {
            responses.push({
                members: members1k,
                checksum: checksum
            });
        }
    }
}

function benchMergeNoChecksum() {
    benchMerge('merge 3 responses of 1000 members with no checksum');
}

function benchMergeSameChecksum() {
    benchMerge('merge 3 responses of 1000 members with same checksum', 123456789);
}

benchMergeNoChecksum();
benchMergeSameChecksum();
