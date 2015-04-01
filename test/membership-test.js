// Copyright (c) 2015 Uber Technologies, Inc.
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

// Test dependencies
var Member = require('../lib/member.js');

// Test helpers
var testRingpop = require('./lib/test-ringpop.js');

function assertIncarnationNumber(deps, assert, memberStatus) {
    var membership = deps.membership;
    var local = membership.localMember;
    var prevInc = local.incarnationNumber - 1;

    membership.update({
        address: local.address,
        status: memberStatus,
        incarnationNumber: local.incarnatioNumber
    });

    assert.ok(prevInc, 'prev incarnation number is truthy');
}

testRingpop('suspect update does not bump local incarnation number', function t(deps, assert) {
    assertIncarnationNumber(deps, assert, Member.Status.suspect);
});

testRingpop('faulty update does not bump local incarnation number', function t(deps, assert) {
    assertIncarnationNumber(deps, assert, Member.Status.faulty);
});

testRingpop('checksum is changed when membership is updated', function t(deps, assert) {
    var membership = deps.membership;

    membership.makeAlive('127.0.0.1:3000', Date.now());
    var prevChecksum = membership.checksum;

    membership.makeAlive('127.0.0.1:3001', Date.now());

    assert.doesNotEqual(membership.checksum, prevChecksum, 'checksum is changed');
});

testRingpop('change with higher incarnation number results in leave override', function t(deps, assert) {
    var ringpop = deps.ringpop;
    var membership = deps.membership;

    var member = membership.findMemberByAddress(ringpop.whoami());
    assert.equals(member.status, Member.Status.alive, 'member starts alive');

    membership.update([{
        address: ringpop.whoami(),
        status: Member.Status.leave,
        incarnationNumber: member.incarnationNumber + 1
    }]);

    assert.equals(member.status, Member.Status.leave, 'results in leave');
});

testRingpop('change with same incarnation number does not result in leave override', function t(deps, assert) {
    var ringpop = deps.ringpop;
    var membership = deps.membership;

    var member = membership.findMemberByAddress(ringpop.whoami());
    assert.equals(member.status, Member.Status.alive, 'member starts alive');

    membership.update([{
        address: ringpop.whoami(),
        status: Member.Status.Leave,
        incarnationNumber: member.incarnationNumber
    }]);

    assert.equals(member.status, Member.Status.alive, 'results in no leave');
});

testRingpop('change with lower incarnation number does not result in leave override', function t(deps, assert) {
    var ringpop = deps.ringpop;
    var membership = deps.membership;

    var member = membership.findMemberByAddress(ringpop.whoami());
    assert.equals(member.status, Member.Status.alive, 'member starts alive');

    membership.update([{
        address: ringpop.whoami(),
        status: Member.Status.Leave,
        incarnationNumber: member.incarnationNumber - 1
    }]);

    assert.equals(member.status, Member.Status.alive, 'results in no leave');
});

testRingpop('member is able to go from alive to faulty without going through suspect', function t(deps, assert) {
    var membership = deps.membership;

    var newMemberAddr = '127.0.0.1:3001';
    membership.makeAlive(newMemberAddr, Date.now());

    var newMember = membership.findMemberByAddress(newMemberAddr);
    assert.equals(newMember.status, Member.Status.alive, 'member starts alive');

    membership.update([{
        address: newMember.address,
        status: Member.Status.faulty,
        incarnationNumber: newMember.incarnationNumber - 1
    }]);

    assert.equals(newMember.status, Member.Status.alive, 'no override with lower inc no.');

    membership.update([{
        address: newMember.address,
        status: Member.Status.faulty,
        incarnationNumber: newMember.incarnationNumber
    }]);

    assert.equals(newMember.status, Member.Status.faulty, 'override with same inc no.');
});

testRingpop('leave does not cause neverending updates', function t(deps, assert) {
    var membership = deps.membership;

    var addr = '127.0.0.1:3001';
    var incNo = Date.now();

    var updates = membership.makeAlive(addr, incNo);
    assert.equals(updates.length, 1, 'alive update applied');

    updates = membership.makeLeave(addr, incNo);
    assert.equals(updates.length, 1, 'leave update applied');

    updates = membership.makeLeave(addr, incNo);
    assert.equals(updates.length, 0, 'no leave update applied');
});
