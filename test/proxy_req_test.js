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

var allocRingpop = require('./lib/alloc-ringpop.js');
var bootstrap = require('./lib/bootstrap.js');

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
