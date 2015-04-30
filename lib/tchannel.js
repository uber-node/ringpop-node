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
var recvJoin = require('./swim/join-recvr.js');
var recvPing = require('./swim/ping-recvr.js');
var recvPingReq = require('./swim/ping-req-recvr.js');
var recvProxyReq = require('./proxy-req-recvr.js');
var safeParse = require('./util').safeParse;
var TChannelAsThrift = require('tchannel/as/thrift');
var thriftify = require('thriftify');

var endpointDefs = {
    '/admin/stats': 'adminStats',
    '/admin/debugSet': 'adminDebugSet',
    '/admin/debugClear': 'adminDebugClear',
    '/admin/gossip': 'adminGossip',
    '/admin/leave': 'adminLeave',
    '/admin/join': 'adminJoin',
    '/admin/reload': 'adminReload',
    '/admin/tick': 'adminTick',
    '/health': 'health',
    '/protocol/ping': 'protocolPing',
    '/protocol/ping-req': 'protocolPingReq',
    '/proxy/req': 'proxyReq'
};

function ThriftResponse(body) {
    this.ok = true;
    this.body = body;
}

function thriftCallback(callback) {
    return function onCallback(err, res) {
        if (err) {
            callback(err);
            return;
        }

        callback(null, new ThriftResponse(res));
    }
}

function TChannelWrapper(opts) {
    this.ringpop = opts.ringpop;
    this.tchannel = opts.channel;
    this.tchannelAsThrift = new TChannelAsThrift({
        spec: thriftify.readSpecSync(opts.thriftSpecFile || './ringpop.thrift')
    });

    // hack to disable retries until we reconcile wrt them
    this.tchannel.requestDefaults.retryLimit = 1;

    var self = this;

    Object.keys(endpointDefs).forEach(registerEndpoint);

    function registerEndpoint(endpoint) {
        var methodName = endpointDefs[endpoint];

        self.tchannel.register(endpoint, function (req, res, arg2, arg3) {
            self[methodName](arg2, arg3, req.remoteAddr, onResponse);

            function onResponse(err, res1, res2) {
                if (err) {
                    res.sendNotOk(null, err.message);
                } else {
                    res.sendOk(res1, res2);
                }
            }
        });
    }

    this.tchannelAsThrift.register(this.tchannel, 'Ringpop::join', opts,
        protocolJoinHandler(this.ringpop));
    this.tchannelAsThrift.regi
}

function protocolJoinHandler(ringpop) {
    return function handleIt(opts, req, head, body, callback) {
        if (!body) {
            // TODO Typed Error
            callback(new Error('body is required'));
            return;
        }

        var app = body.app;
        var source = body.source;
        var incarnationNumber = body.incarnationNumber;

        if (!app || !source || !incarnationNumber) {
            // TODO Typed Error
            callback(new Error('app, source, incarnationNumber are all required'));
            return;
        }

        recvJoin({
            ringpop: ringpop,
            app: app,
            source: source,
            incarnationNumber: incarnationNumber
        }, thriftCallback(callback));
    };
}

TChannelWrapper.prototype.health = function (arg1, arg2, hostInfo, cb) {
    cb(null, null, 'ok');
};

TChannelWrapper.prototype.adminStats = function (arg1, arg2, hostInfo, cb) {
    cb(null, null, JSON.stringify(this.ringpop.getStats()));
};

TChannelWrapper.prototype.adminDebugSet = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2.toString());
    if (body && body.debugFlag) {
        this.ringpop.setDebugFlag(body.debugFlag);
    }
    cb(null, null, 'ok');
};

TChannelWrapper.prototype.adminDebugClear = function (arg1, arg2, hostInfo, cb) {
    this.ringpop.clearDebugFlags();
    cb(null, null, 'ok');
};

TChannelWrapper.prototype.adminGossip = function (arg1, arg2, hostInfo, cb) {
    this.ringpop.gossip.start();
    cb(null, null, 'ok');
};

TChannelWrapper.prototype.adminLeave = function adminLeave(arg1, arg2, hostInfo, cb) {
    recvAdminLeave({
        ringpop: this.ringpop
    }, cb);
};

TChannelWrapper.prototype.adminJoin = function (arg1, arg2, hostInfo, cb) {
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

TChannelWrapper.prototype.adminReload = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2.toString());
    if (body && body.file) {
        this.ringpop.reload(body.file, function(err) {
            cb(err);
        });
    }
};

TChannelWrapper.prototype.adminTick = function (arg1, arg2, hostInfo, cb) {
    this.ringpop.handleTick(function onTick(err, resp) {
        cb(err, null, JSON.stringify(resp));
    });
};

TChannelWrapper.prototype.protocolLeave = function (arg1, arg2, hostInfo, cb) {
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

TChannelWrapper.prototype.protocolPing = function (arg1, arg2, hostInfo, cb) {
    var body = safeParse(arg2);
    if (body === null || !body.source || !body.changes || !body.checksum) {
        return cb(new Error('need req body with source, changes, and checksum'));
    }

    recvPing({
        ringpop: this.ringpop,
        source: body.source,
        changes: body.changes,
        checksum: body.checksum
    }, function(err, res) {
        cb(err, null, JSON.stringify(res));
    });
};

TChannelWrapper.prototype.protocolPingReq = function protocolPingReq(arg1, arg2, hostInfo, cb) {
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

TChannelWrapper.prototype.proxyReq = function (arg1, arg2, hostInfo, cb) {
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

TChannelWrapper.prototype.destroy = function destroy() {
    // HACK remove double destroy gaurd.
    if (this.tchannel &&
        !this.tchannel.topChannel &&
        !this.tchannel.destroyed) {
        this.tchannel.close();
    }
};

TChannelWrapper.prototype.join = function join(opts, callback) {
    this.send('Ringpop::join', opts, callback);
};

TChannelWrapper.prototype.send = function send(endpoint, opts, callback) {
    var request = this.tchannel.request({
        host: opts.host,
        timeout: opts.timeout
    });

    this.tchannelAsThrift.send(request, endpoint, opts.head,
        opts.body, onSend);

    function onSend(err, res) {
        if (!err && !res.ok) {
            err = new Error(String(res.body));
        }

        if (err) {
            callback(err);
            return;
        }

        callback(null, res.body);
    }
};

module.exports = function createTChannelWrapper(opts) {
    return new TChannelWrapper(opts);
};
