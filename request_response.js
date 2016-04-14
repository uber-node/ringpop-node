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

var util = require('util');

function ProtocolRequest(ringpop) {
    var localMember = ringpop.membership.localMember || {};
    this.sourceAddr = localMember.address;
    this.sourceIncarnationNumber = localMember.incarnationNumber;
    this.sourceChecksum = ringpop.membership.checksum;
}

function ProtocolResponse(/*ringpop*/) {
}

function DampReqRequest(ringpop, flappers) {
    ProtocolRequest.call(this, ringpop);
    this.flappers = flappers; // An Array of member's addresses (IDs)
}

util.inherits(DampReqRequest, ProtocolRequest);

function DampReqResponse(ringpop, req, scores) {
    ProtocolResponse.call(this, ringpop, req);
    this.scores = scores; // An Array of MemberDampScore
}

util.inherits(DampReqResponse, ProtocolResponse);

function validateRequest(req, otherProps, callback) {
    if (!req) {
        callback(new Error('Bad request: body is required'));
        return false;
    }

    var props = ['sourceAddr', 'sourceIncarnationNumber',
        'sourceChecksum'].concat(otherProps);

    for (var i = 0; i < props.length; i++) {
        var prop = props[i];
        if (!req[prop]) {
            callback(new Error('Bad request: ' + prop + ' is required'));
            return false;
        }
    }

    return true;
}

module.exports = {
    DampReqRequest: DampReqRequest,
    DampReqResponse: DampReqResponse,
    validateRequest: validateRequest
};
