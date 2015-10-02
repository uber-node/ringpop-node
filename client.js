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
var TChannel = require('tchannel');

function RingpopClient(subChannel) {
    this.subChannel = subChannel;
    this.isChannelOwner = false;
    if (!this.subChannel) {
        this.tchannel = new TChannel();
        this.subChannel = this.tchannel.makeSubChannel({
            serviceName: 'ringpop'
        });
        this.isChannelOwner = true;
    }
}

RingpopClient.prototype.adminConfigGet = function adminConfigGet(host, body, callback) {
    this._request(host, '/admin/config/get', null, body, callback);
};

RingpopClient.prototype.adminConfigSet = function adminConfigSet(host, body, callback) {
    this._request(host, '/admin/config/set', null, body, callback);
};

RingpopClient.prototype.adminGossipStart = function adminGossipStart(host, callback) {
    this._request(host, '/admin/gossip/start', null, null, callback);
};

RingpopClient.prototype.adminGossipStop = function adminGossipStop(host, callback) {
    this._request(host, '/admin/gossip/stop', null, null, callback);
};

RingpopClient.prototype.adminGossipTick = function adminGossipTick(host, callback) {
    this._request(host, '/admin/gossip/tick', null, null, callback);
};

RingpopClient.prototype.protocolDampReq = function protocolDampReq(host, body, callback) {
    this._request(host, '/protocol/damp-req', null, body, callback);
};

RingpopClient.prototype.destroy = function destroy(callback) {
    if (this.isChannelOwner) {
        this.tchannel.close(callback);
    }
};

/* jshint maxparams: 5 */
RingpopClient.prototype._request = function _request(host, endpoint, head, body, callback) {
    var self = this;
    this.subChannel.waitForIdentified({
        host: host
    }, function onIdentified(err) {
        if (err) {
            callback(err);
            return;
        }

        self.subChannel.request({
            host: host,
            serviceName: 'ringpop',
            hasNoParent: true,
            retryLimit: 1,
            trace: false,
            headers: {
                as: 'raw',
                cn: 'ringpop'
            }
        }).send(endpoint, JSON.stringify(head), JSON.stringify(body), onSend);
    });

    function onSend(err, res, arg2, arg3) {
        if (err) {
            callback(err);
            return;
        }

        callback(null, safeParse(arg3));
    }
};

module.exports = RingpopClient;
