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

var after = require('after');
var allocCluster = require('../lib/alloc-cluster.js');
var allocRequest = require('../lib/alloc-request.js');
var allocResponse = require('../lib/alloc-response.js');
var bufferEqual = require('buffer-equal');
var express = require('express');
var http = require('http');
var jsonBody = require('body/json');
var makeTimersMock = require('../lib/timers-mock');
var strHead = require('../../lib/request-proxy/util.js').strHead;
var test = require('tape');
var testRingpopCluster = require('../lib/test-ringpop-cluster.js');
var tryIt = require('tryit');

var retrySchedule = [0, 0.01, 0.02];

function routeEgress(cluster, numRequests, callback) {
    var ringpop1 = cluster[0];
    var ringpop2 = cluster[1];
    var requestProxy = ringpop1.requestProxy;
    for (var i = 0; i < numRequests; i++) {
        var request = allocRequest({
            json: {
                datPayload: 100
            }
        });
        var response = allocResponse({}, callback);
        requestProxy.proxyReq({
            dest: ringpop2.whoami(),
            keys: ['lol'],
            req: request,
            res: response
        });
    }
}

function routeIngress(cluster, numRequests, callback) {
    var ringpop1 = cluster[0];
    var requestProxy = ringpop1.requestProxy;
    for (var i = 0; i < numRequests; i++) {
        requestProxy.handleRequest({
            ringpopChecksum: ringpop1.ring.checksum
        }, null, callback);
    }
}

function scheduleTicker(ringpop, onScheduled) {
    return function tickIt() {
        onScheduled();
        ringpop.timers.advance(10000);
    };
}

test('handleOrProxy() returns true for me', function t(assert) {
    var cluster = allocCluster(function onReady() {
        var keyOne = cluster.keys.one;

        assert.equal(cluster.one.handleOrProxy(keyOne), true);

        cluster.destroy();
        assert.end();
    });
});

test('handleOrProxy() proxies for not me', function t(assert) {
    var cluster = allocCluster(function onReady() {
        var keyTwo = cluster.keys.two;

        debugger;
        cluster.request({
            key: keyTwo,
            host: 'one',
            json: { hello: true }
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 200);
            assert.equal(resp.body.host, 'two');
            assert.equal(resp.body.payload.hello, true);

            cluster.destroy();
            assert.end();
        });
    });
});

test('handleOrProxyAll() proxies and handles locally', function t(assert) {
    var handlerCallCounts = {};
    var cluster = allocCluster({
        createHandler: createServerHandler
    }, function onReady() {
        var k = cluster.keys;
        var keys = [k.one, k.two, k.two, k.three];

        cluster.requestAll({
            keys: keys,
            host: 'one',
            json: { hello: true }
        }, onResponses);
    });

    function onResponses(err, responses) {
        assert.ifError(err);

        assert.equal(responses.length, 3);
        responses.forEach(function(data) {
            assert.equal(data.res.statusCode, 200);
            tryIt(function parse() {
                var body = JSON.parse(data.res.body);
                assert.equal(body.payload.hello, true);
            }, assert.ifError);
        });
        assert.equal(handlerCallCounts.one, 1);
        assert.equal(handlerCallCounts.two, 1);
        assert.equal(handlerCallCounts.three, 1);

        cluster.destroy();
        assert.end();
    }

    function createServerHandler(name) {
        return function serverHandle(req, res) {
            if (handlerCallCounts[name]) {
                handlerCallCounts[name]++;
            } else {
                handlerCallCounts[name] = 1;
            }

            if (req.headers['content-type'] === 'application/json') {
                jsonBody(req, {cache: true}, onBody);
            } else {
                onBody(null, undefined);
            }

            function onBody(err, result) {
                if (err) {
                    res.statusCode = 500;
                    return res.end(err.message);
                }

                res.statusCode = 200;
                res.end(JSON.stringify({
                    host: name,
                    url: req.url,
                    headers: req.headers,
                    method: req.method,
                    httpVersion: req.httpVersion,
                    payload: result
                }));
            }
        };
    }
});

