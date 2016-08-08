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

var testRingpop = require('../lib/test-ringpop');
var test = require('tape');
var SelfEvict = require('../../lib/self-evict');
var RingPop = require('../../index.js');
var _ = require('underscore');
var Member = require('../../lib/membership/member');

test('constructor', function t(assert) {
    var ringpopMock = {};

    var selfEvict = new SelfEvict(ringpopMock);
    assert.ok(selfEvict instanceof SelfEvict, 'instance of');

    assert.end();
});

function assertError(assert, thowIt, expected, msg) {
    var error;
    try {
        thowIt();
    } catch (e) {
        error = e;
    }

    assert.ok(error, msg);
    _.each(expected, function(value, key) {
        assert.equal(error[key], value, msg);
    });
}

test('register hooks', function t(assert) {
    var ringpop = new RingPop({
        app: 'test',
        hostPort: '127.0.0.1:3000'
    });

    var selfEvict = ringpop.selfEvicter;

    var testTable = [
        [null, {type: 'ringpop.argument-required', argument: 'hooks'}],
        [{}, {
            type: 'ringpop.field-required',
            field: 'name',
            argument: 'hooks'
        }],
        [{name: 'test'}, {
            type: 'ringpop.method-required',
            argument: 'hooks',
            method: 'preEvict and/or postEvict'
        }]
    ];

    // assert all the errors
    _.each(testTable, function(testCase) {
        assertError(
            assert,
            selfEvict.registerHooks.bind(selfEvict, testCase[0]),
            testCase[1]
        );
    });


    var hooks = {
        name: 'test',
        preEvict: function preEvict() {
        },
        postEvict: function postEvict() {
        }
    };

    assert.doesNotThrow(selfEvict.registerHooks.bind(selfEvict, hooks));


    assertError(
        assert,
        selfEvict.registerHooks.bind(selfEvict, hooks),
        {type: 'ringpop.duplicate-hook', name: 'test'}
    );

    ringpop.destroy();
    assert.end();
});

testRingpop({async: true}, 'self evict sequence without hooks', function t(deps, assert, cleanup) {
    var ringpop = deps.ringpop;
    var selfEvict = new SelfEvict(ringpop);

    assert.equal(selfEvict.currentPhase(), null, 'initial phase is null');

    selfEvict.initiate(after);

    function after(err) {
        assert.notok(err);

        var phases = selfEvict.phases;
        var phaseNames = _.pluck(phases, 'phase');
        assert.deepEqual(phaseNames, [
            SelfEvict.PhaseNames.PreEvict,
            SelfEvict.PhaseNames.Evicting,
            SelfEvict.PhaseNames.PostEvict,
            SelfEvict.PhaseNames.Done
        ]);

        for (var i = 0; i < phases.length; i++) {
            var phase = phases[i];

            if (i < phases.length - 1) {
                assert.notEqual(phase.duration, undefined, 'duration is set');
                assert.equal(phase.duration, phases[i + 1].ts - phase.ts, 'duration is correct');
                assert.ok(phase.ts <= phases[i + 1].ts, 'sorted correctly');
            } else {
                assert.equal(phase.duration, undefined, 'duration is undefined');
            }
        }

        assert.equal(ringpop.membership.localMember.status, Member.Status.faulty, 'local member is declared faulty');

        cleanup();
    }
});

testRingpop({async: true}, 'self evict sequence invokes hooks', function t(deps, assert, cleanup) {
    var ringpop = deps.ringpop;
    var selfEvict = new SelfEvict(ringpop);

    assert.plan(6);

    selfEvict.registerHooks({
        name: 'onlyPreEvictHook',
        preEvict: function(cb) {
            assert.pass('onlyPreEvictHook.preEvict called');
            cb();
        }
    });

    selfEvict.registerHooks({
        name: 'onlyPostEvictHook',
        postEvict: function(cb) {
            assert.pass('onlyPostEvictHook.postEvict called');
            cb();
        }
    });

    selfEvict.registerHooks({
        name: 'bothHook',
        preEvict: function(cb) {
            assert.equal(selfEvict.currentPhase().phase, SelfEvict.PhaseNames.PreEvict);
            assert.pass('bothHook.preEvict called');
            cb();
        },
        postEvict: function(cb) {
            assert.equal(selfEvict.currentPhase().phase, SelfEvict.PhaseNames.PostEvict);
            assert.pass('bothHook.postEvict called');
            cb();
        }
    });

    selfEvict.initiate(cleanup);
});

testRingpop({async: true}, 'self evict ticks membership to speed up gossip', function t(deps, assert, cleanup) {
    var ringpop = deps.ringpop;
    ringpop.membership.makeChange('127.0.0.1:30002', Date.now(), Member.Status.alive);

    assert.plan(1);

    ringpop.gossip.tick = function tick(cb) {
        assert.ok('gossip ticked!');
        cb();
    };
    var selfEvict = new SelfEvict(ringpop);
    selfEvict.initiate(cleanup);
});

testRingpop({async: true}, 'self evict does not ticks membership when "selfEvictionPingEnabled" is disabled', function t(deps, assert, cleanup) {
    var ringpop = deps.ringpop;
    ringpop.membership.makeChange('127.0.0.1:30002', Date.now(), Member.Status.alive);
    ringpop.config.set('selfEvictionPingEnabled', false);

    ringpop.gossip.tick = function tick(cb) {
        assert.fail('gossip should not tick!');
        cb();
    };
    var selfEvict = new SelfEvict(ringpop);
    selfEvict.initiate(cleanup);
});

testRingpop({async: true}, 'self evict stops and restarts gossip and waits until not pinging', function t(deps, assert, cleanup) {
    var ringpop = deps.ringpop;
    var gossip = ringpop.gossip;
    var membership = ringpop.membership;

    gossip.stop = wrapOnceWithAssertion(gossip, gossip.stop, function(){
        assert.pass('gossip stopped');
    });

    gossip.start = wrapOnceWithAssertion(gossip, gossip.start, function(){
        assert.pass('gossip restarted');
    });

    gossip.isPinging = true;
    gossip.isStopped = false;

    membership.setLocalStatus = wrapOnceWithAssertion(membership, membership.setLocalStatus, function() {
        assert.equal(gossip.isPinging, false);
        assert.equal(gossip.isStopped, true);
    });

    assert.plan(4);
    var selfEvict = new SelfEvict(ringpop);
    selfEvict.initiate(cleanup);

    setTimeout(function(){
        gossip.isPinging = false;
    }, 10);


    function wrapOnceWithAssertion(self, func, assertion) {
        var invoked = false;

        return function(){
            if(!invoked) {
                assertion.apply(self, arguments);
                invoked = true;
            }
            func.apply(self, arguments);
        }
    }
});

testRingpop({async: true}, 'initiate multiple times returns error', function t(deps, assert, cleanup) {
    var ringpop = deps.ringpop;
    var selfEvict = new SelfEvict(ringpop);

    cleanup = _.after(2, cleanup);

    selfEvict.initiate(first);
    selfEvict.initiate(next);

    function first(err) {
        assert.notok(err);
        selfEvict.initiate(next);
    }

    function next(err) {
        assert.ok(err);
        assert.equal(err.type, 'ringpop.self-evict.already-evicting');
        assert.equal(err.phase, selfEvict.currentPhase());

        cleanup();
    }
});
