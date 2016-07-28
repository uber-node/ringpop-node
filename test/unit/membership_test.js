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

var Member = require('../../lib/membership/member.js');
var testRingpop = require('../lib/test-ringpop.js');

testRingpop('checksum is changed when membership is updated', function t(deps, assert) {
    var membership = deps.membership;

    membership.makeLocalAlive();
    var prevChecksum = membership.checksum;

    membership.makeChange('127.0.0.1:3001', Date.now(), Member.Status.alive);

    assert.doesNotEqual(membership.checksum, prevChecksum, 'checksum is changed');
});

testRingpop('change that overrides the local status should be overwritten to a change that reincarnates the node', function t(deps, assert) {
    var ringpop = deps.ringpop;
    var membership = deps.membership;
    var source = "192.0.2.1:1234";

    assert.doesNotEqual(ringpop.whoami(), source, 'this test relies on the source and the target of the change to be different');

    var member = membership.findMemberByAddress(ringpop.whoami());
    assert.equals(member.status, Member.Status.alive, 'member starts alive');

    var applied = membership.update([{
        source: source,
        sourceIncarnationNumber: 1337,

        address: ringpop.whoami(),
        status: Member.Status.suspect,
        incarnationNumber: member.incarnationNumber
    }]);

    member = membership.findMemberByAddress(ringpop.whoami());

    assert.equals(applied.length, 1, 'expected 1 applied update');
    var change = applied[0];
    assert.equals(change.status, Member.Status.alive, 'expected the status of the applied update to be overriden to alive');
    assert.equals(change.incarnationNumber, member.incarnationNumber, 'expected the incarnation number of the change be equal to the incarnation number of the local member');
    assert.equals(change.sourceIncarnationNumber, member.incarnationNumber, 'expected the source incarnation number be equal the the incarnation number of the local member');
    assert.equals(change.source, ringpop.whoami(), 'expected the source to be the address of the local node');
    assert.equals(member.status, Member.Status.alive, 'the status of the member should stay alive');
});

testRingpop('change that does not override the local status should not cause a reincarnation', function t(deps, assert) {
    var ringpop = deps.ringpop;
    var membership = deps.membership;

    var member = membership.findMemberByAddress(ringpop.whoami());
    assert.equals(member.status, Member.Status.alive, 'member starts alive');

    var applied = membership.update([{
        address: ringpop.whoami(),
        status: Member.Status.suspect,
        incarnationNumber: member.incarnationNumber - 1
    }]);

    member = membership.findMemberByAddress(ringpop.whoami());

    assert.equals(applied.length, 0, 'expected 0 applied updates');
    var change = applied[0];
    assert.doesNotEqual(member.status, Member.Status.suspect, 'the status of the member should not transistion to suspect');
});

testRingpop('change with same incarnation number does not result in leave override (reincarnates)', function t(deps, assert) {
    var ringpop = deps.ringpop;
    var membership = deps.membership;

    var member = membership.findMemberByAddress(ringpop.whoami());
    assert.equals(member.status, Member.Status.alive, 'member starts alive');

    var applied = membership.update([{
        address: ringpop.whoami(),
        status: Member.Status.leave,
        incarnationNumber: member.incarnationNumber
    }]);

    assert.equals(member.status, Member.Status.alive, 'results in no leave');
    assert.equals(applied.length, 1, 'change applied');
});

testRingpop('change with lower incarnation number does not result in leave override', function t(deps, assert) {
    var ringpop = deps.ringpop;
    var membership = deps.membership;

    var member = membership.findMemberByAddress(ringpop.whoami());
    assert.equals(member.status, Member.Status.alive, 'member starts alive');

    var incarnationNumber = member.incarnationNumber;
    var applied = membership.update([{
        address: ringpop.whoami(),
        status: Member.Status.leave,
        incarnationNumber: member.incarnationNumber - 1
    }]);

    assert.equals(member.status, Member.Status.alive, 'results in no leave');
    assert.equals(member.incarnationNumber, incarnationNumber, 'incarnation number did not change');
    assert.equals(applied.length, 0, 'no changes applied');
});

