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
var test = require('tape');

var makeTimersMock = require('../lib/timers-mock');

var DiscoverProviderHealer = require('../../lib/partition_healing/discover_provider_healer');
var Healer = require('../../lib/partition_healing/healer');
var Ringpop = require('../../index');
var Member = require('../../lib/membership/member');
var Update = require('../../lib/membership/update');

/**
 * Small util function to generate a number of fake hosts.
 * @param numberOfHosts number of hosts to generate (max 10)
 * @returns {Array}
 */
function generateHosts(numberOfHosts) {
    var hosts = new Array(numberOfHosts);
    for (var i = 0; i < hosts.length; i++) {
        hosts[i] = '127.0.0.1:301' + i;
    }
    return hosts;
}

test('DiscoverProviderHealer - constructor', function t(assert) {
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000'
    });

    var discoverProviderHealer = new DiscoverProviderHealer(ringpop);

    assert.ok(discoverProviderHealer instanceof Healer, 'discover provider healer inherits from healer');
    assert.equal(discoverProviderHealer.ringpop, ringpop);

    ringpop.destroy();
    assert.end();
});


test('DiscoverProviderHealer.heal - errors', function t(assert) {
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000'
    });

    var discoverProviderHealer = new DiscoverProviderHealer(ringpop);

    assert.plan(4);

    discoverProviderHealer.heal(function(err) {
        assert.equal(err.type, DiscoverProviderHealer.Errors.RingpopIsNotReadyError().type);
    });

    ringpop.isReady = true;
    discoverProviderHealer.heal(function(err) {
        assert.equal(err.type, DiscoverProviderHealer.Errors.DiscoverProviderNotAvailableError().type);
    });

    var fakeError = new Error();
    ringpop.discoverProvider = function mockedDiscoverProvider(cb) {
        assert.pass('discover provider called');
        cb(fakeError);
    };

    discoverProviderHealer.heal(function(err) {
        assert.equal(err, fakeError, 'heal when discover provider errors returns error')
    });

    ringpop.destroy();
});

test('DiscoverProviderHeal.heal - random order', function t(assert) {
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000'
    });
    ringpop.isReady = true;

    var hosts = generateHosts(10);

    var discoverProviderHealer = new DiscoverProviderHealer(ringpop);
    ringpop.discoverProvider = function mockedDiscoverProvider(cb) {
        cb(null, hosts);
    };

    discoverProviderHealer.attemptHeal = function mockedAttemptHeal(target, cb) {
        cb(null, [target]);
    };

    discoverProviderHealer.heal(onHeal);

    function onHeal(err, targets) {
        assert.notok(err, 'no error');
        assert.equal(targets.length, hosts.length, 'all hosts should be healed');
        assert.notEqual(targets, hosts, 'order should be different');
        assert.end();
        ringpop.destroy();
    }
});

test('DiscoverProviderHeal.heal - partition healed after one attempt', function t(assert) {
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000'
    });
    ringpop.isReady = true;

    var hosts = generateHosts(3);

    var discoverProviderHealer = new DiscoverProviderHealer(ringpop);
    ringpop.discoverProvider = function mockedDiscoverProvider(cb) {
        cb(null, hosts);
    };

    discoverProviderHealer.attemptHeal = function mockedAttemptHeal(target, cb) {
        // return all hosts as 'pingable'
        cb(null, hosts);
    };

    discoverProviderHealer.heal(onHeal);

    function onHeal(err, targets) {
        assert.notok(err, 'no error');
        assert.equal(targets.length, 1, 'only one host targeted');
        assert.end();
        ringpop.destroy();
    }
});

test('DiscoverProviderHeal.heal - max failures', function t(assert) {
    var maxFailures = 2;
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000',
        discoverProviderHealerMaxFailures: maxFailures
    });
    ringpop.isReady = true;

    var hosts = generateHosts(10);

    var discoverProviderHealer = new DiscoverProviderHealer(ringpop);
    ringpop.discoverProvider = function mockedDiscoverProvider(cb) {
        cb(null, hosts);
    };

    var healAttempts = 0;
    discoverProviderHealer.attemptHeal = function mockedAttemptHeal(target, cb) {
        healAttempts += 1;
        assert.ok(healAttempts <= maxFailures, 'exceeded maximum failures');
        cb('error');
    };

    discoverProviderHealer.heal(onHeal);

    function onHeal(err, targets) {
        assert.notok(err, 'no error');
        assert.equal(targets.length, 0, 'no host successfully targeted');
        assert.end();
        ringpop.destroy();
    }
});

