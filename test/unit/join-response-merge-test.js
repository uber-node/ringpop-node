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

var Member = require('../../lib/membership/member.js');
var mergeJoinResponses = require('../../lib/gossip/join-response-merge.js');
var testRingpop = require('../lib/test-ringpop.js');

testRingpop('no responses results in empty array', function t(deps, assert) {
    var result = mergeJoinResponses(deps.ringpop, deps.ringpop, null);
    assert.deepEqual(result, [], 'empty array');

    result = mergeJoinResponses(deps.ringpop, deps.ringpop, []);
    assert.deepEqual(result, [], 'empty array');
});

testRingpop('responses with same checksum uses first response', function t(deps, assert) {
    var responseCounter = 0;
    var firstResponse = createResponse();
    var responses = [
        firstResponse,
        createResponse(),
        createResponse()
    ];

    var result = mergeJoinResponses(deps.ringpop, responses);
    assert.deepEqual(result, firstResponse.members, 'takes first response');

    function createResponse() {
        return {
            checksum: 123456789,
            members: [{
                address: '127.0.0.1:' + (3001 + (responseCounter++)),
                status: 'alive',
                incarnationNumber: Date.now()
            }]
        };
    }
});

testRingpop('merges responses when checksums are null', function t(deps, assert) {
    var firstResponse = createResponse(null, [
        new Member(deps.ringpop, {
            address: '127.0.0.1:3001',
            status: 'suspect',
            incarnationNumber: 1
        }),
        new Member(deps.ringpop, {
            address: '127.0.0.1:3002',
            status: 'alive',
            incarnationNumber: 2
        })
    ]);
    var secondResponse = createResponse(null, [
        new Member(deps.ringpop, {
            address: '127.0.0.1:3001',
            status: 'alive',
            incarnationNumber: 2
        }),
        new Member(deps.ringpop, {
            address: '127.0.0.1:3002',
            status: 'suspect',
            incarnationNumber: 1
        }),
        new Member(deps.ringpop, {
            address: '127.0.0.1:3003',
            status: 'faulty',
            incarnationNumber: 1
        })
    ]);
    var mergedMembers = [
        new Member(deps.ringpop, {
            address: '127.0.0.1:3001',
            status: 'alive',
            incarnationNumber: 2
        }),
        new Member(deps.ringpop, {
            address: '127.0.0.1:3002',
            status: 'alive',
            incarnationNumber: 2
        }),
        new Member(deps.ringpop, {
            address: '127.0.0.1:3003',
            status: 'faulty',
            incarnationNumber: 1
        })
    ];

    var result = mergeJoinResponses(deps.ringpop, [firstResponse, secondResponse]);
    assert.deepEqual(result, mergedMembers, 'members are merged');

    firstResponse.checksum = 123456789;
    result = mergeJoinResponses(deps.ringpop, [firstResponse, secondResponse]);
    assert.deepEqual(result, mergedMembers, 'members are merged');

    function createResponse(checksum, members) {
        return {
            checksum: checksum,
            members: members
        };
    }
});