testRingpop('member is able to go from alive to faulty without going through suspect', function t(deps, assert) {
    var membership = deps.membership;

    var newMemberAddr = '127.0.0.1:3001';
    membership.makeChange(newMemberAddr, Date.now(), Member.Status.alive);

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

    var updates = membership.makeChange(addr, incNo, Member.Status.alive);
    assert.equals(updates.length, 1, 'alive update applied');

    updates = membership.makeChange(addr, incNo, Member.Status.leave);
    assert.equals(updates.length, 1, 'leave update applied');

    updates = membership.makeChange(addr, incNo, Member.Status.leave);
    assert.equals(updates.length, 0, 'no leave update applied');
});

testRingpop('evict removes a member', function t(deps, assert) {
    var membership = deps.membership;

    var addr = '127.0.0.1:3001';
    var incNo = Date.now();

    membership.makeChange(addr, incNo, Member.Status.alive);
    assert.ok(membership.getMemberAt(1), 'alive applied');
    assert.ok(membership.findMemberByAddress(addr), 'alive applied');

    membership.evict(addr);
    assert.notOk(membership.getMemberAt(1), 'evict applied');
    assert.notOk(membership.findMemberByAddress(addr), 'evict applied');
});

testRingpop('cannot evict self', function t(deps, assert) {
    var membership = deps.membership;

    var localAddr = '127.0.0.1:3000';

    membership.makeLocalAlive();
    membership.evict(localAddr);
    assert.ok(membership.getMemberAt(0), 'evict not applied');
    assert.ok(membership.findMemberByAddress(localAddr), 'evict not applied');
});

testRingpop('generate checksums string preserves order of members', function t(deps, assert) {
    var membership = deps.membership;

    // Start with 1 to skip over the local (that's already alive) member.
    for (var i = 1; i < 100; i++) {
        membership.makeChange('127.0.0.1:' + (3000 + i), Date.now(), Member.Status.alive);
    }

    // Make sure they're out of order
    membership.shuffle();

    assert.equal(membership.getMemberCount(), 100, '100 members');

    var prevMembers = membership.members.slice(); // Make a copy

    var checksumString = membership.generateChecksumString();
    assert.ok(checksumString, 'checksum string is a value');

    assert.deepEqual(membership.members, prevMembers, 'preserves order');
});

testRingpop('sets previously stashed updates', function t(deps, assert) {
    var address = '127.0.0.1:3001';
    var membership = deps.membership;
    var ringpop = deps.ringpop;

    // Make sure updates are stashed -- make ringpop non-ready.
    ringpop.isReady = false;

    membership.makeChange(address, Date.now(), Member.Status.alive);
    assert.notok(membership.findMemberByAddress(address), 'member is not found');

    membership.set();

    assert.ok(membership.findMemberByAddress(address), 'member is found');
});

testRingpop('set merges stashed updates', function t(deps, assert) {
});

testRingpop('set adds all members', function t(deps, assert) {
    var membership = deps.membership;
    var ringpop = deps.ringpop;
    var addresses = createAddresses();

    // Make sure updates are stashed -- make ringpop non-ready.
    ringpop.isReady = false;

    // Stash all members
    addresses.forEach(function eachAddr(addr) {
        membership.makeChange(addr, Date.now(), Member.Status.alive);
    });

    addresses.forEach(function eachAddr(addr) {
        assert.notok(membership.findMemberByAddress(addr),
            'member is not found');
    });

    membership.set();

    // Confirm all are added
    addresses.forEach(function eachAddr(addr) {
        assert.ok(membership.findMemberByAddress(addr),
            'member is found');
    });

    function createAddresses() {
        var addresses = [];

        for (var i = 0; i < 5; i++) {
            addresses.push('127.0.0.1:' + (3001 + i));
        }

        return addresses;
    }
});

testRingpop('set emits an event', function t(deps, assert) {
    assert.plan(1);

    var ringpop = deps.ringpop;
    ringpop.isReady = false;

    var membership = deps.membership;
    membership.on('set', function onSet() {
        assert.pass('membership set');
    });

    membership.makeChange('127.0.0.1:3001', Date.now(), Member.Status.alive);
    membership.set();
});

