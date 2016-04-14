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
var RingpopClient = require('../../client.js');
var testRingpopCluster = require('../lib/test-ringpop-cluster.js');

testRingpopCluster({
    size: 1,
    waitForConvergence: false
}, 'config endpoints', function t(bootRes, cluster, assert) {
    assert.plan(4);

    var client = new RingpopClient(cluster[0]);
    async.series([
        function configSetPart(callback) {
            client.adminConfigSet(cluster[0].whoami(), {
                testconfig1: 1
            }, function onSet(err) {
                assert.notok(err, 'no error occurred');
                callback();
            });
        },
        function configGetPart(callback) {
            client.adminConfigGet(cluster[0].whoami(), null,
                function onGet(err, config) {
                    assert.notok(err, 'no error occurred');
                    assert.equals(config.testconfig1, 1, 'config was set and get');
                    callback();
                });
        }
    ], function onSeries(err) {
        assert.notok(err, 'no error occurred');
        client.destroy();
    });
});

// Test to make sure these endpoints are available. Find tests that test
// behavior of handlers under unit tests.
testRingpopCluster({
    size: 1,
    waitForConvergence: false
}, 'gossip endpoints', function t(bootRes, cluster, assert) {
    assert.plan(4);

    var client = new RingpopClient(cluster[0]);
    async.series([
        adminGossip('adminGossipStart'),
        adminGossip('adminGossipStop'),
        adminGossip('adminGossipTick')
    ], function onSeries(err) {
        assert.notok(err, 'no error occurred');
        client.destroy();
    });

    function adminGossip(method) {
        return function doIt(callback) {
            client[method](cluster[0].whoami(), function onMethod(err) {
                assert.notok(err, 'no error occurred');
                callback();
            });
        };
    }
});
