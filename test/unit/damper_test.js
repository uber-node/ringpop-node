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

var fixtures = require('../fixtures.js');
var Damper = require('../../lib/gossip/damper.js');
var DampReqRequest = require('../../request_response.js').DampReqRequest;
var DampReqResponse = require('../../request_response.js').DampReqResponse;
var makeTimersMock = require('../lib/timers-mock');
var Member = require('../../lib/membership/member.js');
var MemberDampScore = require('../../lib/membership/member_damp_score.js');
var testRingpop = require('../lib/test-ringpop.js');
var timers = require('timer-shim');

var noop = function noop() {};

function setupMembership(deps, numMembers) {
    numMembers = numMembers || 3;

    var membership = deps.membership;
    var memberGen = fixtures.memberGenerator(deps.ringpop);
    var members = [];
    for (var i = 0; i < numMembers; i++) {
        var member = memberGen();
        membership.makeChange(member.address, member.incarnationNumber, Member.Status.alive);
        members.push(member);
    }
    return members;
}

function stubClient(deps, protocolDampReq) {
    deps.ringpop.client = {
        destroy: noop,
        protocolDampReq: protocolDampReq
    };
}

testRingpop('damped max percentage', function t(deps, assert) {
    assert.plan(1);

    // Lower allowable damped members to 0%
    var config = deps.config;
    config.set('dampedMaxPercentage', 0);

    var damper = deps.damper;
    damper.on('dampedLimitExceeded', function onEvent(event) {
        assert.equals(event.name, 'DampedLimitExceededEvent',
            'damped limit exceeded event');
    });
    damper.initiateSubprotocol(noop);
});

testRingpop('damp-req selection unsatisfied', function t(deps, assert) {
    assert.plan(1);

    var damper = deps.damper;
    damper.on('dampReqUnsatisfied', function onEvent(event) {
        assert.pass('damp req selection unsatisfied');
    });
    damper.initiateSubprotocol(noop);
});

testRingpop({
    async: true
}, 'sends n-val damp-reqs', function t(deps, assert, done) {
    assert.plan(2);

    var config = deps.config;
    var nVal = 10;
    config.set('dampReqNVal', nVal);
    config.set('dampReqRVal', nVal);

    // Create enough members to satisfy damp-req selection
    var targets = setupMembership(deps, nVal + 1);

    // Remove member from list when a damp-req is sent to member.
    stubClient(deps, function protocolDampReq(opts, body, callback) {
        targets = targets.filter(function filter(member) {
            return member.address !== opts.host;
        });

        process.nextTick(function onTick() {
            callback(null, new DampReqResponse(deps.ringpop, body, {
                dampScore: 0
            }));
        });
    });

    var damper = deps.damper;
    var flappyMember = targets[targets.length - 1];
    damper.addFlapper(flappyMember);
    // By the time inconclusive event is emitted all members
    // should have received a damp-req.
    damper.on('dampingInconclusive', function onEvent(event) {
        assert.equals(targets.length, 1, 'all n received damp req');
        // Only one not to be filtered out: the flappy member itself.
        assert.equals(targets[0].address, flappyMember.address,
            'flappy member not filtered out');
        done();
    });
    damper.initiateSubprotocol(noop);
});

testRingpop('adds flapper', function t(deps, assert) {
    var damper = deps.damper;
    var member1 = fixtures.member1(deps.ringpop);
    assert.true(damper.addFlapper(member1), 'does not remove flapper');
});

testRingpop('does not add flapper if already damped', function t(deps, assert) {
    var damper = deps.damper;
    var member1 = fixtures.member1(deps.ringpop);
    damper.addDampedMember(member1.address);
    damper.addFlapper(member1);
    assert.false(damper.hasFlapper(member1), 'does not have flapper');
});

testRingpop('does not add flapper twice', function t(deps, assert) {
    var damper = deps.damper;
    var member1 = fixtures.member1(deps.ringpop);
    assert.true(damper.addFlapper(member1), 'adds flapper');
    assert.false(damper.addFlapper(member1), 'does not add flapper');
});

testRingpop('starts damper after adding first flapper', function t(deps, assert) {
    var damper = deps.damper;
    assert.false(damper.hasStarted(), 'has not started');
    var member1 = fixtures.member1(deps.ringpop);
    damper.addFlapper(member1);
    assert.true(damper.hasStarted(), 'has started');
});

testRingpop('removes flapper', function t(deps, assert) {
    var damper = deps.damper;
    var member1 = fixtures.member1(deps.ringpop);
    damper.addFlapper(member1);
    assert.true(damper.removeFlapper(member1), 'removes flapper');
});

testRingpop('does not remove flapper if never added', function t(deps, assert) {
    var damper = deps.damper;
    var member1 = fixtures.member1(deps.ringpop);
    assert.false(damper.removeFlapper(member1), 'does not remove flapper');
});

testRingpop('stops damp timer if last flapper removed', function t(deps, assert) {
    var damper = deps.damper;
    var member1 = fixtures.member1(deps.ringpop);
    damper.addFlapper(member1);
    assert.true(damper.hasStarted(), 'has started');
    damper.removeFlapper(member1);
    assert.false(damper.hasStarted(), 'has stopped');
});

