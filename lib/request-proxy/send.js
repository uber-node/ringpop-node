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
var numOrDefault = require('../util.js').numOrDefault;
var rawHead = require('./util.js').rawHead;
var strHead = require('./util.js').strHead;
var TypedError = require('error/typed');

var ChannelDestroyedError = TypedError({
    type: 'ringpop.request-proxy.channel-destroyed',
    message: 'Channel was destroyed before forwarding attempt'
});

var MaxRetriesExceeded = TypedError({
    type: 'ringpop.request-proxy.max-retries-exceeded',
    message: 'Max number of retries exceeded. {maxRetries} were attempted',
    maxRetries: null
});

var RetryDivergenceError = TypedError({
    type: 'ringpop.request-proxy.keys-diverged',
    message: 'Destinations for proxied request have diverged. These keys: \n' +
        ' {keys}, were originally intended for {origDestination}, but are\n' +
        ' now meant for {newDestinations}.',
    keys: null,
    origDestination: null,
    newDestinations: null
});

var RETRY_SCHEDULE = [0, 1, 3.5];

function logContext(send, opts) {
    return _.extend({
        local: send.ringpop.whoami(),
        destOrig: send.channelOpts.host,
        destinations: send.destinations,
        errors: send.errors,
        maxRetries: send.maxRetries,
        maxRetryTimeout: send.maxRetryTimeout,
        numRetries: send.numRetries,
        reqMethod: send.request.obj.method,
        reqUrl: send.request.obj.url,
        reqStartTime: send.reqStartTime,
        reqTotalTime: Date.now() - send.reqStartTime,
        retrySchedule: send.retrySchedule,
        retryStartTime: send.retryStartTime,
        retryTotalTime: Date.now() - send.retryStartTime,
    }, opts);
}

function RequestProxySend(opts) {
    this.ringpop = opts.ringpop;
    this.requestProxy = opts.requestProxy;
    this.keys = opts.keys;
    this.channelOpts = opts.channelOpts;
    this.request = opts.request;
    this.retries = opts.retries;

    this.retrySchedule = this.retries.schedule || RETRY_SCHEDULE;
    this.maxRetries = numOrDefault(this.retries.max, this.retrySchedule.length);
    this.maxRetryTimeout = this.retrySchedule[this.retrySchedule.length - 1] * 1000;
    this.skipLookupOnRetry = this.retries.skipLookup;

    this.destinations = [this.channelOpts.host];
    this.errors = [];
    this.numRetries = 0;
    this.reqStartTime = Date.now();
    this.retryStartTime = null;
    this.timeout = null;
}

RequestProxySend.prototype.abortOnKeyDivergence = function abortOnKeyDivergence(dests, callback) {
    this.ringpop.stat('increment', 'requestProxy.retry.aborted');
    this.ringpop.logger.warn('ringpop request proxy retry aborted after keys destinations diverged', logContext(this, {
        destNew: dests,
    }));

    this.ringpop.emit('requestProxy.retryAborted');

    callback(RetryDivergenceError({
        keys: this.keys,
        origDestination: this.channelOpts.host,
        newDestinations: dests
    }));
};

RequestProxySend.prototype.attemptRetry = function attemptRetry(callback) {
    this.numRetries++;

    var dests = this.skipLookupOnRetry ? [ this.channelOpts.host ] : this.lookupKeys(this.keys);

    // TODO Support this case too
    if (dests.length > 1) {
        this.abortOnKeyDivergence(dests, callback);
        return;
    }

    this.ringpop.stat('increment', 'requestProxy.retry.attempted');
    this.ringpop.emit('requestProxy.retryAttempted');

    var newDest = dests[0];

    // Nothing rebalanced.
    if (newDest === this.channelOpts.host) {
        this.send(this.channelOpts, callback);
        return;
    }

    this.rerouteRetry(newDest, callback);
};

RequestProxySend.prototype.destroy = function destroy() {
    clearTimeout(this.timeout);
};

RequestProxySend.prototype.getRawHead = function getRawHead() {
    return rawHead(this.request.obj, {
        checksum: this.ringpop.ring.checksum,
        keys: this.keys
    });
};

RequestProxySend.prototype.getStrHead = function getStrHead() {
    return strHead(this.request.obj, {
        checksum: this.ringpop.ring.checksum,
        keys: this.keys
    });
};

RequestProxySend.prototype.handleMaxRetriesExceeded = function handleMaxRetriesExceeded(callback) {
    this.ringpop.stat('increment', 'requestProxy.retry.failed');
    this.ringpop.logger.warn('ringpop request proxy retry exceeded max retries and failed', logContext(this));

    this.ringpop.emit('requestProxy.retryFailed');

    callback(MaxRetriesExceeded({
        maxRetries: this.maxRetries
    }));
};

