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

var Member = require('../../lib/membership/member.js');
var testRingpop = require('../lib/test-ringpop.js');

testRingpop('starting and stopping gossip sets timer / unsets timers', function t(deps, assert) {
    var gossip = deps.gossip;

    gossip.start();
    assert.ok(gossip.protocolPeriodTimer, 'protocol period timer was set');
    assert.ok(gossip.protocolRateTimer, 'protocol rate timer was set');

    gossip.stop();
    assert.notok(gossip.protocolPeriodTimer, 'protocol period timer was cleared');
    assert.notok(gossip.protocolRateTimer, 'protocol rate timer was cleared');
});

testRingpop('stopping gossip is a noop if gossip was never started', function t(deps, assert) {
    var gossip = deps.gossip;

    gossip.protocolPeriodTimer = 'nochange';
    gossip.stop();

    assert.equals(gossip.protocolPeriodTimer, 'nochange', 'timer was not cleared');
    assert.equals(gossip.isStopped, true, 'gossip was not stopped');
});

testRingpop('gossip can be restarted', function t(deps, assert) {
    var gossip = deps.gossip;

    gossip.start();

    gossip.stop();
    assert.equals(gossip.protocolPeriodTimer, null, 'timer was cleared');
    assert.equals(gossip.isStopped, true, 'gossip was stopped');

    gossip.start();
    assert.ok(gossip.protocolPeriodTimer, 'timer was set');
    assert.equals(gossip.isStopped, false, 'gossip was started');
});

testRingpop('suspect period for member is started', function t(deps, assert) {
    var membership = deps.membership;
    var stateTransitions = deps.stateTransitions;

    var address = '127.0.0.1:3001';
    membership.makeChange(address, Date.now(), Member.Status.alive);

    var member = membership.findMemberByAddress(address);
    stateTransitions.scheduleSuspectToFaulty(member);

    var st = stateTransitions.timers[member.address];
    assert.ok(st.timer, 'timer is set for member suspect period');
    assert.equals(st.state, Member.Status.suspect,
        'initial state is set for the state transition');
});

testRingpop('suspect period cannot be started for local member', function t(deps, assert) {
    var membership = deps.membership;
    var stateTransitions = deps.stateTransitions;

    var member = membership.findMemberByAddress(deps.ringpop.whoami());
    stateTransitions.scheduleSuspectToFaulty(member);

    assert.notok(stateTransitions.timers[member.address],
        'timer is not set for local member suspect period');
});

testRingpop('starting the same state transition for a member is a noop', function t(deps, assert) {
    var membership = deps.membership;
    var address = '127.0.0.1:3001';
    membership.makeChange(address, Date.now(), Member.Status.alive);

    var stateTransitions = deps.stateTransitions;

    var remoteMember = membership.findMemberByAddress(address);
    var st = stateTransitions.timers[remoteMember.address] = {
        timer: 1,
        state: Member.Status.suspect
    };
    stateTransitions.scheduleSuspectToFaulty(remoteMember);
    assert.equals(st.timer, 1, 'timer did not change');
    assert.equals(st.state, Member.Status.suspect, 'status did not change');
});

testRingpop('starting a new state transition for a member stops the previous one', function t(deps, assert) {
    assert.plan(4);

    var membership = deps.membership;
    var address = '127.0.0.1:3001';
    membership.makeChange(address, Date.now(), Member.Status.alive);

    var stateTransitions = deps.stateTransitions;

    var remoteMember = membership.findMemberByAddress(address);
    stateTransitions.timers[remoteMember.address] = {
        timer: -1,
        state: Member.Status.suspect
    };
    stateTransitions.cancel = function(member) {
        assert.equals(member.address, remoteMember.address, 'stopping correct member period');
        assert.pass('stop was called on previous member period');
    }
    stateTransitions.schedule(remoteMember, Member.Status.faulty, 100, function() {});
    assert.notEquals(stateTransitions.timers[remoteMember.address].timer, -1, 'timer was updated');
    assert.equals(stateTransitions.timers[remoteMember.address].state, Member.Status.faulty, 'status was updated');
});

