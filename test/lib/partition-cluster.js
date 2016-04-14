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

var globalNet = require('net');
var assert = require('assert');

module.exports = PartitionCluster;

function PartitionCluster(opts) {
    var socketTable = SocketTable();
    var partitionTable = PartitionTable(opts);

    return {
        splitNetwork: splitNetwork,
        allocateNetFor: allocateNetFor
    };

    function splitNetwork(opts) {
        partitionTable.set(opts);

        enforceSplit();
    }

    function allocateNetFor(name) {
        var net = {
            createConnection: createConnection,
            createServer: globalNet.createServer
        };

        return net;

        function createConnection() {
            var sock = globalNet.createConnection.apply(
                globalNet, arguments);

            return sock;
        }
    }

    function enforceSplit() {

    }
}

function SocketTable() {
    /*  socketTable : {
            sources: Object<hostPort: String, {
                destinations: Object<hostPort, net.Socket>
            }>
        }
    */
    var socketTable = {
        sources: {},
        storeSocket: storeSocket
    };

    function storeSocket(name, socket) {
        assert(name, 'name required');
        assert(isHostPort(name), 'name must be host:port');

        if (!socketTable.sources[name]) {
            socketTable.sources[name] = {
                destinations: {}
            };
        }

        var destinationName = '';
    }
}

function PartitionTable(opts) {
    var partitionTable = {
        left: [],
        right: [],
        set: set
    };

    partitionTable.set(opts);

    return partitionTable;

    function set() {
        assert(opts.left, 'opts.left is required');
        assert(opts.right, 'opts.right is required');
        assert(Array.isArray(opts.left), 'opts.left must be array');
        assert(Array.isArray(opts.right), 'opts.right must be array');
        assert(isHostPort(opts.left), 'opts.left must be host:port');
        assert(isHostPort(opts.right), 'opts.right must be host:port');

        partitionTable.left = opts.left;
        partitionTable.right = opts.right;
    }
}

function isHostPort(name) {
    if (Array.isArray(name)) {
        return name.every(isHostPort);
    }

    var HOST_PORT_PATTERN = /^(\d+\.\d+\.\d+\.\d+):(\d+)$/;

    return HOST_PORT_PATTERN.test(name);
}
