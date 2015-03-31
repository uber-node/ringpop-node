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

var test = require('tape');

var allocRingpop = require('../lib/alloc-ringpop.js');
var testRingpopCluster = require('../lib/test-ringpop-cluster.js');

test('bootstrap with self is ok', function t(assert) {
    var ringpop = allocRingpop();

    ringpop.bootstrap([ringpop.hostPort], onBootstrap);

    function onBootstrap(err) {
        assert.ifError(err);
        ringpop.destroy();
        assert.end();
    }
});

testRingpopCluster({
    size: 1
}, 'one node can join', function t(bootRes, cluster, assert) {
    assert.ifErr(bootRes[cluster[0].hostPort].err, 'no error occurred');
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

    var badNode = cluster[2].hostPort;

    cluster.forEach(function eachNode(node) {
        assert.ok(node.isReady, 'node is bootstrapped');

        var nodesJoined = bootRes[node.hostPort].nodesJoined;
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
    }
}, 'three nodes, two of them bad, join size equals two', function t(bootRes, cluster, assert) {
    assert.equal(cluster.length, 3, 'cluster of 3');

    cluster.forEach(function eachNode(node) {
        assert.notok(node.isReady, 'node is not bootstrapped');
        assert.equal(bootRes[node.hostPort].err.type,
            'ringpop.join-duration-exceeded',
            'join duration exceeded error');
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
        cluster[1].protocolJoin = function protocolJoin(options, callback) {
            setTimeout(function onTimeout() {
                cluster[0].destroy();

                callback(null, {
                    app: 'test',
                    coordinator: cluster[1].hostPort,
                    membership: cluster[1].dissemination.fullSync()
                });
            }, 100);
        };
    }
}, 'slow joiner', function t(bootRes, cluster, assert) {
    assert.equal(cluster.length, 2, 'cluster of 2');

    var slowJoiner = cluster[0];
    assert.notok(slowJoiner.isReady, 'node one is not ready');
    assert.equal(bootRes[slowJoiner.hostPort].err.type, 'ringpop.join-aborted',
        'join aborted error');

    assert.ok(cluster[1].isReady, 'node two is ready');
    assert.end();
});
