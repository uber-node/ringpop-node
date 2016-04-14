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

var RBIterator; // forward references

// payload of this tree (val, str) is embedded into the node for performance
function RingNode(val, str) {
    this.val = val;
    this.str = str;
    this.left = null;
    this.right = null;
    this.red = true;
}

RingNode.prototype.getChild = function(dir) {
    return dir ? this.right : this.left;
};

RingNode.prototype.setChild = function(dir, val) {
    if (dir) {
        this.right = val;
    } else {
        this.left = val;
    }
};

var RBTree = function RBTree() {
    this.root = null;
    this.size = 0;
};

function isRed(node) {
    return node !== null && node.red;
}

function singleRotate(root, dir) {
    var save = root.getChild(!dir);

    root.setChild(!dir, save.getChild(dir));
    save.setChild(dir, root);

    root.red = true;
    save.red = false;

    return save;
}

function doubleRotate(root, dir) {
    root.setChild(!dir, singleRotate(root.getChild(!dir), !dir));
    return singleRotate(root, dir);
}

// returns true if inserted, false if duplicate
RBTree.prototype.insert = function(val, str) {
    var ret = false;

    if (this.root === null) { // empty
        this.root = new RingNode(val, str);
        ret = true;
    } else {
        var head = new RingNode(undefined, undefined); // fake tree root

        var dir = 0;
        var last = 0;

        var gp = null; // grandparent
        var ggp = head; // grand-grand-parent
        var p = null; // parent
        var node = this.root;
        ggp.right = this.root;

        while (true) {
            if (node === null) {
                // insert new node at the bottom
                node = new RingNode(val, str);
                p.setChild(dir, node);
                ret = true;
            } else if (isRed(node.left) && isRed(node.right)) {
                // color flip
                node.red = true;
                node.left.red = false;
                node.right.red = false;
            }

            // fix red violation
            if (isRed(node) && isRed(p)) {
                var dir2 = ggp.right === gp;

                if (node === p.getChild(last)) {
                    ggp.setChild(dir2, singleRotate(gp, !last));
                } else {
                    ggp.setChild(dir2, doubleRotate(gp, !last));
                }
            }

            var cmp = node.val - val; // note inlined comparitor

            // stop if found
            if (cmp === 0) {
                break;
            }

            last = dir;
            dir = cmp < 0;

            // update helpers
            if (gp !== null) {
                ggp = gp;
            }
            gp = p;
            p = node;

            node = node.getChild(dir);
        }

        // update root
        this.root = head.right;
    }

    // make root black
    this.root.red = false;

    if (ret) {
    	this.size++;
    }

    return ret;
};

// deleting is easy if the node is red, but complicated if the node is black.
// This is a top down removal technique that pretends to push a new red node onto the tree,
// using color flips and rotations until the proper location is found. This way we always
// delete a red node.

// returns true if found and removed, false if not found
RBTree.prototype.remove = function(val) {
    if (this.root === null) {
        return false;
    }

    var head = new RingNode(undefined, undefined); // our new red node that we'll push down
    var node = head;
    node.right = this.root;
    var p = null; // parent
    var gp = null; // grand parent
    var found = null; // found item
    var dir = 1;

    while (node.getChild(dir) !== null) {
        var lastDir = dir;

        // update helpers
        gp = p;
        p = node;
        node = node.getChild(dir);

        var cmp = val - node.val; // note inlined comparitor

        dir = cmp > 0;

        // save found node
        if (cmp === 0) {
            found = node;
        }

        // pretend to push the red node down
        if (!isRed(node) && !isRed(node.getChild(dir))) {
            if (isRed(node.getChild(!dir))) {
                var sr = singleRotate(node, dir);
                p.setChild(lastDir, sr);
                p = sr;
            } else if (!isRed(node.getChild(!dir))) {
                var sibling = p.getChild(!lastDir);
                if (sibling !== null) {
                    /* jshint -W073 */
                    if (!isRed(sibling.getChild(!lastDir)) && !isRed(sibling.getChild(lastDir))) {
                        // color flip
                        p.red = false;
                        sibling.red = true;
                        node.red = true;
                    } else {
                        var dir2 = gp.right === p;

                        if (isRed(sibling.getChild(lastDir))) {
                            gp.setChild(dir2, doubleRotate(p, lastDir));
                        } else if (isRed(sibling.getChild(!lastDir))) {
                            gp.setChild(dir2, singleRotate(p, lastDir));
                        }

                        var gpc = gp.getChild(dir2);
                        gpc.red = true;
                        node.red = true;
                        gpc.left.red = false;
                        gpc.right.red = false;
                    }
                }
            }
        }
    }

    // splice out the node that we've found
    if (found !== null) {
        found.val = node.val;
        found.str = node.str;
        p.setChild(p.right === node, node.getChild(node.left === null));
        this.size--;
    }

    // update root and make it black
    this.root = head.right;
    if (this.root !== null) {
        this.root.red = false;
    }

    return found !== null;
};

// Returns an interator to the tree node at or immediately after the item
RBTree.prototype.lowerBound = function(val) {
    var cur = this.root;
    var iter = this.iterator();

    while (cur !== null) {
        var c = val - cur.val;
        if (c === 0) {
            iter.cursor = cur;
            return iter;
        }
        iter.ancestors.push(cur);
        cur = cur.getChild(c > 0);
    }

    for (var i = iter.ancestors.length - 1; i >= 0; --i) {
        cur = iter.ancestors[i];
        if (val - cur.val < 0) {
            iter.cursor = cur;
            iter.ancestors.length = i;
            return iter;
        }
    }

    iter.ancestors.length = 0;
    return iter;
};

// Returns an interator to the tree node immediately after the item
RBTree.prototype.upperBound = function(val) {
    var iter = this.lowerBound(val);

    while (iter.val() !== null && (iter.val() - val) < 0) { // inlined comparitor
        iter.next();
    }

    return iter;
};

// returns null if tree is empty
RBTree.prototype.min = function() {
    var res = this.root;
    if (res === null) {
        return null;
    }

    while (res.left !== null) {
        res = res.left;
    }

    return res;
};

RBTree.prototype.iterator = function() {
    return new RBIterator(this);
};

RBIterator = function RBIterator(tree) {
    this.tree = tree;
    this.ancestors = [];
    this.cursor = null;
};

RBIterator.prototype.val = function() {
    return this.cursor !== null ? this.cursor.val : null;
};

RBIterator.prototype.str = function() {
    return this.cursor !== null ? this.cursor.str : null;
};

// if null-iterator, return first node, otherwise next node
RBIterator.prototype.next = function() {
    if (this.cursor === null) {
        var root = this.tree.root;
        if (root !== null) {
            this.minNode(root);
        }
    } else {
        if (this.cursor.right === null) {
            // no greater node in subtree, go up to parent
            // if coming from a right child, continue up the stack
            var save;
            do {
                save = this.cursor;
                if (this.ancestors.length) {
                    this.cursor = this.ancestors.pop();
                } else {
                    this.cursor = null;
                    break;
                }
            } while (this.cursor.right === save);
        } else {
            // get the next node from the subtree
            this.ancestors.push(this.cursor);
            this.minNode(this.cursor.right);
        }
    }
    return this.cursor !== null ? this.cursor.val : null;
};

// find the left-most node from this subtree
RBIterator.prototype.minNode = function(start) {
    while (start.left !== null) {
        this.ancestors.push(start);
        start = start.left;
    }
    this.cursor = start;
};

exports.RBTree = RBTree;
exports.RBIterator = RBIterator;
exports.RingNode = RingNode;

