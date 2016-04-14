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

var MembershipUpdateRollup = require('../../lib/membership/rollup.js');
var Ringpop = require('../../index.js');
var test = require('tape');
var testRingpop = require('../lib/test-ringpop.js');

var localMemberUpdate = {
    address: '127.0.0.1:3000',
    incarnationNumber: 123456789,
    status: 'alive'
};
var remoteMemberUpdate = {
    address: '127.0.0.1:3001',
    incarnationNumber: 123456789,
    status: 'alive'
};
var updates = [
    localMemberUpdate,
    remoteMemberUpdate
];

testRingpop('track handles empty/invalid array', function t(deps, assert) {
    var rollup = deps.rollup;

    assert.doesNotThrow(function noThrow() {
        rollup.trackUpdates();
    }, null, 'no updates does not throw');
    assert.doesNotThrow(function noThrow() {
        rollup.trackUpdates([]);
    }, null, 'empty array does not throw');
});

testRingpop('track sets flush timer', function t(deps, assert) {
    var rollup = deps.rollup;
    rollup.trackUpdates(updates);
    assert.ok(rollup.flushTimer, 'flush timer is set');
});

testRingpop('flushes buffer if time since last update exceeds flush interval', function t(deps, assert) {
    assert.plan(1);

    var rollup = deps.rollup;
    rollup.flushInterval = 123456789;

    // `trackUpdates` kicks off timer that sets to expire after `flushInterval`
    rollup.on('flush', assert.fail);
    rollup.trackUpdates(updates);
    rollup.removeAllListeners();

    rollup.lastUpdateTime = 0; // Simulate passing time
    rollup.on('flushed', onFlushed);
    rollup.trackUpdates(updates);

    function onFlushed() {
        assert.pass('buffer flushed');
    }
});

testRingpop('flush multiple times', function t(deps, assert) {
    assert.plan(2);

    var rollup = deps.rollup;

    assertFlushed();
    assertFlushed();

    function assertFlushed() {
        rollup.once('flushed', onFlushed);
        rollup.trackUpdates(updates);
        rollup.flushBuffer();
    }

    function onFlushed() {
        assert.pass('flushed');
    }
});

test('initializes max num updates', function t(assert) {
    var maxNumUpdates = updates.length - 1;

    var rollup = new MembershipUpdateRollup({
        maxNumUpdates: maxNumUpdates
    });

    assert.equal(rollup.maxNumUpdates, maxNumUpdates, 'maxNumUpdates is set');
    assert.end();
});