test('can proxyReq() to someone', function t(assert) {
    var cluster = allocCluster(function onReady() {
        var keyOne = cluster.keys.one;
        var keyTwo = cluster.keys.two;

        assert.equal(cluster.one.handleOrProxy(keyOne), true);

        cluster.request({
            key: keyTwo,
            host: 'one',
            json: { hello: true }
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 200);
            assert.equal(resp.body.host, 'two');
            assert.equal(resp.body.payload.hello, true);

            cluster.destroy();
            assert.end();
        });
    });
});

test('one retry', function t(assert) {
    assert.plan(6);

    var ringpopOpts = {
        requestProxyMaxRetries: 3,
        requestProxyRetrySchedule: retrySchedule
    };

    var cluster = allocCluster(ringpopOpts, function onReady() {
        cluster.two.ring.checksum = cluster.one.ring.checksum + 1;

        cluster.two.once('requestProxy.checksumsDiffer', function onBadChecksum() {
            assert.pass('received request with invalid checksum');
            cluster.two.ring.checksum = cluster.one.ring.checksum;
        });

        cluster.two.once('request', function onGoodChecksum() {
            assert.pass('received subsequent request with valid checksum');
        });

        cluster.request({
            key: cluster.keys.two,
            host: 'one',
            json: { hello: true }
        }, function onResponse(err, resp) {
            assert.ifErr(err);

            assert.equal(resp.statusCode, 200);
            assert.equal(resp.body.host, 'two');
            assert.equal(resp.body.payload.hello, true);

            cluster.destroy();
            assert.end();
        });
    });
});

test('two retries', function t(assert) {
    assert.plan(9);

    var ringpopOpts = {
        requestProxyMaxRetries: 3,
        requestProxyRetrySchedule: retrySchedule
    };
    var numAttempts = 0;

    var cluster = allocCluster(ringpopOpts, function onReady() {
        cluster.two.ring.checksum = cluster.one.ring.checksum + 1;

        cluster.two.on('requestProxy.checksumsDiffer', function onBadChecksum() {
            numAttempts++;

            // If last retry
            if (numAttempts === cluster.two.requestProxy.maxRetries) {
                cluster.two.ring.checksum = cluster.one.ring.checksum;
            }

            assert.pass('received request with invalid checksum');
        });

        cluster.two.once('request', function onGoodChecksum() {
            numAttempts++;
            assert.pass('received request with valid checksum on last retry');
        });

        cluster.request({
            key: cluster.keys.two,
            host: 'one',
            json: { hello: true }
        }, function onResponse(err, resp) {
            assert.ifErr(err);

            assert.equal(resp.statusCode, 200);
            assert.equal(resp.body.host, 'two');
            assert.equal(resp.body.payload.hello, true);

            assert.equal(numAttempts, cluster.two.requestProxy.maxRetries + 1);

            cluster.destroy();
            assert.end();
        });
    });
});

test('no retries, invalid checksum', function t(assert) {
    assert.plan(4);

    var numAttempts = 0;
    var ringpopOpts = {
        requestProxyMaxRetries: 0
    };

    var cluster = allocCluster(ringpopOpts, function onReady() {
        cluster.two.ring.checksum = cluster.one.ring.checksum + 1;

        cluster.two.on('requestProxy.checksumsDiffer', function onBadChecksum() {
            numAttempts++;
            assert.pass('received request with invalid checksum');
        });

        cluster.two.once('request', function onGoodChecksum() {
            numAttempts++;
            assert.fail('never emits a request event');
        });

        cluster.request({
            key: cluster.keys.two,
            host: 'one',
            json: { hello: true }
        }, function onResponse(err, resp) {
            assert.ifErr(err);

            assert.equal(resp.statusCode, 500);
            assert.equal(numAttempts, 1, 'only 1 attempt because no retries');

            cluster.destroy();
            assert.end();
        });
    });
});