test('DiscoverProviderHeal.heal - only attempt to heal faulty (or worse) nodes', function t(assert) {
    var maxFailures = 2;
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000',
        discoverProviderHealerMaxFailures: maxFailures
    });
    ringpop.membership.makeLocalAlive();
    ringpop.isReady = true;

    var statuses = _.values(Member.Status);

    var nodes = {};
    for (var i = 0; i < statuses.length; i++) {
        var address = '127.0.0.1:' + (3100 + i);
        var status = statuses[i];
        ringpop.membership.update(new Update({
            address: address,
            incarnationNumber: Date.now(),
            status: status
        }));
        nodes[address] = {
            healAllowed: Member.statusPrecedence(status) >= Member.statusPrecedence(Member.Status.faulty),
            status: status
        };
    }

    var discoverProviderHealer = new DiscoverProviderHealer(ringpop);
    ringpop.discoverProvider = function mockedDiscoverProvider(cb) {
        cb(null, _.keys(nodes));
    };

    discoverProviderHealer.attemptHeal = function mockedAttemptHeal(target, cb) {
        assert.ok(nodes[target].healAllowed, 'heal allowed for ' + nodes[target].status);
        cb(null, [target]);
    };

    discoverProviderHealer.heal(onHeal);

    function onHeal(err) {
        assert.notok(err, 'no error');
        assert.end();
        ringpop.destroy();
    }
});

test('DiscoverProviderHeal.heal - never attempt to heal on self', function t(assert) {
    var maxFailures = 2;
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000',
        discoverProviderHealerMaxFailures: maxFailures
    });
    ringpop.membership.makeLocalAlive();
    ringpop.isReady = true;

    var discoverProviderHealer = new DiscoverProviderHealer(ringpop);
    ringpop.discoverProvider = function mockedDiscoverProvider(cb) {
        cb(null, ['127.0.0.1:3000']);
    };

    discoverProviderHealer.attemptHeal = function mockedAttemptHeal(target, cb) {
        assert.fail('attempt heal on self is not allowed!');
        cb(null, [target]);
    };

    // make self faulty
    ringpop.membership.setLocalStatus(Member.Status.faulty);

    discoverProviderHealer.heal(onHeal);

    function onHeal(err, targets) {
        assert.notok(err, 'no error');
        assert.deepEqual(targets, []);
        assert.end();
        ringpop.destroy();
    }
});

test('DiscoverProviderHealer - timers', function t(assert) {
    var timers = makeTimersMock();

    var periodTime = 10;
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000',
        discoverProviderHealerPeriod: periodTime,
        timers: timers
    });

    var discoverProviderHealer = ringpop.healer;
    discoverProviderHealer.heal = function mockedHeal(cb) {
        assert.fail('heal called without start');
        cb(null);
    };

    timers.advance(periodTime + 1);

    discoverProviderHealer.heal = function mockedHeal(cb) {
        assert.pass('heal called after start');
        cb(null);
    };
    discoverProviderHealer.start();
    timers.advance(periodTime + 1);

    discoverProviderHealer.stop();
    discoverProviderHealer.heal = function mockedHeal() {
        assert.fail('heal called after stop');
    };
    timers.advance(periodTime + 1);

    discoverProviderHealer._run();

    ringpop.destroy();
    assert.end();
});

test('DiscoverProviderHealer - starts on ready', function t(assert) {
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000'
    });

    var discoverProviderHealer = ringpop.healer;
    discoverProviderHealer.start = function mockedStart() {
        assert.pass('started!');
    };

    assert.plan(1);
    ringpop.emit('ready');
    ringpop.destroy();
    assert.end();
});
