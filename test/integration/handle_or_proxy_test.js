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

var _ = require('underscore');
var jsonBody = require('body/json');
var test = require('tape');
var tryIt = require('tryit');

var allocCluster = require('../lib/alloc-cluster.js');

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
