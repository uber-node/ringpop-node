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

var body = require('body');
var hammock = require('uber-hammock');
var numOrDefault = require('../util.js').numOrDefault;
var PassThrough = require('stream').PassThrough;
var safeParse = require('../util.js').safeParse;
var sendRequest = require('./send.js');
var TypedError = require('error/typed');

var InvalidCheckSumError = TypedError({
    type: 'ringpop.request-proxy.invalid-checksum',
    message: 'Expected the remote checksum to match local ' +
            'checksum.\n' +
        'The expected checksum ({expected}) did not match ' +
            'actual checksum ({actual}).\n',
    actual: null,
    expected: null
});

var HTTP_TOO_MANY_REQUESTS = 429;
var TooManyRequestsError = TypedError({
    type: 'ringpop.request-proxy.too-many-requests',
    message: 'The number of inflight requests have exceeded a maximum of {max} at {egressIngress}',
    max: null,
    statusCode: HTTP_TOO_MANY_REQUESTS,
    egressIngress: null
});

module.exports = RequestProxy;

function RequestProxy(opts) {
    this.ringpop = opts.ringpop;
    this.retrySchedule = opts.retrySchedule;
    this.maxRetries = opts.maxRetries;
    this.enforceConsistency = opts.enforceConsistency === undefined ? true : opts.enforceConsistency;

    this.sends = [];
    // numInflightRequests and sends.length are two separate things.
    // Since parsing the body of a request is asynchronous, there
    // may be requests that are having their bodies parsed that
    // have not yet been added to the sends collection. We maintain
    // a separate counter in numInflightRequests to make sure that
    // even requests-to-be-sent are accounted for.
    this.numInflightRequests = 0;
}

var proto = RequestProxy.prototype;

proto.removeSend = function removeSend(send) {
    var indexOf = this.sends.indexOf(send);

    if (indexOf !== -1) {
        this.sends.splice(indexOf, 1);

        this.numInflightRequests--;
        if (this.numInflightRequests < 0) {
            // Uh oh, miscounted somewhere. Fix it.
            this.ringpop.logger.warn('ringpop request proxy miscounted inflight requests', {
                local: this.ringpop.whoami(),
                numInflightRequests: this.numInflightRequests
            });
            this.numInflightRequests = 0;
        }

        this.ringpop.stat('gauge', 'requestProxy.inflight',
            this.numInflightRequests);
    }

    send.destroy();
};

proto.destroy = function destroy() {
    this.sends.forEach(function eachSend(send) {
        send.destroy();
    });

    this.sends = [];
};

proto.proxyReq = function proxyReq(opts) {
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

    if (this._hasExceededInflightMax()) {
        this.ringpop.stat('increment', 'requestProxy.too-many-requests');
        sendError(res, new TooManyRequestsError({
            egressIngress: 'egress',
            max: this.ringpop.config.get('maxInflightRequests')
        }));
        return;
    }

    this.numInflightRequests++;
    this.ringpop.stat('gauge', 'requestProxy.inflight',
        this.numInflightRequests);

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
            return sendError(res, err);
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

proto.handleRequest = function handleRequest(head, body, cb) {
    var ringpop = this.ringpop;
    var url = head.url;
    var headers = head.headers;
    var method = head.method;
    var httpVersion = head.httpVersion;
    var checksum = head.ringpopChecksum;

    if (checksum !== ringpop.ring.checksum) {
        var err = InvalidCheckSumError({
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

    var httpRequest = new PassThrough();
    httpRequest.url = url;
    httpRequest.headers = headers;
    httpRequest.method = method;
    httpRequest.httpVersion = httpVersion;

    httpRequest.end(body);

    var httpResponse = hammock.Response(onResponse);

    if (this._hasExceededInflightMax()) {
        onResponse(new TooManyRequestsError({
            egressIngress: 'ingress',
            max: this.ringpop.config.get('maxInflightRequests')
        }));
        return;
    }

    ringpop.logger.trace('handleRequest emitting request', {
        url: url
    });

    ringpop.emit('request', httpRequest, httpResponse, head);

    function onResponse(err, resp) {
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

proto._hasExceededInflightMax = function _hasExceededInflightMax() {
    var config = this.ringpop.config;
    var sheddingEnabled = config.get('inflightSheddingEnabled');
    var max = config.get('maxInflightRequests');
    return sheddingEnabled && this.numInflightRequests >= max;
};

function sendError(res, err) {
    res.statusCode = err.statusCode || 500;
    res.end(err.message);
}
