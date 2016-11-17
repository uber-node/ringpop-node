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

var body = require('body');
var hammock = require('hammock');
var numOrDefault = require('../util.js').numOrDefault;
var PassThrough = require('stream').PassThrough;
var safeParse = require('../util.js').safeParse;
var sendRequest = require('./send.js');
var TypedError = require('error/typed');

var HTTP_TOO_MANY_REQUESTS = 429;
// Very very slight optimization, but there's no reason
// to stringify the headers for every ingress request when
// backpressure is applied. Once is enough.
var INGRESS_BACKPRESSURE_HEAD = JSON.stringify({
    statusCode: HTTP_TOO_MANY_REQUESTS
});
var InvalidCheckSumError = TypedError({
    type: 'ringpop.request-proxy.invalid-checksum',
    message: 'Expected the remote checksum to match local ' +
            'checksum.\n' +
        'The expected checksum ({expected}) did not match ' +
            'actual checksum ({actual}).\n',
    actual: null,
    expected: null
});
var InvalidKeyError = TypedError({
    type: 'ringpop.request-proxy.invalid-key',
    message: 'Expected the local node to resolve to the forwarded key.\n' +
             'A lookup resulted in {target} instead of {whoami}.',
    target: null,
    whoami: null
});
var TooManyRequestsError = TypedError({
    type: 'ringpop.request-proxy.too-many-requests',
    message: 'The number of inflight requests have exceeded a maximum of {max} at {egressOrIngress}',
    statusCode: HTTP_TOO_MANY_REQUESTS,
    max: null,
    egressOrIngress: null,
    metric: null
});

module.exports = RequestProxy;

function RequestProxy(opts) {
    this.ringpop = opts.ringpop;
    this.retrySchedule = opts.retrySchedule;
    this.maxRetries = opts.maxRetries;

    // enforceConsistency enforces ring concistencty
    this.enforceConsistency = opts.enforceConsistency === undefined ? true : opts.enforceConsistency;
    // defaults to false for backwards compatibility
    this.enforceKeyConsistency = opts.enforceKeyConsistency === undefined ? false : opts.enforceKeyConsistency;

    this.sends = [];

    // Tracks number of inflight requests at both ingress (handleRequest())
    // and egress (proxyReq()).
    this.numInflightRequests = 0;
}

RequestProxy.prototype.removeSend = function removeSend(send) {
    var indexOf = this.sends.indexOf(send);

    if (indexOf !== -1) {
        this.sends.splice(indexOf, 1);
    }

    send.destroy();
};

RequestProxy.prototype.destroy = function destroy() {
    this.sends.forEach(function eachSend(send) {
        send.destroy();
    });

    this.sends = [];
};

RequestProxy.prototype.proxyReq = function proxyReq(opts) {
    this.ringpop.stat('increment', 'requestProxy.egress');

    var self = this;
    var keys = opts.keys;
    var dest = opts.dest;
    var req = opts.req;
    var res = opts.res;

    // Request-level overrides (see ctor).
    var maxRetries = opts.maxRetries;
    var retrySchedule = opts.retrySchedule;
    var endpoint = opts.endpoint || '/proxy/req';
    var timeout = opts.timeout ?
        opts.timeout : this.ringpop.proxyReqTimeout;

    var tooManyErr = this._shouldRespondWithTooManyReqs('egress');
    if (tooManyErr) {
        sendError(res, tooManyErr);
        return;
    }

    this._incrementInflightRequests();

    body(req, res, {
        cache: true,
        limit: opts.bodyLimit
    }, onBody);

    function onBody(err, rawBody) {
        if (err) {
            self.ringpop.logger.warn('requestProxy encountered malformed body', {
                error: err,
                url: req.url
            });
            self._decrementInflightRequests();
            sendError(res, err);
            return;
        }

        self.ringpop.logger.trace('requestProxy sending tchannel proxy req', {
            url: req.url
        });

        var send = sendRequest({
            ringpop: self.ringpop,
            requestProxy: self,
            keys: keys,
            channelOpts: {
                host: dest,
                timeout: timeout,
                endpoint: endpoint
            },
            request: {
                obj: req,
                body: rawBody
            },
            retries: {
                max: numOrDefault(maxRetries, self.maxRetries),
                schedule: retrySchedule || self.retrySchedule,
                skipLookup: opts.skipLookupOnRetry
            }
        }, function () {
            var args = arguments;
            var self = this;

            process.nextTick(function () {
                onProxy.apply(self, args);
            });
        });

        self.sends.push(send);

        function onProxy(err, res1, res2) {
            self.removeSend(send);
            self._decrementInflightRequests();

            if (err) {
                self.ringpop.stat('increment', 'requestProxy.send.error');
                self.ringpop.logger.warn('requestProxy got error from tchannel', {
                    error: err,
                    url: req.url
                });
                return sendError(res, err);
            }

            self.ringpop.stat('increment', 'requestProxy.send.success');

            var responseHead = safeParse(res1) || {};

            if (responseHead.headers) {
                Object.keys(responseHead.headers)
                    .forEach(function setHeader(key) {
                        res.setHeader(key, responseHead.headers[key]);
                    });
            }

            self.ringpop.logger.trace('requestProxy writing response', {
                url: req.url
            });

            res.statusCode = responseHead.statusCode || 200;
            res.end(res2);
        }
    }
};

