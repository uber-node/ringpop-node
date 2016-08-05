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

var _ = require('underscore');
var AdminMember = require('../../server/admin/member.js');
var createJoinHandler = require('../../server/protocol/join.js');
var mock = require('../mock');
var Ringpop = require('../../index.js');
var Member = require('../../lib/membership/member.js');
var test = require('tape');
var testRingpop = require('../lib/test-ringpop.js');
var allocRingpop = require('../lib/alloc-ringpop.js');

var createAdminJoinHandler = AdminMember.memberJoin.handler;
var createAdminLeaveHandler = AdminMember.memberLeave.handler;

function createRingpop(opts) {
    var ringpop = new Ringpop(_.extend({
        app: 'test',
        hostPort: '127.0.0.1:3000'
    }, opts));

    ringpop.isReady = true;

    return ringpop;
}

function createRemoteRingpop() {
    return createRingpop({
        hostPort: '127.0.0.1:3001'
    });
}

test('does not throw when calling lookup with 0 servers', function t(assert) {
    var ringpop = createRingpop();
    ringpop.lookup('deadbeef');
    ringpop.destroy();
    assert.end();
});

test('does not throw when calling lookup with an integer', function t(assert) {
    var ringpop = createRingpop();
    ringpop.ring.addServer('127.0.0.1:3000');
    ringpop.lookup(12345);
    ringpop.destroy();
    assert.end();
});

test('key hashes to only server', function t(assert) {
    var ringpop = createRingpop();
    ringpop.membership.makeLocalAlive();
    assert.equals(ringpop.lookup(12345), ringpop.hostPort, 'hashes to only server');
    ringpop.destroy();
    assert.end();
});

test('admin join rejoins if member has previously left', function t(assert) {
    assert.plan(3);

    var ringpop = createRingpop();

    ringpop.membership.makeLocalAlive();

    var handleAdminLeave = createAdminLeaveHandler(ringpop);
    handleAdminLeave(null, null, null, function(err, res1, res2) {
        assert.equals(res2, 'ok', 'node left cluster');

        ringpop.membership.localMember.incarnationNumber = 2;

        var handleAdminJoin = createAdminJoinHandler(ringpop);
        handleAdminJoin(null, null, null, function onAdminJoin(err, res1, res2) {
            assert.equals(res2, 'rejoined', 'node rejoined cluster');
            assert.equals(ringpop.membership.localMember.status, 'alive', 'local member is alive');

            ringpop.destroy();
            assert.end();
        });
    });
});

test('admin leave prevents redundant leave', function t(assert) {
    assert.plan(2);

    var ringpop = createRingpop();
    ringpop.membership.setLocalStatus(Member.Status.leave);

    var handleAdminLeave = createAdminLeaveHandler(ringpop);
    handleAdminLeave(null, null, null, function(err) {
        assert.ok(err, 'an error occurred');
        assert.equals(err.type, 'ringpop.invalid-leave.redundant', 'cannot leave cluster twice');
        ringpop.destroy();
        assert.end();
    });
});

test('admin leave makes local member leave', function t(assert) {
    assert.plan(3);

    var ringpop = createRingpop();
    ringpop.membership.makeLocalAlive();

    var handleAdminLeave = createAdminLeaveHandler(ringpop);
    handleAdminLeave(null, null, null, function(err, _, res2) {
        assert.notok(err, 'an error did not occur');
        assert.ok('leave', ringpop.membership.localMember.status, 'local member has correct status');
        assert.equals('ok', res2, 'admin leave was successful');
        ringpop.destroy();
        assert.end();
    });
});

test('admin leave stops gossip', function t(assert) {
    assert.plan(2);

    var ringpop = createRingpop();
    ringpop.membership.makeLocalAlive();
    ringpop.gossip.start();

    var handleAdminLeave = createAdminLeaveHandler(ringpop);
    handleAdminLeave(null, null, null, function(err) {
        assert.notok(err, 'an error did not occur');
        assert.equals(true, ringpop.gossip.isStopped, 'gossip is stopped');
        ringpop.destroy();
        assert.end();
    });
});

test('admin leave stops state transitions', function t(assert) {
    assert.plan(2);

    var ringpopRemote = createRemoteRingpop();
    ringpopRemote.membership.makeLocalAlive();

    var ringpop = createRingpop();
    ringpop.membership.makeLocalAlive();
    ringpop.membership.makeChange(ringpopRemote.whoami(), Date.now(), Member.Status.alive);
    ringpop.stateTransitions.scheduleSuspectToFaulty(ringpopRemote.hostPort);

    var handleAdminLeave = createAdminLeaveHandler(ringpop);
    handleAdminLeave(null, null, null, function(err) {
        assert.notok(err, 'an error did not occur');
        assert.notok(ringpop.stateTransitions.enabled, 'state transitions is stopped');
        ringpop.destroy();
        ringpopRemote.destroy();
        assert.end();
    });
});

