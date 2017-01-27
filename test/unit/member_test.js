// Copyright (c) 2017 Uber Technologies, Inc.
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

var Member = require('../../lib/membership/member.js');
var testRingpop = require('../lib/test-ringpop.js');

function addSecondMember(membership, address) {
    membership.update([{
        address: address,
        status: Member.Status.alive,
        incarnationNumber: 1
    }]);

    return membership.findMemberByAddress(address);
}

testRingpop('damp score intialized', function t(deps, assert) {
    var config = deps.config;
    var membership = deps.membership;
    var member2 = addSecondMember(membership, '127.0.0.1:3001');
    assert.equals(member2.dampScore, config.get('dampScoringInitial'),
        'damp score is initialized');
});

testRingpop('penalized for update', function t(deps, assert) {
    var membership = deps.membership;
    var member2 = addSecondMember(membership, '127.0.0.1:3001');
    member2.applyUpdate({
        status: Member.Status.suspect,
        incarnationNumber: Date.now() + 1
    });
    var config = deps.config;
    assert.notEqual(member2.dampScore, config.get('dampScoringInitial'),
        'damp score adjusted');
});

testRingpop('flaps until exceeds suppress limit', function t(deps, assert) {
    assert.plan(1);

    var config= deps.config;
    config.set('dampScoringMax', 1000);
    config.set('dampScoringSuppressLimit', 500);
    config.set('dampScoringPenalty', 251); // 2 updates is all it'll take

    var membership = deps.membership;
    var member2 = addSecondMember(membership, '127.0.0.1:3001');
    member2.on('memberSuppressLimitExceeded', onExceeded);
    member2.applyUpdate({
        status: Member.Status.suspect,
        incarnationNumber: Date.now() + 1
    });
    member2.applyUpdate({
        status: Member.Status.faulty,
        incarnationNumber: Date.now() + 2
    });
    assert.true(member2.dampScore > config.get('dampScoringSuppressLimit'),
        'damp score exceeds suppress limit');

    function onExceeded() {
        assert.pass('suppress limit exceeded');
    }
});

testRingpop('damp score never exceeds max', function t(deps, assert) {
    var config= deps.config;
    config.set('dampScoringMax', 1000);
    // Penalty of this size will reach max after one update
    config.set('dampScoringPenalty', 5000);

    var membership = deps.membership;
    var member2 = addSecondMember(membership, '127.0.0.1:3001');
    member2.applyUpdate({
        status: Member.Status.suspect,
        incarnationNumber: Date.now() + 1
    });
    assert.true(member2.dampScore === config.get('dampScoringMax'),
        'damp score equals max');
});

testRingpop('penalized in penalty increments', function t(deps, assert) {
    var config= deps.config;
    config.set('dampScoringMax', 1000);
    config.set('dampScoringPenalty', 100);

    var membership = deps.membership;
    var member2 = addSecondMember(membership, '127.0.0.1:3001');

    // First penalty
    member2.applyUpdate({
        status: Member.Status.suspect,
        incarnationNumber: Date.now() + 1
    });
    assert.true(member2.dampScore === config.get('dampScoringPenalty'),
        'damp score is penalty');

    // Second
    member2.applyUpdate({
        status: Member.Status.suspect,
        incarnationNumber: Date.now() + 2
    });
    assert.true(member2.dampScore === config.get('dampScoringPenalty') * 2,
        'damp score is multiple of penalty');

    // Third
    member2.applyUpdate({
        status: Member.Status.suspect,
        incarnationNumber: Date.now() + 3
    });
    assert.true(member2.dampScore === config.get('dampScoringPenalty') * 3,
        'damp score is multiple of penalty');
});

function decayBy(member, term) {
    // Decay rate is based on time since last update. Make it seem
    // as though time has advanced.
    member.Date = {
        now: function now() {
            return Date.now() + term
        }
    };
    member.decayDampScore();
}

testRingpop('decays by some arbitrary amount', function t(deps, assert) {
    var membership = deps.membership;
    var member2 = addSecondMember(membership, '127.0.0.1:3001');
    member2.applyUpdate({
        status: Member.Status.suspect,
        incarnationNumber: Date.now() + 1
    });

    var origDampScore = member2.dampScore;
    // Granularity of decay is in seconds. Set term to 1 greater.
    decayBy(member2, 1000 + 1);
    assert.true(member2.dampScore < origDampScore,
        'damp score has decayed');
});

testRingpop('decayed by half', function t(deps, assert) {
    var membership = deps.membership;
    var member2 = addSecondMember(membership, '127.0.0.1:3001');
    member2.applyUpdate({
        status: Member.Status.suspect,
        incarnationNumber: Date.now() + 1
    });

    var origDampScore = member2.dampScore;
    var config = deps.config;
    // * 1000 because half-life is in seconds
    decayBy(member2, config.get('dampScoringHalfLife') * 1000);
    assert.true(origDampScore / 2, 'damp score has decayed by half');
});

testRingpop('never decays below min', function t(deps, assert) {
    var config = deps.config;
    config.set('dampScoringInitial', 0);
    config.set('dampScoringPenalty', 100);
    config.set('dampScoringMin', 100);
    config.set('dampScoringMax', 1000);

    var membership = deps.membership;
    var member2 = addSecondMember(membership, '127.0.0.1:3001');
    member2.applyUpdate({
        status: Member.Status.suspect,
        incarnationNumber: Date.now() + 1
    });

    // Penalize until max reached
    var i = 1;
    while (member2.dampScore < config.get('dampScoringMax')) {
        member2.applyUpdate({
            status: Member.Status.suspect,
            incarnationNumber: Date.now() + i
        });
        i++;
    }

    // After 4 half-lives decay should have dropped below min (given
    // damp scoring config params set above)
    decayBy(member2, config.get('dampScoringHalfLife') * 1000 * 4);
    assert.true(member2.dampScore === config.get('dampScoringMin'),
        'damp score decayed to min');
});

testRingpop('member ID is its address', function t(deps, assert) {
    var address = '127.0.0.1:3000';
    var member = new Member(deps.ringpop, {
        address: address
    });
    assert.equals(member.id, address, 'ID is address');
});
