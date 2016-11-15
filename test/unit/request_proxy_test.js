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

var allocRequest = require('../lib/alloc-request.js');
var mocks = require('../mock');
var RequestProxy = require('../../lib/request-proxy/index.js');
var Ringpop = require('../../index.js');
var test = require('tape');

function createRingpop() {
    return new Ringpop({
        app: 'test',
        hostPort: '127.0.0.1:3000',
        channel: mocks.tchannel
    });
}

function createRequestProxy(opts) {
    opts = opts || {};

    if (!opts.ringpop) {
        opts.ringpop = createRingpop();
    }
    return new RequestProxy(opts);
}

test('request proxy sends custom ringpop metadata in head', function t(assert) {
    assert.plan(1);

    var key = 'donaldduck';
    var dest = 'disneyworld';

    var proxy = createRequestProxy();
    var ringpop = proxy.ringpop;
    ringpop.channel.request = function(/* options */) {
        return {
            send: function(arg1, arg2) {
                var head = JSON.parse(arg2);
                assert.deepEquals(head.ringpopKeys, [key], 'sends key in head');

                ringpop.destroy();
                assert.end();
            }
        };
    };
    proxy.proxyReq({
        keys: [key],
        req: allocRequest({}),
        dest: dest
    });
});

test('request proxy emits head', function t(assert) {
    assert.plan(3);

    var proxy = createRequestProxy();
    var ringpop = proxy.ringpop;
    var headExpected = {
        ringpopChecksum: proxy.ringpop.membership.checksum,
        ringpopKeys: ['KEY0']
    };
    proxy.ringpop.on('request', function(req, res, head) {
        assert.ok(req, 'req exists');
        assert.ok(res, 'res exists');
        assert.equals(head, headExpected, 'head is emitted');

        ringpop.destroy();
        assert.end();
    });
    proxy.handleRequest(headExpected, null, mocks.noop);
});

test('request proxy passes down skipLookupOnRetry correctly', function t(assert) {
    assert.plan(2);

    var key = 'donaldduck';
    var dest = 'disneyworld';

    var proxy = createRequestProxy();
    var ringpop = proxy.ringpop;
    ringpop.requestProxy = proxy;
    ringpop.channel.request = function(/* options */) {
        return {
            send: function() {
                process.nextTick(function () {
                    assert.equals(proxy.sends.length, 1, '1 send');
                    assert.equals(proxy.sends[0].skipLookupOnRetry, true, 'skipLookupOnRetry passed down');

                    ringpop.destroy();
                    assert.end();
                });
            }
        };
    };
    ringpop.proxyReq({
        keys: [key],
        req: allocRequest({}),
        dest: dest,
        res: {},
        skipLookupOnRetry: true
    });
});

test('request proxy consistency defaults', function t(assert) {
    var proxy = createRequestProxy();
    assert.equal(proxy.enforceConsistency, true);
    assert.equal(proxy.enforceKeyConsistency, false);

    proxy.ringpop.destroy();
    assert.end();
});

test('request proxy - ring consistency: enabled', function t(assert) {
    assert.plan(2);

    assert.test('returns error on invalid checksum', function st(assert) {
        assert.plan(5);

        var proxy = createRequestProxy({enforceConsistency: true});
        var ringpop = proxy.ringpop;

        ringpop.on('requestProxy.checksumsDiffer', function() {
            assert.pass('requestProxy.checksumsDiffer emitted');
        });
        var headExpected = {
            ringpopChecksum: ringpop.membership.checksum + 1,
            ringpopKeys: ['KEY0']
        };

        proxy.ringpop.on('request', function onRequest() {
            assert.fail('request should be dropped')
        });
        proxy.handleRequest(headExpected, null, function requestHandled(err, head, body) {
            assert.notok(head, 'head should be null');
            assert.notok(body, 'body should be null');

            assert.notEqual(err, null);
            assert.equal(err.type, 'ringpop.request-proxy.invalid-checksum');

            ringpop.destroy();
            assert.end();
        });
    });

    assert.test('handles on valid checksum', function st(assert) {
        assert.plan(6);

        var proxy = createRequestProxy({enforceConsistency: true});
        var ringpop = proxy.ringpop;
        var headExpected = {
            ringpopChecksum: ringpop.membership.checksum,
            ringpopKeys: ['KEY0']
        };

        var respBody = {test: 'done'};

        ringpop.on('requestProxy.checksumsDiffer', function() {
            assert.fail('requestProxy.checksumsDiffer emitted');
        });

        ringpop.on('request', function(req, res, head) {
            assert.ok(req, 'req exists');
            assert.ok(res, 'res exists');
            assert.equals(head, headExpected, 'head is emitted');

            res.end(respBody);
        });

        proxy.handleRequest(headExpected, null, function requestHandled(err, head, body) {
            assert.notok(err);
            assert.ok(head);
            assert.equal(body, respBody);

            ringpop.destroy();
            assert.end();
        });
    });
});

