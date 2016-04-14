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

var Member = require('../lib/membership/member.js');

function member1(ringpop, opts) {
    opts = opts || {};
    return new Member(ringpop, {
        address: opts.address || '127.0.0.1:3001',
        incarnationNumber: opts.incarnationNumber || Date.now(),
        status: Member.Status.alive
    });
}

function memberGenerator(ringpop) {
    var basePort = 3001; // assumes member with port 3000 is already in membership
    var counter = 0;
    return function genMember() {
        return new Member(ringpop, {
            address: '127.0.0.1:' + (basePort + counter++),
            incarnationNumber: Date.now()
        });
    };
}

module.exports = {
    member1: member1,
    memberGenerator: memberGenerator
};