RequestProxy.prototype.handleRequest = function handleRequest(head, body, cb) {
    this.ringpop.stat('increment', 'requestProxy.ingress');

    var self = this;
    var ringpop = this.ringpop;
    var url = head.url;
    var headers = head.headers;
    var method = head.method;
    var httpVersion = head.httpVersion;
    var checksum = head.ringpopChecksum;
    var keys = head.ringpopKeys || []; // default to an empty array in case the keys are missing from the request.
    var err;

    // The check here will validate the consistency of both hashrings for this
    // node and the node that forwarded the request here. If it is configured
    // that the rings need to be consistent during forwarding it will respond
    // with an error and prevent execution of the forwarded request. Either way
    // it will always emit a stat if there are inconsistencies between the rings
    if (checksum !== ringpop.ring.checksum) {
        err = InvalidCheckSumError({
            expected: ringpop.ring.checksum,
            actual: checksum
        });
        ringpop.logger.warn('handleRequest got invalid checksum', {
            error: err,
            url: url,
            enforceConsistency: this.enforceConsistency
        });
        ringpop.emit('requestProxy.checksumsDiffer');
        this.ringpop.stat('increment', 'requestProxy.checksumsDiffer');
        if (this.enforceConsistency) {
            return cb(err);
        }
    }

    // The check here will validate ownership of the forwarded keys. If it is
    // configured that the keys need to be consistent during forwarding it will
    // respond with an error and prevent execution of the forwarded request.
    // Either way it will always emit a stat if there are inconsistencies
    // between the keys
    var whoami = ringpop.whoami();
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var target = ringpop.lookup(key);

        if (target !== whoami) {
            err = InvalidKeyError({
                target: target,
                whoami: whoami
            });

            ringpop.logger.warn('handleRequest got invalid key', {
                error: err,
                url: url,
                enforceKeyConsistency: this.enforceKeyConsistency
            });

            ringpop.emit('requestProxy.keysDiffer');
            ringpop.stat('increment', 'requestProxy.keysDiffer');

            if (this.enforceKeyConsistency) {
                return cb(err);
            }

            // make sure only 1 stat/log is emitted per call to not skew with
            // ratio results if there are multiple keys in the call that don't
            // match.
            break;
        }
    }

    var httpRequest = new PassThrough();
    httpRequest.url = url;
    httpRequest.headers = headers;
    httpRequest.method = method;
    httpRequest.httpVersion = httpVersion;
    httpRequest.end(body);

    var tooManyErr = this._shouldRespondWithTooManyReqs('ingress');
    if (tooManyErr) {
        cb(null, INGRESS_BACKPRESSURE_HEAD, JSON.stringify(tooManyErr));
        return;
    }

    this._incrementInflightRequests();

    var httpResponse = hammock.Response(onResponse);
    ringpop.emit('request', httpRequest, httpResponse, head);

    function onResponse(err, resp) {
        self._decrementInflightRequests();

        if (err) {
            ringpop.logger.warn('handleRequest got response error', {
                error: err,
                url: url
            });
            return cb(err);
        }

        var responseHead = JSON.stringify({
            statusCode: resp.statusCode,
            headers: resp.headers
        });

        ringpop.logger.trace('handleRequest sending response over tchannel', {
            url: url
        });

        cb(null, responseHead, resp.body);
    }
};

RequestProxy.prototype._decrementInflightRequests = function _decrementInflightRequests() {
    this.numInflightRequests--;
    if (this.numInflightRequests < 0) {
        // We miscounted number of inflight requests. Correct by setting to min.
        this.ringpop.stat('increment', 'requestProxy.miscount.decrement');
        this.numInflightRequests = 0;
    }

    this.ringpop.stat('gauge', 'requestProxy.inflight',
        this.numInflightRequests);
};

RequestProxy.prototype._incrementInflightRequests = function _incrementInflightRequests() {
    this.numInflightRequests++;
    var max = this.ringpop.config.get('maxInflightRequests');
    if (this.numInflightRequests > max) {
        // We miscounted number of inflight requests. Correct by setting to max.
        this.ringpop.stat('increment', 'requestProxy.miscount.increment');
        this.numInflightRequests = max;
    }

    this.ringpop.stat('gauge', 'requestProxy.inflight',
        this.numInflightRequests);
};

RequestProxy.prototype._hasExceededMaxInflightRequests =
        function _hasExceededMaxInflightRequests() {
    var config = this.ringpop.config;
    var backpressureEnabled = config.get('backpressureEnabled');
    var max = config.get('maxInflightRequests');

    // We add one to the current number of inflight requests to account for
    // the current request for which we are evaluating against the maximum.
    return backpressureEnabled && (this.numInflightRequests + 1) > max;
};

RequestProxy.prototype._hasExceededMaxEventLoopLag =
        function _hasExceededMaxEventLoopLag() {
    var config = this.ringpop.config;
    var backpressureEnabled = config.get('backpressureEnabled');
    var max = config.get('maxEventLoopLag');
    return backpressureEnabled && this.ringpop.lagSampler.currentLag > max;
};

RequestProxy.prototype._shouldRespondWithTooManyReqs =
        function _shouldRespondWithTooManyReqs(egressOrIngress) {
    if (this._hasExceededMaxInflightRequests()) {
        this.ringpop.stat('increment', 'requestProxy.refused.inflight');
        return new TooManyRequestsError({
            egressOrIngress: egressOrIngress,
            max: this.ringpop.config.get('maxInflightRequests'),
            metric: 'inflight'
        });
    }

    if (this._hasExceededMaxEventLoopLag()) {
        this.ringpop.stat('increment', 'requestProxy.refused.eventloop');
        return new TooManyRequestsError({
            egressOrIngress: egressOrIngress,
            max: this.ringpop.config.get('maxEventLoopLag'),
            metric: 'eventloop'
        });
    }

    // No back pressure.
    return null;
};

function sendError(res, err) {
    res.statusCode = err.statusCode || 500;
    res.end(err.message);
}
