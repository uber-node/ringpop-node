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

var fs = require('fs');
var path = require('path');
var TChannel = require('tchannel');
var HyperbahnClient = require('tchannel/hyperbahn');
var TChannelAsThrift = require('tchannel/as/thrift');
var Ringpop = require('../index.js');
var RingpopHandler = require('../ringpop-handler.js');

var thriftSource = fs.readFileSync(path.join(__dirname, 'hyperbahn.thrift'), 'utf8');

/* Instructions:
 * 1) run Hyperbahn with at least one node: 127.0.0.1:21300
 *
 * 2) node discovery.js
 *    You will observe the member joining process. 
 *
 * Issue:
 *    If you run this example more than once without restarting Hyperbahn,
 *    ringpop will refuses to join, since the host list returned by discovery API
 *    has dead hostports from previous runs.
 *
 */

function App(options) {
    if (!(this instanceof App)) {
        return new App(options);
    }

    var self = this;

    self.thrift = new TChannelAsThrift({source: thriftSource});

    self.name = options.name;

    self.channel = TChannel();
}

App.prototype.setupRingpop = function setupRingpop() {
    var self = this;
    self.ringpop = Ringpop({
        app: 'app',
        hostPort: self.channel.address().address + ':' + self.channel.address().port,
        channel: self.channel.makeSubChannel({
            serviceName: 'ringpop'
        })
    });

    self.appChannel = self.channel.makeSubChannel({
        serviceName: 'app'
    });
    self.appChannel.handler = RingpopHandler({
        channel: self.appChannel,
        ringpop: self.ringpop,
        logger: self.channel.logger,
        realHandler: self.appChannel.handler
    });

    self.appChannel.register('hello', function hello(req, res, arg2, arg3) {
        res.headers.as = 'raw';
        res.sendOk('', 'hello from ' + self.name + ' for ' + req.headers.sk);
    });

    self.ringpop.setupChannel();
}

App.prototype.discover = function discover(cb) {
    var self = this;
    self.hyperbahnChannel = self.hyperbahnChannel || self.hyperbahnClient.getClientChannel({
        serviceName: 'hyperbahn'
    });

    var request = self.hyperbahnChannel.request({
        headers: {
            cn: 'app'
        },
        serviceName: 'hyperbahn',
        hasNoParent: true
    });
    self.thrift.send(request,
        'Hyperbahn::discover',
        null,
        {
            query: {
                serviceName: 'app'
            }
        },
        onResponse
    );

    function onResponse(err, res) {
        if (err || !res.ok) {
            console.log(res);
            console.log('call to discovery API failed', {
                error: err,
                body: res.body
            });
            cb([]);
            return;
        }

        var hosts = [];
        for (var i = 0; i < res.body.peers.length; i++) {
            hosts.push(covertHost(res.body.peers[i]));
        }

        cb(hosts);
    }
};

App.prototype.bootstrap = function bootstrap(cb) {
    var self = this;

    // listen
    self.channel.listen(0, '127.0.0.1', onListen);

    // create hyperbahn client
    self.hyperbahnClient = new HyperbahnClient({
        serviceName: 'app',
        callerName: 'app',
        hostPortList: ['127.0.0.1:21300', '127.0.0.1:21301'],
        tchannel: self.channel,
        logger: self.channel.logger,
        forwardRetries: 5,
        checkForwardListInterval: 60000,
        registrationTimeout: 5000,
        reportTracing: true,
        logTraceWarnings: false
    });

    function onListen() {
        // advertise
        self.hyperbahnClient.on('advertised', advertised);
        self.hyperbahnClient.on('error', advertised);
        self.hyperbahnClient.advertise();
    }

    function advertised(err) {
        if (err) {
            console.log('Hyperbahn advertising failed', err);
            return;
        }

        // discover existing hosts
        self.discover(onDiscover);
    }

    function onDiscover(hosts) {
        console.log(hosts);
        self.setupRingpop();
        self.ringpop.bootstrap(hosts, onBootstrap);
    }

    function onBootstrap() {
        console.log();
        console.log('app: ' + self.name + ' listening on ' +
            self.channel.address().port);
        console.log('members: ', self.ringpop.ring.servers);

        if (cb) {
            cb();
        }
    }
};

function covertHost(host) {
    var res = '';
    res += ((host.ip.ipv4 & 0xff000000) >> 24) + '.';
    res += ((host.ip.ipv4 & 0xff0000) >> 16) + '.';
    res += ((host.ip.ipv4 & 0xff00) >> 8) + '.';
    res += host.ip.ipv4 & 0xff;
    return res + ':' + host.port;
}

if (require.main === module) {
    var apps = [];
    var i;
    var items = 6;
    for (i = 1; i <= items; i++) {
        apps.push(App({
            name: 'app' + i
        }));
    }

    var count = 0;
    for (i = 1; i <= items; i++) {
        apps[i-1].bootstrap(function onBootstrap() {
            count++;
            if (count === items) {
                console.log('\n---------------------------------\n');
                console.log('bootstrap done', {
                    hosts: apps[0].ringpop.ring.servers
                });
            }
        });
    }
}
