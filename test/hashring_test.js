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
var HashRing = require('../lib/ring');
var RBTree = require('../lib/rbtree').RBTree;

var test = require('tape');

test('construct a new HashRing with defaults', function t(assert) {
    var ring = new HashRing();

    assert.strictEquals(typeof ring.options, 'object', 'ring.options is an Object');
    assert.strictEquals(Object.keys(ring.options).length, 0, 'ring.options is empty by default');
    assert.strictEquals(ring.replicaPoints, 100, 'replicaPoints is initialized to 100 by default');
    assert.strictEquals(ring.rbtree instanceof RBTree, true, 'rbtree is an RBTree');
    assert.strictEquals(typeof ring.servers, 'object', 'ring.servers is an Object');
    assert.strictEquals(Object.keys(ring.servers).length, 0, 'ring.servers is empty by default');

    assert.end();
});

test('construct a new HashRing with options', function t(assert) {
    var ring = new HashRing({ replicaPoints: 200 });

    assert.strictEquals(typeof ring.options, 'object', 'ring.options is an Object');
    assert.strictEquals(Object.keys(ring.options).length, 1, 'ring.options is 1');
    assert.strictEquals(ring.replicaPoints, 200, 'replicaPoints is 200');
    assert.strictEquals(ring.rbtree instanceof RBTree, true, 'rbtree is an RBTree');
    assert.strictEquals(typeof ring.servers, 'object', 'ring.servers is an Object');
    assert.strictEquals(Object.keys(ring.servers).length, 0, 'ring.servers is empty by default');

    assert.end();
});

test('HashRing.addServer', function t(assert) {
    var name = 'test 1';
    var ring = new HashRing();
    var emitted = false;
    ring.on('added', function () { emitted = true; });
    ring.addServer(name);
 
    assert.strictEquals(ring.servers[name], true, 'ring.servers has new server');
    assert.strictEquals(Object.keys(ring.servers).length, 1, 'ring.servers is 1');
    assert.strictEquals(emitted, true, 'ring emits added event');
    assert.strictEquals(ring.rbtree.size, ring.replicaPoints, 'rbtree has added replicaPoints nodes');
    assert.strictEquals(ring.getServerCount(), 1, 'ring.getServerCount() returns 1');

    assert.end();
});

test('HashRing.removeServer', function t(assert) {
    var name1 = 'test 1';
    var name2 = 'test 2';
    var ring = new HashRing();
    var added = 0;
    var removed = 0;
    ring.on('added', function () { added++; });
    ring.on('removed', function () { removed++; });
    ring.addServer(name1);
    ring.addServer(name2);
 
    assert.strictEquals(ring.servers[name1], true, 'ring.servers has name1');
    assert.strictEquals(ring.servers[name2], true, 'ring.servers has name2');
    assert.strictEquals(Object.keys(ring.servers).length, 2, 'ring.servers is 2');
    assert.strictEquals(added, 2, 'ring emits added events');
    assert.strictEquals(ring.rbtree.size, ring.replicaPoints * ring.getServerCount(), 'rbtree has added replicaPoints for all nodes');

    ring.removeServer(name1);

    assert.strictEquals(ring.servers[name1], undefined, 'ring.servers does not have name1');
    assert.strictEquals(ring.servers[name2], true, 'ring.servers has name2');
    assert.strictEquals(Object.keys(ring.servers).length, 1, 'ring.servers is 1');
    assert.strictEquals(removed, 1, 'ring emits removed events');
    assert.strictEquals(ring.rbtree.size, ring.replicaPoints * ring.getServerCount(), 'rbtree has added replicaPoints for all nodes');

    assert.end();
});