RequestProxySend.prototype.handleSuccess = function handleSuccess(res1, res2, callback) {
    if (this.numRetries > 0) {
        this.ringpop.stat('increment', 'requestProxy.retry.succeeded');
        this.ringpop.logger.info('ringpop request proxy retry succeeded', logContext(this));

        this.ringpop.emit('requestProxy.retrySucceeded');
    }

    callback(null, res1, res2);
};

RequestProxySend.prototype.lookupKeys = function lookupKeys(keys) {
    var dests = {};

    for (var i = 0; i < keys.length; i++) {
        dests[this.ringpop.lookup(keys[i])] = true;
    }

    return Object.keys(dests);
};

RequestProxySend.prototype.rerouteRetry = function rerouteRetry(newDest, callback) {
    this.destinations.push(newDest);

    this.ringpop.logger.warn('ringpop request proxy retry rerouted', logContext(this, {
        destNew: newDest
    }));

    this.ringpop.emit('requestProxy.retryRerouted', this.channelOpts.host, newDest);

    if (newDest === this.ringpop.whoami()) {
        this.ringpop.stat('increment', 'requestProxy.retry.reroute.local');
        this.requestProxy.handleRequest(
            this.getRawHead(),
            this.request.body,
            callback
        );
        return;
    }

    this.ringpop.stat('increment', 'requestProxy.retry.reroute.remote');

    // NOTE Passes in different channel opts than all other calls to send
    this.send({
        host: newDest,
        timeout: this.channelOpts.timeout,
        endpoint: this.channelOpts.endpoint
    }, callback);
};

RequestProxySend.prototype.scheduleRetry = function scheduleRetry(callback) {
    var self = this;

    if (this.numRetries === 0) {
        this.retryStartTime = Date.now();
    }

    // `scheduleDelay` could result in NaN. If so, default to max.
    var scheduleDelay = this.retrySchedule[this.numRetries] * 1000;
    var delay = numOrDefault(scheduleDelay, this.maxRetryTimeout);

    // TODO Can we make this delay responsive/adaptive to previously
    // recorded cluster converge-times?
    this.timeout = this.ringpop.setTimeout(function onTimeout() {
        self.attemptRetry(callback);
    }, delay);

    this.ringpop.emit('requestProxy.retryScheduled');
};

RequestProxySend.prototype.send = function send(channelOpts, callback) {
    var self = this;

    if (this.ringpop.channel.destroyed) {
        process.nextTick(function onTick() {
            callback(ChannelDestroyedError());
        });
        return;
    }

    channelOpts.serviceName = 'ringpop';

    self.ringpop.channel.waitForIdentified({
        host: channelOpts.host
    }, function onRequest(err) {
        if (err) {
            return callback(err);
        }

        self.ringpop.channel.request(
            _.extend({
                hasNoParent: true,
                retryLimit: self.ringpop.config.get('tchannelRetryLimit'),
                headers: {
                    'as': 'raw',
                    'cn': 'ringpop'
                },
                timeout: 5000
            }, channelOpts)
        ).send(
            channelOpts.endpoint,
            self.getStrHead(),
            self.request.body,
            self.maxRetries === 0 ? onSendNoRetries : onSend
        );

        self.ringpop.emit('requestProxy.requestProxied');
    });

    function onSend(err, res, arg2, arg3) {
        if (!err && !res.ok) {
            err = new Error(String(arg3));
        }

        if (self.maxRetries === 0) {
            if (err) {
                callback(err, null, null);
            } else {
                callback(null, arg2, arg3);
            }
            return;
        }

        if (!err) {
            self.handleSuccess(arg2, arg3, callback);
            return;
        }

        self.errors.push(err);

        if (self.numRetries >= self.maxRetries) {
            self.handleMaxRetriesExceeded(callback);
            return;
        }

        self.scheduleRetry(callback);
    }

    function onSendNoRetries(err, res, arg2, arg3) {
        process.nextTick(function onTick() {
            if (!err && !res.ok) {
                err = new Error(String(arg3));
            }

            callback(err, arg2, arg3);
        });
    }
};

module.exports = function send(opts, callback) {
    // All properties of opts are request invariants
    // besides channelOpts. Therefore, channelOpts is explicitly
    // passed into the send function instead.
    var sender = new RequestProxySend(opts);
    sender.send(opts.channelOpts, callback);
    return sender;
};
