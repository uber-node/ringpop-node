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

var EventEmitter = require('events').EventEmitter;

var _ = require('underscore');
var test = require('tape');

var PeriodicStats = require('../../lib/stats-periodic');
var makeTimersMock = require('../lib/timers-mock');

test('periodic stats have correct defaults', function t(assert) {
    var opts = null;

    var ringpop = new RingpopMock();
    var stats = new PeriodicStats(ringpop, null);

    assert.equal(stats.periodDefault, 5000, 'period default');
    assert.equal(stats.periodMinimum, 10, 'period minimum');
    assert.equal(stats.ringChecksumPeriod, 5000, 'ring checksum period');

    stats.start();
    assert.deepEqual(ringpop.journal, [], 'empty journal after start');
    ringpop.timers.advance(5000);
    debugger;
    assert.deepEqual(ringpop.journal, [
        // hard ordering, not worth changing for 2. _.contains doesn't work :(
        ['stat', 'gauge', 'membership.checksum-periodic', 0xCAFED00D],
        ['stat', 'gauge', 'ring.checksum-periodic', 0xDEADBEEF]
    ]);

    stats.stop();
    assert.end();
});

test('periodic stats respect period overrides', function t(assert) {
    var opts = {periods: {default: 500, minimum: 20}};;

    var ringpop = new RingpopMock();
    var stats = new PeriodicStats(ringpop, opts);

    assert.equal(stats.periodDefault, 500, 'period default');
    assert.equal(stats.periodMinimum, 20, 'period minimum');
    assert.equal(stats.ringChecksumPeriod, 500, 'ring checksum period');

    stats.start();
    assert.deepEqual(ringpop.journal, [], 'empty journal after start');
    ringpop.timers.advance(500);
    assert.deepEqual(ringpop.journal, [
        // hard ordering, not worth changing for 2. _.contains doesn't work :(
        ['stat', 'gauge', 'membership.checksum-periodic', 0xCAFED00D],
        ['stat', 'gauge', 'ring.checksum-periodic', 0xDEADBEEF]
    ]);

    stats.stop();
    assert.end();
});

test('periodic stats bounded by minimum', function t(assert) {
    var opts = {periods: {ringChecksum: 5}};

    var ringpop = new RingpopMock();
    var stats = new PeriodicStats(ringpop, opts);

    assert.equal(stats.ringChecksumPeriod, 10, 'ring checksum period');
    assert.deepEqual(
        ringpop.journal[0],
        ['logger.info', 'too aggressive stats period found; using minimum', {local: 'me', minimum: 10, period: 5}]);

    stats.start();
    ringpop.timers.advance(10);
    assert.deepEqual(ringpop.journal[1], ['stat', 'gauge', 'ring.checksum-periodic', 0xDEADBEEF]);

    stats.stop();
    assert.end();
});

test('ringChecksumPeriod honored if in bounds', function t(assert) {
    var opts = {periods: {ringChecksum: 42}};

    var ringpop = new RingpopMock();
    var stats = new PeriodicStats(ringpop, opts);

    assert.equal(stats.ringChecksumPeriod, 42, 'ring checksum period');

    stats.start();
    assert.deepEqual(ringpop.journal, [], 'empty journal after start');
    ringpop.timers.advance(42);
    assert.deepEqual(ringpop.journal, [['stat', 'gauge', 'ring.checksum-periodic', 0xDEADBEEF]]);

    stats.stop();
    assert.end();
});

test('ringChecksumPeriod survives invalid option', function t(assert) {
    var opts = {periods: {ringChecksum: 'invalid period'}};

    var ringpop = new RingpopMock();
    var stats = new PeriodicStats(ringpop, opts);

    assert.equal(stats.ringChecksumPeriod, 5000, 'ring checksum period');
    assert.deepEqual(
        ringpop.journal[0],
        ['logger.warn', 'invalid stats period found; using default', {local: 'me', default: 5000, period: 'invalid period'}]);

    assert.end();
});

test('start/stop works too', function t(assert) {
    var ringpop = new RingpopMock();
    var stats = new PeriodicStats(ringpop, null);

    // confirm that nothing is generated until start, and that after stop, no more.
    assert.deepEqual(ringpop.journal, [], 'journal empty');
    ringpop.timers.advance(10000);
    assert.deepEqual(ringpop.journal, [], 'journal empty before start after 10s');

    stats.start();
    ringpop.timers.advance(5000);
    // hard ordering, not worth changing for 2. _.contains doesn't work :(
    assert.deepEqual(ringpop.journal.length, 2, 'journal contains 1 entry');
    assert.deepEqual(ringpop.journal[0][3], 0xCAFED00D, 'journal contains checksum');
    assert.deepEqual(ringpop.journal[1][3], 0xDEADBEEF, 'journal contains checksum');
    ringpop.journal = [];

    stats.stop();
    ringpop.timers.advance(5000);
    assert.deepEqual(ringpop.journal, [], 'journal contains nothing new after stop');

    assert.end();
});

test.skip('trace events get traced', function t(assert) {
    var ringpop = new RingpopMock();
    var store = new TracerStore(ringpop);
    var config = core.resolveEventConfig(ringpop, 'membership.checksum.update');
    var opts = {expiresIn: 50, sink: {type: 'log'}};
    var tracer = store.add(config, opts);

    assert.plan(5);
    tracer.on('connectSink', function onTracer() {
        // now test events on this thing
        assert.equal(ringpop.journal.length, 0, 'journal starts empty');
        ringpop.membership.emit('checksumUpdate', 'foo');
        assert.equal(ringpop.journal.length, 1, 'journal has 1 entry');
        assert.equal(ringpop.journal[0], 'foo', 'journal added foo');

        ringpop.membership.emit('checksumUpdate', 'bar');
        assert.equal(ringpop.journal.length, 2, 'journal has 2 entries');
        assert.equal(ringpop.journal[1], 'bar', 'journal added bar');
    });
});

test.skip('trace events can renew, and expire', function t(assert) {
    var ringpop = new RingpopMock();
    var store = new TracerStore(ringpop, { timers: timers });
    var config = core.resolveEventConfig(ringpop, 'membership.checksum.update');
    var opts = {expiresIn: 50, sink: {type: 'log'}};
    store.add(config, opts);

    assert.plan(3);

    // nextTick okay since log "connects" instantly
    process.nextTick(function onTracer() {
        ringpop.membership.emit('checksumUpdate', 'foo');
        assert.equal(ringpop.journal.length, 1, 'trace added correctly');

        timer.advance(25);
        store.add(config, opts);

        timer.advance(49);
        ringpop.membership.emit('checksumUpdate', 'bar');
        assert.equal(ringpop.journal.length, 2, 'trace readd survived timeout');

        timer.advance(1);
        ringpop.membership.emit('checksumUpdate', 'dropped');
        assert.equal(ringpop.journal.length, 2, 'timer dropped trace @timeout');
    });
});

// dumbest of mocks for our trace element
function RingpopMock() {
    var journal = [];
    var push = function() {
        journal.push(Array.prototype.slice.call(arguments));
    }

    this.journal = journal;
    this.logger = {
        info: push.bind(null, 'logger.info'),
        warn: push.bind(null, 'logger.warn'),
    };
    this.membership = {checksum: 0xCAFED00D};
    this.ring = {checksum: 0xDEADBEEF};
    this.stat = push.bind(null, 'stat');
    this.timers = makeTimersMock();
    this.whoami = function() { return 'me'; };
}
