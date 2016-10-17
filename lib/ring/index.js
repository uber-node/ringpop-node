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

var EventEmitter = require('events').EventEmitter;
var farmhash = require('farmhash');
var util = require('util');
var RBTree = require('./rbtree').RBTree;
var RingEvents = require('./events.js');

function HashRing(options) {
    this.options = options || {};

    this.replicaPoints = this.options.replicaPoints || 100;
    this.hashFunc = this.options.hashFunc || farmhash.hash32v1;

    this.rbtree = new RBTree();
    this.servers = {};
    this.checksum = null;
}

util.inherits(HashRing, EventEmitter);

// TODO - error checking from rbtree.insert
HashRing.prototype.addServer = function addServer(name) {
    if (this.hasServer(name)) {
        return;
    }

    this.addServerReplicas(name);
    this.computeChecksum();

    this.emit('added', name);
};

HashRing.prototype.addServerReplicas = function addServerReplicas(server) {
    // Assumes server has not been previously added.
    this.servers[server] = true;

    for (var i = 0; i < this.replicaPoints; i++) {
        var hash = this.hashFunc(server + i);
        this.rbtree.insert(hash, server);
    }
};

HashRing.prototype.addRemoveServers = function addRemoveServers(serversToAdd, serversToRemove) {
    serversToAdd = serversToAdd || [];
    serversToRemove = serversToRemove || [];

    var addedServers = false;
    var removedServers = false;

    var server;

    for (var i = 0; i < serversToAdd.length; i++) {
        server = serversToAdd[i];

        if (!this.hasServer(server)) {
            this.addServerReplicas(server);
            addedServers = true;
        }
    }

    for (var j = 0; j < serversToRemove.length; j++) {
        server = serversToRemove[j];

        if (this.hasServer(server)) {
            this.removeServerReplicas(server);
            removedServers = true;
        }
    }

    var ringChanged = addedServers || removedServers;

    if (ringChanged) {
        this.computeChecksum();
        this.emit('ringChanged', new RingEvents.RingChangedEvent(
            serversToAdd, serversToRemove));
    }

    return ringChanged;
};

HashRing.prototype.computeChecksum = function computeChecksum() {
    // If servers is empty, a checksum will still be computed
    // for the empty string.
    var serverNames = Object.keys(this.servers);
    var serverNameStr = serverNames.sort().join(';');

    var oldChecksum = this.checksum;
    this.checksum = this.hashFunc(serverNameStr);

    this.emit('checksumComputed', new RingEvents.ChecksumComputedEvent(
        this.checksum, oldChecksum));
};

HashRing.prototype.getServerCount = function getServerCount() {
    return Object.keys(this.servers).length;
};

HashRing.prototype.getStats = function getStats() {
    return {
        checksum: this.checksum,
        servers: Object.keys(this.servers)
    };
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

    this.removeServerReplicas(name);
    this.computeChecksum();

    this.emit('removed', name);
};

HashRing.prototype.removeServerReplicas = function removeServerReplicas(server) {
    // Assumes server has been previously added.
    delete this.servers[server];

    for (var i = 0; i < this.replicaPoints; i++) {
        var hash = this.hashFunc(server + i);
        this.rbtree.remove(hash, server);
    }
};

HashRing.prototype.lookup = function lookup(str) {
    var hash = this.hashFunc(str);
    var iter = this.rbtree.upperBound(hash);
    var res = iter.str();
    if (res === null) {
        var min = this.rbtree.min();
        res = min && min.str;
    }
    return res;
};

// find (up to) N unique successor nodes (aka the 'preference list') for the given key
HashRing.prototype.lookupN = function lookupN(str, n) {
    // can't return more than the number of servers
    var serverCount = this.getServerCount();
    if (n > serverCount) {
        n = serverCount;
    }

    var resultArray = [];
    var resultSet = {}; // for fast dedup
    var hash = this.hashFunc(str);
    var iter = this.rbtree.upperBound(hash);
    // remember start of loop to prevent infinite loops
    // (This is to guard against the cases where serverCount is out of sync with
    // the rbtree (e.g., due to a bug), e.g., n === serverCount === 3 but the
    // rbtree contains only 2 unique servers.)
    var firstVal = iter.val();
    do {
        var res = iter.str();
        if (res === null) {
            // reached end of rbtree, wrapping around
            iter = this.rbtree.iterator();
        } else {
            // only add unique servers
            if (!resultSet[res]) {
                resultArray.push(res);
                resultSet[res] = true;
            }
        }
        iter.next();
    } while (resultArray.length < n && iter.val() !== firstVal);

    return resultArray;
};

module.exports = HashRing;
