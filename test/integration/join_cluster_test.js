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
var after = require('after');
var DebuglogLogger = require('../../lib/debug-log-logger.js');
var Ringpop = require('../../index.js');
var TChannel = require('tchannel');
var test = require('tape');

function bootstrapClusterOf(size, opts, tap, onBootstrap) {
    var cluster = createClusterOf(size, opts);

    var bootstrapHosts = cluster.map(function mapRingpop(ringpop) {
        return ringpop.hostPort;
    });

    if (typeof tap === 'function') {
        tap(cluster);
    }

    for (var i = 0; i < cluster.length; i++) {
        var node = cluster[i];
        node.bootstrap(bootstrapHosts, onBootstrap);
    }

    return cluster;
}

function createTChannel(host, port) {
    return new TChannel({
        host: host,
        port: port
    });
}

function createRingpop(opts) {
    opts = opts || {};

    var ringpop = new Ringpop(_.extend({
        app: 'test',
        hostPort: opts.host + ':' + opts.port,
        maxJoinDuration: opts.maxJoinDuration,
        channel: createTChannel(opts.host, opts.port),
        logger: DebuglogLogger()
    }, opts));

    ringpop.setupChannel();

    return ringpop;
}

function createClusterOf(size, opts) {
    size = size || 3;

    var cluster = [];

    for (var i = 1; i <= size; i++) {
        cluster.push(createRingpop(_.extend({
            host: '127.0.0.1',
            port: randomPort(10000 * i)
        }, opts)));
    }

    return cluster;
}

function destroyCluster(cluster) {
    cluster.forEach(function eachRingpop(ringpop) {
        ringpop.destroy();
    });
}

function randomPort(offset) {
    return Math.floor((Math.random() * 9999) + offset);
}

test.skip('one node can join', function t(assert) {
    var cluster = bootstrapClusterOf(1, null, null, function onBootstrap(err) {
        assert.ifError(err, 'no bootstrap error');
        destroyCluster(cluster);
        assert.end();
    });
});

test('two nodes can join', function t(assert) {
    assert.plan(4);

    var done = after(2, function onDone() {
        destroyCluster(cluster);
        assert.end();
    });

    function onBootstrap(err, nodesJoined) {
        assert.ifError(err, 'no bootstrap error');
        assert.equal(nodesJoined.length, 1, 'joined one other node');
        done();
    }

    var cluster = bootstrapClusterOf(2, null, null, onBootstrap);
});

test('three nodes can join', function t(assert) {
    assert.plan(6);

    var done = after(3, function onDone() {
        destroyCluster(cluster);
        assert.end();
    });

    function onBootstrap(err, nodesJoined) {
        assert.ifError(err, 'no bootstrap error');
        assert.equal(nodesJoined.length, 2, 'joined one other node');
        done();
    }

    var cluster = bootstrapClusterOf(3, null, null, onBootstrap);
});

test('three nodes, 1 bad node, join size 1', function t(assert) {
    var done = after(3, function onDone() {
        destroyCluster(cluster);
        assert.end();
    });

    function onBootstrap(err, nodesJoined) {
        assert.ifError(err, 'no bootstrap error');
        assert.ok(nodesJoined.length >= 1, 'joined at least one other node');
        assert.ok(nodesJoined.indexOf(cluster[2].hostPort) === -1, 'no one can join this guy');
        done();
    }

    var cluster = bootstrapClusterOf(3, {
        joinSize: 1
    }, function tap(cluster) {
        cluster[2].denyJoins();
    }, onBootstrap);
});

test('three nodes, 1 bad node, join size 2', function t(assert) {
    var done = after(3, function onDone() {
        destroyCluster(cluster);
        assert.end();
    });

    function onBootstrap(err) {
        assert.ok(err, 'bootstrap error occurred');
        done();
    }

    var cluster = bootstrapClusterOf(3, {
        joinSize: 2,
        maxJoinDuration: 100
    }, function tap(cluster) {
        cluster[1].denyJoins();
        cluster[2].denyJoins();
    }, onBootstrap);
});
