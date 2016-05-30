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

var sendPingReqs = require('../../lib/gossip/ping-req-sender.js');
var testRingpopCluster = require('../lib/test-ringpop-cluster.js');
var stopGossiping = require('../lib/gossip-utils').stopGossiping;

// Avoid depending upon mutation of member and find
// member again and assert its status.
function assertAlive(assert, ringpop, address) {
    var member = ringpop.membership.findMemberByAddress(address);
    assert.equals(member.status, 'alive', 'member is alive');
}

function assertSuspect(assert, ringpop, address) {
    var member = ringpop.membership.findMemberByAddress(address);
    assert.equals(member.status, 'suspect', 'member is suspect');
}

function assertNumBadStatuses(assert, res, num) {
    var badStatuses = res.pingReqErrs.filter(function filterErr(err) {
        return err.type === 'ringpop.ping-req.bad-ping-status';
    });

    assert.equals(badStatuses.length, num, 'correct number of bad statuses');
}

function mkBadPingReqResponder(ringpop) {
    ringpop.channel.register('/protocol/ping-req', function protocolPingReq(req, res) {
        res.headers.as = 'raw';
        res.sendOk(null, JSON.stringify('badbody'));
    });
}

testRingpopCluster({
    tapAfterConvergence: function tapAfterConvergence(cluster) {
        stopGossiping(cluster);
    }
}, 'ping-reqs 1 member', function t(bootRes, cluster, assert) {

    var ringpop = cluster[0];
    var unreachableMember = ringpop.membership.findMemberByAddress(cluster[1].hostPort);

    sendPingReqs({
        ringpop: cluster[0],
        unreachableMember: unreachableMember,
        pingReqSize: 3
    }, function onPingReq(err, res) {
        assert.ifErr(err, 'no error occurred');
        assert.equal(res.pingReqAddrs.length, 1,
            'number of selected ping-req members is correct');
        assert.ok(res.pingReqSuccess.address === cluster[2].hostPort,
            'successful ping-req response from either member');
        assert.end();
    });
});

testRingpopCluster({
    size: 5,
    tapAfterConvergence: function tapAfterConvergence(cluster) {
        stopGossiping(cluster);
    }
}, 'ping-reqs 3 members', function t(bootRes, cluster, assert) {
    var ringpop = cluster[0];
    var unreachableMember = ringpop.membership.
        findMemberByAddress(cluster[1].hostPort);
    var pingReqSize = 3;

    sendPingReqs({
        ringpop: cluster[0],
        unreachableMember: unreachableMember,
        pingReqSize: pingReqSize
    }, function onPingReq(err, res) {
        assert.ifErr(err, 'no error occurred');
        assert.equal(res.pingReqAddrs.length, pingReqSize,
            'number of selected ping-req members is correct');
        assertAlive(assert, ringpop, unreachableMember.address);
        assert.end();
    });
});

testRingpopCluster({
    size: 5,
    tapAfterConvergence: function tapAfterConvergence(cluster) {
        stopGossiping(cluster);
    }
}, 'ping-req target unreachable', function t(bootRes, cluster, assert) {
    var badRingpop = cluster[4];
    badRingpop.on('destroyed', onDestroyed);
    badRingpop.destroy();

    function onDestroyed() {
        var ringpop = cluster[0];
        var unreachableMember = ringpop.membership.findMemberByAddress(badRingpop.hostPort);
        var pingReqSize = 3;

        sendPingReqs({
            ringpop: ringpop,
            unreachableMember: unreachableMember,
            pingReqSize: pingReqSize
        }, function onPingReq(err, res) {
            assert.ifErr(err, 'no error occurred');
            assertNumBadStatuses(assert, res, pingReqSize);
            assertSuspect(assert, ringpop, unreachableMember.address);
            assert.end();
        });
    }
});

testRingpopCluster({
    size: 2,
    tapAfterConvergence: function tapAfterConvergence(cluster) {
        stopGossiping(cluster);
    }
}, 'no ping-req members', function t(bootRes, cluster, assert) {
    var ringpop = cluster[0];
    var ringpop2Addr = cluster[1].hostPort;

    var unreachableMember = ringpop.membership.findMemberByAddress(ringpop2Addr);
    var pingReqSize = 3;

    sendPingReqs({
        ringpop: ringpop,
        unreachableMember: unreachableMember,
        pingReqSize: pingReqSize
    }, function onPingReq(err, res) {
        assert.ifErr(err, 'no error occurred');
        assertNumBadStatuses(assert, res, 0);
        assertSuspect(assert, ringpop, unreachableMember.address);
        assert.end();
    });
});

testRingpopCluster({
    size: 5,
    tap: function tap(cluster) {
        mkBadPingReqResponder(cluster[3]);
    },
    tapAfterConvergence: function tapAfterConvergence(cluster) {
        stopGossiping(cluster);
    }
}, 'some bad ping-statuses', function t(bootRes, cluster, assert) {
    var badRingpop = cluster[4];
    badRingpop.destroy();

    var ringpop = cluster[0];
    var unreachableMember = ringpop.membership.findMemberByAddress(badRingpop.hostPort);
    var pingReqSize = 3;

    sendPingReqs({
        ringpop: ringpop,
        unreachableMember: unreachableMember,
        pingReqSize: pingReqSize
    }, function onPingReq(err, res) {
        assert.ifErr(err, 'no error occurred');
        assertNumBadStatuses(assert, res, pingReqSize - 1);
        assertSuspect(assert, ringpop, unreachableMember.address);
        assert.end();
    });
});

testRingpopCluster({
    size: 5,
    tapAfterConvergence: function tapAfterConvergence(cluster) {
        stopGossiping(cluster);
    }
}, 'ping-req inconclusive', function t(bootRes, cluster, assert) {
    var ringpop = cluster[0];
    var unreachableMember = ringpop.membership.findMemberByAddress(cluster[4].hostPort);
    var pingReqSize = 3;

    // Mutating all member addresses to make each of selected ping-req members
    // unreachable and therefore, the results of ping-req inconclusive.
    ringpop.membership.members.forEach(function eachMember(member) {
        if (member.address !== unreachableMember.address) {
            member.address = member.address.split(':')[0]+":9999"
        }
    });

    sendPingReqs({
        ringpop: ringpop,
        unreachableMember: unreachableMember,
        pingReqSize: pingReqSize
    }, function onPingReq(err) {
        assert.ok(err, 'an error occurred');
        assert.equal(err.type, 'ringpop.ping-req.inconclusive',
            'ping-req is inconclusive');
        assertAlive(assert, ringpop, unreachableMember.address);
        assert.end();
    });
});