test('no retries, invalid checksum emit request when enforceConsistency is false', function t(assert) {
    assert.plan(6);

    var numAttempts = 0;
    var emittedRequest = false;
    var ringpopOpts = {
        requestProxyMaxRetries: 0,
        enforceConsistency: false
    };

    var cluster = allocCluster(ringpopOpts, function onReady() {
        cluster.two.ring.checksum = cluster.one.ring.checksum + 1;

        cluster.two.on('requestProxy.checksumsDiffer', function onBadChecksum() {
            numAttempts++;
            assert.pass('received request with invalid checksum');
        });

        cluster.two.once('request', function onGoodChecksum() {
            emittedRequest = true;
            assert.pass('received request with invalid checksum');
        });

        cluster.request({
            key: cluster.keys.two,
            host: 'one',
            json: { hello: true }
        }, function onResponse(err, resp) {
            assert.ifErr(err);

            assert.equal(resp.statusCode, 200);
            assert.equal(numAttempts, 1, 'only 1 attempt because no retries');
            assert.ok(emittedRequest, 'request is emmitted');

            cluster.destroy();
            assert.end();
        });
    });
});

test('exceeds max retries, errors out', function t(assert) {
    assert.plan(9);

    var numAttempts = 0;
    var ringpopOpts = {
        requestProxyMaxRetries: 5,
        requestProxyRetrySchedule: retrySchedule
    };

    var cluster = allocCluster(ringpopOpts, function onReady() {
        cluster.two.ring.checksum = cluster.one.ring.checksum + 1;

        cluster.two.on('requestProxy.checksumsDiffer', function onBadChecksum() {
            numAttempts++;
            assert.pass('received request with invalid checksum');
        });

        cluster.two.once('request', function onGoodChecksum() {
            numAttempts++;
            assert.fail('never emits a request event');
        });

        cluster.request({
            key: cluster.keys.two,
            host: 'one',
            json: { hello: true }
        }, function onResponse(err, resp) {
            assert.ifErr(err);

            assert.equal(resp.statusCode, 500);
            assert.equal(numAttempts, ringpopOpts.requestProxyMaxRetries + 1, '1 initial send + maxRetries');

            cluster.destroy();
            assert.end();
        });
    });
});

test('cleans up pending sends', function t(assert) {
    var numRequests = 3;

    var done = after(numRequests, function onDone() {
        var beforeDestroy = cluster.one.requestProxy.sends.length;
        assert.equal(beforeDestroy, numRequests, 'timers are pending');

        cluster.destroy();

        var afterDestroy = cluster.one.requestProxy.sends.length;
        assert.equal(afterDestroy, 0, 'timers are cleared');

        assert.end();
    });

    var ringpopOpts = {
        // Really really long delays before retry is initiated
        requestProxyRetrySchedule: [100000, 200000, 300000]
    };

    var cluster = allocCluster(ringpopOpts, function onReady() {
        cluster.two.ring.checksum = cluster.one.ring.checksum + 1;

        cluster.one.on('requestProxy.retryScheduled', function onRetry() {
            done();
        });

        function onRequest() {
            assert.fail('no response');
        }

        for (var i = 0; i < numRequests; i++) {
            cluster.request({
                key: cluster.keys.two,
                host: 'one',
                json: { hello: true }
            }, onRequest);
        }
    });
});

test('cleans up some pending sends', function t(assert) {
    var ringpopOpts = {
        // Really really long delays before retry is initiated
        requestProxyRetrySchedule: [100000, 200000, 300000]
    };

    var cluster = allocCluster(ringpopOpts, function onReady() {
        cluster.two.ring.checksum = cluster.one.ring.checksum + 1;

        // Only one retry will be attempted, others will still be waiting
        cluster.one.on('requestProxy.retryAttempted', function onRetry() {
            cluster.two.ring.checksum = cluster.one.ring.checksum;
        });

        for (var i = 0; i < 2; i++) {
            cluster.request({
                key: cluster.keys.two,
                host: 'one',
                json: { hello: true }
            }, assert.fail);
        }

        cluster.request({
            key: cluster.keys.two,
            host: 'one',
            json: { hello: true },
            retrySchedule: [0]
        }, function onRequest() {
            var beforeDestroy = cluster.one.requestProxy.sends.length;
            assert.equal(beforeDestroy, 2, 'sends are pending');

            cluster.destroy();

            assert.end();
        });
    });
});