testRingpop('suspect period can\'t be started until enabled', function t(deps, assert) {
    var membership = deps.membership;
    var stateTransitions = deps.stateTransitions;

    var address = '127.0.0.1:3001';
    membership.makeChange(address, Date.now(), Member.Status.alive);

    stateTransitions.disable();

    var remoteMember = membership.findMemberByAddress(address);
    stateTransitions.scheduleSuspectToFaulty(remoteMember);
    assert.notok(stateTransitions.timers[remoteMember.address], 'timer for member was not set');

    stateTransitions.enable();
    assert.ok(stateTransitions.enabled, 'state transitions enabled');

    stateTransitions.scheduleSuspectToFaulty(remoteMember);
    assert.ok(stateTransitions.timers[remoteMember.address], 'timer for member was set');
});

testRingpop('state transition stop all clears all timers', function t(deps, assert) {
    var addr1 = '127.0.0.1:3001';
    var addr2 = '127.0.0.1:3002';

    var membership = deps.membership;
    membership.makeChange(addr1, Date.now(), Member.Status.alive);
    membership.makeChange(addr2, Date.now(), Member.Status.alive);

    var remoteMember = membership.findMemberByAddress(addr1);
    var remoteMember2 = membership.findMemberByAddress(addr2);

    var stateTransitions = deps.stateTransitions;
    stateTransitions.scheduleSuspectToFaulty(remoteMember);
    stateTransitions.scheduleSuspectToFaulty(remoteMember2);

    assert.ok(stateTransitions.timers[remoteMember.address], 'suspect timer started for first member');
    assert.ok(stateTransitions.timers[remoteMember2.address], 'suspect timer started for next member');

    stateTransitions.disable();
    assert.notok(stateTransitions.timers[remoteMember.address], 'suspect timer clear for first member');
    assert.notok(stateTransitions.timers[remoteMember2.address], 'suspect timer clear for next member');
    assert.notok(stateTransitions.enabled, 'stopped all timers');
});

testRingpop('state transitions cannot be enabled without all timers first being stopped', function t(deps, assert) {
    var stateTransitions = deps.stateTransitions;

    stateTransitions.enabled = 'fakestopall';
    stateTransitions.enable();
    assert.equals(stateTransitions.enabled, 'fakestopall', 'state transitions not enabled');
});

testRingpop({
    async: true
}, 'marks member faulty after suspect period', function t(deps, assert, done) {
    assert.plan(1);

    var membership = deps.membership;
    var stateTransitions = deps.stateTransitions;

    var address = '127.0.0.1:3001';
    membership.makeChange(address, Date.now(), Member.Status.alive);

    var member = membership.findMemberByAddress(address);

    stateTransitions.suspectTimeout = 1;
    stateTransitions.scheduleSuspectToFaulty(member);

    setTimeout(function onTimeout() {
        assert.equals(member.status, Member.Status.faulty, 'member is faulty');
        done();
    }, stateTransitions.suspectTimeout + 1);
});

testRingpop({
    async: true
}, 'marks member tombstone after faulty period', function t(deps, assert, done) {
    assert.plan(1);

    var membership = deps.membership;
    var stateTransitions = deps.stateTransitions;

    var address = '127.0.0.1:3001';
    membership.makeChange(address, Date.now(), Member.Status.alive);

    var member = membership.findMemberByAddress(address);

    stateTransitions.faultyTimeout = 1;
    stateTransitions.scheduleFaultyToTombstone(member);

    setTimeout(function onTimeout() {
        assert.equals(member.status, Member.Status.tombstone, 'member is tombstone');
        done();
    }, stateTransitions.faultyTimeout + 1);
});

testRingpop({
    async: true
}, 'evict member after tombstone period', function t(deps, assert, done) {
    assert.plan(1);

    var membership = deps.membership;
    var stateTransitions = deps.stateTransitions;

    var address = '127.0.0.1:3001';
    membership.makeChange(address, Date.now(), Member.Status.alive);

    var member = membership.findMemberByAddress(address);

    stateTransitions.tombstoneTimeout = 1;
    stateTransitions.scheduleTombstoneToEvict(member);

    setTimeout(function onTimeout() {
        assert.notOk(membership.findMemberByAddress(address), 'member was evicted');
        done();
    }, stateTransitions.tombstoneTimeout + 1);
});
