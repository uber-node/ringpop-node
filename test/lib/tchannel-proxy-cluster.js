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

var tape = require('tape');
var tapeCluster = require('tape-cluster');
var TChannel = require('tchannel');
var parallel = require('async').parallel;

var RingpopHandler = require('../../ringpop-handler.js');
var allocCluster = require('./alloc-cluster.js');

TChannelProxyCluster.test = tapeCluster(tape, TChannelProxyCluster);

module.exports = TChannelProxyCluster;

function TChannelProxyCluster(options) {
    if (!(this instanceof TChannelProxyCluster)) {
        return new TChannelProxyCluster(options);
    }

    var self = this;

    self.size = options.size;
    self.blacklist = options.blacklist;
    self.serviceName = options.serviceName || 'app';

    self.keys = null;
    self.hosts = null;
    self.cluster = null;
    self.clientRootChannel = null;
    self.client = null;
}

TChannelProxyCluster.prototype.bootstrap = function bootstrap(cb) {
    var self = this;

    self.cluster = allocCluster(onCluster);
    self.keys = self.cluster.keys;
    self.clientRootChannel = TChannel();

    self.client = self.clientRootChannel.makeSubChannel({
        serviceName: self.serviceName,
        requestDefaults: {
            headers: {
                cn: 'client-app',
                as: 'raw'
            },
            hasNoParent: true
        },
        trace: false
    });

    function onCluster() {
        self.hosts = {
            one: self.cluster.one.hostPort,
            two: self.cluster.two.hostPort,
            three: self.cluster.three.hostPort
        };

        self.setupHandler('one', self.cluster.one);
        self.setupHandler('two', self.cluster.two);
        self.setupHandler('three', self.cluster.three);
        self.clientRootChannel.listen(0, '127.0.0.1', onListen);
    }

    function onListen() {
        parallel([
            self.client.waitForIdentified.bind(self.client, {
                host: self.hosts.one
            }),
            self.client.waitForIdentified.bind(self.client, {
                host: self.hosts.two
            }),
            self.client.waitForIdentified.bind(self.client, {
                host: self.hosts.three
            })
        ], cb);
    }
};

TChannelProxyCluster.prototype.setupHandler =
function setupHandler(name, ringpop) {
    var self = this;

    var channel = ringpop.channel;
    var subChannel = channel.topChannel.makeSubChannel({
        serviceName: self.serviceName
    });

    var realHandler = subChannel.handler;
    subChannel.handler = RingpopHandler({
        realHandler: realHandler,
        channel: channel,
        ringpop: ringpop,
        blacklist: self.blacklist,
        logger: ringpop.logger
    });

    subChannel.register('ping', ping);

    function ping(req, res, arg2, arg3) {
        res.headers.as = 'raw';
        res.sendOk(arg2, 'ping from ' + name);
    }
};

TChannelProxyCluster.prototype.close = function close(cb) {
    var self = this;

    self.cluster.destroy();
    self.clientRootChannel.close();
    cb();
};