test('overrides /proxy/req endpoint', function t(assert) {
    assert.plan(3);

    var endpoint = 'FIND ME A THING';
    var things = [
        'thing1',
        'thing2',
        'thing3'
    ];

    var cluster = allocCluster(function onReady() {
        cluster.two.on('request', function onRequest() {
            assert.fail('did not bypass request proxy handler');
        });

        cluster.two.channel.register(endpoint, function handler(req, res, arg2, arg3) {
            assert.equal(arg2.toString(), head, 'arg1 is raw head');
            assert.equal(arg3.toString(), '{"hello":true}', 'arg2 is raw body');
            res.headers.as = 'raw';
            res.sendOk(null, JSON.stringify(things));
        });

        var request = cluster.request({
            key: cluster.keys.two,
            host: 'one',
            endpoint: endpoint,
            json: { hello: true },
            maxRetries: 0
        }, function onRequest(err, resp) {
            assert.deepEqual(resp.body, things, 'responds with body');

            cluster.destroy();
            assert.end();
        });

        var head = strHead(request, {
            checksum: cluster.two.ring.checksum,
            keys: [cluster.keys.two]
        });
    });
});

test('overrides /proxy/req endpoint and fails', function t(assert) {
    assert.plan(3);

    var endpoint = 'FIND ME A THING';
    var error = 'things are bad';

    var cluster = allocCluster(function onReady() {
        cluster.two.channel.register(endpoint, function handler(req, res) {
            res.headers.as = 'raw';
            res.sendNotOk(null, error);
        });

        cluster.request({
            key: cluster.keys.two,
            host: 'one',
            endpoint: endpoint,
            json: { hello: true },
            maxRetries: 0
        }, function onRequest(err, resp) {
            assert.ifErr(err, 'no error occurred');
            assert.equal(resp.statusCode, 500, 'status code 500');
            assert.equal(resp.body, error, 'err message in body');

            cluster.destroy();
            assert.end();
        });
    });
});

test('aborts retry because keys diverge', function t(assert) {
    assert.plan(5);

    var numRetries = 0;

    var cluster = allocCluster({
        useFakeTimers: true
    }, function onReady() {
        // Make node two refuse initial request
        cluster.two.ring.checksum = cluster.one.ring.checksum + 1;

        cluster.one.on('requestProxy.retryAborted', function onRetryAborted() {
            assert.pass('retry aborted');
        });

        cluster.one.on('requestProxy.retryAttempted', function onRetryAttempted() {
            numRetries++;
        });

        var ticker = scheduleTicker(cluster.one, function onRetryScheduled() {
            // Make sure keys diverge
            cluster.one.lookup = lookupHandler();

            function lookupHandler() {
                var count = 0;

                return function lookIt() {
                    return ++count === 1 ? cluster.one.hostPort :
                        cluster.three.hostPort;
                };
            }
        });
        cluster.one.on('requestProxy.retryScheduled', ticker);

        cluster.requestAll({
            keys: [cluster.keys.two, cluster.keys.two],
            host: 'one',
            maxRetries: 10,
            retrySchedule: [1]
        }, function onRequest(err, responses) {
            assert.ifError(err, 'no error occurs');
            assert.equal(responses.length, 1, 'one response');
            assert.equal(responses[0].res.statusCode, 500, '500 status code');

            assert.equal(numRetries, 0, 'aborted before retries');

            cluster.destroy();
            assert.end();
        });
    });
});

