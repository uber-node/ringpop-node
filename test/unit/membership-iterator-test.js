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

var Member = require('../../lib/membership/member.js');

var testRingpop = require('../lib/test-ringpop.js');

testRingpop('iterates over two members correctly', function t(deps, assert) {
    var membership = deps.membership;
    var iterator = deps.iterator;

    membership.makeChange('127.0.0.1:3001', Date.now(), Member.Status.alive);
    membership.makeChange('127.0.0.1:3002', Date.now(), Member.Status.alive);

    var iterated = {};
    iterated[iterator.next().address] = true;
    iterated[iterator.next().address] = true;

    assert.equals(Object.keys(iterated).length, 2, '2 members iterated over');
});

testRingpop('iterates over three members correctly', function t(deps, assert) {
    var membership = deps.membership;
    var iterator = deps.iterator;

    membership.makeChange('127.0.0.1:3001', Date.now(), Member.Status.alive);
    membership.makeChange('127.0.0.1:3002', Date.now(), Member.Status.alive);
    membership.makeChange('127.0.0.1:3003', Date.now(), Member.Status.alive);

    var iterated = {};
    iterated[iterator.next().address] = true;
    iterated[iterator.next().address] = true;
    iterated[iterator.next().address] = true;

    assert.equals(Object.keys(iterated).length, 3, '3 members iterated over');
});

testRingpop('skips over faulty member and 1 local member', function t(deps, assert) {
    var membership = deps.membership;
    var iterator = deps.iterator;

    membership.makeChange('127.0.0.1:3001', Date.now(), Member.Status.alive);
    membership.makeFaulty('127.0.0.1:3002', Date.now());
    membership.makeChange('127.0.0.1:3003', Date.now(), Member.Status.alive);

    var iterated = {};
    iterated[iterator.next().address] = true;
    iterated[iterator.next().address] = true;
    iterated[iterator.next().address] = true;

    assert.equals(Object.keys(iterated).length, 2, '2 members iterated over');
    assert.notok(iterated['127.0.0.1:3002'], 'faulty member not iterated over');
});
