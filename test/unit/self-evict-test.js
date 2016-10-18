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
        }],
        [{name: 'test', preEvict: 'non-function'}, {
            type: 'ringpop.invalid-option',
            option: 'preEvict',
            reason: 'it is not a function'
        }],
        [{name: 'test', postEvict: 'non-function'}, {
            type: 'ringpop.invalid-option',
            option: 'postEvict',
            reason: 'it is not a function'
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

    assert.plan(10);

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
        preEvict: function(cb){
            assert.pass('bothHook.preEvict called');
            cb();
        },
        postEvict: function(cb){
            assert.pass('bothHook.postEvict called');
            cb();
        }
    });

    var exampleHook;
    var ExampleHook = function ExampleHook(name){
        this.name = name;

        var self = this;
        this.preEvict = function preEvict(cb){
            assert.equal(selfEvict.currentPhase().phase, SelfEvict.PhaseNames.PreEvict);
            assert.pass('exampleHook.preEvict called');
            assert.equal(this, self, 'context is correct');
            cb();
        };
    };
    ExampleHook.prototype.preEvict = function preEvict(cb){
        assert.equal(selfEvict.currentPhase().phase, SelfEvict.PhaseNames.PreEvict);
        assert.pass('exampleHook.preEvict called');
        assert.equal(this, exampleHook, 'context is correct');
        cb();
    };

    ExampleHook.prototype.postEvict = function postEvict(cb){
        assert.equal(selfEvict.currentPhase().phase, SelfEvict.PhaseNames.PostEvict);
        assert.pass('exampleHook.postEvict called');
        assert.equal(this, exampleHook, 'context is correct');

        cb();
    };

    exampleHook = new ExampleHook('InstanceExample');
    selfEvict.registerHooks(exampleHook);

    selfEvict.initiate(cleanup);
});

testRingpop({async: true}, 'self evict completes when membership is empty', function t(deps, assert, cleanup) {
    var ringpop = deps.ringpop;

    var selfEvict = new SelfEvict(ringpop);
    selfEvict.initiate(function afterSelfEvict(err){
        assert.notOk(err);

        var evictingPhase = _.findWhere(selfEvict.phases, {phase: SelfEvict.PhaseNames.Evicting});

        assert.equal(evictingPhase.numberOfPings, 0, 'number of pings is correct');
        assert.equal(evictingPhase.numberOfSuccessfulPings, 0, 'successful pings is correct');

        cleanup();
    });
});

testRingpop({async: true}, 'self evict pings members to speed up gossip', function t(deps, assert, cleanup) {
    var ringpop = deps.ringpop;
    ringpop.membership.makeChange('127.0.0.1:30002', Date.now(), Member.Status.alive);

    assert.plan(1);

    ringpop.client = {
        protocolPing: function(opts, body, cb) {
            assert.ok('gossip ticked!');
            cb(null, {});
        },
        destroy: function noop() {
        }
    };
    var selfEvict = new SelfEvict(ringpop);
    selfEvict.initiate(cleanup);
});

testRingpop({async: true}, 'self evict ping count is correct', function t(deps, assert, cleanup) {
    var ringpop = deps.ringpop;
    ringpop.config.set('selfEvictionMaxPingRatio', 1.0);

    ringpop.membership.makeChange('127.0.0.1:30002', Date.now(), Member.Status.alive);
    ringpop.membership.makeChange('127.0.0.1:30003', Date.now(), Member.Status.alive);
    ringpop.membership.makeChange('127.0.0.1:30004', Date.now(), Member.Status.faulty);

    assert.plan(4);

    ringpop.client = {
        protocolPing: function(opts, body, cb) {
            var target = opts.host;
            if (target === '127.0.0.1:30002') {
                assert.ok('127.0.0.1:30002 is pinged!');
                cb(null, {changes: []});
            } else if (target === '127.0.0.1:30003') {
                assert.ok('127.0.0.1:30003 is pinged!');
                cb('error', null);
            } else {
                assert.fail('incorrect target');
                cb(null, {changes: []});
            }
        },
        destroy: function noop() {
        }
    };
    var selfEvict = new SelfEvict(ringpop);
    selfEvict.initiate(function afterEvict() {
        var evictingPhase = _.findWhere(selfEvict.phases, {phase: SelfEvict.PhaseNames.Evicting});

        assert.equal(evictingPhase.numberOfPings, 2, 'number of pings is correct');
        assert.equal(evictingPhase.numberOfSuccessfulPings, 1, 'successful pings is correct');

        cleanup();
    });
});

testRingpop({async: true}, 'self evict does not ping more than number of members', function t(deps, assert, cleanup) {
    var ringpop = deps.ringpop;
    ringpop.config.set('selfEvictionMaxPingRatio', 2.0); //set above 1 on purpose

    ringpop.membership.makeChange('127.0.0.1:30002', Date.now(), Member.Status.alive);
    ringpop.membership.makeChange('127.0.0.1:30003', Date.now(), Member.Status.alive);

    assert.plan(3);

    var numberOfPings = 0;
    ringpop.client = {
        protocolPing: function(opts, body, cb) {
            numberOfPings++;
            cb(null, {changes: []});
        },
        destroy: function noop() {
        }
    };
    var selfEvict = new SelfEvict(ringpop);
    selfEvict.initiate(function afterEvict() {
        var evictingPhase = _.findWhere(selfEvict.phases, {phase: SelfEvict.PhaseNames.Evicting});

        assert.equal(evictingPhase.numberOfPings, 2, 'number of pings is correct');
        assert.equal(evictingPhase.numberOfSuccessfulPings, 2, 'successful pings is correct');
        assert.equal(numberOfPings, 2, 'does not ping more than number of members');

        cleanup();
    });
});

testRingpop({async: true}, 'self evict does not tick membership when "selfEvictionPingEnabled" is disabled', function t(deps, assert, cleanup) {
    var ringpop = deps.ringpop;
    ringpop.membership.makeChange('127.0.0.1:30002', Date.now(), Member.Status.alive);
    ringpop.config.set('selfEvictionPingEnabled', false);

    ringpop.client = {
        protocolPing: function(opts, body, cb) {
            assert.fail('gossip should not tick!');
            cb(null, {});
        },
        destroy: function noop() {
        }
    };

    var selfEvict = new SelfEvict(ringpop);
    selfEvict.initiate(cleanup);
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
