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

var safeParse = require('./lib/util.js').safeParse;
var validateHostPort = require('./lib/util.js').validateHostPort;
var TChannel = require('tchannel');
var TypedError = require('error/typed');

var ChannelDestroyedError = TypedError({
    type: 'ringpop.client.channel-destroyed',
    message: 'Channel is already destroyed',
    endpoint: null,
    channelType: null
});

var InvalidHostPortError = TypedError({
    type: 'ringpop.client.invalid-hostport',
    message: 'Request made with invalid host port combination ({hostPort})',
    hostPort: null
});

function RingpopClient(subChannel) {
    this.subChannel = subChannel;
    this.isChannelOwner = false;
    if (!this.subChannel) {
        this.tchannel = new TChannel();
        this.subChannel = this.tchannel.makeSubChannel({
            serviceName: 'ringpop',
            trace: false
        });
        this.isChannelOwner = true;
    }
}

RingpopClient.prototype.adminConfigGet = function adminConfigGet(host, body, callback) {
    this._request({
        host: host
    }, '/admin/config/get', null, body, callback);
};

RingpopClient.prototype.adminConfigSet = function adminConfigSet(host, body, callback) {
    this._request({
        host: host
    }, '/admin/config/set', null, body, callback);
};

RingpopClient.prototype.adminGossipStart = function adminGossipStart(host, callback) {
    this._request({
        host: host
    }, '/admin/gossip/start', null, null, callback);
};

RingpopClient.prototype.adminGossipStop = function adminGossipStop(host, callback) {
    this._request({
        host: host
    }, '/admin/gossip/stop', null, null, callback);
};

RingpopClient.prototype.adminGossipTick = function adminGossipTick(host, callback) {
    this._request({
        host: host
    }, '/admin/gossip/tick', null, null, callback);
};

RingpopClient.prototype.protocolJoin = function protocolJoin(opts, body, callback) {
    this._request(opts, '/protocol/join', null, body, callback);
};

RingpopClient.prototype.protocolPing = function protocolPing(opts, body, callback) {
    this._request(opts, '/protocol/ping', null, body, callback);
};

RingpopClient.prototype.protocolPingReq = function protocolPingReq(opts, body, callback) {
    this._request(opts, '/protocol/ping-req', null, body, callback);
};

RingpopClient.prototype.protocolDampReq = function protocolDampReq(opts, body, callback) {
    this._request(opts, '/protocol/damp-req', null, body, callback);
};

RingpopClient.prototype.destroy = function destroy(callback) {
    if (this.isChannelOwner) {
        this.tchannel.close(callback);
    }
};

/* jshint maxparams: 5 */
RingpopClient.prototype._request = function _request(opts, endpoint, head, body, callback) {
    var self = this;

    if (this.subChannel && this.subChannel.destroyed) {
        process.nextTick(function onTick() {
            callback(ChannelDestroyedError({
                endpoint: endpoint,
                channelType: 'subChannel'
            }));
        });
        return;
    }

    if (this.subChannel &&
            this.subChannel.topChannel &&
            this.subChannel.topChannel.destroyed) {
        process.nextTick(function onTick() {
            callback(ChannelDestroyedError({
                endpoint: endpoint,
                channelType: 'topChannel'
            }));
        });
        return;
    }

    if (!opts || !validateHostPort(opts.host)) {
        callback(InvalidHostPortError({
            hostPort: String(opts && opts.host)
        }));
        return;
    }

    self.subChannel.waitForIdentified({
        host: opts.host
    }, function onIdentified(err) {
        if (err) {
            callback(err);
            return;
        }

        self.subChannel.request({
            host: opts.host,
            serviceName: 'ringpop',
            hasNoParent: true,
            retryLimit: opts.retryLimit || 0,
            trace: false,
            headers: {
                as: 'raw',
                cn: 'ringpop'
            },
            timeout: opts.timeout || 30000
        }).send(endpoint, JSON.stringify(head), JSON.stringify(body), onSend);
    });

    function onSend(err, res, arg2, arg3) {
        if (!err && !res.ok) {
            err = safeParse(arg3) || new Error('Server Error');
        }

        if (err) {
            callback(err);
            return;
        }

        callback(null, safeParse(arg3));
    }
};

module.exports = RingpopClient;
