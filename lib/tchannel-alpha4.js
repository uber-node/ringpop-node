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

var recvPingReq = require('./swim/ping-req-recvr.js');
var parallel = require('run-parallel');
var safeParse = require('./util').safeParse;
var TChannelEndpointHandler = require('tchannel/endpoint-handler');

function RingPopTChannel(ringpop) {
    var self = this;
    self.ringpop = ringpop;
    // TODO:
    // - support self-method dispatch in tchannel/endpoint-handler (or a
    //   convenience subclass thereof)
    // - take away the legacy compat / binding layer here
    // - move away from url-like arg1 strings, just use method names
    var handler = TChannelEndpointHandler('ringpop');
    handler.register('/health', wrap('health'));
    handler.register('/admin/stats', wrap('adminStats'));
    handler.register('/admin/debugSet', wrap('adminDebugSet'));
    handler.register('/admin/debugClear', wrap('adminDebugClear'));
    handler.register('/admin/gossip', wrap('adminGossip'));
    handler.register('/admin/leave', wrap('adminLeave'));
    handler.register('/admin/join', wrap('adminJoin'));
    handler.register('/admin/reload', wrap('adminReload'));
    handler.register('/admin/tick', wrap('adminTick'));
    handler.register('/protocol/leave', wrap('protocolLeave'));
    handler.register('/protocol/join', wrap('protocolJoin'));
    handler.register('/protocol/ping', wrap('protocolPing'));
    handler.register('/protocol/ping-req', wrap('protocolPingReq'));
    handler.register('/proxy/req', wrap('proxyReq'));
    return handler;

    function wrap(method) {
        var func = self[method];
        if (!func) throw new Error('invalid method');
        return function wrapped(req, res, arg2, arg3) {
            func.call(self, arg2, arg3, req.remoteAddr, onResponse);
            function onResponse(err, res1, res2) {
                if (err) {
                    res.sendNotOk(null, err.message);
                } else {
                    res.sendOk(res1, res2);
                }
            }
        };
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

RingPopTChannel.prototype.adminLeave = function (arg1, arg2, hostInfo, cb) {
    this.ringpop.adminLeave(cb);
};

RingPopTChannel.prototype.adminJoin = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2.toString()) || {};
    if (body) {
        this.ringpop.adminJoin(function (err, candidateHosts) {
            if (err) {
                return cb(err);
            }
            cb(null, JSON.stringify({
                candidateHosts: candidateHosts
            }));
        });
    } else {
        cb(new Error('bad JSON in request'));
    }
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

    this.ringpop.protocolJoin({
        app: app,
        source: source,
        incarnationNumber: incarnationNumber
    }, function(err, res) {
        cb(err, null, JSON.stringify(res));
    });
};

RingPopTChannel.prototype.protocolLeave = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2);
    if (body === null || !body.node) {
        return cb(new Error('need req body with node'));
    }

    var node = body.node;

    this.ringpop.protocolLeave(node);

    // In response send back `coordinator` which is node
    // that handled leave request, aka this node. This will
    // not be obvious to the requester as the leave could
    // happen through haproxy.
    cb(null, null, JSON.stringify({
        coordinator: this.ringpop.whoami()
    }));
};

RingPopTChannel.prototype.protocolPing = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2);
    if (body === null || !body.source || !body.changes || !body.checksum) {
        return cb(new Error('need req body with source, changes, and checksum'));
    }

    this.ringpop.protocolPing({
        source: body.source,
        changes: body.changes,
        checksum: body.checksum
    }, function(err, res) {
        cb(err, null, JSON.stringify(res));
    });
};

RingPopTChannel.prototype.protocolPingReq = function protocolPingReq(arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2);
    if (body === null || !body.source || !body.target || !body.changes || !body.checksum) {
        return cb(new Error('need req body with source, target, changes, and checksum'));
    }

    recvPingReq({
        ringpop: this.ringpop,
        source: body.source,
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

    this.ringpop.handleIncomingRequest(header, arg2, cb);
};

function createRingPopTChannel(ringpop, tchannel) {
    if (!tchannel) tchannel = ringpop.channel;
    tchannel.handler = new RingPopTChannel(ringpop, tchannel);
    return ringpop;
}

exports.createRingPopTChannel = createRingPopTChannel;
