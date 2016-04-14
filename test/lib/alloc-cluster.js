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

var assert = require('assert');
var jsonBody = require('body/json');

var allocRequest = require('./alloc-request.js');
var allocResponse = require('./alloc-response.js');
var allocRingpop = require('./alloc-ringpop.js');
var bootstrap = require('./bootstrap.js');

module.exports = allocCluster;

function allocCluster(options, onReady) {
    if (typeof options === 'function') {
        onReady = options;
        options = null;
    }

    options = options || {};

    var createHandler = options.createHandler ||
        createServerHandler;
    var one = allocRingpop('one', options);
    var two = allocRingpop('two', options);
    var three = allocRingpop('three', options);

    one.on('request', createHandler('one', options));
    two.on('request', createHandler('two', options));
    three.on('request', createHandler('three', options));

    bootstrap([one, two, three], onReady);

    var cluster = {
        one: one,
        two: two,
        three: three,
        keys: {
            one: one.whoami() + '0',
            two: two.whoami() + '0',
            three: three.whoami() + '0'
        },
        destroy: destroy,
        request: request,
        requestAll: requestAll
    };
    return cluster;

    function destroy() {
        one.destroy();
        two.destroy();
        three.destroy();
    }

    function request(opts, cb) {
        assert(opts, 'opts required');
        assert(cb, 'cb required');
        assert(opts.key, 'key required');
        assert(opts.host, 'host required');

        var req = allocRequest(opts);
        var res = allocResponse(opts, cb);

        var key = opts.key;
        var host = opts.host;

        var handle = cluster[host].handleOrProxy(key, req, res, {
            timeout: opts.timeout,
            retrySchedule: opts.retrySchedule,
            endpoint: opts.endpoint,
            maxRetries: opts.maxRetries,
            bodyLimit: opts.bodyLimit
        });
        if (handle) {
            cluster[host].emit('request', req, res);
        }
        return req;
    }

    function requestAll(opts, cb) {
        var host = opts.host;
        opts.req = allocRequest(opts);
        cluster[host].handleOrProxyAll(opts, cb);
    }
}

function createServerHandler(name, opts) {
    return function serverHandle(req, res) {
        if (req.headers['content-type'] === 'application/json') {
            jsonBody(req, null, {
                limit: opts.bodyLimit
            }, onBody);
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
