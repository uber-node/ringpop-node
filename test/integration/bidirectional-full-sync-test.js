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
    // nodeA will include B in its member list
    var nodeA = _.find(cluster, function(node) { return node.isReady;});

    // nodeB will not include A in its member list
    var nodeB = _.find(cluster, function(node) { return !node.isReady;});

    // bootstrap node B without A.
    nodeB.bootstrap([nodeB.hostPort], function onBootStrapped(err) {
        assert.error(err);

        // clear changes to trigger a full sync
        nodeA.dissemination.clearChanges();
        nodeB.dissemination.clearChanges();

        // verify nodeA does include B in its member list
        assert.notEqual(nodeA.membership.findMemberByAddress(nodeB.hostPort), undefined);

        // verify nodeB doesn't include A in its member list
        assert.equal(nodeB.membership.findMemberByAddress(nodeA.hostPort), undefined);

        nodeB.membership.on('updated', function(updates) {
            // verify nodeB now includes A in its member list
            assert.notEqual(nodeB.membership.findMemberByAddress(nodeA.hostPort), undefined);
            assert.end();
        });

        nodeA.gossip.tick();
    });

    assert.timeoutAfter(2000);
});

/*
    To test if the number of concurrent join requests is correctly throttled,
    we're overwriting the protocolJoinMethod. Instead of calling the callback
    immediately, we bind the arguments to the callback and add it to an array.
    After the full sync flood we verify that the number of joins doesn't exceed
    it's configured maximum and the counter to keep track of the concurrent joins
    is in sync; afterwards we can call the stored callbacks, completing the joins
    and double check if the counter is decremented again.
 */
testRingpopCluster({
    bootstrapSize: 1,
    size: 2,
    waitForConvergence: false,
    autoGossip: false
}, 'test bi-directional full syncs throttles', function t(bootRes, cluster, assert) {
    // nodeA will include B in its member list
    var nodeA = _.find(cluster, function(node) { return node.isReady;});

    // nodeB will not include A in its member list
    var nodeB = _.find(cluster, function(node) { return !node.isReady;});

    // bootstrap node B without A.
    nodeB.bootstrap([nodeB.hostPort], function onBootStrapped(err) {
        assert.error(err);

        // verify nodeA does include B in its member list
        assert.notEqual(nodeA.membership.findMemberByAddress(nodeB.hostPort), undefined);

        // verify nodeB doesn't include A in its member list
        assert.equal(nodeB.membership.findMemberByAddress(nodeA.hostPort), undefined);

        var originalProtocolJoinFunction = nodeB.client.protocolJoin.bind(nodeB.client);
        var protocolJoinCallbacks = [];

        // overwrite the protocolJoin function so we're able to stall calling it's callback
        nodeB.client.protocolJoin = function cachedProtocolJoin(opts, body, originalCallback) {
            // first call the original protocolJoin-function
            originalProtocolJoinFunction(opts, body, function onJoin(err, result) {
                // bind the params to the original callback-function and store it in the array.
               protocolJoinCallbacks.push(originalCallback.bind(null, err, result));
            });
        };

        // pinging maxReverseFullSyncJobs+2 times to trigger maxReverseFullSyncJobs+2 full syncs.
        // only maxReverseFullSyncJobs should result in an actual join-request.
        async.timesSeries(nodeB.maxReverseFullSyncJobs+2, function tick(i, next) {

            // clear changes to trigger a full sync
            nodeA.dissemination.clearChanges();
            nodeB.dissemination.clearChanges();

            nodeA.client.protocolPing({
                host: nodeB.hostPort
            }, {
                changes: [],
                checksum: 1,
                source: nodeA.whoami(),
                sourceIncarnationNumber:  nodeA.membership.getIncarnationNumber()
            }, next);
        }, function done(err) {
            assert.error(err);

            assert.equal(protocolJoinCallbacks.length, nodeB.maxReverseFullSyncJobs);
            assert.equal(nodeB.dissemination.reverseFullSyncJobs, protocolJoinCallbacks.length);

            // call the original callbacks
            async.each(protocolJoinCallbacks, function callOriginalCallback(fn, next){
                // the response err and res are already bound to fn so no need for any params.
                fn();
                next();
            }, function done(err){
                assert.error(err);
                // verify if reverseFullSyncJobs is decremented correctly.
                assert.equal(nodeB.dissemination.reverseFullSyncJobs, 0);
                assert.end();
            });
        });
    });
    assert.timeoutAfter(2000);
});
