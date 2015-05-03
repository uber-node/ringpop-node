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

var recvAdminJoin = require('./admin-join-recvr.js');
var recvAdminLeave = require('./admin-leave-recvr.js');
var recvAdminSetUserData = require('./admin-set-user-data-recvr.js');
var recvJoin = require('./swim/join-recvr.js');
var recvPing = require('./swim/ping-recvr.js');
var recvPingReq = require('./swim/ping-req-recvr.js');
var recvProxyReq = require('./proxy-req-recvr.js');
var safeParse = require('./util').safeParse;

var commands = {
    '/health': 'health',

    '/admin/stats': 'adminStats',
    '/admin/debugSet': 'adminDebugSet',
    '/admin/debugClear': 'adminDebugClear',
    '/admin/gossip': 'adminGossip',
    '/admin/leave': 'adminLeave',
    '/admin/join': 'adminJoin',
    '/admin/reload': 'adminReload',
    '/admin/tick': 'adminTick',
    '/admin/userData/set': 'adminSetUserData',

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
    recvAdminLeave({
        ringpop: this.ringpop
    }, cb);
};

RingPopTChannel.prototype.adminJoin = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2.toString()) || {};

    if (!body) {
        cb(new Error('bad JSON in request'));
        return;
    }

    recvAdminJoin({
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

RingPopTChannel.prototype.adminSetUserData = function adminSetUserData(arg1, arg2, hostInfo, callback) {
    var body = safeParse(arg2.toString());

    if (!body) {
        callback(new Error('User data is required'));
        return;
    }

    recvAdminSetUserData({
        dissemination: this.ringpop.dissemination,
        userData: body
    }, callback);
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

    recvJoin({
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
    if (body === null || !body.source || !body.piggyback|| !body.checksum) {
        return cb(new Error('need req body with source, piggyback, and checksum'));
    }

    recvPing({
        ringpop: this.ringpop,
        source: body.source,
        checksum: body.checksum,
        piggyback: body.piggyback
    }, function(err, res) {
        cb(err, null, JSON.stringify(res));
    });
};

RingPopTChannel.prototype.protocolPingReq = function protocolPingReq(arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2);
    if (body === null || !body.source || !body.target || !body.piggyback || !body.checksum) {
        return cb(new Error('need req body with source, target, piggyback, and checksum'));
    }

    recvPingReq({
        ringpop: this.ringpop,
        source: body.source,
        target: body.target,
        piggyback: body.piggyback,
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

    recvProxyReq({
        ringpop: this.ringpop,
        header: header,
        body: arg2
    }, cb);
};

function createRingPopTChannel(ringpop, tchannel) {
    return new RingPopTChannel(ringpop, tchannel);
}

exports.createRingPopTChannel = createRingPopTChannel;
