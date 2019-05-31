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
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFhasherEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

var RendezvousHasher = require('../../lib/hasher/rendezvous-hashing');

var test = require('tape');

test('construct a new RendezvousHasher with defaults', function t(assert) {
    var hasher = new RendezvousHasher();

    assert.strictEquals(typeof hasher.options, 'object', 'hasher.options is an Object');
    assert.strictEquals(Object.keys(hasher.options).length, 0, 'hasher.options is empty by default');
    assert.strictEquals(typeof hasher.servers, 'object', 'hasher.servers is an Object');
    assert.strictEquals(Object.keys(hasher.servers).length, 0, 'hasher.servers is empty by default');
    assert.strictEquals(typeof hasher.serverHashes, 'object', 'hasher.servers is an Object');
    assert.strictEquals(Object.keys(hasher.serverHashes).length, 0, 'hasher.servers is empty by default');
    assert.strictEquals(hasher.checksum, null);

    assert.end();
});

test('construct a new RendezvousHasher with options', function t(assert) {
    fakeHash = function(a) {return a;}
    var hasher = new RendezvousHasher({ hashFunc: fakeHash });

    assert.strictEquals(typeof hasher.options, 'object', 'hasher.options is an Object');
    assert.strictEquals(Object.keys(hasher.options).length, 1, 'hasher.options is 1');
    assert.strictEquals(hasher.hashFunc, fakeHash, 'hashFunc is fakeHash');
    assert.strictEquals(typeof hasher.servers, 'object', 'hasher.servers is an Object');
    assert.strictEquals(Object.keys(hasher.servers).length, 0, 'hasher.servers is empty by default');
    assert.strictEquals(typeof hasher.serverHashes, 'object', 'hasher.servers is an Object');
    assert.strictEquals(Object.keys(hasher.serverHashes).length, 0, 'hasher.servers is empty by default');
    assert.strictEquals(hasher.checksum, null);

    assert.end();
});

test('RendezvousHasher.addServer', function t(assert) {
    var name = 'test 1';
    var hasher = new RendezvousHasher();
    var emitted = false;
    hasher.on('added', function () { emitted = true; });
    hasher.addServer(name);
 
    assert.strictEquals(hasher.servers[name], true, 'hasher.servers has new server');
    assert.strictEquals(Object.keys(hasher.servers).length, 1, 'hasher.servers is 1');
    assert.strictEquals(emitted, true, 'hasher emits added event');
    assert.strictEquals(hasher.getServerCount(), 1, 'hasher.getServerCount() returns 1');

    assert.end();
});

test('RendezvousHasher.removeServer', function t(assert) {
    var name1 = 'test 1';
    var name2 = 'test 2';
    var hasher = new RendezvousHasher();
    var added = 0;
    var removed = 0;
    hasher.on('added', function () { added++; });
    hasher.on('removed', function () { removed++; });
    hasher.addServer(name1);
    hasher.addServer(name2);
 
    assert.strictEquals(hasher.servers[name1], true, 'hasher.servers has name1');
    assert.strictEquals(hasher.servers[name2], true, 'hasher.servers has name2');
    assert.strictEquals(Object.keys(hasher.servers).length, 2, 'hasher.servers is 2');
    assert.strictEquals(Object.keys(hasher.serverHashes).length, 2, 'hasher.serverHashes is 2');
    assert.strictEquals(Object.keys(hasher.serverNames).length, 2, 'hasher.serverNames is 2');
    assert.strictEquals(added, 2, 'hasher emits added events');
    
    hasher.removeServer(name1);

    assert.strictEquals(hasher.servers[name1], undefined, 'hasher.servers does not have name1');
    assert.strictEquals(hasher.servers[name2], true, 'hasher.servers has name2');
    assert.strictEquals(Object.keys(hasher.servers).length, 1, 'hasher.servers is 1');
    assert.strictEquals(Object.keys(hasher.serverHashes).length, 1, 'hasher.serverHashes is 1');
    assert.strictEquals(Object.keys(hasher.serverNames).length, 1, 'hasher.serverNames is 1');
    assert.strictEquals(removed, 1, 'hasher emits removed events');
    
    assert.end();
});

test('checksum is null upon instantiation', function t(assert) {
    var hasher = new RendezvousHasher();
    assert.equals(hasher.checksum, null, 'checksum is null');
    assert.end();
});

