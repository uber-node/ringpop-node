// Copyright (c) 2019 Uber Technologies, Inc.
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
var RingEvents = require('../events.js');
var util = require('util');

function RendezvousHasher(options) {
    this.options = options || {};

    this.hashFunc = this.options.hashFunc || farmhash.hash32v1;

    this.servers = {};
    this.serverHashes = [];
    this.serverNames = []
    this.checksum = null;
}

util.inherits(RendezvousHasher, EventEmitter);

RendezvousHasher.prototype.addServer = function addServer(server) {
    if (this.hasServer(server)) {
        return;
    }
    
    this.servers[server] = true;

    var hash = _serverHash(this.hashFunc, server);
    this.serverHashes.push(hash);
    this.serverNames.push(server)
    
    this.computeChecksum();

    this.emit('added', server);
};

RendezvousHasher.prototype.removeServer = function removeServer(server) {
    if (!this.hasServer(server)) {
        return;
    }

    delete this.servers[server];
    
    var i = this.serverNames.indexOf(server);
    if (i!==-1) {
        hash = this.serverHashes.pop();
        name = this.serverNames.pop();

        if (this.serverHashes.length > 0) {
            this.serverHashes[i] = hash;
            this.serverNames[i] = name;
        }
    }
    
    this.computeChecksum();

    this.emit('removed', server);
};


RendezvousHasher.prototype.addRemoveServers = function addRemoveServers(serversToAdd, serversToRemove) {
    serversToAdd = serversToAdd || [];
    serversToRemove = serversToRemove || [];

    var addedServers = false;
    var removedServers = false;

    var server;

    for (var i = 0; i < serversToAdd.length; i++) {
        server = serversToAdd[i];

        if (!this.hasServer(server)) {
            this.addServer(server);
            addedServers = true;
        }
    }

    for (var j = 0; j < serversToRemove.length; j++) {
        server = serversToRemove[j];

        if (this.hasServer(server)) {
            this.removeServer(server);
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

RendezvousHasher.prototype.computeChecksum = function computeChecksum() {
    // If servers is empty, a checksum will still be computed
    // for the empty string.
    var serverservers = Object.keys(this.servers);
    var serverserverStr = serverservers.sort().join(';');

    var oldChecksum = this.checksum;
    this.checksum = this.hashFunc(serverserverStr);

    this.emit('checksumComputed', new RingEvents.ChecksumComputedEvent(
        this.checksum, oldChecksum));
};

RendezvousHasher.prototype.getServerCount = function getServerCount() {
    return Object.keys(this.servers).length;
};

RendezvousHasher.prototype.getStats = function getStats() {
    return {
        checksum: this.checksum,
        servers: Object.keys(this.servers)
    };
};

RendezvousHasher.prototype.hasServer = function hasServer(server) {
    return !!this.servers[server];
};



RendezvousHasher.prototype.lookup = function lookup(str) {
    // Numbers in js are floats with 53 bits for precission. If we need more than
    // 53 bits to store the result of a multiplication, we lose information. To
    // avoid this we multiply as follows:
    // ((x & 0xffff0000) * y + (x & 0x0000ffff) * y) & 0xffffffff
    // 
    // Another trick we use is x >>> 0, which creates a uint32.
    // 
    // https://stackoverflow.com/questions/6232939/is-there-a-way-to-correctly-multiply-two-32-bit-integers-in-javascript
    // 

    var hash = this.hashFunc(str) >>> 0;
    var hlo = hash & 0x0000ffff;
    var hhi = hash - hlo;

    var max = 0;
    var maxServer = "";
    for (var i=0; i < this.serverHashes.length; i++) {
        sh = this.serverHashes[i];

        // 32 bit multiplication of hash * sh (with implicit mod 2^32)
        var weight = ((hhi*sh>>>0) + (hlo*sh))>>>0;
        if (weight >= max) { // optimization to first check >= instead of having multiple ifs.
            
            if (weight == max) {
                if (this.serverNames[i] < maxServer) { // prefer first in lexigraphic order
                    maxServer = this.serverNames[i];
                }
            } else {
                max = weight;
                maxServer = this.serverNames[i];
            }
        }
    }

    return maxServer;
};

// find (up to) N unique successor nodes (aka the 'preference list') for the given key
RendezvousHasher.prototype.lookupN = function lookupN(str, n) {
    // can't return more than the number of servers
    var serverCount = this.getServerCount();
    if (n > serverCount) {
        n = serverCount;
    }

    var hash = this.hashFunc(str) >>> 0;
    var hlo = hash & 0x0000ffff;
    var hhi = hash - hlo;

    // init heap with capacity n
    let serversByWeight = {};
    let heap = [];
    for (var i=0; i<n; i++) {
        heap[i] = 0;
    }

    // add weights to the minheap keeping only the n biggest values
    for (var i=0; i < this.serverHashes.length; i++) {
        sh = this.serverHashes[i];
        server = this.serverNames[i];

        // 32 bit multiplication of hash * sh (with implicit mod 2^32)
        weight = ((hhi*sh >>> 0) + (hlo*sh)) >>> 0;
        if (heap[0] >= weight) {
            continue
        }

        // add weight to heap
        if (!serversByWeight.hasOwnProperty(weight)) {
            serversByWeight[weight] = [];
        }
        serversByWeight[weight].push(server);
        _pushpop(heap, weight);
    }

     // pop all weights from the heap
    orderedWeights = [];
    while (heap.length > 0) {
        orderedWeights.push(heap[0]);

        // We perform a heap pop by removing an element from the end of the
        // heap array and using a pushpop operation to push it back on and
        // remove the smallest element. Not that heap.pop() shirnks the array
        // and is not the same as a heap pop operation.
        item = heap.pop();
        _pushpop(heap, item);
    }

    // get the servers associated with the weights
    var resultArray = [];
    for (var i = orderedWeights.length - 1; i >= 0; i--) {
        var w = orderedWeights[i];
        if (serversByWeight[w].length > 1) {
            // hash collissions are extremely rare so it doesn't matter this
            // doesn't look efficient.
            serversByWeight[w].sort();
            serversByWeight[w].reverse();
        }
        server = serversByWeight[w].pop();
        resultArray.push(server);
    }

    return resultArray;
};

function _serverHash(hashFunc, v) {
    // We calculate max hash of server-hash * key-hash. Odd numbers spread out
    // perfectly over the uint32 range, odd numbers, however, don't. Take 0 for
    // example which doesn't distribute at all because 0 * key-hash is always 0.
    // The | operation converts the uint32 to a signed integer. We use >>> to
    // convert back to a uint32.
    return (hashFunc(v)|1) >>> 0;
}

function _pushpop(heap, item){
    if (heap.length===0 || item<heap[0]) {
        return
    }
    // Bubble up the smaller child until hitting a leaf.
    i = 0
    child = 1
    while (child < heap.length) {
        r = child + 1
        if (r < heap.length && heap[r] < heap[child]) {
            child = r;
        }
        heap[i] = heap[child];
        i = child;
        child = 2*i + 1;
    }

    // The leaf at pos is empty now. Put item there, and bubble it up
    // to its final resting place (by sifting its parents down).
    heap[i] = item
    while (i > 0) {
        p = (i - 1) >> 1;
        if (item > heap[p]) {
            break
        }
        heap[i] = heap[p];
        i = p;
    }
    heap[i] = item;
}

module.exports = RendezvousHasher;
