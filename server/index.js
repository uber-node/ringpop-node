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

var handleAdminJoin = require('./admin-join-handler.js');
var handleAdminLeave = require('./admin-leave-handler.js');
var handleAdminLookup = require('./admin-lookup-handler.js');
var handleJoin = require('./join-handler.js');
var handlePing = require('./ping-handler.js');
var handlePingReq = require('./ping-req-handler.js');
var handleProxyReq = require('./proxy-req-handler.js');
var safeParse = require('../lib/util').safeParse;

var commands = {
    '/health': 'health',

    '/admin/stats': 'adminStats',
    '/admin/debugSet': 'adminDebugSet',
    '/admin/debugClear': 'adminDebugClear',
    '/admin/gossip': 'adminGossip',
    '/admin/leave': 'adminLeave',
    '/admin/lookup': 'adminLookup',
    '/admin/join': 'adminJoin',
    '/admin/reload': 'adminReload',
    '/admin/tick': 'adminTick',

    '/protocol/join': 'protocolJoin',
    '/protocol/ping': 'protocolPing',
    '/protocol/ping-req': 'protocolPingReq',

    '/proxy/req': 'proxyReq'
};

function RingPopTChannel(ringpop, tchannel) {
    this.ringpop = ringpop;
    this.tchannel = tchannel;

    var self = this;

    Object.keys(commands).forEach(registerEndpoint);

    function registerEndpoint(url) {
        var methodName = commands[url];

        tchannel.register(url, self[methodName].bind(self));
    }
}

RingPopTChannel.prototype.health = function (arg1, arg2, hostInfo, cb) {
    cb(null, null, 'ok');
};

RingPopTChannel.prototype.adminStats = function (arg1, arg2, hostInfo, cb) {
    cb(null, null, JSON.stringify(this.ringpop.getStats()));
};

RingPopTChannel.prototype.adminDebugSet = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2.toString());
    if (body && body.debugFlag) {
        this.ringpop.setDebugFlag(body.debugFlag);
    }
    cb(null, null, 'ok');
};

RingPopTChannel.prototype.adminDebugClear = function (arg1, arg2, hostInfo, cb) {
    this.ringpop.clearDebugFlags();
    cb(null, null, 'ok');
};

RingPopTChannel.prototype.adminGossip = function (arg1, arg2, hostInfo, cb) {
    this.ringpop.gossip.start();
    cb(null, null, 'ok');
};

RingPopTChannel.prototype.adminLeave = function adminLeave(arg1, arg2, hostInfo, cb) {
    handleAdminLeave({
        ringpop: this.ringpop
    }, cb);
};

RingPopTChannel.prototype.adminLookup = function adminLookup(arg1, arg2, hostInfo, cb) {
    handleAdminLookup({
        ringpop: this.ringpop,
        key: arg2.toString()
    }, cb);
};

RingPopTChannel.prototype.adminJoin = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2.toString()) || {};

    if (!body) {
        cb(new Error('bad JSON in request'));
        return;
    }

    handleAdminJoin({
        ringpop: this.ringpop
    }, function onAdminJoin(err, candidateHosts) {
        if (err) {
            return cb(err);
        }
        cb(null, JSON.stringify({
            candidateHosts: candidateHosts
        }));
    });
};

RingPopTChannel.prototype.adminReload = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2.toString());
    if (body && body.file) {
        this.ringpop.reload(body.file, function(err) {
            cb(err);
        });
    }
};

RingPopTChannel.prototype.adminTick = function (arg1, arg2, hostInfo, cb) {
    this.ringpop.handleTick(function onTick(err, resp) {
        cb(err, null, JSON.stringify(resp));
    });
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
