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


var test = require('tape');
var transportMiddleware = require('../../lib/middleware/transport.js').transportServerMiddleware;


test('arg3 is JSON decoded', function t(assert) {
    assert.plan(2);
    var req = {'endpoint': '/test'};
    var arg2 = '{"arg2":2}';
    var arg3 = '{"arg3":3}';
    transportMiddleware.request(req, arg2, arg3, function(arg2, arg3) {
        assert.equals(arg2, '{"arg2":2}');
        assert.deepEquals(arg3, {'arg3': 3});
    });
});

test('if decoding fails, the arg is unchanged', function t(assert) {
    assert.plan(2);
    var req = {'endpoint': '/test'};
    var arg2 = '{"arg2":2}';
    var arg3 = 'not JSON';
    transportMiddleware.request(req, arg2, arg3, function(arg2, arg3) {
        assert.equals(arg2, '{"arg2":2}');
        assert.equals(arg3, 'not JSON');
    });
});


test('arg2 is JSON decoded for /proxy/req', function t(assert) {
    assert.plan(2);
    var req = {'endpoint': '/proxy/req'};
    var arg2 = '{"arg2":2}';
    var arg3 = '{"arg3":3}';
    transportMiddleware.request(req, arg2, arg3, function(arg2, arg3) {
        assert.deepEquals(arg2, {'arg2': 2});
        assert.equals(arg3, '{"arg3":3}');
    });
});

test('res2 is JSON encoded', function t(assert) {
    assert.plan(3);
    var req = {};
    var error = null;
    var res1 = null;
    var res2 = {"res2": 2};
    transportMiddleware.response(req, error, res1, res2, function(err, res1, res2) {
        assert.equals(err, null);
        assert.deepEquals(res1, null);
        assert.equals(res2, '{"res2":2}');
    });
});


test('res2 is not JSON encoded if string', function t(assert) {
    assert.plan(3);
    var req = {};
    var error = null;
    var res1 = null;
    var res2 = 'string';
    transportMiddleware.response(req, error, res1, res2, function(err, res1, res2) {
        assert.equals(err, null);
        assert.equals(res1, null);
        assert.equals(res2, 'string');
    });
});

test('buffer-res2 is not JSON encoded if string', function t(assert) {
    assert.plan(3);
    var req = {};
    var error = null;
    var res1 = null;
    var res2 = new Buffer('string');
    transportMiddleware.response(req, error, res1, res2, function(err, res1, res2) {
        assert.equals(err, null);
        assert.equals(res1, null);
        assert.deepEquals(res2, new Buffer('string'));
    });
});
