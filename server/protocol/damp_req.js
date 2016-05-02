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

var DampReqResponse = require('../../request_response.js').DampReqResponse;
var TypedError = require('error/typed');

var BadRequestError = TypedError({
    type: 'overrideme',
    message: 'Bad request: {reason}',
    reason: null
});

module.exports = function createDampReqHandler(ringpop) {
    return function handleDampReq(arg2, arg3, hostInfo, callback) {
        ringpop.stat('increment', 'damp-req.recv');

        var body = arg3;
        if (!body || !body.flappers) {
            callback(BadRequestError({
                type: 'ringpop.server.damp-req.bad-request.flappers-required',
                reason: 'flappers is required'
            }));
            return;
        }

        var flappers = body.flappers;
        if (!Array.isArray(flappers)) {
            callback(BadRequestError({
                type: 'ringpop.server.damp-req.bad-request.flappers-array',
                reason: 'flappers must be an array'
            }));
            return;
        }

        var dampScores = ringpop.membership.collectDampScores(flappers);
        var response = new DampReqResponse(ringpop, body, dampScores);
        callback(null, null, response);
    };
};
