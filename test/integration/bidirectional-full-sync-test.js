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

var async = require('async');
var _ = require('underscore');

var testRingpopCluster = require('../lib/test-ringpop-cluster.js');

testRingpopCluster({
    bootstrapSize: 1,
    size: 2,
    waitForConvergence: false,
    autoGossip: false
}, 'test bi-directional full syncs', function t(bootRes, cluster, assert) {
    // nodeA will include B in it's member list
    var nodeA = _.find(cluster, function(node) { return node.isReady;});

    // nodeB will not include A in it's member list
    var nodeB = _.find(cluster, function(node) { return !node.isReady;});

    // bootstrap node B without A.
    nodeB.bootstrap([nodeB.hostPort], function onBootStrapped(err) {
        assert.error(err);

        // clear changes to trigger a full sync
        nodeA.dissemination.clearChanges();
        nodeB.dissemination.clearChanges();

        // verify nodeA does include B in it's member list
        assert.notEqual(nodeA.membership.findMemberByAddress(nodeB.hostPort), undefined);

        // verify nodeB doesn't include A in it's member list
        assert.equal(nodeB.membership.findMemberByAddress(nodeA.hostPort), undefined);

        nodeB.membership.on('updated', function(updates) {
            // verify nodeB now includes A in it's member list
            assert.notEqual(nodeB.membership.findMemberByAddress(nodeA.hostPort), undefined);
            assert.end();
        });

        nodeA.gossip.tick();
    });

    assert.timeoutAfter(2000);
});


testRingpopCluster({
    bootstrapSize: 1,
    size: 2,
    waitForConvergence: false,
    autoGossip: false
}, 'test bi-directional full syncs throttles', function t(bootRes, cluster, assert) {
    // nodeA will include B in it's member list
    var nodeA = _.find(cluster, function(node) { return node.isReady;});

    // nodeB will not include A in it's member list
    var nodeB = _.find(cluster, function(node) { return !node.isReady;});

    // bootstrap node B without A.
    nodeB.bootstrap([nodeB.hostPort], function onBootStrapped(err) {
        assert.error(err);

        // verify nodeA does include B in it's member list
        assert.notEqual(nodeA.membership.findMemberByAddress(nodeB.hostPort), undefined);

        // verify nodeB doesn't include A in it's member list
        assert.equal(nodeB.membership.findMemberByAddress(nodeA.hostPort), undefined);

        var realProtocolJoin = nodeB.client.protocolJoin.bind(nodeB.client);
        var protocolJoinCalls = [];
        nodeB.client.protocolJoin = function() {
            protocolJoinCalls.push(arguments);
            assert.equal(nodeB.dissemination.reverseFullSyncJobs, protocolJoinCalls.length);
            if (protocolJoinCalls.length > nodeB.maxReverseFullSyncJobs) {
                assert.fail('full sync should have been throttled');
            }
        };

        async.timesSeries(nodeB.maxReverseFullSyncJobs, function tick(i, next) {
            // clear changes to trigger a full sync
            nodeA.dissemination.clearChanges();
            nodeB.dissemination.clearChanges();

            nodeA.gossip.tick(next);
        }, function done(err) {
            console.log('done pinging', err);
            assert.error(err);

            process.nextTick(executeJoins);
        });

        function executeJoins() {
            var count = protocolJoinCalls.length;

            async.timesSeries(protocolJoinCalls.length, function executeJoin(index, next) {
                var args = protocolJoinCalls[index];
                assert.equal(nodeB.dissemination.reverseFullSyncJobs, count - index);

                // Wrap callback to check decrement of reverseFullSyncJobs
                var origCallback = args[args.length-1];
                args[args.length-1] = function onJoined() {
                    origCallback.apply(this, arguments);
                    assert.equal(nodeB.dissemination.reverseFullSyncJobs, count - index - 1);
                    next();
                };
                realProtocolJoin.apply(null, args)
            }, function done(err) {
                assert.error(err);
                assert.end();
            });
        }
    });
});
