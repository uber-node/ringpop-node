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
var PassThrough = require('readable-stream').PassThrough;
var hammock = require('uber-hammock');
var TypedError = require('error/typed');

var safeParse = require('./util').safeParse;
var serializeHead = require('./request-proxy-util.js').serializeHead;

var RETRY_SCHEDULE = [0, 1, 3.5];

var InvalidCheckSumError = TypedError({
    type: 'ringpop.request-proxy.invalid-checksum',
    message: 'Expected the remote checksum to match local ' +
            'checksum.\n' +
        'The expected checksum ({expected}) did not match ' +
            'actual checksum ({actual}).\n',
    actual: null,
    expected: null
});

var MaxRetriesExceeded = TypedError({
    type: 'ringpop.request-proxy.max-retries-exceeded',
    message: 'Max number of retries ({maxRetries}) to fulfill request have been exceeded',
    maxRetries: null
});

module.exports = RequestProxy;

function numOrDefault(num, def) {
    return typeof num === 'number' ? num : def;
}

function RequestProxy(opts) {
    this.ringpop = opts.ringpop;
    this.retrySchedule = opts.retrySchedule || RETRY_SCHEDULE;
    this.maxRetries = numOrDefault(opts.maxRetries, this.retrySchedule.length);

    // Simply a convenience over having to index into `retrySchedule` each time
    this.maxRetryTimeout = this.retrySchedule[this.retrySchedule.length - 1];

    this.retryTimeouts = [];
}

var proto = RequestProxy.prototype;

proto.clearRetryTimeout = function clearRetryTimeout(timeout) {
    var indexOf = this.retryTimeouts.indexOf(timeout);

    if (indexOf !== -1) {
        this.retryTimeouts.splice(indexOf, 1);
    }
};

proto.destroy = function destroy() {
    this.retryTimeouts.forEach(function eachTimeout(timeout) {
        clearTimeout(timeout);
    });

    this.retryTimeouts = [];
};

proto.proxyReq = function proxyReq(opts) {
    var self = this;
    var keys = opts.keys;
    var dest = opts.dest;
    var req = opts.req;
    var res = opts.res;
    var maxRetries = opts.maxRetries;
    var retrySchedule = opts.retrySchedule;
    var endpoint = opts.endpoint || '/proxy/req';

    var ringpop = this.ringpop;

    var timeout = opts.timeout ?
        opts.timeout : ringpop.proxyReqTimeout;

    body(req, res, { cache: true }, onBody);

    function onBody(err, rawBody) {
        if (err) {
            ringpop.logger.warn('requestProxy encountered malformed body', {
                err: err,
                url: req.url
            });
            return sendError(res, err);
        }

        var options = {
            host: dest,
            timeout: timeout
        };
        var head = serializeHead(req, {
            checksum: ringpop.membership.checksum,
            keys: keys
        });

        ringpop.logger.trace('requestProxy sending tchannel proxy req', {
            url: req.url
        });

        var sendIt = sendHandler();
        sendIt(options, head, rawBody, onProxy);
    }

    function onProxy(err, res1, res2) {
        if (err) {
            ringpop.logger.warn('requestProxy got error from tchannel', {
                err: err,
                url: req.url
            });
            return sendError(res, err);
        }

        // TODO Remove the assumption request proxy makes about the
        // shape of the response, aka decouple from HTTP.
        var responseHead = safeParse(res1) || {};

        if (responseHead.headers) {
            Object.keys(responseHead.headers)
                .forEach(function setHeader(key) {
                    res.setHeader(key, responseHead.headers[key]);
                });
        }

        ringpop.logger.trace('requestProxy writing response', {
            url: req.url
        });

        res.statusCode = responseHead.statusCode || 200;
        res.end(res2);
    }

    function sendHandler() {
        // Per-request parameters override instance-level
        maxRetries = numOrDefault(maxRetries, self.maxRetries);
        retrySchedule = retrySchedule || self.retrySchedule;

        var numRetries = 0;
        var reqStartTime = Date.now();
        var retryStartTime = null;

        return function sendIt(options, head, body, callback) {
            if (maxRetries === 0) {
                ringpop.channel.send(options, endpoint,
                    head, body, callback);
                return;
            }

            ringpop.channel.send(options, endpoint, head, body, onSend);

            function onSend(err, res1, res2) {
                if (!err) {
                    if (numRetries > 0) {
                        ringpop.stat('increment', 'requestProxy.retry.succeeded');
                        ringpop.logger.info('ringpop request proxy retry succeeded', {
                            numRetries: numRetries,
                            maxRetries: maxRetries,
                            reqMethod: req.method,
                            reqUrl: req.url,
                            reqStartTime: reqStartTime,
                            reqTotalTime: Date.now() - reqStartTime,
                            retrySchedule: retrySchedule,
                            retryStartTime: retryStartTime,
                            retryTotalTime: Date.now() - retryStartTime
                        });
                        ringpop.emit('requestProxy.retrySucceeded');
                    }

                    callback(null, res1, res2);
                    return;
                }

                if (numRetries >= maxRetries) {
                    ringpop.stat('increment', 'requestProxy.retry.failed');
                    ringpop.logger.warn('ringpop request proxy retry exceeded max retries and failed', {
                        maxRetries: maxRetries,
                        maxRetryTimeout: self.maxRetryTimeout,
                        reqMethod: req.method,
                        reqUrl: req.url,
                        reqStartTime: reqStartTime,
                        reqTotalTime: Date.now() - reqStartTime,
                        retrySchedule: retrySchedule,
                        retryStartTime: retryStartTime,
                        retryTotalTime: Date.now() - retryStartTime
                    });
                    ringpop.emit('requestProxy.retryFailed');

                    callback(MaxRetriesExceeded({
                        maxRetries: maxRetries
                    }));
                    return;
                } else {
                    if (numRetries === 0) {
                        retryStartTime = Date.now();
                    }

                    // TODO Can we make this timeout value responsive/adaptive to previously
                    // recorded cluster converge-times?
                    var delay = numOrDefault(retrySchedule[numRetries] * 1000,
                        self.maxRetryTimeout);
                    var timeout = setTimeout(function onTimeout() {
                        numRetries++;

                        self.clearRetryTimeout(timeout);

                        sendIt(options, head, body, callback);

                        ringpop.stat('increment', 'requestProxy.retry.attempted');
                        ringpop.emit('requestProxy.retryAttempted');
                    }, delay);

                    self.retryTimeouts.push(timeout);

                    ringpop.emit('requestProxy.retryScheduled');
                }
            }
        };
    }
};

proto.handleRequest = function handleRequest(head, body, cb) {
    var ringpop = this.ringpop;
    var url = head.url;
    var headers = head.headers;
    var method = head.method;
    var httpVersion = head.httpVersion;
    var checksum = head.ringpopChecksum;

    if (checksum !== ringpop.membership.checksum) {
        var err = InvalidCheckSumError({
            expected: ringpop.membership.checksum,
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
