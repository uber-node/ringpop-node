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

var test = require('tape');

var core = require('../../lib/trace/core');
var makeTimersMock = require('../lib/timers-mock');
var TracerStore = require('../../lib/trace/store');

test('trace adds/removes work and are idempotent', function t(assert) {
    assert.plan(13);

    var ringpop = new RingpopMock();
    var store = new TracerStore(ringpop);

    var config = core.resolveEventConfig(ringpop, 'membership.checksum.update');
    assert.ok(config, 'event resolves');
    assert.equal(config.sourceEmitter, ringpop.membership, 'config has right membership emitter');
    var opts = {expiresIn: 50, sink: {type: 'log'}};

    // remove from nothing, then add, and again. should end with one tracer
    store.remove(config, opts, function onRemove(err, tracer) {
        assert.false(err, 'no error, idempotent remove');
        assert.false(tracer, 'no tracer, idempotent remove');
    });

    var theTracer = store.add(config, opts, function onAdd(err, tracerOptsStr) {
        assert.false(err, 'no error, add good');
        assert.true(tracerOptsStr, 'tracer added');
    });
    assert.true(theTracer, 'tracer added, double checking');

    store.add(config, opts, function onAdd(err, tracerOptsStr) {
        assert.false(err, 'no error, idempotent add');
        assert.true(tracerOptsStr, 'tracer already added');
    });

    // remove twice, checking both times
    store.remove(config, opts, function onRemove(err, tracerOptsStr) {
        assert.false(err, 'no error, idempotent remove');
        assert.true(tracerOptsStr, 'tracer removed');
    });

    store.remove(config, opts, function onRemove(err, tracerOptsStr) {
        assert.false(err, 'no error, idempotent remove');
        assert.false(tracerOptsStr, 'tracer already removed');
    });
});

test('trace events get traced', function t(assert) {
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

test('trace events can renew, and expire', function t(assert) {
    var timers = makeTimersMock();
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

        timers.advance(25);
        store.add(config, opts);

        timers.advance(49);
        ringpop.membership.emit('checksumUpdate', 'bar');
        assert.equal(ringpop.journal.length, 2, 'trace readd survived timeout');

        timers.advance(1);
        ringpop.membership.emit('checksumUpdate', 'dropped');
        assert.equal(ringpop.journal.length, 2, 'timer dropped trace @timeout');
    });
});

// dumbest of mocks for our trace element
function RingpopMock() {
    var journal = [];
    this.journal = journal;
    this.logger = {
        info: function(_, data) { journal.push(data); },
        warn: function(_, data) { journal.push(data); },
    };
    this.membership = new EventEmitter();
}