test('protocol join disallows joining itself', function t(assert) {
    assert.plan(2);

    var ringpop = createRingpop();
    var handleJoin = createJoinHandler(ringpop);
    handleJoin(null, {
        app: ringpop.app,
        source: ringpop.hostPort,
        incarnationNumber: 1
    }, null, function(err) {
        assert.ok(err, 'an error occurred');
        assert.equals(err.type, 'ringpop.self-join', 'a node cannot join itself');
        ringpop.destroy();
        assert.end();
    });
});

test('protocol join disallows joining different app clusters', function t(assert) {
    assert.plan(2);

    var ringpop = new Ringpop({
        app: 'mars',
        hostPort: '127.0.0.1:3000'
    });

    var handleJoin = createJoinHandler(ringpop);
    handleJoin(null, {
        app: 'jupiter',
        source: '127.0.0.1:3001',
        incarnationNumber: 1
    }, null, function(err) {
        assert.ok(err, 'an error occurred');
        assert.equals(err.type, 'ringpop.invalid-join.app', 'a node cannot join a different app cluster');
        ringpop.destroy();
        assert.end();
    });
});

test('no opts does not break handleOrProxy', function t(assert) {
    var ringpop = createRingpop();
    ringpop.lookup = function() { return '127.0.0.1:3001'; };
    ringpop.requestProxy = mock.requestProxy;

    var key = 'KEY0';
    var req = {};
    var res = {};
    var opts = null;
    var handleOrProxy = ringpop.handleOrProxy.bind(ringpop, key, req, res, opts);
    assert.doesNotThrow(handleOrProxy, null, 'handleOrProxy does not throw');
    ringpop.destroy();
    assert.end();
});

test('registers stats hook', function t(assert) {
    var ringpop = createRingpop();
    ringpop.registerStatsHook({
        name: 'myhook',
        getStats: function getIt() {
            return {
                numQueues: 10
            };
        }
    });

    assert.ok(ringpop.isStatsHookRegistered('myhook'), 'hook has been registered');
    ringpop.destroy();
    assert.end();
});

test('stats include stat hooks', function t(assert) {
    var ringpop = createRingpop();

    assert.notok(ringpop.getStats().hooks, 'no stats for no stat hooks');

    var stats = { numQueues: 10 };
    ringpop.registerStatsHook({
        name: 'myhook',
        getStats: function getIt() {
            return stats;
        }
    });

    assert.deepEqual(ringpop.getStats().hooks.myhook, stats, 'returns hook stats');
    ringpop.destroy();
    assert.end();
});

test('fails all hook registration preconditions', function t(assert) {
    var ringpop = createRingpop();

    function throwsType(fn) {
        try {
            fn();
        } catch (e) {
            return e.type;
        }

        return null;
    }

    assert.equals(throwsType(function throwIt() {
        ringpop.registerStatsHook();
    }), 'ringpop.argument-required', 'missing hook argument');

    assert.equals(throwsType(function throwIt() {
        ringpop.registerStatsHook({
            getStats: function getIt() { return {}; }
        });
    }), 'ringpop.field-required', 'missing name field');

    assert.equals(throwsType(function throwIt() {
        ringpop.registerStatsHook({
            name: 'myhook'
        });
    }), 'ringpop.method-required', 'missing getStats method');

    assert.equals(throwsType(function throwIt() {
        ringpop.registerStatsHook({
            name: 'myhook',
            getStats: function getIt() { return {}; }
        });
        ringpop.registerStatsHook({
            name: 'myhook',
            getStats: function getIt() { return {}; }
        });
    }), 'ringpop.duplicate-hook', 'registered hook twice');

    ringpop.destroy();
    assert.end();
});

test('stat host/port should properly format IPs and hostnames', function t(assert) {
    function createRingpop(host) {
        return new Ringpop({
            app: 'test',
            hostPort: host + ':3000'
        });
    }

    var ringpopByHostname = createRingpop('myhostname');
    assert.equal(ringpopByHostname.statHostPort,
        'myhostname_3000', 'properly formatted with hostname');

    var ringpopByIP= createRingpop('127.0.0.1');
    assert.equal(ringpopByIP.statHostPort,
        '127_0_0_1_3000', 'properly formatted with hostname');

    ringpopByHostname.destroy();
    ringpopByIP.destroy();
    assert.end();
});

test('emits membership changed event', function t(assert) {
    assert.plan(1);

    var node1Addr = '127.0.0.1:3001';

    var ringpop = createRingpop();
    ringpop.membership.makeLocalAlive();
    ringpop.membership.makeChange(node1Addr, Date.now(), Member.Status.alive);

    assertChanged();

    var node1Member = ringpop.membership.findMemberByAddress(node1Addr);
    ringpop.membership.makeSuspect(node1Addr, node1Member.incarnationNumber);

    ringpop.destroy();
    assert.end();

    function assertChanged() {
        ringpop.once('membershipChanged', function onMembershipChanged() {
            assert.pass('membership changed');
        });

        ringpop.once('ringChanged', function onRingChanged() {
            assert.fail('no ring changed');
        });
    }
});

