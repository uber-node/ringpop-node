// Copyright (c) 2016 Uber Technologies, Inc.
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

var _ = require('underscore');
var Config = require('./config.js');
var ClientErrors = require('./client_errors.js');
var ClientRequest = require('./client_request.js');
var globalTimers = require('timers');
var RingpopErrors = require('./ringpop_errors.js');
var TChannel = require('tchannel');

/* jshint maxparams: 5 */
function RingpopClient(ringpop, subChannel, timers, date, middlewares) {
    this.ringpop = ringpop;
    this.subChannel = subChannel;
    this.timers = timers || globalTimers;
    this.date = date || Date;
    this.middlewares = middlewares || [];

    this.config = this.ringpop.config;
    this.logger = this.ringpop.loggerFactory.getLogger('client');

    // If no subChannel provided, create one from a new instance
    // of TChannel. This client then becomes the owner of that
    // instance and is responsible for closing.
    this.isChannelOwner = false;
    if (!this.subChannel) {
        this.tchannel = new TChannel();
        this.subChannel = this.tchannel.makeSubChannel({
            serviceName: 'ringpop',
            trace: false
        });
        this.isChannelOwner = true;
    }

    this.requestsById = {};
    this.wedgedTimer = null;
    this.isDestroyed = false;
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

    this.timers.clearTimeout(this.wedgedTimer);
    this.isDestroyed = true;
};

// This function is "public" for ease of testing, but shouldn't be called by
// anything other than the class itself.
RingpopClient.prototype.scanForWedgedRequests = function scanForWedgedRequests() {
    var wedgedRequests = [];

    // Find all requests that have not been timed-out by TChannel.
    // Induce Ringpop timeout for wedged requests and cancel them.
    var requestIds = Object.keys(this.requestsById);
    var scanTime = this.date.now();
    for (var i = 0; i < requestIds.length; i++) {
        var request = this.requestsById[requestIds[i]];
        var timeInflight = scanTime - request.timestamp;
        var isWedged = timeInflight >= (this.config.get('wedgedRequestTimeout') ||
            Config.Defaults.wedgedRequestTimeout);
        if (isWedged) {
            delete this.requestsById[request.id];
            request.cancel();
            wedgedRequests.push(request);
        }
    }

    if (wedgedRequests.length > 0) {
        this.logger.error('ringpop canceled wedged requests', {
            local: this.ringpop.whoami(),
            numWedgedRequests: wedgedRequests.length,
            wedgedRequests: wedgedRequestsToLog()
        });
        this._emitWedgedError();
    }

    return wedgedRequests;

    // Log the first N requests only. We don't want to flood
    // our pipes.
    function wedgedRequestsToLog() {
        return _.take(wedgedRequests, 10).map(function toLog(request) {
            return request.toLog();
        });
    }
};

RingpopClient.prototype._emitWedgedError = function _emitWedgedError() {
    var errorListeners = this.ringpop.listeners('error');
    if (errorListeners.length > 0) {
        this.ringpop.emit('error',
            RingpopErrors.PotentiallyWedgedRequestsError());
    }
};

RingpopClient.prototype._request = function _request(opts, endpoint, head, body, callback) {
    var self = this;

    if (!this.wedgedTimer) {
        this._scheduleWedgedTimer();
    }

    var request = new ClientRequest(this, opts, endpoint, head, body,
        this.date, onSend, this.middlewares);

    // Evaluate the number of inflight requests. If we've got more than the
    // allowable limit it's a strong indication that at least some are wedged.
    // Apply backpressure until the amount of inflight requests is reduced
    // by cancellation or otherwise.
    var inflightCurrent = Object.keys(this.requestsById).length;
    var inflightMax = this.config.get('inflightClientRequestsLimit');
    if (inflightCurrent >= inflightMax) {
        process.nextTick(function onTick() {
            callback(ClientErrors.ClientRequestsLimitError({
                inflightCurrent: inflightCurrent,
                inflightMax: inflightMax,
                endpoint: endpoint
            }));
        });
        return;
    }

    // Registering the request by its ID must happen at the precise
    // moment before we know it will be "inflight."
    this.requestsById[request.id] = request;
    request.send();

    function onSend() {
        delete self.requestsById[request.id];
        var args = Array.prototype.splice.call(arguments, 0);
        callback.apply(null, args);
    }
};

RingpopClient.prototype._scheduleWedgedTimer = function _scheduleWedgedTimer() {
    var self = this;
    this.wedgedTimer = this.timers.setTimeout(function onTimeout() {
        if (self.isDestroyed) return;
        self.scanForWedgedRequests();
        self._scheduleWedgedTimer();
    }, this.config.get('wedgedTimerInterval') || Config.Defaults.wedgedTimerInterval);
};

module.exports = RingpopClient;
