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
var EventEmitter = require('events').EventEmitter;
var farmhash = require('farmhash');
var util = require('util');
var RBTree = require('./rbtree').RBTree;

function HashRing(options) {
    this.options = options || {};

    this.replicaPoints = this.options.replicaPoints || 100;

    this.rbtree = new RBTree();
    this.servers = {};
}

util.inherits(HashRing, EventEmitter);

// TODO - error checking around adding a server that's already there
// TODO - error checking from rbtree.insert
HashRing.prototype.addServer = function addServer(name) {
    if (this.hasServer(name)) {
        return;
    }

    this.servers[name] = true;

    for (var i = 0; i < this.replicaPoints; i++) {
        this.rbtree.insert(farmhash.hash32(name + i), name);
    }

    this.emit('added', name);
};

HashRing.prototype.getServerCount = function getServerCount() {
    return Object.keys(this.servers).length;
};

HashRing.prototype.hasServer = function hasServer(name) {
    return !!this.servers[name];
};

// TODO - error checking around removing servers that aren't there
// TODO - error checking from rbtree.insert
HashRing.prototype.removeServer = function removeServer(name) {
    if (!this.hasServer(name)) {
        return;
    }

    delete this.servers[name];

    for (var i = 0; i < this.replicaPoints; i++) {
        this.rbtree.remove(farmhash.hash32(name + i), name);
    }

    this.emit('removed', name);
};

HashRing.prototype.lookup = function lookup(str) {
    var hash = farmhash.hash32(str);
    var iter = this.rbtree.upperBound(hash);
    var res = iter.str();
    if (res === null) {
        var min = this.rbtree.min();
        res = min && min.str;
    }
    return res;
};

module.exports = HashRing;
