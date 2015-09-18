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

// 3rd party dependencies
var _ = require('underscore');
var DebuglogLogger = require('debug-logtron');
var tape = require('tape');

// 1st party dependencies
var Ringpop = require('../../index.js');
var TChannel = require('tchannel');

function bootstrapClusterOf(opts, onBootstrap) {
    var cluster = createClusterOf(opts);

    var bootstrapHosts = cluster.map(function mapRingpop(ringpop) {
        return ringpop.hostPort;
    });

    if (typeof opts.tap === 'function') {
        opts.tap(cluster);
    }

    var count = 0;
    var results = {};

    function bootstrapHandler(hostPort) {
        return function bootstrapIt(err, nodesJoined) {
            results[hostPort] = {
                err: err,
                nodesJoined: nodesJoined
            };

            if (++count === cluster.length) {
                onBootstrap(results);
            }
        };
    }

    cluster.forEach(function each(ringpop, i) {
        var parts = ringpop.hostPort.split(':');
        ringpop.__channel.listen(Number(parts[1]), parts[0], function listened() {
            ringpop.__channel.removeListener('listening', listened);

            var cb = Array.isArray(onBootstrap) ?
                onBootstrap[i] : bootstrapHandler(ringpop.hostPort);
            ringpop.bootstrap({
                bootstrapFile: bootstrapHosts
            }, cb);
        });
    });

    return cluster;
}

function createClusterOf(opts) {
    var size = opts.size || 3;

    var cluster = [];

    for (var i = 0; i < size; i++) {
        cluster.push(createRingpop(_.extend({
            host: '127.0.0.1',
            port: 10000 + i
        }, opts)));
    }

    return cluster;
}

function createRingpop(opts) {
    opts = opts || {};

    var channel = new TChannel({
        logger: DebuglogLogger('tchannel')
    });

    var ringpop = new Ringpop(_.extend({
        app: 'test',
        hostPort: opts.host + ':' + opts.port,
        maxJoinDuration: opts.maxJoinDuration,
        channel: channel.makeSubChannel({
            serviceName: 'ringpop'
        }),
        logger: DebuglogLogger('ringpop')
    }, opts));

    ringpop.__channel = channel;
    ringpop.setupChannel();

    return ringpop;
}

function destroyCluster(cluster) {
    cluster.forEach(function eachRingpop(ringpop) {
        ringpop.destroy();
        if (!ringpop.__channel.destroyed) {
            ringpop.__channel.close();
        }
    });
}

function testRingpopCluster(opts, name, test) {
    if (typeof opts === 'string' && typeof name === 'function') {
        test = name;
        name = opts;
        opts = {};
    }

    tape(name, function onTest(assert) {
        var cluster = bootstrapClusterOf(opts, function onBootstrap(results) {
            assert.on('end', function onEnd() {
                destroyCluster(cluster);
            });

            test(results, cluster, assert);
        });
    });
}

module.exports = testRingpopCluster;
