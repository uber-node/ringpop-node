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

var handleJoin = require('./join-handler.js');
var handlePing = require('./ping-handler.js');
var handlePingReq = require('./ping-req-handler.js');
var handleProxyReq = require('./proxy-req-handler.js');
var safeParse = require('../lib/util').safeParse;

var commands = {
    '/health': 'health',
    '/protocol/join': 'protocolJoin',
    '/protocol/ping': 'protocolPing',
    '/protocol/ping-req': 'protocolPingReq',
    '/proxy/req': 'proxyReq'
};

function RingPopTChannel(ringpop, tchannel) {
    this.ringpop = ringpop;
    this.tchannel = tchannel;

    var self = this;

    // Register admin endpoint handlers
    var endpointHandlers = require('./admin');
    Object.keys(endpointHandlers).forEach(function each(key) {
        var endpointHandler = endpointHandlers[key];
        registerEndpoint(endpointHandler.endpoint,
            endpointHandler.handler(ringpop));
    });

    // Register protocol and proxy endpoint handlers
    Object.keys(commands).forEach(function each(url) {
        registerEndpoint(url, self[commands[url]].bind(self));
    });

    // Wraps endpoint handler so that it doesn't have to
    // know TChannel req/res API.
    function registerEndpoint(url, handler) {
        tchannel.register(url, function (req, res, arg2, arg3) {
            handler(arg2, arg3, req.remoteAddr, onResponse);

            function onResponse(err, res1, res2) {
                res.headers.as = 'raw';
                if (err) {
                    res.sendNotOk(null, err.message);
                } else {
                    res.sendOk(res1, res2);
                }
            }
        });
    }
}

RingPopTChannel.prototype.health = function (arg1, arg2, hostInfo, cb) {
    cb(null, null, 'ok');
};

RingPopTChannel.prototype.protocolJoin = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2.toString());
    if (body === null) {
        return cb(new Error('need JSON req body with source and incarnationNumber'));
    }

    var app = body.app;
    var source = body.source;
    var incarnationNumber = body.incarnationNumber;
    if (app === undefined || source === undefined || incarnationNumber === undefined) {
        return cb(new Error('need req body with app, source and incarnationNumber'));
    }

    handleJoin({
        ringpop: this.ringpop,
        app: app,
        source: source,
        incarnationNumber: incarnationNumber
    }, function(err, res) {
        cb(err, null, JSON.stringify(res));
    });
};

RingPopTChannel.prototype.protocolPing = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2);

    // NOTE sourceIncarnationNumber is an optional argument. It was not present
    // until after the v9.8.12 release.
    if (body === null || !body.source || !body.changes || !body.checksum) {
        return cb(new Error('need req body with source, changes, and checksum'));
    }

    handlePing({
        ringpop: this.ringpop,
        source: body.source,
        sourceIncarnationNumber: body.sourceIncarnationNumber,
        changes: body.changes,
        checksum: body.checksum
    }, function(err, res) {
        cb(err, null, JSON.stringify(res));
    });
};

RingPopTChannel.prototype.protocolPingReq = function protocolPingReq(arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2);

    // NOTE sourceIncarnationNumber is an optional argument. It was not present
    // until after the v9.8.12 release.
    if (body === null || !body.source || !body.target || !body.changes || !body.checksum) {
        return cb(new Error('need req body with source, target, changes, and checksum'));
    }

    handlePingReq({
        ringpop: this.ringpop,
        source: body.source,
        sourceIncarnationNumber: body.sourceIncarnationNumber,
        target: body.target,
        changes: body.changes,
        checksum: body.checksum
    }, function onHandled(err, result) {
        cb(err, null, JSON.stringify(result));
    });
};

RingPopTChannel.prototype.proxyReq = function (arg1, arg2, hostInfo, cb) {
    var header = safeParse(arg1);
    if (header === null) {
        return cb(new Error('need header to exist'));
    }

    handleProxyReq({
        ringpop: this.ringpop,
        header: header,
        body: arg2
    }, cb);
};

function createServer(ringpop, tchannel) {
    return new RingPopTChannel(ringpop, tchannel);
}

module.exports = createServer;
