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

function RequestProxy(ringpop) {
    this.ringpop = ringpop;
}

var proto = RequestProxy.prototype;

proto.proxyReq = function proxyReq(opts) {
    var key = opts.key;
    var dest = opts.dest;
    var req = opts.req;
    var res = opts.res;

    var ringpop = this.ringpop;
    var url = req.url;
    var headers = req.headers;
    var method = req.method;
    var httpVersion = req.httpVersion;

    var timeout = opts.timeout ?
        opts.timeout : ringpop.proxyReqTimeout;

    body(req, onBody);

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
        var head = JSON.stringify({
            url: url,
            headers: headers,
            method: method,
            httpVersion: httpVersion,
            checksum: ringpop.membership.checksum,
            ringpopKey: key
        });

        ringpop.logger.trace('requestProxy sending tchannel proxy req', {
            url: req.url
        });
        ringpop.channel.send(options, '/proxy/req',
            head, rawBody, onProxy);
    }

    function onProxy(err, res1, res2) {
        if (err) {
            ringpop.logger.warn('requestProxy got error from tchannel', {
                err: err,
                url: req.url
            });
            return sendError(res, err);
        }

        var responseHead = safeParse(res1);
        if (!responseHead) {
            var error = new Error('Ringpop parser error');
            ringpop.logger.warn('requestProxy got invalid head from tchannel', {
                err: error,
                url: req.url,
                res1: res1
            });

            return sendError(res, error);
        }

        res.statusCode = responseHead.statusCode || 200;
        Object.keys(responseHead.headers)
            .forEach(function setHeader(key) {
                res.setHeader(key, responseHead.headers[key]);
            });

        ringpop.logger.trace('requestProxy writing response', {
            url: req.url
        });
        res.end(res2);
    }
};

proto.handleRequest = function handleRequest(head, body, cb) {
    var ringpop = this.ringpop;
    var url = head.url;
    var headers = head.headers;
    var method = head.method;
    var httpVersion = head.httpVersion;
    var checksum = head.checksum;

    if (checksum !== ringpop.membership.checksum) {
        var err = InvalidCheckSumError({
            expected: ringpop.membership.checksum,
            actual: checksum
        });
        ringpop.logger.warn('handleRequest got invalid checksum', {
            err: err,
            url: url
        });
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