test('checksum is not null when server added', function t(assert) {
    var hasher = new RendezvousHasher();
    hasher.addServer('127.0.0.1:3000');
    assert.doesNotEqual(hasher.checksum, null, 'checksum is not null');
    assert.end();
});

test('checksum is still null when non-existent server removed', function t(assert) {
    var hasher = new RendezvousHasher();
    hasher.removeServer('127.0.0.1:3000');
    assert.equals(hasher.checksum, null, 'checksum is null');
    assert.end();
});

test('checksum recomputed after server added, then removed', function t(assert) {
    var hasher = new RendezvousHasher();

    hasher.addServer('127.0.0.1:3000');
    hasher.addServer('127.0.0.1:3001');
    var firstChecksum = hasher.checksum;

    hasher.removeServer('127.0.0.1:3000');
    var secondChecksum = hasher.checksum;

    hasher.addServer('127.0.0.1:3000');
    var thirdChecksum = hasher.checksum;

    assert.doesNotEqual(firstChecksum, null, 'first checksum is not null');
    assert.doesNotEqual(secondChecksum, null, 'second checksum is not null');
    assert.doesNotEqual(firstChecksum, secondChecksum, 'checksums are different');
    assert.equals(firstChecksum, thirdChecksum, 'checksums are the same');
    assert.end();
});

test('servers added out of order result in same checksum', function t(assert) {
    var hasher1 = new RendezvousHasher();
    hasher1.addServer('127.0.0.1:3000');
    hasher1.addServer('127.0.0.1:3001');

    var hasher2 = new RendezvousHasher();
    hasher2.addServer('127.0.0.1:3001');
    hasher2.addServer('127.0.0.1:3000');

    assert.doesNotEqual(hasher1.checksum, null, 'hasher1 checksum is not null');
    assert.doesNotEqual(hasher2.checksum, null, 'hasher2 checksum is not null');
    assert.equals(hasher1.checksum, hasher2.checksum, 'checksums are same');
    assert.end();
});

test('servers removed out of order result in same checksum', function t(assert) {
    var hasher1 = new RendezvousHasher();
    addServers(hasher1);
    hasher1.removeServer('127.0.0.1:3001');
    hasher1.removeServer('127.0.0.1:3002');

    var hasher2 = new RendezvousHasher();
    addServers(hasher2);
    hasher2.removeServer('127.0.0.1:3002');
    hasher2.removeServer('127.0.0.1:3001');

    assert.doesNotEqual(hasher1.checksum, null, 'hasher1 checksum is not null');
    assert.doesNotEqual(hasher2.checksum, null, 'hasher2 checksum is not null');
    assert.equals(hasher1.checksum, hasher2.checksum, 'checksums are same');
    assert.end();

    function addServers(hasher) {
        for (var i = 0; i < 4; i++) {
            hasher.addServer('127.0.0.1:300' + i);
        }
    }
});

test('consistent lookups', function t(assert) {
    var hasher1 = new RendezvousHasher();
    var hasher2 = new RendezvousHasher();

    var serverA = '10.0.0.1:50';
    var serverB = '10.0.0.1:501';
    var key = '10.0.0.1:5011';

    hasher1.addServer(serverA);
    hasher1.addServer(serverB);

    // Add servers in different order
    hasher2.addServer(serverB);
    hasher2.addServer(serverA);

    assert.equal(hasher1.lookup(key), serverB);
    assert.equal(hasher2.lookup(key), serverB);

    assert.end();
});

