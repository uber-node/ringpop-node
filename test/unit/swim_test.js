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
    var suspicion = deps.suspicion;

    var address = '127.0.0.1:3001';
    membership.makeAlive(address, Date.now());

    var member = membership.findMemberByAddress(address);
    suspicion.start(member);

    assert.ok(suspicion.timers[member.address],
        'timer is set for member suspect period');
});

testRingpop('suspect period cannot be started for local member', function t(deps, assert) {
    var membership = deps.membership;
    var suspicion = deps.suspicion;

    var member = membership.findMemberByAddress(deps.ringpop.whoami());
    suspicion.start(member);

    assert.notok(suspicion.timers[member.address],
        'timer is not set for local member suspect period');
});

testRingpop('suspect period for member is stopped before another is started', function t(deps, assert) {
    assert.plan(2);

    var membership = deps.membership;
    var address = '127.0.0.1:3001';
    membership.makeAlive(address, Date.now());

    var suspicion = deps.suspicion;

    var remoteMember = membership.findMemberByAddress(address);
    suspicion.timers[remoteMember.address] = true;
    suspicion.stop = function(member) {
        assert.equals(member.address, remoteMember.address, 'stopping correct member period');
        assert.pass('stop was called on previous suspect period');
    };

    suspicion.start(remoteMember);
});

testRingpop('suspect period can\'t be started until reenabled', function t(deps, assert) {
    var membership = deps.membership;
    var suspicion = deps.suspicion;

    var address = '127.0.0.1:3001';
    membership.makeAlive(address, Date.now());

    suspicion.stopAll();

    var remoteMember = membership.findMemberByAddress(address);
    suspicion.start(remoteMember);
    assert.notok(suspicion.timers[remoteMember.address], 'timer for member was not set');

    suspicion.reenable();
    assert.equals(suspicion.isStoppedAll, null, 'suspicion reenabled');

    suspicion.start(remoteMember);
    assert.ok(suspicion.timers[remoteMember.address], 'timer for member was set');
});

testRingpop('suspect period stop all clears all timers', function t(deps, assert) {
    var addr1 = '127.0.0.1:3001';
    var addr2 = '127.0.0.1:3002';

    var membership = deps.membership;
    membership.makeAlive(addr1, Date.now());
    membership.makeAlive(addr2, Date.now());

    var remoteMember = membership.findMemberByAddress(addr1);
    var remoteMember2 = membership.findMemberByAddress(addr2);

    var suspicion = deps.suspicion;
    suspicion.start(remoteMember);
    suspicion.start(remoteMember2);

    assert.ok(suspicion.timers[remoteMember.address], 'suspect timer started for first member');
    assert.ok(suspicion.timers[remoteMember2.address], 'suspect timer started for next member');

    suspicion.stopAll();
    assert.notok(suspicion.timers[remoteMember.address], 'suspect timer clear for first member');
    assert.notok(suspicion.timers[remoteMember2.address], 'suspect timer clear for next member');
    assert.ok(suspicion.isStoppedAll, 'stopped all timers');
});

testRingpop('suspicion subprotocol cannot be reenabled without all timers first being stopped', function t(deps, assert) {
    var suspicion = deps.suspicion;

    suspicion.isStoppedAll = 'fakestopall';
    suspicion.reenable();
    assert.equals(suspicion.isStoppedAll, 'fakestopall', 'suspicion not reenabled');
});

testRingpop({
    async: true
}, 'marks member faulty after suspect period', function t(deps, assert, done) {
    assert.plan(1);

    var membership = deps.membership;
    var suspicion = deps.suspicion;

    var address = '127.0.0.1:3001';
    membership.makeAlive(address, Date.now());

    var member = membership.findMemberByAddress(address);

    suspicion.period = 1;
    suspicion.start(member);

    setTimeout(function onTimeout() {
        assert.equals(member.status, Member.Status.faulty, 'member is faulty');
        done();
    }, suspicion.period + 1);
});
