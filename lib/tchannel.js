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

    '/protocol/leave': 'protocolLeave',
    '/protocol/join': 'protocolJoin',
    '/protocol/ping': 'protocolPing',
    '/protocol/ping-req': 'protocolPingReq',

    '/proxy/req': 'proxyReq'
};

function RingPopTChannel(ringPop, tchannel) {
    this.ringPop = ringPop;
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
    cb(null, null, this.ringPop.getStats());
};

RingPopTChannel.prototype.adminDebugSet = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2.toString());
    if (body && body.debugFlag) {
        this.ringPop.setDebugFlag(body.debugFlag);
    }
    cb(null, null, 'ok');
};

RingPopTChannel.prototype.adminDebugClear = function (arg1, arg2, hostInfo, cb) {
    this.ringPop.clearDebugFlags();
    cb(null, null, 'ok');
};

RingPopTChannel.prototype.adminGossip = function (arg1, arg2, hostInfo, cb) {
    this.ringPop.gossip.start();
    cb(null, null, 'ok');
};

RingPopTChannel.prototype.adminLeave = function (arg1, arg2, hostInfo, cb) {
    this.ringPop.adminLeave(cb);
};

RingPopTChannel.prototype.adminJoin = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2.toString()) || {};
    if (body) {
        this.ringPop.adminJoin(body.target, function (err, candidateHosts) {
            if (err) {
                return cb(err);
            }
            cb(null, { candidateHosts: candidateHosts });
        });
    } else {
        cb(new Error('bad JSON in request'));
    }
};

RingPopTChannel.prototype.adminReload = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2.toString());
    if (body && body.file) {
        this.ringPop.reload(body.file, function(err) {
            cb(err);
        });
    }
};

RingPopTChannel.prototype.adminTick = function (arg1, arg2, hostInfo, cb) {
    this.ringPop.handleTick(function onTick(err, resp) {
        cb(err, null, resp);
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

    this.ringPop.protocolJoin({
        app: app,
        source: source,
        incarnationNumber: incarnationNumber
    }, function(err, res) {
        cb(err, null, res);
    });
};

RingPopTChannel.prototype.protocolLeave = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2);
    if (body === null || !body.node) {
        return cb(new Error('need req body with node'));
    }

    var node = body.node;

    this.ringPop.protocolLeave(node);

    // In response send back `coordinator` which is node
    // that handled leave request, aka this node. This will
    // not be obvious to the requester as the leave could
    // happen through haproxy.
    cb(null, null, { coordinator: this.ringPop.whoami() });
};

RingPopTChannel.prototype.protocolPing = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2);
    if (body === null || !body.source || !body.changes || !body.checksum) {
        return cb(new Error('need req body with source, changes, and checksum'));
    }

    this.ringPop.protocolPing({
        source: body.source,
        changes: body.changes,
        checksum: body.checksum
    }, function(err, res) {
        cb(err, null, res);
    });
};

RingPopTChannel.prototype.protocolPingReq = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2);
    if (body === null || !body.source || !body.target || !body.changes || !body.checksum) {
        return cb(new Error('need req body with source, target, changes, and checksum'));
    }

    this.ringPop.protocolPingReq({
        source: body.source,
        target: body.target,
        changes: body.changes,
        checksum: body.checksum
    }, function(err, result) {
        cb(err, null, result);
    });
};

RingPopTChannel.prototype.proxyReq = function (arg1, arg2, hostInfo, cb) {
    var header = safeParse(arg1);
    if (header === null) {
        return cb(new Error('need header to exist'));
    }

    this.ringPop.handleIncomingRequest(header, arg2, cb);
};

function createRingPopTChannel(ringPop, tchannel) {
    return new RingPopTChannel(ringPop, tchannel);
}

exports.createRingPopTChannel = createRingPopTChannel;
