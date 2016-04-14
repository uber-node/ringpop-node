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

'use strict';

var _ = require('underscore');
var HashRing = require('../../lib/ring');
var test = require('tape');

function createServers(size) {
    return _.times(size, function each(i) {
        return '127.0.0.1:' + (3000 + i);
    });
}

function extractPort(server) {
    return parseInt(server.substr(server.lastIndexOf(':')+1));
}

var servers = createServers(1000);

test('has correct number of servers on add/remove', function t(assert) {
    var ring = new HashRing();

    ring.addRemoveServers(servers, null);
    assert.equal(ring.getServerCount(), 1000, 'has 1000 servers');

    ring.addRemoveServers(null, servers);
    assert.equal(ring.getServerCount(), 0, 'has 0 servers');

    ring.addRemoveServers(servers, servers);
    assert.equal(ring.getServerCount(), 0, 'has 0 servers');

    assert.end();
});

test('checksum computed only once', function t(assert) {
    assert.plan(1);

    var ring = new HashRing();
    ring.on('checksumComputed', function onComputed() {
        assert.pass('checksum computed');
    });

    ring.addRemoveServers(servers, servers);

    assert.end();
});

test('1000 lookups', function t(assert) {
    assert.plan(1000);

    var ring = new HashRing();
    ring.addRemoveServers(servers, null);

    for (var i = 0; i < servers.length; i++) {
        var server = servers[i];

        assert.equal(ring.lookup(server + '0'), server,
            'server hashes correctly');
    }

    assert.end();
});

test('1000 lookupN', function t(assert) {
    assert.plan(1000);

    var ring = new HashRing({
        hashFunc: extractPort
    });
    ring.addRemoveServers(servers, null);

    for (var i = 0; i < servers.length; i++) {
        var server = servers[i];
        var server2 = servers[(i+1)%servers.length];
        var server3 = servers[(i+2)%servers.length];

        assert.deepEqual(ring.lookupN(server + '0', 3), [server, server2, server3],
            'server hashes correctly');
    }

    assert.end();
});

test('lookupN on ring of size 1', function t(assert) {
    assert.plan(1);

    var ring = new HashRing({
        hashFunc: extractPort
    });
    var server = servers[0];
    ring.addRemoveServers([server], null);

    assert.deepEqual(ring.lookupN(server + '0', 3), [server],
        'server hashes correctly');

    assert.end();
});

test('lookupN on empty ring', function t(assert) {
    assert.plan(1);

    var ring = new HashRing({
        hashFunc: extractPort
    });

    var server = servers[0];
    assert.deepEqual(ring.lookupN(server + '0', 3), [],
        'server hashes correctly');

    assert.end();
});

test('lookupN on corrupted ring of size 1', function t(assert) {
    assert.plan(1);

    var ring = new HashRing({
        hashFunc: extractPort
    });

    // ring has two servers, but rbtree has one
    var server = servers[0];
    ring.addRemoveServers([server], null);
    ring.servers = [servers[0], servers[1]];

    assert.deepEqual(ring.lookupN(server + '0', 3), [server],
        'server hashes correctly');

    assert.end();
});

test('lookupN on corrupted empty ring', function t(assert) {
    assert.plan(1);

    var ring = new HashRing({
        hashFunc: extractPort
    });

    // ring has 1 server, but rbtree is empty
    ring.servers = [servers[0]];

    var server = servers[0];
    assert.deepEqual(ring.lookupN(server + '0', 3), [],
        'server hashes correctly');

    assert.end();
});
