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

var RingNode = require('../../lib/ring/rbtree').RingNode;
var test = require('tape');

test('construct a new red node with supplied values', function t(assert) {
    var val = 12345;
    var str = 'just in time';
    var node = new RingNode(val, str);

    assert.strictEquals(node.val, val, 'val set to supplied val');
    assert.strictEquals(node.str, str, 'str set to supplied str');

    assert.strictEquals(node.left, null, 'left is null');
    assert.strictEquals(node.right, null, 'right is null');
    assert.strictEquals(node.red, true, 'color is red');
    assert.end();
});

function makeTree() {
    var node1 = new RingNode(1, 'one');
    var node2 = new RingNode(2, 'two');
    var node3 = new RingNode(3, 'three');

    //       2,B
    //      /   \
    //    1,R   3,R

    node2.red = false;
    node2.left = node1;
    node2.right = node3;

    return [node1, node2, node3];
}

test('getChild', function t(assert) {
    var nodes = makeTree();

    assert.strictEquals(nodes[1].getChild(0), nodes[0], 'root getChild left returns left node');
    assert.strictEquals(nodes[1].getChild(1), nodes[2], 'root getChild right returns right node');
    assert.strictEquals(nodes[0].getChild(0), null, 'leaf 1 getChild left returns null');
    assert.strictEquals(nodes[0].getChild(1), null, 'leaf 1 getChild right returns null');
    assert.strictEquals(nodes[2].getChild(0), null, 'leaf 3 getChild left returns null');
    assert.strictEquals(nodes[2].getChild(1), null, 'leaf 3 getChild right returns null');

    assert.end();
});

test('setChild', function t(assert) {
    var nodes = makeTree();
    nodes[3] = new RingNode(4, 'four');

    nodes[2].setChild(1, nodes[3]);
    assert.strictEquals(nodes[2].right, nodes[3], 'setChild right returns new node');

    nodes[2].setChild(0, nodes[3]); // not a valid tree, but still a valid test
    assert.strictEquals(nodes[2].left, nodes[3], 'setChild left returns new node');

    assert.end();
});
