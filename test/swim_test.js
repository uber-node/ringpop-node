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

var mock = require('./mock');
var test = require('tape');

var AdminJoiner = require('../lib/swim.js').AdminJoiner;
var Gossip = require('../lib/swim.js').Gossip;
var Suspicion = require('../lib/swim.js').Suspicion;

function createRingpop() {
    return {
        computeProtocolDelay: mock.noop,
        logger: mock.logger,
        membership: mock.membership,
        stat: mock.noop
    };
}

function createGossip() {
    return new Gossip(createRingpop());
}

function createSuspicion() {
    return new Suspicion(createRingpop());
}

test('join is aborted when max join duration is exceeded', function t(assert) {
    assert.plan(2);

    var joiner = new AdminJoiner({
        ringpop: {
            bootstrapHosts: ['127.0.0.1:3000', '127.0.0.1:3001', '127.0.0.1:3002'],
            channel: mock.channel,
            logger: mock.logger,
            membership: mock.membership
        },
        callback: function(err) {
            assert.ok(err, 'an error occurred');
            assert.equals(err.type, 'ringpop.join-duration-exceeded', 'join duration exceeded');
        },
        maxJoinDuration: 1
    });
    joiner.joinStart = new Date() - (86400 * 1000); // Started a day ago ;)
    joiner.sendJoin();

    assert.end();
});

test('starting and stopping gossip sets timer / unsets timers', function t(assert) {
    var gossip = createGossip();

    gossip.start();
    assert.ok(gossip.protocolPeriodTimer, 'protocol period timer was set');
    assert.ok(gossip.protocolRateTimer, 'protocol rate timer was set');

    gossip.stop();
    assert.notok(gossip.protocolPeriodTimer, 'protocol period timer was cleared');
    assert.notok(gossip.protocolRateTimer, 'protocol rate timer was cleared');

    assert.end();
});

test('stopping gossip is a noop if gossip was never started', function t(assert) {
    var gossip = createGossip();
    gossip.protocolPeriodTimer = 'nochange';

    gossip.stop();
    assert.equals(gossip.protocolPeriodTimer, 'nochange', 'timer was not cleared');
    assert.equals(gossip.isStopped, true, 'gossip was not stopped');

    assert.end();
});

test('gossip can be restarted', function t(assert) {
    var gossip = createGossip();
    gossip.start();

    gossip.stop();
    assert.equals(gossip.protocolPeriodTimer, null, 'timer was cleared');
    assert.equals(gossip.isStopped, true, 'gossip was stopped');

    gossip.start();
    assert.ok(gossip.protocolPeriodTimer, 'timer was set');
    assert.equals(gossip.isStopped, false, 'gossip was started');

    gossip.stop(); // Cleanup
    assert.end();
});

test('suspect period for member is started', function t(assert) {
    var member = { address: '127.0.0.1:3000' };
    var suspicion = createSuspicion();

    suspicion.start(member);
    assert.ok(suspicion.timers[member.address], 'timer is set for member suspect period');

    suspicion.stopAll(); // Cleanup
    assert.end();
});

test('suspect period cannot be started for local member', function t(assert) {
    var localMember = { address: '127.0.0.1:3000' };
    var suspicion = createSuspicion();
    suspicion.ringpop.membership.localMember = localMember;
    suspicion.ringpop.membership.getLocalMemberAddress = function() { return localMember.address; };

    suspicion.start(localMember);
    assert.notok(suspicion.timers[localMember.address], 'timer is not set for local member suspect period');

    suspicion.stopAll();
    assert.end();
});

test('suspect period for member is stopped before another is started', function t(assert) {
    assert.plan(2);

    var suspicion = createSuspicion();
    var remoteMember = suspicion.ringpop.membership.remoteMember;
    suspicion.timers[remoteMember.address] = true;
    suspicion.stop = function(member) {
        assert.equals(member.address, remoteMember.address, 'stopping correct member period');
        assert.pass('stop was called on previous suspect period');
    };

    suspicion.start(remoteMember);

    suspicion.stopAll();
    assert.end();
});

test('suspect period can\'t be started until reenabled', function t(assert) {
    var suspicion = createSuspicion();
    var remoteMember = suspicion.ringpop.membership.remoteMember;
    suspicion.stopAll();

    suspicion.start(remoteMember);
    assert.notok(suspicion.timers[remoteMember.address], 'timer for member was not set');

    suspicion.reenable();
    assert.equals(suspicion.isStoppedAll, null, 'suspicion reenabled');

    suspicion.start(remoteMember);
    assert.ok(suspicion.timers[remoteMember.address], 'timer for member was set');

    suspicion.stopAll();
    assert.end();
});

test('suspect period stop all clears all timers', function t(assert) {
    var suspicion = createSuspicion();
    var remoteMember = suspicion.ringpop.membership.remoteMember;
    var remoteMember2 = suspicion.ringpop.membership.remoteMember2;

    suspicion.start(remoteMember);
    suspicion.start(remoteMember2);
    assert.ok(suspicion.timers[remoteMember.address], 'suspect timer started for first member');
    assert.ok(suspicion.timers[remoteMember2.address], 'suspect timer started for next member');

    suspicion.stopAll();
    assert.notok(suspicion.timers[remoteMember.address], 'suspect timer clear for first member');
    assert.notok(suspicion.timers[remoteMember2.address], 'suspect timer clear for next member');
    assert.ok(suspicion.isStoppedAll, 'stopped all timers');

    assert.end();
});

test('suspicion subprotocol cannot be reenabled without all timers first being stopped', function t(assert) {
    var suspicion = createSuspicion();
    suspicion.isStoppedAll = 'fakestopall';
    suspicion.reenable();
    assert.equals(suspicion.isStoppedAll, 'fakestopall', 'suspicion not reenabled');
    assert.end();
});

test('marks member faulty after suspect period', function t(assert) {
    assert.plan(2);

    var suspicion = createSuspicion();
    var member = suspicion.ringpop.membership.remoteMember;
    suspicion.setTimeout = function(fn) { return fn(); };
    suspicion.ringpop.membership.update = function(changes) {
        assert.equals(changes[0].address, member.address, 'updates correct member');
        assert.equals(changes[0].status, 'faulty', 'marks member faulty');
    };

    suspicion.start(member);

    suspicion.stopAll();
    assert.end();
});