testRingpop({
    async: true
}, 'damps multiple members', function t(deps, assert, done) {
    assert.plan(2);

    var config = deps.config;
    // Make sure we can damp as many members as needed
    config.set('dampedMaxPercentage', 100);
    var targets = setupMembership(deps, config.get('dampReqNVal'));
    var flapper1 = targets[0];
    var flapper2 = targets[1];

    // Arrange scores for damp-req response gathered by subprotocol initiated
    // below.
    var dampScore = config.get('dampScoringSuppressLimit');
    var scores = [{
        member: flapper1.address,
        dampScore: dampScore
    }, {
        member: flapper2.address,
        dampScore: dampScore
    }];

    // Stub clients to respond with scores.
    stubClient(deps, function protocolDampReq(host, body, callback) {
        process.nextTick(function onTick() {
            callback(null, new DampReqResponse(deps.ringpop, body, scores));
        });
    });

    // Add flappers and initiate subprotocol that'll retrieve the scores
    // arranged above.
    var damper = deps.damper;
    damper.addFlapper(flapper1);
    damper.addFlapper(flapper2);
    damper.initiateSubprotocol(function onSubprotocol() {
        assert.true(damper.isDamped(flapper1), 'member is damped');
        assert.true(damper.isDamped(flapper2), 'member is damped');
        done();
    });
});

testRingpop('damp timer initiates subprotocol', function t(deps, assert) {
    assert.plan(2);

    var timers = makeTimersMock();
    var damper = deps.damper;
    damper.timers = timers;
    damper.on('started', function onEvent(event) {
        assert.pass('damper started');
    });

    var member1 = fixtures.member1(deps.ringpop);
    // Kicks off damp timer
    damper.addFlapper(member1);

    // Advance interval twice; expect subprotocol to be started
    // twice.
    var config = deps.config;
    timers.advance(config.get('dampTimerInterval') + 1);
    timers.advance(config.get('dampTimerInterval') + 1);
});

testRingpop('damping member starts expiration', function t(deps, assert) {
    var damper = deps.damper;
    var member1 = fixtures.member1(deps.ringpop);
    assert.false(damper.dampMember(member1.address), 'cannot damp member');

    var membership = deps.membership;
    membership.makeChange(member1.address, member1.incarnationNumber, Member.Status.alive);
    assert.false(damper.dampMember(member1.address), 'cannot damp member');

    assert.false(damper.expirationTimer, 'expiration timer not started');
    damper.addFlapper(member1);
    damper.dampMember(member1.address);
    assert.true(damper.isDamped(member1), 'member is damped');
    assert.true(damper.expirationTimer, 'expiration timer started');
});

testRingpop('expires damped members', function t(deps, assert) {
    assert.plan(5);

    var damper = deps.damper;
    var timers = makeTimersMock();
    // Stub damper timers to allow for expiring damped members
    damper.timers = timers;
    damper.Date = timers;

    // Before we advance time, let's make sure we tick the expiration timer once.
    var config = deps.config;
    var expirationInterval = config.get('dampedMemberExpirationInterval');
    config.set('dampScoringSuppressDuration', expirationInterval - 1);

    var member1 = fixtures.member1(deps.ringpop);
    assert.false(damper.dampMember(member1.address), 'cannot damp member');

    var membership = deps.membership;
    membership.makeChange(member1.address, member1.incarnationNumber, Member.Status.alive);
    assert.false(damper.dampMember(member1.address), 'member is not damped');

    damper.addFlapper(member1);
    damper.dampMember(member1.address);
    assert.true(damper.isDamped(member1), 'member is damped');

    // Advance fake time beyond damped member suppress duration
    damper.on('dampedMemberExpiration', function onEvent(event) {
        var undampedMembers = event.undampedMembers;
        assert.equals(undampedMembers.length, 1, 'a member has been undamped');
        assert.false(damper.isDamped(member1), 'member is no longer damped');
    });
    timers.advance(expirationInterval + 1);
});

testRingpop('expires no damped members', function t(deps, assert) {
    var damper = deps.damper;
    var undampedMembers = damper.expireDampedMembers();
    assert.equals(undampedMembers.length, 0, 'undamps no members');
});

testRingpop({
    async: true
}, 'deals with damp-req errors', function t(deps, assert, done) {
    assert.plan(1);

    var config = deps.config;
    var nVal = 10;
    config.set('dampReqNVal', nVal);
    config.set('dampReqRVal', nVal);

    // Create enough members to satisfy damp-req selection
    var targets = setupMembership(deps, nVal + 1);

    // Remove member from list when a damp-req is sent to member.
    stubClient(deps, function protocolDampReq(host, body, callback) {
        targets = targets.filter(function filter(member) {
            return member.address !== host;
        });

        process.nextTick(function onTick() {
            callback(new Error('damp-req error'));
        });
    });

    var damper = deps.damper;
    var flappyMember = targets[targets.length - 1];
    damper.addFlapper(flappyMember);
    damper.on('dampReqFailed', function onEvent(event) {
        assert.true(event.err, 'an error occurred');
        done();
    });
    damper.initiateSubprotocol(noop);
});

testRingpop('damp these members', function t(deps, assert) {
    var ringpop = deps.ringpop;
    var config = deps.config;
    config.set('dampScoringSuppressLimit', 4999);

    var scores = [
        new MemberDampScore('127.0.0.1:3000', 5000),
        new MemberDampScore('127.0.0.1:3001', 5000),
        new MemberDampScore('127.0.0.1:3002', 4998)
    ];
    var request = new DampReqRequest(ringpop);
    var responses = [
        new DampReqResponse(ringpop, request, scores),
        new DampReqResponse(ringpop, request, scores),
        new DampReqResponse(ringpop, request, scores)
    ];

    var rVal = config.get('dampReqRVal');
    var membersToDamp = Damper.getMembersToDamp(responses, rVal, config);
    assert.equals(membersToDamp.length, 2, '2 members to damp');
    assert.true(membersToDamp.indexOf('127.0.0.1:3000') > -1, 'member to damp');
    assert.true(membersToDamp.indexOf('127.0.0.1:3001') > -1, 'member to damp');
});