test('retries multiple keys w/ same dest', function t(assert) {
    assert.plan(4);

    var numRetries = 0;

    var cluster = allocCluster({
        useFakeTimers: true
    }, function onReady() {
        // Make node two refuse initial request
        cluster.two.ring.checksum = cluster.one.ring.checksum + 1;

        cluster.one.on('requestProxy.retryAborted', function onRetryAborted() {
            assert.fail('retry aborted');
        });

        cluster.one.on('requestProxy.retryAttempted', function onRetryAttempted() {
            numRetries++;
        });

        cluster.one.on('requestProxy.retryScheduled', function onRetryScheduled() {
            cluster.one.timers.advance(10000);
        });

        cluster.requestAll({
            keys: [cluster.keys.two, cluster.keys.two, cluster.keys.two],
            host: 'one',
            maxRetries: 5,
            retrySchedule: [1]
        }, function onRequest(err, responses) {
            assert.ifError(err, 'no error occurs');
            assert.equal(responses.length, 1, 'one response');
            assert.equal(responses[0].res.statusCode, 500, '500 status code');

            assert.equal(numRetries, 5, 'retried much');

            cluster.destroy();
            assert.end();
        });
    });
});

test('reroutes retry to local', function t(assert) {
    assert.plan(3);

    var cluster = allocCluster({
        useFakeTimers: true
    }, function onReady() {
        // Make node two refuse initial request
        cluster.two.ring.checksum = cluster.one.ring.checksum + 1;

        cluster.one.on('requestProxy.retryRerouted', function onRetryRerouted() {
            assert.pass('retry rerouted');
        });

        var ticker = scheduleTicker(cluster.one, function onRetryScheduled() {
            // Make sure retry happens locally
            cluster.one.lookup = function lookup() {
                return cluster.one.hostPort;
            };
        });
        cluster.one.on('requestProxy.retryScheduled', ticker);

        // Request is now handled locally instead of being proxied
        cluster.one.on('request', function onRequest(req, res) {
            res.end('rerouted');
        });

        cluster.request({
            key: cluster.keys.two,
            host: 'one',
            json: { hello: true },
            maxRetries: 10,
            retrySchedule: [1]
        }, function onRequest(err, res) {
            assert.ifError(err, 'no error occurs');
            assert.equal(res.body, 'rerouted', 'response from rerouted request is correct');

            cluster.destroy();
            assert.end();
        });
    });
});

test('reroutes retry to remote', function t(assert) {
    assert.plan(3);

    var cluster = allocCluster({
        useFakeTimers: true
    }, function onReady() {
        // Make node two refuse initial request
        cluster.two.ring.checksum = cluster.one.ring.checksum + 1;

        cluster.one.on('requestProxy.retryRerouted', function onRetryRerouted() {
            assert.pass('retry rerouted');
        });

        var ticker = scheduleTicker(cluster.one, function onRetrySchedule() {
            // Make sure retry happens remotely
            cluster.one.lookup = function lookup() {
                return cluster.three.hostPort;
            };
        });
        cluster.one.on('requestProxy.retryScheduled', ticker);

        // Request is now handled remotely, on node three
        cluster.three.on('request', function onRequest(req, res) {
            res.end('rerouted');
        });

        cluster.request({
            key: cluster.keys.two,
            host: 'one',
            json: { hello: true },
            maxRetries: 10,
            retrySchedule: [1]
        }, function onRequest(err, res) {
            assert.ifError(err, 'no error occurs');
            assert.equal(
                res.body.toString('hex'),
                new Buffer('rerouted').toString('hex'),
                'response from rerouted request is correct'
            );

            cluster.destroy();
            assert.end();
        });
    });
});

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
    var timers = makeTimersMock();
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
            assert.ok(/^request timed out|^socket closed/.test(resp.body));

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
            assert.equal(
                resp.body.toString('hex'),
                new Buffer('hello').toString('hex')
            );

            cluster.destroy();
            assert.end();
        });
    });
});

