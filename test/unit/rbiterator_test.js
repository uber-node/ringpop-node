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

var RBTree = require('../../lib/ring/rbtree').RBTree;
var RBIterator = require('../../lib/ring/rbtree').RBIterator;
var test = require('tape');

test('construct a new RBIterator', function t(assert) {
    var tree = new RBTree();
    var iterator = new RBIterator(tree);

    assert.strictEquals(iterator.tree, tree, 'tree is set to supplied tree');
    assert.strictEquals(iterator.ancestors.length, 0, 'ancestors is empty');
    assert.strictEquals(Array.isArray(iterator.ancestors), true, 'ancestors is an Array');
    assert.end();
});

test('RBIterator.val and RBIterator.str', function t(assert) {
    var tree = new RBTree();
    var iterator = new RBIterator(tree);

    assert.strictEquals(iterator.val(), null, 'val on empty tree is null');
    assert.strictEquals(iterator.str(), null, 'str on empty tree is null');

    iterator.cursor = {
        val: 1234,
        str: '1234'
    };

    assert.strictEquals(iterator.val(), 1234, 'val returns cursor val');
    assert.strictEquals(iterator.str(), '1234', 'str returns cursor str');

    assert.end();
});

function makeTree() {
    var tree = new RBTree();

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
    assert.strictEquals(iterator.val(), 1, 'val min from root is 1');
    assert.strictEquals(iterator.str(), 'one', 'str min from root is one');

    iterator.minNode(tree.root.left.left);
    assert.strictEquals(iterator.val(), 1, 'val min from 1 is 1');
    assert.strictEquals(iterator.str(), 'one', 'str min from 1 is one');

    iterator.minNode(tree.root.right);
    assert.strictEquals(iterator.val(), 5, 'val min from 6 is 5');
    assert.strictEquals(iterator.str(), 'five', 'str min from 6 is five');

    assert.end();
});

test('RBIterator.next walk the entire tree', function t(assert) {
    var tree = makeTree();
    var iterator = new RBIterator(tree);

    assert.strictEquals(iterator.next(), 1, 'val is 1');
    assert.strictEquals(iterator.next(), 2, 'val is 2');
    assert.strictEquals(iterator.next(), 3, 'val is 3');
    assert.strictEquals(iterator.next(), 4, 'val is 4');
    assert.strictEquals(iterator.next(), 5, 'val is 5');
    assert.strictEquals(iterator.next(), 6, 'val is 6');
    assert.strictEquals(iterator.next(), 7, 'val is 7');
    assert.strictEquals(iterator.next(), 8, 'val is 8');
    assert.strictEquals(iterator.next(), null, 'val is null');

    assert.end();
});
