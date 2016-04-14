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

var mergeMembershipChangesets = require('../../lib/membership/merge.js');
var testRingpop = require('../lib/test-ringpop.js');

testRingpop('merges incarnation numbers', function t(deps, assert) {
    var changesets = [firstChangeset(), secondChangeset()];

    assert.deepEqual(mergeMembershipChangesets(deps.ringpop, changesets),
        expectedChangeset(), 'updates are merged');

    function createUpdate(address, status, incarnationNumber) {
        return {
            address: address,
            status: status,
            incarnationNumber: incarnationNumber
        };
    }

    function firstChangeset() {
        return [
            createUpdate('127.0.0.1:3001', 'suspect', 1),
            createUpdate('127.0.0.1:3002', 'alive', 2)
        ];
    }

    function secondChangeset() {
        return [
            createUpdate('127.0.0.1:3001', 'alive', 2),
            createUpdate('127.0.0.1:3002', 'suspect', 1),
            createUpdate('127.0.0.1:3003', 'faulty', 1)
        ];
    }

    function expectedChangeset() {
        return [
            createUpdate('127.0.0.1:3001', 'alive', 2),
            createUpdate('127.0.0.1:3002', 'alive', 2),
            createUpdate('127.0.0.1:3003', 'faulty', 1),
        ];
    }
});
