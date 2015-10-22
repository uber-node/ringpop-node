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

var testRingpopCluster = require('../lib/test-ringpop-cluster.js');

testRingpopCluster({
    size: 2
}, 'sync fails', function t(bootRes, cluster, assert) {
    assert.plan(1);

    var ringpop2 = cluster[1];
    ringpop2.destroy();

    var ringpop1 = cluster[0];
    ringpop1.dissemination.clearChanges();

    var syncer1 = ringpop1.syncer;
    syncer1.on('event', function onEvent(event) {
        if (event.name === 'SyncFailedEvent') {
            assert.pass('sync failed');
            assert.end();
        }
    });
    syncer1.sync();
});

testRingpopCluster({
    size: 2
}, 'sync empty', function t(bootRes, cluster, assert) {
    assert.plan(1);

    var ringpop2 = cluster[1];
    ringpop2.dissemination.clearChanges();

    var syncer1 = cluster[0].syncer;
    syncer1.on('event', function onEvent(event) {
        if (event.name === 'SyncEmptyEvent') {
            assert.pass('sync empty');
            assert.end();
        }
    });
    syncer1.sync();
});

testRingpopCluster({
    size: 2
}, 'synced', function t(bootRes, cluster, assert) {
    assert.plan(2);

    // Different checksums + no changes left to disseminate
    // induces full sync.
    var ringpop1 = cluster[0];
    var ringpop2 = cluster[1];
    ringpop1.dissemination.clearChanges();
    ringpop2.dissemination.clearChanges();
    ringpop1.membership.checksum = ringpop2.membership.checksum + 1;

    var syncer1 = cluster[0].syncer;
    syncer1.on('event', function onEvent(event) {
        if (event.name === 'SyncedEvent') {
            assert.equals(event.membershipChanges.length, 2,
                'received membership changes')
            assert.pass('synced');
            assert.end();
        }
    });
    syncer1.sync();
});
