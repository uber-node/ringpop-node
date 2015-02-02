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
var RingPop = require('../index.js');
var test = require('tape');

test('does not throw when calling lookup with 0 servers', function t(assert) {
    var ringpop = new RingPop({
        app: 'ringpop-test',
        hostPort: '127.0.0.1:3000'
    });
    ringpop.lookup('deadbeef');
    ringpop.destroy();
    assert.end();
});

test('does not throw when calling lookup with an integer', function t(assert) {
    var ringpop = new RingPop({
        app: 'ringpop-test',
        hostPort: '127.0.0.1:3000'
    });
    ringpop.ring.addServer('127.0.0.1:3000');
    ringpop.lookup(12345);
    ringpop.destroy();
    assert.end();
});

test('key hashes to only server', function t(assert) {
    var onlyServer = '127.0.0.1:3000';
    var ringpop = new RingPop({
        app: 'ringpop-test',
        hostPort: onlyServer
    });
    ringpop.ring.addServer(onlyServer);
    assert.equals(ringpop.lookup(12345), onlyServer, 'hashes to only server');
    ringpop.destroy();
    assert.end();
});

test('admin join rejoins if member has previously left', function t(assert) {
    assert.plan(3);

    var ringpop = new RingPop({ app: 'ringpop', hostPort: '127.0.0.1:3000' });
    ringpop.addLocalMember({ incarnationNumber: 1 });
    ringpop.adminLeave(function(err, res1, res2) {
        assert.equals(res2, 'ok', 'node left cluster');

        ringpop.membership.localMember.incarnationNumber = 2;
        ringpop.adminJoin(null, function(err, res1, res2) {
            assert.equals(res2, 'rejoined', 'node rejoined cluster');
            assert.equals(ringpop.membership.localMember.status, 'alive', 'local member is alive');

            ringpop.destroy();
            assert.end();
        });
    });
});

test('admin join cannot be performed before local member is added to membership', function t(assert) {
    assert.plan(2);

    var ringpop = new RingPop({ app: 'ringpop', hostPort: '127.0.0.1:3000' });
    ringpop.adminJoin(null, function(err) {
        assert.ok(err, 'an error occurred');
        assert.equals(err.type, 'ringpop.invalid-local-member', 'invalid local member error');
        assert.end();
    });
});

test('admin leave prevents redundant leave', function t(assert) {
    assert.plan(2);

    var ringpop = new RingPop({ app: 'ringpop', hostPort: '127.0.0.1:3000' });
    ringpop.addLocalMember({ incarnationNumber: 1 });
    ringpop.membership.makeLeave();
    ringpop.adminLeave(function(err) {
        assert.ok(err, 'an error occurred');
        assert.equals(err.type, 'ringpop.invalid-leave.redundant', 'cannot leave cluster twice');
        assert.end();
    });
});

test('admin leave makes local member leave', function t(assert) {
    assert.plan(3);

    var ringpop = new RingPop({ app: 'ringpop', hostPort: '127.0.0.1:3000' });
    ringpop.addLocalMember({ incarnationNumber: 1 });
    ringpop.adminLeave(function(err, _, res2) {
        assert.notok(err, 'an error did not occur');
        assert.ok('leave', ringpop.membership.localMember.status, 'local member has correct status');
        assert.equals('ok', res2, 'admin leave was successful');
        assert.end();
    });
});

test('admin leave stops gossip', function t(assert) {
    assert.plan(2);

    var ringpop = new RingPop({ app: 'ringpop', hostPort: '127.0.0.1:3000' });
    ringpop.addLocalMember({ incarnationNumber: 1 });
    ringpop.gossip.start();
    ringpop.adminLeave(function(err) {
        assert.notok(err, 'an error did not occur');
        assert.equals(true, ringpop.gossip.isStopped, 'gossip is stopped');
        assert.end();
    });
});

test('admin leave stops suspicion subprotocol', function t(assert) {
    assert.plan(2);

    var local = '127.0.0.1:3000';
    var remote = { address: '127.0.0.2:3000' };
    var ringpop = new RingPop({ app: 'ringpop', hostPort: local });
    ringpop.addLocalMember({ incarnationNumber: 1 });
    ringpop.membership.addMember(remote);
    ringpop.suspicion.start(remote);

    ringpop.adminLeave(function(err) {
        assert.notok(err, 'an error did not occur');
        assert.equals(true, ringpop.suspicion.isStoppedAll, 'suspicion subprotocol is stopped');
        assert.end();
    });
});

test('admin leave cannot be attempted before local member is added', function t(assert) {
    assert.plan(2);

    var ringpop = new RingPop({ app: 'ringpop', hostPort: '127.0.0.1:3000' });

    ringpop.adminLeave(function(err) {
        assert.ok(err, 'an error occurred');
        assert.equals(err.type, 'ringpop.invalid-local-member', 'an invalid leave occurred');
        assert.end();
    });
});

test('protocol join disallows joining itself', function t(assert) {
    assert.plan(2);

    var itself = '127.0.0.1:3000';
    var ringpop = new RingPop({ app: 'ringpop', hostPort: itself });
    ringpop.protocolJoin({ source: itself }, function(err) {
        assert.ok(err, 'an error occurred');
        assert.equals(err.type, 'ringpop.invalid-join.source', 'a node cannot join itself');
        assert.end();
    });
});

test('protocol join disallows joining different app clusters', function t(assert) {
    assert.plan(2);

    var node1 = { app: 'mars', hostPort: '127.0.0.1:3000' };
    var node2 = { app: 'jupiter', source: '127.0.0.1:3001' };
    var ringpop = new RingPop(node1);
    ringpop.protocolJoin(node2, function(err) {
        assert.ok(err, 'an error occurred');
        assert.equals(err.type, 'ringpop.invalid-join.app', 'a node cannot join a different app cluster');
        assert.end();
    });
});

test('no opts does not break handleOrProxy', function t(assert) {
    var ringpop = new RingPop({ app: 'ringpop', hostPort: '127.0.0.1:3000' });
    ringpop.lookup = function() { return '127.0.0.1:3001'; };
    ringpop.requestProxy = mock.requestProxy;

    var key = 'KEY0';
    var req = {};
    var res = {};
    var opts = null;
    var handleOrProxy = ringpop.handleOrProxy.bind(ringpop, key, req, res, opts);
    assert.doesNotThrow(handleOrProxy, null, 'handleOrProxy does not throw');
    assert.end();
});
