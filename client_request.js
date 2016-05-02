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

var ClientRequestErrors = require('./client_request_errors.js');
var ClientRequestStates = require('./client_request_states.js');
var EventEmitter = require('events').EventEmitter;
var LoggingLevels = require('./lib/logging/levels.js');
var safeParse = require('./lib/util.js').safeParse;
var validateHostPort = require('./lib/util.js').validateHostPort;
var uuid = require('node-uuid');
var util = require('util');
var middleware = require('./lib/middleware');

/* jshint maxparams: 8 */
function ClientRequest(client, opts, endpoint, head, body, date, callback, middlewares) {
    this.client = client;
    this.opts = opts;
    this.endpoint = endpoint;
    this.head = head;
    this.body = body;
    this.date = date || Date;
    this.callback = callback;
    this.id = uuid.v4();
    this.isCanceled = false;
    this.state = ClientRequestStates.initialized;
    this.timestamp = this.date.now();
    this.middlewareStack = new middleware.MiddlewareStack(middlewares || []);
}

util.inherits(ClientRequest, EventEmitter);

ClientRequest.prototype.cancel = function cancel() {
    this.cancelTimestamp = this.date.now();
    this.isCanceled = true;
    this._invokeCallback(ClientRequestErrors.RequestCanceledError({
        endpoint: this.endpoint
    }));
};

ClientRequest.prototype.send = function send() {
    var self = this;
    var opts = this.opts;
    var endpoint = this.endpoint;
    var timeout = opts.timeout || 30000;
    var subChannel = this.client.subChannel;

    if (subChannel && subChannel.destroyed) {
        process.nextTick(function onTick() {
            self._invokeCallback(ClientRequestErrors.ChannelDestroyedError({
                endpoint: endpoint,
                channelType: 'subChannel'
            }));
        });
        return;
    }

    if (subChannel &&
            subChannel.topChannel &&
            subChannel.topChannel.destroyed) {
        process.nextTick(function onTick() {
            self._invokeCallback(ClientRequestErrors.ChannelDestroyedError({
                endpoint: endpoint,
                channelType: 'topChannel'
            }));
        });
        return;
    }

    if (!opts || !validateHostPort(opts.host)) {
        process.nextTick(function onTick() {
            self._invokeCallback(ClientRequestErrors.InvalidHostPortError({
                hostPort: String(opts && opts.host)
            }));
        });
        return;
    }

    self._changeState(ClientRequestStates.waitForIdentifiedPre);
    subChannel.waitForIdentified({
        host: opts.host
    }, function onIdentified(err) {
        self._changeState(ClientRequestStates.waitForIdentifiedPost);

        if (self.isCanceled) {
            self.client.logger.error('ringpop tchannel completed after request was canceled', {
                local: self.client.ringpop.whoami(),
                state: self.state,
                request: self.toLog()
            });
            self.emit('alreadyCanceled', ClientRequestErrors.WaitForIdentifiedAfterCancelError());
            return;
        }

        if (err) {
            self._invokeCallback(err);
            return;
        }

        self.middlewareStack.run(self, self.head, self.body,
            function subChannelRequest(req, arg2, arg3, callback) {
                self._changeState(ClientRequestStates.subChannelRequestPre);
                // Set stringified head/body as member variables
                // so we can log their size later.
                self.strHead = JSON.stringify(arg2);
                self.strBody = JSON.stringify(arg3);
                subChannel.request({
                    host: opts.host,
                    serviceName: 'ringpop',
                    hasNoParent: true,
                    retryLimit: opts.retryLimit || 0,
                    trace: false,
                    headers: {
                        as: 'raw',
                        cn: 'ringpop'
                    },
                    timeout: timeout
                }).send(endpoint, self.strHead, self.strBody, onSend);

                function onSend(err, res, arg2, arg3) {
                    self._changeState(ClientRequestStates.subChannelRequestPost);

                    if (self.isCanceled) {
                        self.client.logger.error('ringpop tchannel completed after request was canceled', {
                            local: self.client.ringpop.whoami(),
                            state: self.state,
                            request: self.toLog()
                        });
                        self.emit('alreadyCanceled', ClientRequestErrors.SubChannelRequestAfterCancelError());
                        return;
                    }

                    if (!err && !res.ok) {
                        err = safeParse(arg3) || new Error('Server Error');
                    }

                    if (err) {
                        callback(err, null, null);
                    } else {
                        callback(null, safeParse(arg3), null);
                    }
                }
            },
            function afterSubChannelRequest (req, err, res1) { // we don't use res2
                self._invokeCallback(err, res1);
            });
    });

};

ClientRequest.prototype.toLog = function toLog() {
    return {
        id: this.id,
        timestamp: this.timestamp,
        cancelTimestamp: this.cancelTimestamp,
        endpoint: this.endpoint,
        headSize: this.strHead ? new Buffer(this.strHead).length : 0,
        bodySize: this.strBody ? new Buffer(this.strBody).length : 0,
        state: this.state,
        isCanceled: this.isCanceled,
        timeout: this.timeout,
        timeToCancel: this.cancelTimestamp ?
            this.cancelTimestamp - this.timestamp : null
    };
};

ClientRequest.prototype._changeState = function _changeState(state) {
    var oldState = this.state;
    this.state = state;

    if (this.client.logger.canLogAt(LoggingLevels.debug)) {
        this.client.logger.debug('ringpop client request changed state', {
            local: this.client.ringpop.whoami(),
            oldState: oldState,
            newState: this.state,
            request: this.toLog()
        });
    }
};

ClientRequest.prototype._invokeCallback = function _invokeCallback() {
    var args = Array.prototype.splice.call(arguments, 0);

    // Callback is nullified after its first invocation.
    if (!this.callback) {
        this.client.logger.error('ringpop request callback already called', {
            local: this.client.ringpop.whoami(),
            // Log the first argument just in case it is TChannel trying to communicate
            // an error to us.
            err: args[0],
            request: this.toLog()
        });
        this.emit('alreadyCalled');
        return;
    }

    this.callback.apply(null, args);
    this.callback = null;
};

module.exports = ClientRequest;
