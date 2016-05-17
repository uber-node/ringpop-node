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

var _ = require('underscore');
var async = require('async');

var testRingpopCluster = require('../lib/test-ringpop-cluster.js');
var GossipUtils = require('../lib/gossip-utils');

testRingpopCluster({
    size: 2,
    tapAfterConvergence: function tapAfterConvergence(cluster) {
        GossipUtils.stopGossiping(cluster);
    }
}, 'healing - two nodes', function t(bootRes, cluster, assert) {
    GossipUtils.waitForNoGossip(cluster, test);
    
    function test() {
        var ringpopA = cluster[0];
        var ringpopB = cluster[1];

        var addressB = ringpopB.hostPort;
        var addressA = ringpopA.hostPort;

        // create a partition by marking nodeB faulty on nodeA and vice versa.
        var initialIncarnationNumberB = ringpopB.membership.getIncarnationNumber();
        var initialIncarnationNumberA = ringpopA.membership.getIncarnationNumber();
        ringpopA.membership.makeFaulty(addressB, initialIncarnationNumberB);
        ringpopB.membership.makeFaulty(addressA, initialIncarnationNumberA);

        ringpopA.healer.heal(function afterFirstHeal(err, targets) {
            assert.ifError(err, 'healing successful');
            assert.deepEqual(targets, [ringpopB.hostPort]);

            assert.ok(ringpopA.membership.getIncarnationNumber() > initialIncarnationNumberA, 'node A reincarnated');
            assert.ok(ringpopB.membership.getIncarnationNumber() > initialIncarnationNumberB, 'node B reincarnated');

            ringpopA.healer.heal(function afterSecondHeal(err, targets) {
                assert.ifError(err, 'healing successful');
                assert.deepEqual(targets, [ringpopB.hostPort]);
                assert.equal(ringpopA.membership.findMemberByAddress(addressB).status, 'alive', 'B is alive in A');
                assert.equal(ringpopB.membership.findMemberByAddress(addressA).status, 'alive', 'A is alive in B');
                assert.end();
            });
        });
    }
});

function assertNoPartition(assert, cluster) {
    _.each(cluster, function iterator(ringpop) {
        _.each(ringpop.membership.members, assertAlive);
    });

    function assertAlive(member) {
        assert.equal(member.status, 'alive');
    }
}

testRingpopCluster({
    size: 4,
    waitForConvergence: true,
    tapAfterConvergence: function tapAfterConvergence(cluster) {
        GossipUtils.stopGossiping(cluster);
    }
}, 'healing - two partitions of two nodes', function t(bootRes, cluster, assert) {

    GossipUtils.waitForNoGossip(cluster, test);

    function test() {
        var initialIncarnationNumbers = new Array(cluster.length);
        for (var i = 0; i < cluster.length; i++) {
            initialIncarnationNumbers[i] = cluster[i].membership.getIncarnationNumber();
        }
        var partitionA = [cluster[0], cluster[1]];
        var partitionB = [cluster[2], cluster[3]];

        _.each(partitionA, function(nodeA) {
            _.each(partitionB, function(nodeB) {
                nodeA.membership.makeFaulty(nodeB.hostPort, nodeB.membership.getIncarnationNumber());
                nodeB.membership.makeFaulty(nodeA.hostPort, nodeA.membership.getIncarnationNumber());
            });
        });

        for (var i = 0; i < partitionA.length; i++) {
            var node = partitionA[i];
            for (var j = 0; j < node.membership.members.length; j++) {
                var member = node.membership.members[j];
                if (_.pluck(partitionA, 'hostPort').indexOf(member.address) > -1) {
                    assert.equal(member.status, 'alive')
                } else if (_.pluck(partitionB, 'hostPort').indexOf(member.address) > -1) {
                    assert.equal(member.status, 'faulty');
                } else {
                    assert.fail('member is not part of one of the partitions');
                }
            }
        }
        var target = _.find(cluster, function(n) {
            return n.hostPort === '127.0.0.1:10000'
        });
        target.healer.heal(function afterFirstHeal(err, targets) {
            assert.ifError(err, 'healing successful');
            assert.equal(targets.length, 1, 'one heal target should be enough');

            GossipUtils.waitForConvergence(cluster, true, function verifyFirstHeal(err) {
                assert.ifError(err, 'ping all successful');
                for (var i = 0; i < cluster.length; i++) {
                    assert.ok(cluster[i].membership.getIncarnationNumber() > initialIncarnationNumbers[i], 'node reincarnated');
                }

                target.healer.heal(function afterSecondHeal(err, targets) {
                    assert.ifError(err, 'healing successful');
                    assert.equal(targets.length, 1, 'one heal target should be enough');

                    GossipUtils.waitForConvergence(cluster, true, function verifySecondHeal(err) {
                        assert.ifError(err, 'ping all successful');
                        assertNoPartition(assert, cluster);
                        assert.end();
                    });
                });
            });
        });
    }
});
