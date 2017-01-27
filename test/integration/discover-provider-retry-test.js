// Copyright (c) 2017 Uber Technologies, Inc.
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

var fs = require('fs');
var test = require('tape');
var tmp = require('tmp');

var testRingpopCluster = require('../lib/test-ringpop-cluster.js');

testRingpopCluster('ringpop without retry fails to join cluster when bootstrap file does not exists',
    function t(bootRes, cluster, assert) {
        var ringpop = testRingpopCluster.createRingpop({
            host: '127.0.0.1',
            port: 11000
        });

        ringpop.bootstrap({
            bootstrapFile: '/tmp/does.not.exist.json',
            retry: false
        }, function onBootstrap(err, nodesJoined) {
            assert.ok(err, 'error during bootstrap');

            ringpop.destroy();
            assert.end();
        });
});

testRingpopCluster('ringpop with retry can join cluster after file is created',
    function t(bootRes, cluster, assert) {
        var ringpop = testRingpopCluster.createRingpop({
            host: '127.0.0.1',
            port: 11000
        });
        var hosts = cluster.map(function(node) {
            return node.hostPort;
        });

        var bootstrapFileWritten = false;
        var bootstrapFileName = tmp.tmpNameSync({});

        ringpop.bootstrap({
            bootstrapFile: bootstrapFileName,
            retry: {
                minDelay: 10
            }
        }, function onBootstrap(err, nodesJoined) {
            assert.error(err, 'no error during bootstrap');
            assert.ok(bootstrapFileWritten, 'bootstrap file is created before bootstrap');
            assert.equals(nodesJoined && nodesJoined.length, cluster.length, 'all nodes joined');

            ringpop.destroy();

            assert.end();

            fs.unlinkSync(bootstrapFileName);
        });

        setTimeout(function createHostsFile() {
            bootstrapFileWritten = true;

            fs.writeFile(bootstrapFileName, JSON.stringify(hosts), function onWrite(err) {
                assert.error(err);
            });
        }, 5);
});

testRingpopCluster('ringpop with retry can join cluster after file is written',
    function t(bootRes, cluster, assert) {
        var ringpop = testRingpopCluster.createRingpop({
            host: '127.0.0.1',
            port: 11000
        });
        var hosts = cluster.map(function(node) {
            return node.hostPort;
        });

        var bootstrapFileWritten = false;
        var bootstrapFile = tmp.fileSync({});

        ringpop.bootstrap({
            bootstrapFile: bootstrapFile.name,
            retry: {
                minDelay: 10
            }
        }, function onBootstrap(err, nodesJoined) {
            assert.error(err, 'no error during bootstrap');
            assert.ok(bootstrapFileWritten, 'bootstrap file is created before bootstrap');
            assert.equals(nodesJoined && nodesJoined.length, cluster.length, 'all nodes joined');

            ringpop.destroy();
            assert.end();
        });

        setTimeout(function writeHostsFile() {
            bootstrapFileWritten = true;

            fs.writeFile(bootstrapFile.name, JSON.stringify(hosts), function onWrite(err) {
                assert.error(err);
            });
        }, 5);
});
