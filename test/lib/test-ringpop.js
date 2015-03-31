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

var Ringpop = require('../../index.js');
var tape = require('tape');

function testRingpop(opts, name, test) {
    if (typeof opts === 'string' && typeof name === 'function') {
        test = name;
        name = opts;
        opts = {};
    }

    tape(name, function onTest(assert) {
        var ringpop = new Ringpop({
            app: opts.app || 'test',
            hostPort: opts.hostPort || '127.0.0.1:3000'
        });

        ringpop.membership.makeAlive(ringpop.whoami(), Date.now());

        test({
            dissemination: ringpop.dissemination,
            iterator: ringpop.memberIterator,
            localMember: ringpop.membership.localMember,
            membership: ringpop.membership,
            ringpop: ringpop
        }, assert);

        assert.end();
        ringpop.destroy();
    });
}

module.exports = testRingpop;
