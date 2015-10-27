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

function assertNoPendingChanges(deps, assert) {
    var dissemination = deps.dissemination;
    dissemination.clearChanges();
    assert.true(dissemination.isEmpty(), 'no pending changes');
}

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

testRingpop('stop stops', function t(deps, assert) {
    assert.plan(1);

    var syncer = deps.syncer;
    syncer.start();
    expectSyncerEvent(assert, syncer, 'SyncerStoppedEvent');
    syncer.stop();
});

testRingpop('already started', function t(deps, assert) {
    assert.plan(1);

    var syncer = deps.syncer;
    syncer.start();
    expectSyncerEvent(assert, syncer, 'SyncerAlreadyStartedEvent');
    syncer.start();
});

testRingpop('already stopped', function t(deps, assert) {
    assert.plan(1);

    var syncer = deps.syncer;
    syncer.start();
    syncer.stop();
    expectSyncerEvent(assert, syncer, 'SyncerAlreadyStoppedEvent');
    syncer.stop();
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

testRingpop('no sync target', function t(deps, assert) {
    assert.plan(2);

    assertNoPendingChanges(deps, assert);

    var syncer = deps.syncer;
    syncer.on('event', function onEvent(event) {
        if (event.name === 'NoSyncTargetEvent') {
            assert.pass('no sync target event');
        }
    });
    syncer.sync();
});

testRingpop({
    async: true
}, 'already syncing', function t(deps, assert, done) {
    assert.plan(2);

    // Create a second member to allow syncer to have a target
    // to sync to.
    deps.membership.makeAlive('127.0.0.1:3001', Date.now());

    assertNoPendingChanges(deps, assert);

    // Artificially delay sync request of first sync() call below.
    var timer;
    deps.ringpop.client = {
        destroy: function noop() {},
        protocolSync: function protocolSync(host, head, body, callback) {
            console.log('protocolSync');
            timer = setTimeout(function onTimeout() {
                callback();
            }, 1000);
        }
    };

    var syncer = deps.syncer;
    syncer.on('event', function onEvent(event) {
        if (event.name === 'SyncerAlreadySyncingEvent') {
            assert.pass('syncer already syncing');
            clearTimeout(timer);
            done();
        }
    });
    syncer.sync();
    syncer.sync();
});

testRingpop('changes pending', function t(deps, assert) {
    assert.plan(1);

    // Take note that we're not clearing changes
    // in the dissemination component.
    var syncer = deps.syncer;
    syncer.on('event', function onEvent(event) {
        if (event.name === 'ChangesPendingEvent') {
            assert.pass('changes pending');
        }
    });
    syncer.sync();
});
