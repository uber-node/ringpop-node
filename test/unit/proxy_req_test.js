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

var _ = require('underscore');
var test = require('tape');

var allocRingpop = require('../lib/alloc-ringpop.js');
var bootstrap = require('../lib/bootstrap.js');
var mocks = require('../mock');
var Ringpop = require('../../index.js');

test('proxyReq() proxies the request', function t(assert) {
    var left = allocRingpop('left');
    var right = allocRingpop('right');

    bootstrap([left, right], function onReady() {
        var leftKey = left.whoami() + '0';
        var rightKey = right.whoami() + '0';

        var dest = left.lookup(leftKey);
        var dest2 = left.lookup(rightKey);

        assert.notEqual(dest, dest2, 'expected dests to be different');

        left.destroy();
        right.destroy();
        assert.end();
    });
});

test('proxyReq enforces required args', function t(assert) {
    var ringpop = new Ringpop({
        app: 'test',
        hostPort: '127.0.0.1:3000'
    });
    ringpop.requestProxy = mocks.requestProxy;

    function assertProxyReqThrows(opts) {
        try {
            ringpop.proxyReq(opts);
            assert.fail('no exception thrown');
        } catch (e) {
            assert.pass('exception thrown');
            return e;
        }
    }

    function assertPropertyRequiredError(property, opts, newOpts) {
        opts = _.extend(opts || {}, newOpts);

        var exception = assertProxyReqThrows(opts);
        assert.equals(exception.type, 'ringpop.options.property-required', 'err type is correct');
        assert.equals(property, exception.property, 'err property is correct');

        return opts;
    }

    var exception = assertProxyReqThrows();
    assert.equals(exception.type, 'ringpop.options.required', 'err type is correct');

    var opts = assertPropertyRequiredError('keys');
    opts = assertPropertyRequiredError('dest', opts, { keys: ['KEY0'] });
    opts = assertPropertyRequiredError('req', opts, { dest: '127.0.0.1:3000' });
    opts = assertPropertyRequiredError('res', opts, { req: {} });

    opts = _.extend(opts, { res: {} });
    assert.doesNotThrow(function() { ringpop.proxyReq(opts); });
    assert.end();
    ringpop.destroy();
});
