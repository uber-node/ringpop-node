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

var testRingpop = require('../lib/test-ringpop.js');
var TimeMock = require('time-mock');

function expectSyncerEvent(assert, syncer, expectedName) {
    syncer.once('event', function onEvent(event) {
        assert.equals(event.name, expectedName, 'event emitted');
    });
}

testRingpop('start starts', function t(deps, assert) {
    assert.plan(1);

    var syncer = deps.syncer;
    expectSyncerEvent(assert, syncer, 'SyncerStartedEvent');
    syncer.start();
});

testRingpop('already started', function t(deps, assert) {
    assert.plan(1);

    var syncer = deps.syncer;
    syncer.start();
    expectSyncerEvent(assert, syncer, 'SyncerAlreadyStartedEvent');
    syncer.start();
});

testRingpop('can disable', function t(deps, assert) {
    assert.plan(1);

    deps.config.set('syncerEnabled', false);

    var syncer = deps.syncer;
    expectSyncerEvent(assert, syncer, 'SyncerDisabledEvent');
    syncer.start();
});

testRingpop('start syncs', function t(deps, assert) {
    assert.plan(1);

    var syncer = deps.syncer;
    var timers = new TimeMock(Date.now());
    syncer.timers = timers;
    syncer.on('event', function onEvent(event) {
        if (event.name === 'SyncerSyncingEvent') {
            assert.pass('syncer syncing');
        }
    });
    syncer.start();

    // Advancing timer triggers sync interval
    var config = deps.config;
    timers.advance(config.get('syncInterval') + 1);
});
