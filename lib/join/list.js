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

var _ = require('underscore');
var EventEmitter = require('events').EventEmitter;

function JoinList(members) {
    members = members || [];

    this.members = {};
    this.add(members);
}
require('util').inherits(JoinList, EventEmitter);

JoinList.prototype.add = function add() {
    var targets = flattenAndUnique(arguments);
    var added = [];
    for (var i = 0; i < targets.length; ++i) {
        var target = targets[i];
        if (!this.members[target]) {
            var state = {};
            this.members[target] = state;
            added.push(target);
        }
    }
    if (added.length) {
        process.nextTick(this.emit.bind(this, 'add', added));
    }
};

JoinList.prototype.remove = function remove() {
    var targets = flattenAndUnique(arguments);
    var removed = [];
    for (var i = 0; i < targets.length; ++i) {
        var target = targets[i];
        var state = this.members[target];
        if (state) {
            delete this.members[target];
            removed.push(target);
        }
    }
    if (removed.length) {
        process.nextTick(this.emit.bind(this, 'remove', removed));
    }
};

JoinList.prototype.update = function update() {
    var current = Object.keys(this.members);
    var targets = flattenAndUnique(arguments);
    var targetSet = {};

    var adds = [];
    for (var i = 0; i < targets.length; ++i) {
        var target = targets[i];
        targetSet[target] = true;
        if (!this.members[target]) {
            adds.push(target);
        }
    }

    var removes = [];
    for (i = 0; i < current.length; ++i) {
        if (!targetSet[current[i]]) {
            removes.push(current[i]);
        }
    }

    this.remove(removes);
    this.add(adds);
};

JoinList.prototype.sample = function sample(n) {
    return _.sample(Object.keys(this.members), n || 1);
};

JoinList.prototype.shuffle = function shuffle() {
    return _.shuffle(Object.keys(this.members));
};

// overkill?
JoinList.prototype.get = function get(target) {
    return this.members[target];
};

function flattenAndUnique(args) {
    args = Array.prototype.slice.call(args);
    return _.chain(args).flatten().unique().value();
}

module.exports = JoinList; 