test('emits ring changed event', function t(assert) {
    assert.plan(16);

    var node1Addr = '127.0.0.1:3001';
    var node2Addr = '127.0.0.1:3002';
    var incNo = Date.now();
    var magicIncNo = incNo +  123456;

    var ringpop = createRingpop();
    ringpop.membership.makeLocalAlive();
    ringpop.membership.makeChange(node1Addr, incNo, Member.Status.alive);

    function assertChanged(changer, intent) {
        ringpop.once('membershipChanged', function onMembershipChanged() {
            assert.pass('membership changed');
        });

        ringpop.once('ringChanged', function onRingChanged(event) {
            assert.pass('ring changed');
            assert.deepEquals(event.added, intent.adding, 'expected servers added');
            assert.deepEquals(event.removed, intent.removing, 'expected servers removed');
        });

        changer();
    }

    assertChanged(function assertIt() {
        ringpop.membership.makeFaulty(node1Addr, incNo);
    }, {
        adding: [],
        removing: [node1Addr]
    });

    assertChanged(function assertIt() {
        ringpop.membership.makeChange(node1Addr, magicIncNo, Member.Status.alive);
    }, {
        adding: [node1Addr],
        removing: []
    });

    assertChanged(function assertIt() {
        ringpop.membership.makeChange(node1Addr, magicIncNo, Member.Status.leave);
    }, {
        adding: [],
        removing: [node1Addr]
    });

    assertChanged(function assertIt() {
        ringpop.membership.makeChange(node2Addr, Date.now(), Member.Status.alive);
    }, {
        adding: [node2Addr],
        removing: []
    });

    ringpop.destroy();
    assert.end();
});

testRingpop('max piggyback not adjusted on membership update', function t(deps, assert) {
    assert.plan(0);

    var dissemination = deps.dissemination;
    var membership = deps.membership;

    dissemination.on('maxPiggybackCountAdjusted', function onAdjusted() {
        assert.fail('max piggyback count was adjusted');
    });

    // Reset count to prove that it goes unmodified.
    dissemination.resetMaxPiggybackCount();

    var address = '127.0.0.1:3002';
    var incarnationNumber = Date.now();
    membership.makeFaulty(address, incarnationNumber);
});

testRingpop('max piggyback adjusted on new members', function t(deps, assert) {
    assert.plan(1);

    var dissemination = deps.dissemination;
    var membership = deps.membership;

    dissemination.on('maxPiggybackCountAdjusted', function onAdjusted() {
        assert.pass('max piggyback count was adjusted');
    });

    // Reset count to prove that it is modified.
    dissemination.resetMaxPiggybackCount();

    var address = '127.0.0.1:3002';
    var incarnationNumber = Date.now();
    membership.makeChange(address, incarnationNumber, Member.Status.alive);
});

test('first time member, not alive', function t(assert) {
    var ringpop = createRingpop();
    ringpop.membership.makeLocalAlive();

    var faultyAddr = '127.0.0.1:3001';
    ringpop.membership.makeFaulty(faultyAddr, Date.now());

    assert.notok(ringpop.ring.hasServer(faultyAddr),
        'new faulty server should not be in ring');

    ringpop.destroy();
    assert.end();
});

var badHostPorts = ['I.AM.BAD.IP.123', null];
badHostPorts.forEach(function each(hostPort) {
    test('don\'t call tchannel with invalid host port pair', function t(assert) {
        assert.plan(1);

        var ringpop = allocRingpop();

        ringpop.client.protocolPing({
                host: hostPort
            }, 
            {},
            function onPing(err, res) {
                assert.equals(err.type, 'ringpop.client.invalid-hostport',
                    'get an ringpop.client.invalid-hostport error');
                ringpop.destroy();
                assert.end();
            }
        );
    });
});

test('suspicionTimeout backward compatibility', function t(assert) {
    var ringpop = createRingpop({suspicionTimeout: 123});
    assert.deepEquals(ringpop.stateTransitions.suspectTimeout, 123);
    ringpop.destroy();
    ringpop = createRingpop({suspicionTimeout: 123, stateTimeouts: {suspect: 124}});
    assert.deepEquals(ringpop.stateTransitions.suspectTimeout, 124);
    ringpop.destroy();
    assert.end();
});

test('registerSelfEvictHook registers hook in self evicter', function t(assert) {
    var ringpop = createRingpop();

    var hookFixture = {};

    ringpop.selfEvicter= {
        registerHooks: function(hook) {
            assert.pass('registerHooks called');
            assert.equal(hook, hookFixture);
        }
    };
    assert.plan(2);
    ringpop.registerSelfEvictHook(hookFixture);

    ringpop.destroy();
    assert.end();
});

test('selfEvict initiates self evict sequence', function t(assert) {
    var ringpop = createRingpop();

    var cbFixture = function(){};

    ringpop.selfEvicter= {
        initiate: function(cb) {
            assert.pass('initiate');
            assert.equal(cb, cbFixture);
        }
    };
    assert.plan(2);
    ringpop.selfEvict(cbFixture);

    ringpop.destroy();
    assert.end();
});
