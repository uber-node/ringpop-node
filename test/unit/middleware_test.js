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

var middleware = require('../../lib/middleware');

var test = require('tape');

test('empty middleware stack', function t(assert) {
    var m = new middleware.MiddlewareStack();
    var args = [];

    assert.plan(1);
    m.run(1, 2, 3,
        function(context, arg2, arg3, next) {
            Array.prototype.push.apply(args, [context, arg2, arg3]);
            next(4, 5, 6);
        },
        function(context, err, res1, res2) {
            Array.prototype.push.apply(args, [context, err, res1, res2]);
            assert.deepEqual(args, [1, 2, 3, 1, 4, 5, 6]);
            assert.end();
        }
    );
});

test('empty middlewares in stack', function t(assert) {
    var m = new middleware.MiddlewareStack([{}, {}, {}]);
    var args = [];

    assert.plan(1);
    m.run(1, 2, 3,
        function(context, arg2, arg3, next) {
            Array.prototype.push.apply(args, [context, arg2, arg3]);
            next(4, 5, 6);
        },
        function(context, err, res1, res2) {
            Array.prototype.push.apply(args, [context, err, res1, res2]);
            assert.deepEqual(args, [1, 2, 3, 1, 4, 5, 6]);
            assert.end();
        }
    );
});

test('middlewares are applied in order', function t(assert) {
    var M1 = {
        'request': function(context, arg2, arg3, next) {
            Array.prototype.push.apply(args, [context, arg2, arg3]);
            next(arg2 + 10, arg3 + 100);
        },
        'response': function(context, err, res1, res2, next) {
            Array.prototype.push.apply(args, [context, err, res1, res2]);
            next(err + 10, res1 + 100, res2 + 1000);
        }
    };
    var M2 = {
        'request': function(context, arg2, arg3, next) {
            Array.prototype.push.apply(args, [context, arg2, arg3]);
            next(arg2 + 20, arg3 + 200);
        },
        'response': function(context, err, res1, res2, next) {
            Array.prototype.push.apply(args, [context, err, res1, res2]);
            next(err + 20, res1 + 200, res2 + 2000);
        }
    };
    var m = new middleware.MiddlewareStack([M1, M2]);
    var args = [];

    assert.plan(1);
    m.run(1, 2, 3,
        function(context, arg2, arg3, next) {
            Array.prototype.push.apply(args, [context, arg2, arg3]);
            next(1, 2, 3);
        },
        function(context, err, res1, res2) {
            Array.prototype.push.apply(args, [context, err, res1, res2]);
            assert.deepEqual(args, [
                1, 2, 3,
                1, 12, 103,
                1, 32, 303,
                1, 1, 2, 3,
                1, 21, 202, 2003,
                1, 31, 302, 3003,
            ]);
            assert.end();
        }
    );
});

test('middlewares with only one method', function t(assert) {
    var testRequest = {
        'request': function(context, arg2, arg3, next) {
            Array.prototype.push.apply(args, [context, arg2, arg3]);
            next(arg2 + 10, arg3 + 100);
        }
    };
    var testResponse = {
        'response': function(context, err, res1, res2, next) {
            Array.prototype.push.apply(args, [context, err, res1, res2]);
            next(err + 10, res1 + 100, res2 + 1000);
        }
    };
    var m = new middleware.MiddlewareStack([testRequest, testResponse]);
    var args = [];

    assert.plan(1);
    m.run(1, 2, 3,
        function(context, arg2, arg3, next) {
            Array.prototype.push.apply(args, [context, arg2, arg3]);
            next(1, 2, 3);
        },
        function(context, err, res1, res2) {
            Array.prototype.push.apply(args, [context, err, res1, res2]);
            assert.deepEqual(args, [
                1, 2, 3,
                1, 12, 103,
                1, 1, 2, 3,
                1, 11, 102, 1003,
            ]);
            assert.end();
        }
    );
});