test('proxies buffer responses', function t(assert) {
    var cluster = allocCluster({
        createHandler: function createHandler() {
            return function handle(req, res) {
                res.end(new Buffer('hello'));
            };
        }
    }, function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 200);
            assert.equal(
                resp.body.toString('hex'),
                new Buffer('hello').toString('hex')
            );

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
    var timers = makeTimersMock();
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
            assert.ok(resp.body.indexOf('timed out') >= 0);

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

    function fakeProxyReq(req, res) {
        res.headers.as = 'raw';
        res.sendOk('fake-text', '');
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
            assert.ok(/^tchannel: socket closed/.test(resp.body));

            cluster.destroy();
            assert.end();
        });

        // Reach into the the first TChannel and forcibly
        // destroy its open TCP connection
        setTimeout(function onTimer() {
            var name = cluster.two.channel.hostPort;
            var peer = cluster.one.channel.peers.get(name);

            // Kill all connections. This will trigger the
            // socket closed response we're asserting on
            // above.
            peer.connections.forEach(function each(conn) {
                conn.socket.destroy();
            });
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

test('does not crash when forwarding request on closed socket', function t(assert) {
    var ringpopOpts = {
        requestProxyMaxRetries: 0
    };

    var cluster = allocCluster(ringpopOpts, function onReady() {
        destroyAllSockets();

        cluster.request({
            host: 'one', key: cluster.keys.two
        }, function onResponse(err, resp) {
            assert.ifError(err);

            cluster.destroy();
            assert.end();
        });
    });

    function destroyAllSockets() {
        var allPeers = cluster.one.channel.peers.values();

        allPeers.forEach(function each(peer) {
            peer.close(function noop() {});
        });
    }
});

test('send on destroyed channel not allowed', function t(assert) {
    var ringpopOpts = {
        requestProxyMaxRetries: 0
    };

    var cluster = allocCluster(ringpopOpts, function onReady() {
        cluster.one.channel.quit();

        cluster.request({
            host: 'one', key: cluster.keys.two
        }, function onResponse(err, resp) {
            assert.ifError(err);

            assert.equal(resp.statusCode, 500);
            assert.ok(resp.body.indexOf(
                'Channel was destroyed before forwarding attempt') >= 0);

            cluster.destroy();
            assert.end();
        });
    });
});

test('proxies big json', function t(assert) {
    var buffer = new Buffer(1024 * 1024 * 1.5);
    var bodyLimit = JSON.stringify(buffer).length;

    var opts = {
        bodyLimit: bodyLimit,
        requestProxyMaxRetries: 0
    };

    var cluster = allocCluster(opts, function onReady() {
        cluster.request({
            host: 'one', key: cluster.keys.two,
            json: buffer,
            bodyLimit: bodyLimit
        }, function onResponse(err, resp) {
            assert.ifError(err, 'no error occurred');
            assert.ok(resp.body, 'response has a body');
            assert.ok(bufferEqual(buffer, new Buffer(resp.body.payload)), 'buffers are equal');

            cluster.destroy();
            assert.end();
        });
    });
});

testRingpopCluster({
    size: 2
}, 'stuck requests', function t(bootRes, cluster, assert) {
    assert.plan(1);

    // Create HTTP server through which request for payload
    // will be sent.
    var httpPort = 4001;
    var app = express();
    app.get('/payload', function onReq(req, res) {
        cluster[0].requestProxy.proxyReq({
            keys: ['abc'],
            dest: cluster[1].whoami(),
            req: req,
            res: res
        });
    });

    // Make a big string that has proven to choke applications.
    var bigStr = '';
    for (var i = 0; i < 65000; i++) {
        bigStr += '东';
    }

    // The request will be forwarded to this node and the
    // node will respond with the full payload.
    cluster[1].on('request', function onRequest(req, res) {
        var payload = JSON.stringify({
            userTags: {
                name: bigStr
            }
        });
        res.setHeader('Content-Length', new Buffer(payload).length);
        res.end(payload);
    });

    // Make the request to the HTTP server. The HTTP server
    // will forward the request.
    var server = app.listen(httpPort, function onListen() {
        var payload = '';
        var request = http.request({
            path: '/payload',
            port: httpPort
        }, function onRequest(res) {
            res.setEncoding('utf8');
            res.on('data', function onData(chunk) {
                payload += chunk;
            });
            res.on('end', function onEnd() {
                assert.pass('got full response');
                assert.end();
                server.close();
            });
        });

        request.on('error', function onError(err) {
            assert.fail(err.message);
        });

        request.end();
    });
});

testRingpopCluster({
    size: 2
}, 'too many requests in', function t(bootRes, cluster, assert) {
    assert.plan(1);

    var ringpop1 = cluster[0];
    ringpop1.config.set('backpressureEnabled', true);
    var tooMany = ringpop1.config.get('maxInflightRequests') + 1;
    routeIngress(cluster, tooMany, function onHandle(err, head) {
        var headObj = JSON.parse(head);
        if (headObj.statusCode === 429) {
            assert.pass('too many requests');
            assert.end();
        }
    });
});

testRingpopCluster({
    size: 2
}, 'too many requests out', function t(bootRes, cluster, assert) {
    assert.plan(1);

    var ringpop1 = cluster[0];
    ringpop1.config.set('backpressureEnabled', true);
    var tooMany = ringpop1.config.get('maxInflightRequests') + 1;
    routeEgress(cluster, tooMany, function onRoute(err, resp) {
        if (assert.calledEnd) return;
        if (resp.statusCode === 429) {
            assert.pass('too many requests');
            assert.end();
        }
    });
});

testRingpopCluster({
    size: 2
}, 'too many requests in+out', function t(bootRes, cluster, assert) {
    assert.plan(1);

    var ringpop1 = cluster[0];
    ringpop1.config.set('backpressureEnabled', true);
    var max = ringpop1.config.get('maxInflightRequests');
    routeIngress(cluster, max / 2, function onRoute(err, head) {
        var headObj = JSON.parse(head);
        if (headObj.statusCode === 429) {
            assert.fail('not too many requests');
        }
    });
    routeEgress(cluster, max / 2 + 1, function onRoute(err, resp) {
        if (assert.calledEnd) return;
        if (resp.statusCode === 429) {
            assert.pass('too many requests');
            assert.end();
        }
    });
});

testRingpopCluster({
    size: 2
}, 'too much lag', function t(bootRes, cluster, assert) {
    var done = after(2, assert.end.bind(assert));

    var ringpop1 = cluster[0];
    ringpop1.config.set('backpressureEnabled', true);
    ringpop1.lagSampler.stop();

    // Manually adjust current lag to exceed max
    ringpop1.config.set('maxEventLoopLag', 99);
    ringpop1.lagSampler.currentLag = 100;

    routeIngress(cluster, 1, function onRoute(err, head) {
        var headObj = JSON.parse(head);
        assert.equals(headObj.statusCode, 429, 'too many requests');
        done();
    });
    routeEgress(cluster, 1, function onRoute(err, resp) {
        assert.equals(resp.statusCode, 429, 'too many requests');
        done();
    });
});

testRingpopCluster({
    size: 2
}, 'egress inflight to 0', function t(bootRes, cluster, assert) {
    assert.plan(27);

    var ringpop1 = cluster[0];
    var numInflight = 25;
    var done = after(numInflight, function onDone() {
        assert.equals(ringpop1.requestProxy.numInflightRequests, 0,
            'none left');
        assert.end();
    });

    // Make sure ringpop2 properly responds to requests
    var ringpop2 = cluster[1];
    ringpop2.on('request', function onRequest(req, res) {
        res.end();
    });

    routeEgress(cluster, numInflight, function onRoute() {
        assert.pass('request finished');
        done();
    });

    assert.equals(ringpop1.requestProxy.numInflightRequests, numInflight,
        'all inflight');
});

testRingpopCluster({
    size: 2
}, 'ingress inflight to 0', function t(bootRes, cluster, assert) {
    assert.plan(27);

    var ringpop1 = cluster[0];
    var numInflight = 25;
    var done = after(numInflight, function onDone() {
        assert.equals(ringpop1.requestProxy.numInflightRequests, 0,
            'none left');
        assert.end();
    });

    // Make sure ringpop1 serves its own ingress requests.
    ringpop1.on('request', function onRequest(req, res) {
        process.nextTick(function onTick() {
            res.end();
        });
    });

    routeIngress(cluster, numInflight, function onRoute() {
        assert.pass('request finished');
        done();
    });

    assert.equals(ringpop1.requestProxy.numInflightRequests, numInflight,
        'all inflight');
});
