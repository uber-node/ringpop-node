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

// 3rd party dependencies
var body = require('body');
var hammock = require('uber-hammock');
var PassThrough = require('readable-stream').PassThrough;
var TypedError = require('error/typed');

// 1st party dependencies
var numOrDefault = require('../util.js').numOrDefault;
var safeParse = require('../util.js').safeParse;
var sendRequest = require('./send.js');

var InvalidCheckSumError = TypedError({
    type: 'ringpop.request-proxy.invalid-checksum',
    message: 'Expected the remote checksum to match local ' +
            'checksum.\n' +
        'The expected checksum ({expected}) did not match ' +
            'actual checksum ({actual}).\n',
    actual: null,
    expected: null
});

module.exports = RequestProxy;

function RequestProxy(opts) {
    this.ringpop = opts.ringpop;
    this.retrySchedule = opts.retrySchedule;
    this.maxRetries = opts.maxRetries;

    this.sends = [];
}

var proto = RequestProxy.prototype;

proto.removeSend = function removeSend(send) {
    var indexOf = this.sends.indexOf(send);

    if (indexOf !== -1) {
        this.sends.splice(indexOf, 1);
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

    body(req, res, { cache: true }, onBody);

    function onBody(err, rawBody) {
        if (err) {
            self.ringpop.logger.warn('requestProxy encountered malformed body', {
                err: err,
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
                schedule: retrySchedule || self.retrySchedule
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
                self.ringpop.logger.warn('requestProxy got error from tchannel', {
                    err: err,
                    url: req.url
                });
                return sendError(res, err);
            }

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
            err: err,
            url: url
        });
        ringpop.emit('requestProxy.checksumsDiffer');
        return cb(err);
    }

    var httpRequest = new PassThrough();
    httpRequest.url = url;
    httpRequest.headers = headers;
    httpRequest.method = method;
    httpRequest.httpVersion = httpVersion;

    httpRequest.end(body);

    var httpResponse = hammock.Response(onResponse);

    ringpop.logger.trace('handleRequest emitting request', {
        url: url
    });

    ringpop.emit('request', httpRequest, httpResponse, head);

    function onResponse(err, resp) {
        if (err) {
            ringpop.logger.warn('handleRequest got response error', {
                err: err,
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

function sendError(res, err) {
    res.statusCode = err.statusCode || 500;
    res.end(err.message);
}
