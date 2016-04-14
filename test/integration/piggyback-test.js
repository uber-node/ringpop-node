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

var testRingpopCluster = require('../lib/test-ringpop-cluster.js');

testRingpopCluster({
    size: 2,
    waitForConvergence: false,
    autoGossip: false
}, 'raise piggyback counter', function t(bootRes, cluster, assert) {
    assert.plan(1);

    var pingSender = cluster[0];
    pingSender.gossip.tick(function() {
        var changes = pingSender.dissemination.changes;
        var joinChange = changes[pingSender.whoami()];
        var piggybackCount = joinChange.piggybackCount;
        assert.equals(piggybackCount, 1, 'piggyback counter raised by one');
        assert.end();
    });
});

function mkBadPingResponder(ringpop) {
    ringpop.channel.register('/protocol/ping', function protocolPing(req, res) {
        res.headers.as = 'raw';
        res.sendNotOk(null, JSON.stringify('ping failed on purpose'));
    });
}

testRingpopCluster({
    size: 2,
    waitForConvergence: false,
    autoGossip: false,
    tap: function tap(cluster) {
        mkBadPingResponder(cluster[1]);
    },
}, 'don\'t raise piggyback counter when ping fails', function t(bootRes, cluster, assert) {
    assert.plan(1);

    var pingSender = cluster[0];
    pingSender.gossip.tick(function() {
        var changes = pingSender.dissemination.changes;
        var joinChange = changes[pingSender.whoami()];
        var piggybackCount = joinChange.piggybackCount;
        assert.equals(piggybackCount, 0, 'piggyback counter not raised');
        assert.end();
    });
});