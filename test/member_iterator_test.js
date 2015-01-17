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
var MemberIterator = require('../lib/members').MemberIterator;
var test = require('tape');

function createMembers2() {
    return [
        { address: '127.0.0.1', status: 'alive', isLocal: false },
        { address: '127.0.0.2', status: 'alive', isLocal: true }
    ];
}

function createMembers3() {
    return [
        { address: '127.0.0.1', status: 'alive', isLocal: false },
        { address: '127.0.0.2', status: 'alive', isLocal: false },
        { address: '127.0.0.3', status: 'alive', isLocal: true }
    ];
}

function createRing(members) {
    return {
        membership: {
            getMemberCount: function() {
                return members.length;
            },
            getMemberAt: function(index) {
                return members[index];
            },
            shuffle: function() {
                return members.reverse();
            }
        }
    };
}

test('iterates over two members correctly', function t(assert) {
    var ring = createRing(createMembers2());
    var iterator = new MemberIterator(ring);

    assert.equals(iterator.next().address, '127.0.0.1', 'first member is first');
    assert.equals(iterator.next().address, '127.0.0.1', 'first member is next');
    assert.equals(iterator.next().address, '127.0.0.1', 'first member is next again');
    assert.equals(iterator.next().address, '127.0.0.1', 'first member is last');
    assert.end();
});

test('iterates over three members correctly', function t(assert) {
    var ring = createRing(createMembers3());
    var iterator = new MemberIterator(ring);

    assert.equals(iterator.next().address, '127.0.0.1', 'first member is first');
    assert.equals(iterator.next().address, '127.0.0.2', 'second member is next');
    assert.equals(iterator.next().address, '127.0.0.2', 'second member is next again');
    assert.equals(iterator.next().address, '127.0.0.1', 'first member is next');
    assert.equals(iterator.next().address, '127.0.0.1', 'first member is next again');
    assert.equals(iterator.next().address, '127.0.0.2', 'second member is last');
    assert.end();
});

test('skips over 2 faulty members and 1 local member', function t(assert) {
    var members = createMembers3();
    members[0].status = 'faulty';
    members[1].status = 'faulty';
    var ring = createRing(members);
    var iterator = new MemberIterator(ring);

    assert.equals(iterator.next(), null, 'next member is null');
    assert.equals(iterator.next(), null, 'next member is null again');
    assert.end();
});