test('consistent lookups on collision - real collision', function t(assert) {
    var hasher1 = new RendezvousHasher();
    var hasher2 = new RendezvousHasher();

    // These ip addresses and lookup key look 'magic' but are actually
    // the first hash collision (1477543671) we found "in the wild".
    servers = ['10.66.3.137:3153839', '10.66.135.9:3184872'].sort()
    var serverA = servers[0];
    var serverB = servers[1];
    var key = servers[0];

    assert.equals(hasher1.hashFunc(serverA), 1477543671);
    assert.equals(hasher1.hashFunc(serverB), 1477543671);

    hasher1.addServer(serverA);
    hasher1.addServer(serverB);

    // Add servers in different order
    hasher2.addServer(serverB);
    hasher2.addServer(serverA);

    assert.equal(hasher1.lookup(key), serverA);
    assert.equal(hasher1.lookup(key), serverA);
    assert.equal(hasher1.lookupN(key,1)[0], serverA);
    assert.equal(hasher1.lookupN(key,1)[0], serverA);
    assert.equal(hasher1.lookupN(key,2)[0], serverA);
    assert.equal(hasher2.lookupN(key,2)[0], serverA);
    assert.equal(hasher1.lookupN(key,2)[1], serverB);
    assert.equal(hasher2.lookupN(key,2)[1], serverB);
    assert.equal(hasher1.lookupN(key,3).length, 2);
    assert.equal(hasher2.lookupN(key,3).length, 2);
    assert.equal(hasher1.lookupN(key,3)[0], serverA);
    assert.equal(hasher2.lookupN(key,3)[0], serverA);
    assert.equal(hasher1.lookupN(key,3)[1], serverB);
    assert.equal(hasher2.lookupN(key,3)[1], serverB);

    assert.end();
});

test('hashes distributed evenly', function t(assert) {
    var hasher = new RendezvousHasher();

    servers = [];
    for (var i=0; i<13; i++) {
        servers.push("worker"+i);
    }
    hasher.addRemoveServers(servers, []);

    distr = {}
    avgLoad = 1000;
    for (var key=0; key < servers.length * avgLoad; key++) {
        server = hasher.lookup("key"+key);
        distr[server] = (distr[server] || 0) + 1;
    }
    
    assert.equals(Object.keys(distr).length, 13, 'all servers received load')
    var max = 0;
    var min = avgLoad * servers.length;
    for (var i=0; i<13; i++) {
        server = "worker"+i;
        if (distr[server] > max) {
            max = distr[server];
        }
        if (distr[server] < min) {
            min = distr[server];
        }
    }

    assert.ok(min / avgLoad > 0.95, 'least loaded server is >0.95 of avg');
    assert.ok(max / avgLoad < 1.05, 'most loaded server is <1.05 of avg');
    assert.end();
});

test('lookupN hashes are distributed evenly', function t(assert) {
    var hasher = new RendezvousHasher();

    servers = [];
    for (var i=0; i<13; i++) {
        servers.push("worker"+i);
    }
    hasher.addRemoveServers(servers, []);

    for(var x=0; x<5; x++) {
        distr = {}
        avgLoad = 1000;
        for (var key=0; key < servers.length * avgLoad; key++) {
            server = hasher.lookupN("key"+key,5)[x];
            distr[server] = (distr[server] || 0) + 1;
        }
        
        assert.equals(Object.keys(distr).length, 13, 'all servers received load')
        var max = 0;
        var min = avgLoad * servers.length;
        for (var i=0; i<13; i++) {
            server = "worker"+i;
            if (distr[server] > max) {
                max = distr[server];
            }
            if (distr[server] < min) {
                min = distr[server];
            }
        }
        assert.ok(min / avgLoad > 0.92, 'least loaded server is >0.95 of avg');
        assert.ok(max / avgLoad < 1.08, 'most loaded server is <1.05 of avg');
    }
    assert.end();
});

test('server hashes are odd uint32 numbers', function t(assert) {
    var hasher = new RendezvousHasher();

    servers = [];
    for (var i=0; i<13; i++) {
        servers.push("worker"+i);
    }
    hasher.addRemoveServers(servers, []);

    odd=0;
    negative=0;
    above32bits=0;
    above31bits=0;
    below31bits=0;

    for (var i=0; i < hasher.serverHashes.length; i++) {
        hash = hasher.serverHashes[i];
        if (hash&1 === 1) {
            odd++;
        }
        if (hash < 0) {
            negative++;
        }
        if (hash >= 2**32) {
            above32bits++;
        }
        if (hash >= 2**31) {
            above31bits++;
        } else {
            below31bits++
        }
    }

    assert.equals(odd, 13, 'all server hashes are odd');
    assert.equals(negative, 0, 'no server hashes are negative');
    assert.equals(above32bits, 0, 'no server hashes are bigger than 32 bits');
    assert.ok(above31bits > 3 && below31bits > 3, 'full uint32 range is utilized');
    assert.end();
});