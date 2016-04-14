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
var RingNode = require('../../lib/ring/rbtree').RingNode;
var test = require('tape');

test('construct a new RBTree', function t(assert) {
    var tree = new RBTree();

    assert.strictEquals(tree.root, null, 'root is null');
    assert.strictEquals(tree.size, 0, 'size is 0');

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

function isRed(node) {
    return node !== null && node.red;
}

// recursively count the black height of the tree and validate along the way
function validateRBTree(node) {
    if (node === null) {
        return 1; // leaf nodes are considered to be black, and this tree has implicit leaf nodes
    }

    var leftNode = node.left;
    var rightNode = node.right;

    if (isRed(node) && (isRed(leftNode) || isRed(rightNode))) {
        throw new Error('red violation at node val' + node.val);
    }

    var leftHeight = validateRBTree(leftNode);
    var rightHeight = validateRBTree(rightNode);

    if (leftNode !== null && leftNode.val >= root.val || rightNode !== null && rightNode.val <= root.val) {
        throw new Error('binary tree violation at node val ' + node.val);
    }

    if (leftHeight !== 0 && rightHeight !== 0) {
        if (leftHeight !== rightHeight) {
            throw new Error('black height violation at node val ' + node.val);
        }

        if (isRed(node)) {
            return leftHeight;
        } else {
            return leftHeight + 1; // count black nodes
        }
    } else {
        return 0;
    }
}

test('RBTree.insert', function t(assert) {
    var tree = makeTree();

    validateRBTree(tree.root);

    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');
    assert.strictEquals(validateRBTree(tree.root), 3, 'tree has a black height of 3');

    assert.strictEquals(tree.size, 8, 'tree has 8 nodes');

    var node = tree.root;
    assert.strictEquals(node.val, 4, 'tree root val is 4');
    assert.strictEquals(node.str, 'four', 'tree root str is four');
    assert.strictEquals(node.red, false, 'tree root is black');
    assert.strictEquals(node.left instanceof RingNode, true, 'tree root left points to a RingNode');
    assert.strictEquals(node.right instanceof RingNode, true, 'tree root right points to a RingNode');

    // 1,B
    node = tree.root.left.left;
    assert.strictEquals(node.val, 1, 'node val is correct');
    assert.strictEquals(node.str, 'one', 'node str is correct');
    assert.strictEquals(node.red, false, 'node color is correct');
    assert.strictEquals(node.left, null, 'leaf node has no left pointer');
    assert.strictEquals(node.right, null, 'leaf node has no right pointer');

    // 2,R
    node = tree.root.left;
    assert.strictEquals(node.val, 2, 'tree node val is correct');
    assert.strictEquals(node.str, 'two', 'tree node str is correct');
    assert.strictEquals(node.red, true, 'tree node color is correct');
    assert.strictEquals(node.left instanceof RingNode, true, 'node left points to a RingNode');
    assert.strictEquals(node.right instanceof RingNode, true, 'node right points to a RingNode');

    // 3,B
    node = tree.root.left.right;
    assert.strictEquals(node.val, 3, 'node val is correct');
    assert.strictEquals(node.str, 'three', 'node str is correct');
    assert.strictEquals(node.red, false, 'node color is correct');
    assert.strictEquals(node.left, null, 'leaf node has no left pointer');
    assert.strictEquals(node.right, null, 'leaf node has no right pointer');

    // 6,R
    node = tree.root.right;
    assert.strictEquals(node.val, 6, 'tree node val is correct');
    assert.strictEquals(node.str, 'six', 'tree node str is correct');
    assert.strictEquals(node.red, true, 'tree node color is correct');
    assert.strictEquals(node.left instanceof RingNode, true, 'node left points to a RingNode');
    assert.strictEquals(node.right instanceof RingNode, true, 'node right points to a RingNode');

    // 5,B
    node = tree.root.right.left;
    assert.strictEquals(node.val, 5, 'node val is correct');
    assert.strictEquals(node.str, 'five', 'node str is correct');
    assert.strictEquals(node.red, false, 'node color is correct');
    assert.strictEquals(node.left, null, 'leaf node has no left pointer');
    assert.strictEquals(node.right, null, 'leaf node has no right pointer');

    // 7,B
    node = tree.root.right.right;
    assert.strictEquals(node.val, 7, 'node val is correct');
    assert.strictEquals(node.str, 'seven', 'node str is correct');
    assert.strictEquals(node.red, false, 'node color is correct');
    assert.strictEquals(node.left, null, 'node has no left pointer');
    assert.strictEquals(node.right instanceof RingNode, true, 'node right points to a RingNode');

    // 8,R
    node = tree.root.right.right.right;
    assert.strictEquals(node.val, 8, 'node val is correct');
    assert.strictEquals(node.str, 'eight', 'node str is correct');
    assert.strictEquals(node.red, true, 'node color is correct');
    assert.strictEquals(node.left, null, 'leaf node has no left pointer');
    assert.strictEquals(node.right, null, 'leaf node has no right pointer');

    assert.end();
});

test('RBTree.remove', function t(assert) {
    var tree = makeTree();

    assert.strictEquals(tree.size, 8, 'tree has 8 nodes');
    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');
    assert.strictEquals(validateRBTree(tree.root), 3, 'tree has a black height of 3');

    var ret = tree.remove(1);
    assert.strictEquals(ret, true, 'node was found and removed from tree');
    assert.strictEquals(tree.size, 7, 'tree has 7 nodes');
    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');
    assert.strictEquals(validateRBTree(tree.root), 3, 'tree has a black height of 3');

    // new tree:
    //                         4,B
    //                       /     \
    //                   2,B         6,R
    //                       \     /     \
    //                      3,R   5,B    7,B
    //                                      \
    //                                       8,R

    // 4,B
    var node = tree.root;
    assert.strictEquals(node.val, 4, 'tree root val is 4');
    assert.strictEquals(node.str, 'four', 'tree root str is four');
    assert.strictEquals(node.red, false, 'tree root is black');
    assert.strictEquals(node.left instanceof RingNode, true, 'tree root left points to a RingNode');
    assert.strictEquals(node.right instanceof RingNode, true, 'tree root right points to a RingNode');

    // 2,R
    node = tree.root.left;
    assert.strictEquals(node.val, 2, 'tree node val is correct');
    assert.strictEquals(node.str, 'two', 'tree node str is correct');
    assert.strictEquals(node.red, false, 'tree node color is correct');
    assert.strictEquals(node.left, null, 'node left points to null');
    assert.strictEquals(node.right instanceof RingNode, true, 'node right points to a RingNode');

    // 3,B
    node = tree.root.left.right;
    assert.strictEquals(node.val, 3, 'node val is correct');
    assert.strictEquals(node.str, 'three', 'node str is correct');
    assert.strictEquals(node.red, true, 'node color is correct');
    assert.strictEquals(node.left, null, 'leaf node has no left pointer');
    assert.strictEquals(node.right, null, 'leaf node has no right pointer');

    // 6,R
    node = tree.root.right;
    assert.strictEquals(node.val, 6, 'tree node val is correct');
    assert.strictEquals(node.str, 'six', 'tree node str is correct');
    assert.strictEquals(node.red, true, 'tree node color is correct');
    assert.strictEquals(node.left instanceof RingNode, true, 'node left points to a RingNode');
    assert.strictEquals(node.right instanceof RingNode, true, 'node right points to a RingNode');

    // 5,B
    node = tree.root.right.left;
    assert.strictEquals(node.val, 5, 'node val is correct');
    assert.strictEquals(node.str, 'five', 'node str is correct');
    assert.strictEquals(node.red, false, 'node color is correct');
    assert.strictEquals(node.left, null, 'leaf node has no left pointer');
    assert.strictEquals(node.right, null, 'leaf node has no right pointer');

    // 7,B
    node = tree.root.right.right;
    assert.strictEquals(node.val, 7, 'node val is correct');
    assert.strictEquals(node.str, 'seven', 'node str is correct');
    assert.strictEquals(node.red, false, 'node color is correct');
    assert.strictEquals(node.left, null, 'node has no left pointer');
    assert.strictEquals(node.right instanceof RingNode, true, 'node right points to a RingNode');

    // 8,R
    node = tree.root.right.right.right;
    assert.strictEquals(node.val, 8, 'node val is correct');
    assert.strictEquals(node.str, 'eight', 'node str is correct');
    assert.strictEquals(node.red, true, 'node color is correct');
    assert.strictEquals(node.left, null, 'leaf node has no left pointer');
    assert.strictEquals(node.right, null, 'leaf node has no right pointer');

    var ret = tree.remove(2);
    assert.strictEquals(ret, true, 'node was found and removed from tree');
    assert.strictEquals(tree.size, 6, 'tree has 6 nodes');
    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');
    assert.strictEquals(validateRBTree(tree.root), 3, 'tree has a black height of 3');

    // new tree:
    //                        6,B
    //                      /     \
    //                  4,R        7,B
    //                 /   \          \
    //               3,B   5,B        8,R

    // 6,B
    var node = tree.root;
    assert.strictEquals(node.val, 6, 'tree root val is 6');
    assert.strictEquals(node.str, 'six', 'tree root str is six');
    assert.strictEquals(node.red, false, 'tree root is black');
    assert.strictEquals(node.left instanceof RingNode, true, 'tree root left points to a RingNode');
    assert.strictEquals(node.right instanceof RingNode, true, 'tree root right points to a RingNode');

    // 3,B
    node = tree.root.left.left;
    assert.strictEquals(node.val, 3, 'node val is correct');
    assert.strictEquals(node.str, 'three', 'node str is correct');
    assert.strictEquals(node.red, false, 'node color is correct');
    assert.strictEquals(node.left, null, 'leaf node has no left pointer');
    assert.strictEquals(node.right, null, 'leaf node has no right pointer');

    // 4,B
    node = tree.root.left;
    assert.strictEquals(node.val, 4, 'node val is correct');
    assert.strictEquals(node.str, 'four', 'node str is correct');
    assert.strictEquals(node.red, true, 'node color is correct');
    assert.strictEquals(node.left instanceof RingNode, true, 'left pointer is RingNode');
    assert.strictEquals(node.right instanceof RingNode, true, 'right pointer is RingNode');

    // 5,R
    node = tree.root.left.right;
    assert.strictEquals(node.val, 5, 'tree node val is correct');
    assert.strictEquals(node.str, 'five', 'tree node str is correct');
    assert.strictEquals(node.red, false, 'tree node color is correct');
    assert.strictEquals(node.left, null, 'node left points to null');
    assert.strictEquals(node.right, null, 'node right points to null');

    // 7,B
    node = tree.root.right;
    assert.strictEquals(node.val, 7, 'node val is correct');
    assert.strictEquals(node.str, 'seven', 'node str is correct');
    assert.strictEquals(node.red, false, 'node color is correct');
    assert.strictEquals(node.left, null, 'node has no left pointer');
    assert.strictEquals(node.right instanceof RingNode, true, 'node right points to a RingNode');

    // 8,R
    node = tree.root.right.right;
    assert.strictEquals(node.val, 8, 'node val is correct');
    assert.strictEquals(node.str, 'eight', 'node str is correct');
    assert.strictEquals(node.red, true, 'node color is correct');
    assert.strictEquals(node.left, null, 'leaf node has no left pointer');
    assert.strictEquals(node.right, null, 'leaf node has no right pointer');

    var ret = tree.remove(3);
    assert.strictEquals(ret, true, 'node was found and removed from tree');
    assert.strictEquals(tree.size, 5, 'tree has 5 nodes');
    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');
    assert.strictEquals(validateRBTree(tree.root), 3, 'tree has a black height of 3');

    // new tree:
    //                        6,B
    //                      /     \
    //                  4,B        7,B
    //                     \          \
    //                     5,R        8,R

    // 6,B
    var node = tree.root;
    assert.strictEquals(node.val, 6, 'tree root val is 6');
    assert.strictEquals(node.str, 'six', 'tree root str is six');
    assert.strictEquals(node.red, false, 'tree root is black');
    assert.strictEquals(node.left instanceof RingNode, true, 'tree root left points to a RingNode');
    assert.strictEquals(node.right instanceof RingNode, true, 'tree root right points to a RingNode');

    // 4,B
    node = tree.root.left;
    assert.strictEquals(node.val, 4, 'node val is correct');
    assert.strictEquals(node.str, 'four', 'node str is correct');
    assert.strictEquals(node.red, false, 'node color is correct');
    assert.strictEquals(node.left, null, 'left pointer is null');
    assert.strictEquals(node.right instanceof RingNode, true, 'right pointer is RingNode');

    // 5,R
    node = tree.root.left.right;
    assert.strictEquals(node.val, 5, 'tree node val is correct');
    assert.strictEquals(node.str, 'five', 'tree node str is correct');
    assert.strictEquals(node.red, true, 'tree node color is correct');
    assert.strictEquals(node.left, null, 'node left points to null');
    assert.strictEquals(node.right, null, 'node right points to null');

    // 7,B
    node = tree.root.right;
    assert.strictEquals(node.val, 7, 'node val is correct');
    assert.strictEquals(node.str, 'seven', 'node str is correct');
    assert.strictEquals(node.red, false, 'node color is correct');
    assert.strictEquals(node.left, null, 'node has no left pointer');
    assert.strictEquals(node.right instanceof RingNode, true, 'node right points to a RingNode');

    // 8,R
    node = tree.root.right.right;
    assert.strictEquals(node.val, 8, 'node val is correct');
    assert.strictEquals(node.str, 'eight', 'node str is correct');
    assert.strictEquals(node.red, true, 'node color is correct');
    assert.strictEquals(node.left, null, 'leaf node has no left pointer');
    assert.strictEquals(node.right, null, 'leaf node has no right pointer');

    var ret = tree.remove(4);
    assert.strictEquals(ret, true, 'node was found and removed from tree');
    assert.strictEquals(tree.size, 4, 'tree has 4 nodes');
    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');
    assert.strictEquals(validateRBTree(tree.root), 3, 'tree has a black height of 3');

    // new tree:
    //                        6,B
    //                      /     \
    //                  5,B        7,B
    //                                \
    //                                8,R

    // 6,B
    var node = tree.root;
    assert.strictEquals(node.val, 6, 'tree root val is 6');
    assert.strictEquals(node.str, 'six', 'tree root str is six');
    assert.strictEquals(node.red, false, 'tree root is black');
    assert.strictEquals(node.left instanceof RingNode, true, 'tree root left points to a RingNode');
    assert.strictEquals(node.right instanceof RingNode, true, 'tree root right points to a RingNode');

    // 5,B
    node = tree.root.left;
    assert.strictEquals(node.val, 5, 'tree node val is correct');
    assert.strictEquals(node.str, 'five', 'tree node str is correct');
    assert.strictEquals(node.red, false, 'tree node color is correct');
    assert.strictEquals(node.left, null, 'node left points to null');
    assert.strictEquals(node.right, null, 'node right points to null');

    // 7,B
    node = tree.root.right;
    assert.strictEquals(node.val, 7, 'node val is correct');
    assert.strictEquals(node.str, 'seven', 'node str is correct');
    assert.strictEquals(node.red, false, 'node color is correct');
    assert.strictEquals(node.left, null, 'node has no left pointer');
    assert.strictEquals(node.right instanceof RingNode, true, 'node right points to a RingNode');

    // 8,R
    node = tree.root.right.right;
    assert.strictEquals(node.val, 8, 'node val is correct');
    assert.strictEquals(node.str, 'eight', 'node str is correct');
    assert.strictEquals(node.red, true, 'node color is correct');
    assert.strictEquals(node.left, null, 'leaf node has no left pointer');
    assert.strictEquals(node.right, null, 'leaf node has no right pointer');

    var ret = tree.remove(5);
    assert.strictEquals(ret, true, 'node was found and removed from tree');
    assert.strictEquals(tree.size, 3, 'tree has 3 nodes');
    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');
    assert.strictEquals(validateRBTree(tree.root), 3, 'tree has a black height of 3');

    // new tree:
    //                        7,B
    //                      /     \
    //                  6,B        8,B

    // 7,B
    var node = tree.root;
    assert.strictEquals(node.val, 7, 'tree root val is 7');
    assert.strictEquals(node.str, 'seven', 'tree root str is seven');
    assert.strictEquals(node.red, false, 'tree root is black');
    assert.strictEquals(node.left instanceof RingNode, true, 'tree root left points to a RingNode');
    assert.strictEquals(node.right instanceof RingNode, true, 'tree root right points to a RingNode');

    // 6,B
    node = tree.root.left;
    assert.strictEquals(node.val, 6, 'tree node val is correct');
    assert.strictEquals(node.str, 'six', 'tree node str is correct');
    assert.strictEquals(node.red, false, 'tree node color is correct');
    assert.strictEquals(node.left, null, 'node left points to null');
    assert.strictEquals(node.right, null, 'node right points to null');

    // 8,B
    node = tree.root.right;
    assert.strictEquals(node.val, 8, 'tree node val is correct');
    assert.strictEquals(node.str, 'eight', 'tree node str is correct');
    assert.strictEquals(node.red, false, 'tree node color is correct');
    assert.strictEquals(node.left, null, 'node left is null');
    assert.strictEquals(node.right, null, 'node right is null');

    var ret = tree.remove(6);
    assert.strictEquals(ret, true, 'node was found and removed from tree');
    assert.strictEquals(tree.size, 2, 'tree has 2 nodes');
    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');
    assert.strictEquals(validateRBTree(tree.root), 2, 'tree has a black height of 2');

    // new tree:
    //                        7,B
    //                           \
    //                            8,R

    // 7,B
    var node = tree.root;
    assert.strictEquals(node.val, 7, 'tree root val is 7');
    assert.strictEquals(node.str, 'seven', 'tree root str is seven');
    assert.strictEquals(node.red, false, 'tree root is black');
    assert.strictEquals(node.left, null, 'tree root left is null');
    assert.strictEquals(node.right instanceof RingNode, true, 'tree root right points to a RingNode');

    // 8,R
    node = tree.root.right;
    assert.strictEquals(node.val, 8, 'tree node val is correct');
    assert.strictEquals(node.str, 'eight', 'tree node str is correct');
    assert.strictEquals(node.red, true, 'tree node color is correct');
    assert.strictEquals(node.left, null, 'node left points to null');
    assert.strictEquals(node.right, null, 'node right points to null');

    var ret = tree.remove(7);
    assert.strictEquals(ret, true, 'node was found and removed from tree');
    assert.strictEquals(tree.size, 1, 'tree has 1 nodes');
    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');
    assert.strictEquals(validateRBTree(tree.root), 2, 'tree has a black height of 2');

    // new tree:
    //                        8,B

    // 7,B
    var node = tree.root;
    assert.strictEquals(node.val, 8, 'tree root val is 8');
    assert.strictEquals(node.str, 'eight', 'tree root str is eight');
    assert.strictEquals(node.red, false, 'tree root is black');
    assert.strictEquals(node.left, null, 'tree root left is null');
    assert.strictEquals(node.right, null, 'tree root right is null');

    var ret = tree.remove(8);
    assert.strictEquals(ret, true, 'node was found and removed from tree');
    assert.strictEquals(tree.size, 0, 'tree has 0 nodes');
    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');
    assert.strictEquals(validateRBTree(tree.root), 1, 'tree has a black height of 1');

    // tree is now empty

    assert.strictEquals(tree.root, null, 'tree root is null');

    var ret = tree.remove(1);
    assert.strictEquals(ret, false, 'node was not found');
    assert.strictEquals(tree.size, 0, 'tree has 0 nodes');
    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');
    assert.strictEquals(validateRBTree(tree.root), 1, 'tree has a black height of 1');

    assert.end();
});

test('RBTree insert dup', function t(assert) {
    var tree = makeTree();

    assert.strictEquals(tree.size, 8, 'tree has 8 nodes');

    var ret = tree.insert(9, 'nine');
    assert.strictEquals(ret, true, 'unique value inserted');
    assert.strictEquals(tree.size, 9, 'tree has 9 nodes');

    ret = tree.insert(1, 'ONE');
    assert.strictEquals(ret, false, 'duplicate value not inserted');
    assert.strictEquals(tree.size, 9, 'tree has 9 nodes');

    assert.end();
});

test('RBTree insert remove insert', function t(assert) {
    var tree = makeTree();

    assert.strictEquals(tree.size, 8, 'tree has 8 nodes');

    tree.remove(2);
    tree.remove(4);

    assert.strictEquals(tree.size, 6, 'tree has 6 nodes');

    var ret = tree.insert(2, 'TWO');
    assert.strictEquals(ret, true, 'unique value inserted');
    assert.strictEquals(tree.size, 7, 'tree has 7 nodes');
    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');

    ret = tree.insert(4, 'FOUR');
    assert.strictEquals(ret, true, 'unique value inserted');
    assert.strictEquals(tree.size, 8, 'tree has 8 nodes');
    assert.doesNotThrow(function () { validateRBTree(tree.root); }, false, 'tree is a valid red black tree');

    assert.end();
});

test('RBTree lowerBound', function t(assert) {
    var tree = makeTree();
    tree.insert(10, 'ten');

    //                         4,B
    //                       /     \
    //                   2,R         6,R
    //                 /     \     /     \
    //               1,B    3,B   5,B    8,B
    //                                  /   \
    //                               7,R     10,R

    var iter = tree.lowerBound(1);
    assert.strictEquals(iter.val(), 1, 'lowerBound(1) is 1');

    iter = tree.lowerBound(9);
    assert.strictEquals(iter.val(), 10, 'lowerBound(9) is 10');

    iter = tree.lowerBound(10);
    assert.strictEquals(iter.val(), 10, 'lowerBound(10) is 10');

    iter = tree.lowerBound(11);
    assert.strictEquals(iter.val(), null, 'lowerBound(11) is null');

    iter = tree.lowerBound(0);
    assert.strictEquals(iter.val(), 1, 'lowerBound(0) is 1');

    assert.end();
});

test('RBTree upperBound', function t(assert) {
    var tree = makeTree();
    tree.insert(10, 'ten');

    var iter = tree.upperBound(1);
    assert.strictEquals(iter.val(), 1, 'upperBound(1) is 1');

    iter = tree.upperBound(9);
    assert.strictEquals(iter.val(), 10, 'upperBound(9) is 10');

    iter = tree.upperBound(10);
    assert.strictEquals(iter.val(), 10, 'upperBound(10) is 10');

    iter = tree.upperBound(0);
    assert.strictEquals(iter.val(), 1, 'upperBound(0) is 1');

    assert.end();
});

test('RBTree payload copy bug', function t(assert) {
    var tree = new RBTree();

    for (var i = 0; i < 2000; i++) {
        tree.insert(i, String(i));
    }

    for (i = 2; i < 1999 ; i++) {
        tree.remove(i);
    }

    var iter = tree.iterator();
    while (iter.next() !== null) {
        assert.strictEquals(iter.val(), Number(iter.str()), 'node payloads match');
    }

    assert.end();
});

