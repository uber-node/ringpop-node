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
var sendPing = require('../../lib/gossip/ping-sender.js').sendPing;
var sendPingReqs = require('../../lib/gossip/ping-req-sender.js');

// If a node has bad bootstrap hosts it will be unable to join. We use this
// to trick a ringpop to stay in its bootstrapping phase forever. This is
// useful in testing the not-ready status of a node.
function setBadBootstrapHosts(ringpop) {
    ringpop.bootstrapHosts = ['127.0.0.1:20001', ringpop.whoami()];
}

// Pinging a bootstrapping node results in a ringpop.not-ready error.
testRingpopCluster({
    size: 4,
    bootstrapSize: 3,
    tap: function(cluster) {
        setBadBootstrapHosts(cluster[3]);
    },
    waitForConvergence: false
}, 'not-ready error on ping', function t(bootRes, cluster, assert) {
    assert.plan(1);

    console.log(cluster[0].membership.members.length);

    var notReadyRingpop = cluster[3];
    
    var pingSender = cluster[0];
    var pingTarget = notReadyRingpop;
    var pingTargetMember = pingSender.membership.findMemberByAddress(pingTarget.whoami());

    sendPing({
        ringpop: pingSender,
        target: pingTargetMember
    }, function onPing(err, res) {
        assert.equal(err.type, 'ringpop.not-ready');
        assert.end();
    });
});

// Indirectly pinging a node that is still bootstrapping, and thus not-ready,
// via a ping-req will marked with pingStatus false in the aggregated pingReqs
// result.
testRingpopCluster({
    size: 4,
    bootstrapSize: 3,
    tap: function(cluster) {
        setBadBootstrapHosts(cluster[3]);
    },
    waitForConvergence: false
}, 'ping-req fails when not ready', function t(bootRes, cluster, assert) {
    assert.plan(2);

    var notReadyRingpop = cluster[3];

    // indirectly target the notReadyRingpop for a health check
    var pingReqSender = cluster[0];
    var pingReqTarget = notReadyRingpop;
    var pingReqTargetMember = pingReqSender.membership.findMemberByAddress(pingReqTarget.whoami());

    sendPingReqs({
        ringpop: pingReqSender,
        unreachableMember: pingReqTargetMember,
        pingReqSize: 2
    }, function onPing(err, res) {
        res.pingReqErrs.forEach(function each(pingReqRes) {
            assert.equals(pingReqRes.pingStatus, false, 'ping status of node that is not ready is false');
        });
        assert.end();
    });
});

// When an indirect health check is done by the ping-req mechanism and all
// nodes that are requested to do a ping are not ready, the result of the 
// indirect health check is inconclusive. 
testRingpopCluster({
    size: 4,
    bootstrapSize: 2,
    tap: function(cluster) {
        setBadBootstrapHosts(cluster[2]);
        setBadBootstrapHosts(cluster[3]);
    },
    waitForConvergence: false
}, 'ping-req inconclusive when all ping-req nodes are not ready', function t(bootRes, cluster, assert) {
    assert.plan(1);

    // Target a healthy node for an indirect health check so that only nodes 
    // that are not ready receive ping-reqs.
    var pingReqSender = cluster[0];
    var pingReqTarget = cluster[1];
    var pingReqTargetMember = pingReqSender.membership.findMemberByAddress(pingReqTarget.whoami());

    sendPingReqs({
        ringpop: pingReqSender,
        unreachableMember: pingReqTargetMember,
        pingReqSize: 2
    }, function onPingReq(err, res) {
        assert.equal(err.type, 'ringpop.ping-req.inconclusive');
        assert.end();
    });
});

// When an indirect health check is done by the ping-req mechanism and one node
// finds out that the target is healthy, the health check is positive. Even
// if some of the nodes requested to do a ping check are not ready, the health
// check succeeds if at least one node is ready.
testRingpopCluster({
    size: 4,
    bootstrapSize: 3,
    tap: function(cluster) {
        setBadBootstrapHosts(cluster[3]);
    },
    waitForConvergence: false
}, 'ping-req succeeds if one ping-req is successful', function t(bootRes, cluster, assert) {
    assert.plan(1);

    // Target a healthy node for an indirect health check. One of the two
    // nodes that receive ping-reqs is healthy, one is not ready.
    var pingReqSender = cluster[0];
    var pingReqTarget = cluster[1];
    var pingReqTargetMember = pingReqSender.membership.findMemberByAddress(pingReqTarget.whoami());

    sendPingReqs({
        ringpop: pingReqSender,
        unreachableMember: pingReqTargetMember,
        pingReqSize: 2
    }, function onPingReq(err, res) {
        assert.ifError(err, 'ping-reqs should succeed when a member pings successfully');
        assert.end();
    });
});

// When a node pings a node that is not ready. The node will perform
// an indirect health check and send out ping-reqs.
testRingpopCluster({
    size: 2,
    bootstrapSize: 1,
    tap: function(cluster) {
        setBadBootstrapHosts(cluster[1]);
    },
    waitForConvergence: false,
    autoGossip: false
}, 'send ping-reqs when a node is not ready', function t(bootRes, cluster, assert) {
    assert.plan(0);
 
    var pingSender = cluster[0];
    pingSender.gossip.on('sendingPingReqs', function onSendingPingReqs(event) {
        assert.end();
    });
    pingSender.gossip.tick();
});
