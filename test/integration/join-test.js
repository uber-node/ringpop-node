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

var test = require('tape');

var allocRingpop = require('../lib/alloc-ringpop.js');
var testRingpopCluster = require('../lib/test-ringpop-cluster.js');

test('bootstrap with self is ok', function t(assert) {
    var ringpop = allocRingpop();

    ringpop.bootstrap([ringpop.whoami()], onBootstrap);

    function onBootstrap(err) {
        assert.ifError(err);
        ringpop.destroy();
        assert.end();
    }
});

testRingpopCluster({
    size: 1,
    waitForConvergence: false
}, 'one node can join', function t(bootRes, cluster, assert) {
    assert.ifErr(bootRes[cluster[0].whoami()].err, 'no error occurred');
    assert.end();
});

testRingpopCluster({
    size: 2
}, 'two nodes can join', function t(bootRes, cluster, assert) {
    assert.equal(cluster.length, 2, 'cluster of 2');

    cluster.forEach(function eachNode(node) {
        assert.ok(node.isReady, 'node is ready');
    });

    assert.end();
});

testRingpopCluster('three nodes can join', function t(bootRes, cluster, assert) {
    assert.equal(cluster.length, 3, 'cluster of 3');

    cluster.forEach(function eachNode(node) {
        assert.ok(node.isReady, 'node is ready');
    });

    assert.end();
});

testRingpopCluster({
    joinSize: 1,
    tap: function tap(cluster) {
        cluster[2].denyJoins();
    }
}, 'three nodes, one of them bad, join size equals one', function t(bootRes, cluster, assert) {
    assert.equal(cluster.length, 3, 'cluster of 3');

    var badNode = cluster[2].whoami();

    cluster.forEach(function eachNode(node) {
        assert.ok(node.isReady, 'node is ready');
        var nodesJoined = bootRes[node.whoami()].nodesJoined;
        assert.ok(nodesJoined.length >= 1, 'joined at least one other node');
        assert.ok(nodesJoined.indexOf(badNode) === -1, 'no one can join bad node');
    });

    assert.end();
});

testRingpopCluster({
    joinSize: 2,
    maxJoinDuration: 100,
    tap: function tap(cluster) {
        cluster[1].denyJoins();
        cluster[2].denyJoins();
    },
    waitForConvergence: false
}, 'three nodes, two of them bad, join size equals two', function t(bootRes, cluster, assert) {
    assert.equal(cluster.length, 3, 'cluster of 3');

    cluster.forEach(function eachNode(node) {
        assert.notok(node.isReady, 'node is not ready');
        assert.equal(bootRes[node.whoami()].err.type,
            'ringpop.join-duration-exceeded',
            'join duration exceeded error');
    });

    assert.end();
});

testRingpopCluster({
    // We disable gossip because we don't want to exhaust the changes through pings
    autoGossip: false,
    waitForConvergence: false
}, 'do not disseminate join list', function t(bootRes, cluster, assert) {
    assert.plan(9);
    cluster.forEach(function eachNode(node) {
        assert.equal(node.dissemination.getChangesCount(), 1, 'only one change to be disseminated');
        var change = node.dissemination.getChangeByAddress(node.whoami());
        assert.ok(change, 'changes should contain this node\'s address');
        assert.equal(change.address, node.whoami(), 'address matches');
    });
    assert.end();
});

testRingpopCluster({
    size: 25
}, 'mega cluster', function t(bootRes, cluster, assert) {
    assert.equal(cluster.length, 25, 'cluser of 25');

    cluster.forEach(function eachNode(node) {
        assert.ok(node.isReady, 'node is bootstrapped');
    });

    assert.end();
});

testRingpopCluster({
    size: 2,
    tap: function tap(cluster) {
        cluster[1].channel.register('/protocol/join', function protocolJoin(req, res) {
            setTimeout(function onTimeout() {
                cluster[0].destroy();

                res.headers.as = 'raw';
                res.sendOk(null, JSON.stringify({
                    app: 'test',
                    coordinator: cluster[1].whoami(),
                    membership: cluster[1].dissemination.membershipAsChanges()
                }));
            }, 100);
        });
    },
    waitForConvergence: false
}, 'slow joiner', function t(bootRes, cluster, assert) {
    assert.equal(cluster.length, 2, 'cluster of 2');

    var slowJoiner = cluster[0];
    assert.notok(slowJoiner.isReady, 'node one is not ready');
    assert.equal(bootRes[slowJoiner.whoami()].err.type, 'ringpop.join-aborted',
        'join aborted error');

    assert.ok(cluster[1].isReady, 'node two is ready');
    assert.end();
});

// This is a 3-node test. All nodes need to join a minimum of 2 other nodes.
// Node 0 has been blacklisted by Node 1 so it can't possibly join 2 others.
// Node 0's bootstrap is expected to fail.
testRingpopCluster({
    size: 3,
    tap: function tap(cluster) {
        // Setting join config will make Node 0's join fail faster
        cluster[0].config.set('joinDelayMax', 0);
        cluster[0].config.set('joinDelayMin', 0);
        cluster[0].config.set('maxJoinDuration', 1);
        cluster[1].config.set('memberBlacklist', [/127.0.0.1:10000/]);
    },
    waitForConvergence: false,
    checkChecksums: false
}, 'join blacklist', function t(bootRes, cluster, assert) {
    assert.notok(cluster[0].isReady, 'node one is not ready');
    assert.ok(cluster[1].isReady, 'node two is ready');
    assert.ok(cluster[2].isReady, 'node three is ready');
    assert.end();
});
