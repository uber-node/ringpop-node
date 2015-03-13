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

var test = require('tape');
var TimeMock = require('time-mock');

var allocCluster = require('../lib/alloc-cluster.js');

// basic tests
test('can serialize url', function t(assert) {
    var cluster = allocCluster(function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two,
            url: '/foo', json: true
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.body.url, '/foo');

            cluster.destroy();
            assert.end();
        });
    });
});

test('can serialize headers', function t(assert) {
    var cluster = allocCluster(function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two,
            headers: { 'foo': 'bar' }, json: true
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.body.headers.foo, 'bar');

            cluster.destroy();
            assert.end();
        });
    });
});

test('can serialize method', function t(assert) {
    var cluster = allocCluster(function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two,
            method: 'POST', json: true
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.body.method, 'POST');

            cluster.destroy();
            assert.end();
        });
    });
});

test('can serialize httpVersion', function t(assert) {
    var cluster = allocCluster(function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two,
            httpVersion: '1.1', json: true
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.body.httpVersion, '1.1');

            cluster.destroy();
            assert.end();
        });
    });
});

test('will timeout after default timeout', function t(assert) {
    var timers = TimeMock(Date.now());
    var cluster = allocCluster({
        timers: timers,
        createHandler: function createHandler() {
            return function handle() {
                // do nothing to timeout
            };
        },
        requestProxyMaxRetries: 0
    }, function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two,
            json: { hello: true }
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 500);
            // timeout non deterministically times the cb out
            // or closes the TCP socket.
            assert.ok(resp.body === 'timed out' ||
                resp.body === 'socket closed');

            cluster.destroy();
            assert.end();
        });

        setTimeout(function onTick() {
            timers.advance(32000);
        }, 50);
    });
});

test('can serialize body', function t(assert) {
    var cluster = allocCluster(function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two,
            json: { hello: true }
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 200);
            assert.equal(resp.body.payload.hello, true);

            cluster.destroy();
            assert.end();
        });
    });
});

test('can serialize response statusCode', function t(assert) {
    var cluster = allocCluster({
         createHandler: function createHandler() {
            return function handle(req, res) {
                res.statusCode = 404;
                res.end();
            };
        }
    }, function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 404);

            cluster.destroy();
            assert.end();
        });
    });
});

test('can serialize response headers', function t(assert) {
    var cluster = allocCluster({
         createHandler: function createHandler() {
            return function handle(req, res) {
                res.setHeader('X-Foo', 'bar');
                res.end();
            };
        }
    }, function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 200);
            assert.equal(resp.headers['x-foo'], 'bar');

            cluster.destroy();
            assert.end();
        });
    });
});

test('can serialize response body', function t(assert) {
    var cluster = allocCluster({
         createHandler: function createHandler() {
            return function handle(req, res) {
                res.end('hello');
            };
        }
    }, function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 200);
            assert.equal(resp.body, 'hello');

            cluster.destroy();
            assert.end();
        });
    });
});

// new features
test('can handle errors differently');
test('adds forwarding header');
test('does not handle MockResponse errors');
test('checks the checksum for response');
test('can send back a close event');

// lack of coverage.
test('custom timeouts', function t(assert) {
    var timers = TimeMock(Date.now());
    var cluster = allocCluster({
        timers: timers,
        createHandler: function createHandler() {
            return function handle() {
                // do nothing to timeout
            };
        },
        requestProxyMaxRetries: 0
    }, function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two,
            json: { hello: true },
            timeout: 1500
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 500);
            assert.equal(resp.body, 'timed out');

            cluster.destroy();
            assert.end();
        });

        setTimeout(function onTick() {
            timers.advance(3200);
        }, 50);
    });
});

test('handle body failures', function t(assert) {
    var cluster = allocCluster(function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two,
            body: '1234567890',
            headers: {
                'content-length': '5'
            }
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 400);
            assert.equal(resp.body,
                'request size did not match content length');

            cluster.destroy();
            assert.end();
        });
    });
});

test('non json head is ok', function t(assert) {
    var cluster = allocCluster(function onReady() {
        var two = cluster.two;

        two.channel.register('/proxy/req', fakeProxyReq);

        cluster.request({
            host: 'one', key: cluster.keys.two
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 200);

            cluster.destroy();
            assert.end();
        });
    });

    function fakeProxyReq(arg1, arg2, hostInfo, cb) {
        cb(null, 'fake-text', '');
    }
});

test('handle tchannel failures', function t(assert) {
    var cluster = allocCluster({
        createHandler: function createHandler() {
            return function handle() {
                // do nothing to timeout
            };
        },
        requestProxyMaxRetries: 0
    }, function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 500);
            assert.equal(resp.body, 'socket closed');

            cluster.destroy();
            assert.end();
        });

        // Reach into the the first TChannel and forcibly
        // destroy its open TCP connection
        setTimeout(function onTimer() {
            var name = cluster.two.channel.name;
            cluster.one.channel.getPeer(name).socket.destroy();
        }, 100);
    });
});

test('handles checksum failures', function t(assert) {
    var ringpopOpts = {
        requestProxyMaxRetries: 0
    };

    var cluster = allocCluster(ringpopOpts, function onReady() {
        cluster.two.ring.addServer('localhost:9999');

        cluster.request({
            host: 'one', key: cluster.keys.two
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 500);
            assert.ok(resp.body.indexOf(
                'Expected the remote checksum to match local checksum') >= 0);

            cluster.destroy();
            assert.end();
        });
    });
});