test('request proxy - handles request with invalid checksum and ring consistency disabled', function t(assert) {
    assert.plan(7);

    var proxy = createRequestProxy({enforceConsistency: false});
    var ringpop = proxy.ringpop;
    var headExpected = {
        ringpopChecksum: ringpop.membership.checksum + 1,
        ringpopKeys: ['KEY0']
    };

    var respBody = {test: 'done'};

    ringpop.on('requestProxy.checksumsDiffer', function() {
        assert.pass('requestProxy.checksumsDiffer emitted');
    });

    ringpop.on('request', function(req, res, head) {
        assert.ok(req, 'req exists');
        assert.ok(res, 'res exists');
        assert.equals(head, headExpected, 'head is emitted');

        res.end(respBody);
    });

    proxy.handleRequest(headExpected, null, function requestHandled(err, head, body) {
        assert.notok(err);
        assert.ok(head);
        assert.equal(body, respBody);

        ringpop.destroy();
        assert.end();
    });
});

test('request proxy - key consistency - returns error when key not owned by node', function t(assert) {
    assert.plan(5);

    var proxy = createRequestProxy({
        enforceConsistency: false,
        enforceKeyConsistency: true
    });
    var ringpop = proxy.ringpop;

    // force lookup to a different node
    ringpop.lookup = function() {
        return 'not me';
    };

    var headExpected = {
        ringpopChecksum: ringpop.membership.checksum + 1,
        ringpopKeys: ['KEY0']
    };

    ringpop.on('requestProxy.keysDiffer', function() {
        assert.pass('requestProxy.keysDiffer emitted');
    });

    ringpop.on('request', function(req, res, head) {
        assert.fail('request should not be handled');
    });

    proxy.handleRequest(headExpected, null, function requestHandled(err, head, body) {
        assert.notok(head, 'head should be null');
        assert.notok(body, 'body should be null');

        assert.notEqual(err, null);
        assert.equal(err.type, 'ringpop.request-proxy.invalid-key');

        ringpop.destroy();
        assert.end();
    });
});

test('request proxy - key consistency - emit stat once', function t(assert) {
    assert.plan(5);

    var proxy = createRequestProxy({
        enforceConsistency: false,
        enforceKeyConsistency: false
    });
    var ringpop = proxy.ringpop;

    // force lookup to a different node
    ringpop.lookup = function() {
        return 'not me';
    };

    var headExpected = {
        ringpopChecksum: ringpop.membership.checksum + 1,
        ringpopKeys: ['KEY0', 'KEY1']
    };

    ringpop.once('requestProxy.keysDiffer', function() {
        assert.pass('requestProxy.keysDiffer emitted first time');

        // fail next time:
        ringpop.on('requestProxy.keysDiffer', function(){
            assert.fail('requestProxy.keysDiffer emitted again');
        });
    });

    ringpop.on('request', function(req, res, head) {
        assert.pass('request handled');
        res.end('done');
    });

    proxy.handleRequest(headExpected, null, function requestHandled(err, head, body) {
        assert.notok(err);
        assert.ok(head);
        assert.equal(body, 'done');

        ringpop.destroy();
        assert.end();
    });
});
