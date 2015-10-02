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

var RequestResponse = require('../../request_response.js');
var safeParse = require('../../lib/util.js').safeParse;

var DampReqResponse = RequestResponse.DampReqResponse;
var validateRequest = RequestResponse.validateRequest;

module.exports = function createDampReqHandler(ringpop) {
    return function handleDampReq(arg2, arg3, hostInfo, callback) {
        ringpop.stat('increment', 'damp-req.recv');

        var body = safeParse(arg3.toString());
        if (!validateRequest(body, ['flappyMemberAddr'], callback)) {
            return;
        }

        var member = ringpop.membership.findMemberByAddress(body.flappyMemberAddr);
        if (!member) {
            callback(new Error('Bad request: no flappy member found'));
            return;
        }

        if (Array.isArray(body.changes)) {
            ringpop.membership.update(body.changes);
        }

        callback(null, null, JSON.stringify(new DampReqResponse(ringpop, body, {
            dampScore: member.dampScore
        })));
    };
};
