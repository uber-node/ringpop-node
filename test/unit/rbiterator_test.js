// Copyright (c) 2017 Uber Technologies, Inc.
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

var RBTree = require('../../lib/ring/rbtree').RBTree;
var RBIterator = require('../../lib/ring/rbtree').RBIterator;
var comparator = require('../lib/int-comparator');

var test = require('tape');

test('construct a new RBIterator', function t(assert) {
    var tree = new RBTree(comparator);
    var iterator = new RBIterator(tree);

    assert.strictEquals(iterator.tree, tree, 'tree is set to supplied tree');
    assert.strictEquals(iterator.ancestors.length, 0, 'ancestors is empty');
    assert.strictEquals(Array.isArray(iterator.ancestors), true, 'ancestors is an Array');
    assert.end();
});

test('RBIterator.key and RBIterator.value', function t(assert) {
    var tree = new RBTree(comparator);
    var iterator = new RBIterator(tree);

    assert.strictEquals(iterator.key(), null, 'key on empty tree is null');
    assert.strictEquals(iterator.value(), null, 'value on empty tree is null');

    iterator.cursor = {
        key: 1234,
        value: '1234'
    };

    assert.strictEquals(iterator.key(), 1234, 'key returns cursor key');
    assert.strictEquals(iterator.value(), '1234', 'value returns cursor value');

    assert.end();
});

function makeTree() {
    var tree = new RBTree(comparator);

    tree.insert(1, 'one');
    tree.insert(2, 'two');
    tree.insert(3, 'three');
    tree.insert(4, 'four');
    tree.insert(5, 'five');
    tree.insert(6, 'six');
    tree.insert(7, 'seven');
    tree.insert(8, 'eight');

    //                         4,B
    //                       /     \
    //                   2,R         6,R
    //                 /     \     /     \
    //               1,B    3,B   5,B    7,B
    //                                      \
    //                                       8,R

    return tree;
}

test('RBIterator.minNode', function t(assert) {
    var tree = makeTree();
    var iterator = new RBIterator(tree);

    iterator.minNode(tree.root);
    assert.strictEquals(iterator.key(), 1, 'key min from root is 1');
    assert.strictEquals(iterator.value(), 'one', 'value min from root is one');

    iterator.minNode(tree.root.left.left);
    assert.strictEquals(iterator.key(), 1, 'key min from 1 is 1');
    assert.strictEquals(iterator.value(), 'one', 'value min from 1 is one');

    iterator.minNode(tree.root.right);
    assert.strictEquals(iterator.key(), 5, 'key min from 6 is 5');
    assert.strictEquals(iterator.value(), 'five', 'value min from 6 is five');

    assert.end();
});

test('RBIterator.next walk the entire tree', function t(assert) {
    var tree = makeTree();
    var iterator = new RBIterator(tree);

    assert.strictEquals(iterator.next(), 1, 'key is 1');
    assert.strictEquals(iterator.next(), 2, 'key is 2');
    assert.strictEquals(iterator.next(), 3, 'key is 3');
    assert.strictEquals(iterator.next(), 4, 'key is 4');
    assert.strictEquals(iterator.next(), 5, 'key is 5');
    assert.strictEquals(iterator.next(), 6, 'key is 6');
    assert.strictEquals(iterator.next(), 7, 'key is 7');
    assert.strictEquals(iterator.next(), 8, 'key is 8');
    assert.strictEquals(iterator.next(), null, 'key is null');

    assert.end();
});