testRingpop('set computes a checksum once', function t(deps, assert) {
    assert.plan(1);

    var ringpop = deps.ringpop;
    ringpop.isReady = false;

    var membership = deps.membership;
    membership.on('checksumComputed', function onSet() {
        assert.pass('checksum computed');
    });

    membership.makeChange('127.0.0.1:3001', Date.now(), Member.Status.alive);
    membership.set();
});

testRingpop('set does not shuffle member positions', function t(deps, assert) {
    var membership = deps.membership;
    var ringpop = deps.ringpop;
    var addresses = createAddresses();

    // Make sure updates are stashed -- make ringpop non-ready.
    ringpop.isReady = false;

    // Stash all members
    addresses.forEach(function eachAddr(addr) {
        if (addr === ringpop.whoami()) {
            membership.makeLocalAlive();
        } else {
            membership.makeChange(addr, Date.now(), Member.Status.alive);
        }
    });

    membership.set();

    // Confirm all are added in the correct position
    addresses.forEach(function eachAddr(addr, i) {
        assert.equal(membership.getMemberAt(i).address, addresses[i],
            'member is in the correct position');
    });

    function createAddresses() {
        var addresses = [];

        for (var i = 0; i < 5; i++) {
            addresses.push('127.0.0.1:' + (3000 + i));
        }

        return addresses;
    }
});

testRingpop('starts decayer on init', function t(deps, assert) {
    assert.ok(deps.membership.decayTimer, 'timer is set');
});

testRingpop('unsets decayer timer on stop', function t(deps, assert) {
    deps.membership.stopDampScoreDecayer();
    assert.notok(deps.membership.decayTimer, 'timer is unset');
});

testRingpop('respects decayer enabled config', function t(deps, assert) {
    var membership = deps.membership;
    membership.stopDampScoreDecayer();
    var config = deps.config;
    config.set('dampScoringDecayEnabled', false);
    membership.startDampScoreDecayer();
    assert.notok(membership.decayTimer, 'time is not set');
});

testRingpop('decayer decays all damp scores', function t(deps, assert) {
    var membership = deps.membership;
    membership.setTimeout = createTickOnce();
    // Stop decayer and schedule manually below
    membership.stopDampScoreDecayer();

    // Setup membership with 2 members
    var memberAddr3001 = '127.0.0.1:3001';
    var memberAddr3002 = '127.0.0.1:3002';
    membership.update([{
        address: memberAddr3001,
        status: Member.Status.suspect,
        incarnationNumber: Date.now() + 1
    }, {
        address: memberAddr3002,
        status: Member.Status.faulty,
        incarnationNumber: Date.now() + 1
    }]);

    // Make sure the two members have their damp scores
    // decayed when the decayer runs.
    assert.plan(2);
    assertOnDecayed(memberAddr3001);
    assertOnDecayed(memberAddr3002);
    membership.startDampScoreDecayer();

    function assertOnDecayed(addr) {
        var member = membership.findMemberByAddress(addr);
        member.on('dampScoreDecayed', function onDecayed() {
            assert.pass('damp score decayed');
        });
    }

    function createTickOnce() {
        var ticked = false;
        return function tick(onTimeout) {
            if (!ticked) {
                ticked = true;
                onTimeout();
            }
        };
    }
});

testRingpop('update happens synchronously or not at all', function t(deps, assert) {
    var membership = deps.membership;
    var address = '127.0.0.1:3001';
    var incarnationNumber = Date.now();

    membership.update([{
        address: address,
        status: Member.Status.alive,
        incarnationNumber: incarnationNumber
    }]);

    var emitted = false;
    membership.on('updated', function onUpdated() {
        emitted = true;
    });

    var update = {
        address: address,
        status: Member.Status.suspect,
        incarnationNumber: incarnationNumber+1
    };

    var updates = membership.update(update);
    assert.equal(updates.length, 1, 'update is applied');
    assert.true(emitted, 'event is emitted');

    // Reset and try the same (redundant) update again
    emitted = false;
    updates = membership.update(update);
    assert.equal(updates.length, 0, 'update is not applied');
    assert.false(emitted, 'event is not emitted');
});
