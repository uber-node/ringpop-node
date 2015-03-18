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

var path = require('path');
var recvAdminJoin = require('./admin-join-recvr.js');
var recvAdminLeave = require('./admin-leave-recvr.js');
var recvJoin = require('./swim/join-recvr.js');
var recvPing = require('./swim/ping-recvr.js');
var recvPingReq = require('./swim/ping-req-recvr.js');
var recvProxyReq = require('./proxy-req-recvr.js');
var safeParse = require('./util').safeParse;
var TChannelAsThrift = require('tchannel/as/thrift');
var thriftify = require('thriftify');

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

    '/proxy/req': 'proxyReq'
};

function ThriftError(err) {
    this.ok = false;
    this.body = err;
}

function ThriftResponse(body) {
    this.ok = true;
    this.body = body;
}

function initThriftChannel(opts) {
    // TODO Error handling
    var thriftSpec = thriftify.readSpecSync(
        opts.thriftSpecFile || path.join(__dirname, '..', './ringpop.thrift'));

    return new TChannelAsThrift({
        spec: thriftSpec
    });
}

function protocolJoinHandler(ringpop) {
    /* jshint maxparams:5 */
    return function handleIt(opts, req, head, body, callback) {
        if (!body) {
            // TODO Typed Error
            callback(new Error('body is required'));
            return;
        }

        if (!body.app || !body.source || !body.incarnationNumber) {
            // TODO Typed Error
            callback(new Error('app, source, incarnationNumber are all required'));
            return;
        }

        recvJoin({
            ringpop: ringpop,
            app: body.app,
            source: body.source,
            incarnationNumber: body.incarnationNumber
        }, thriftCallback(callback));
    };
}

function protocolPingHandler(ringpop) {
    /* jshint maxparams:5 */
    return function handleIt(opts, req, head, body, callback) {
        if (!body) {
            // TODO Typed error
            callback(new Error('body is required'));
            return;
        }

        if (!body.changes || !body.checksum) {
            // TODO Typed error
            callback(new Error('changes, checksum are all required'));
            return;
        }

        recvPing({
            ringpop: ringpop,
            changes: body.changes,
            checksum: body.checksum
        }, thriftCallback(callback));
    };
}

function protocolPingReqHandler(ringpop) {
    /* jshint maxparams:5 */
    return function handleIt(opts, req, head, body, callback) {
        if (!body) {
            // TODO Typed error
            callback(new Error('body is required'));
            return;
        }

        if (!body.target || !body.changes || !body.checksum) {
            // TODO Typed error
            callback(new Error('target, changes, checksum are all required'));
            return;
        }

        recvPingReq({
            ringpop: ringpop,
            target: body.target,
            changes: body.changes,
            checksum: body.checksum
        }, thriftCallback(callback));
    };
}

function registerThriftHandlers(ringpop, tchannel, tchannelAsThrift) {
    var thriftHandlers = {
        'Ringpop::join': protocolJoinHandler(ringpop),
        'Ringpop::ping': protocolPingHandler(ringpop),
        'Ringpop::pingReq': protocolPingReqHandler(ringpop)
    };

    Object.keys(thriftHandlers).forEach(function eachDef(def) {
        tchannelAsThrift.register(tchannel, def, null,
            thriftHandlers[def]);
    });
}

function thriftCallback(callback) {
    return function onCallback(err, res) {
        if (err) {
            callback(null, new ThriftError(err));
            return;
        }

        callback(null, new ThriftResponse(res));
    };
}

function RingPopTChannel(opts) {
    this.ringpop = opts.ringpop;
    this.tchannel = opts.channel;
    // hack to disable retries until we reconcile wrt them
    this.tchannel.requestDefaults.retryLimit = 1;
    this.tchannelAsThrift = initThriftChannel(opts);

    var self = this;

    // Register non-Thrift handlers
    Object.keys(commands).forEach(registerEndpoint);

    function registerEndpoint(url) {
        var methodName = commands[url];

        self.tchannel.register(url, function (req, res, arg2, arg3) {
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

    registerThriftHandlers(this.ringpop, this.tchannel, this.tchannelAsThrift);
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

RingPopTChannel.prototype.destroy = function destroy() {
    // HACK remove double destroy gaurd.
    if (this.tchannel &&
        !this.tchannel.topChannel &&
        !this.tchannel.destroyed) {
        this.tchannel.close();
    }
};

// Convenience functions to hide away the endpoint name
// conventions and Thrift details from callers.
RingPopTChannel.prototype.join = function join(opts, callback) {
    this.send('Ringpop::join', opts, callback);
};

RingPopTChannel.prototype.ping = function ping(opts, callback) {
    this.send('Ringpop::ping', opts, callback);
};

RingPopTChannel.prototype.pingReq = function pingReq(opts, callback) {
    this.send('Ringpop::pingReq', opts, callback);
};

RingPopTChannel.prototype.send = function send(endpoint, opts, callback) {
    var request = this.tchannel.request({
        host: opts.host,
        timeout: opts.timeout,
        serviceName: 'ringpop'
    });

    this.tchannelAsThrift.send(request, endpoint, opts.head,
        opts.body, onSend);

    function onSend(err, res) {
        if (!err && !res.ok) {
            err = res.body;
        }

        if (err) {
            callback(err);
            return;
        }

        callback(null, res.body);
    }
};

function createRingPopTChannel(opts) {
    return new RingPopTChannel(opts);
}

exports.createRingPopTChannel = createRingPopTChannel;
