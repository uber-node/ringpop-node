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

var Member = require('../lib/member.js');
var mergeJoinResponses = require('../lib/swim/join-response-merge.js');
var test = require('tape');

test('no responses results in empty array', function t(assert) {
    var result = mergeJoinResponses(null);
    assert.deepEqual(result, [], 'empty array');

    result = mergeJoinResponses(null);
    assert.deepEqual(result, [], 'empty array');

    assert.end();
});

test('responses with same checksum uses first response', function t(assert) {
    var responseCounter = 0;
    var firstResponse = createResponse();
    var responses = [
        firstResponse,
        createResponse(),
        createResponse()
    ];

    var result = mergeJoinResponses(responses);
    assert.deepEqual(result, firstResponse.members, 'takes first response');

    assert.end();

    function createResponse() {
        return {
            checksum: 123456789,
            members: [{
                address: '127.0.0.1:' + (3000 + (responseCounter++)),
                status: 'alive',
                incarnationNumber: Date.now()
            }]
        };
    }
});

test('merges responses and takes those updates with higher incarnation numbers', function t(assert) {
    var firstResponse = createResponse(123456789, [
        new Member('127.0.0.1:3000', 'suspect', 1),
        new Member('127.0.0.1:3001', 'alive', 2)
    ]);
    var secondResponse = createResponse(23456789, [
        new Member('127.0.0.1:3000', 'alive', 2),
        new Member('127.0.0.1:3001', 'suspect', 1),
        new Member('127.0.0.1:3002', 'faulty', 1)
    ]);
    var mergedMembers = [
        new Member('127.0.0.1:3000', 'alive', 2),
        new Member('127.0.0.1:3001', 'alive', 2),
        new Member('127.0.0.1:3002', 'faulty', 1),
    ];

    var result = mergeJoinResponses([firstResponse, secondResponse]);
    assert.deepEqual(result, mergedMembers, 'members are merged');

    assert.end();
});

test('merges responses when checksums are null', function t(assert) {
    var firstResponse = createResponse(null, [
        new Member('127.0.0.1:3000', 'suspect', 1),
        new Member('127.0.0.1:3001', 'alive', 2)
    ]);
    var secondResponse = createResponse(null, [
        new Member('127.0.0.1:3000', 'alive', 2),
        new Member('127.0.0.1:3001', 'suspect', 1),
        new Member('127.0.0.1:3002', 'faulty', 1)
    ]);
    var mergedMembers = [
        new Member('127.0.0.1:3000', 'alive', 2),
        new Member('127.0.0.1:3001', 'alive', 2),
        new Member('127.0.0.1:3002', 'faulty', 1)
    ];

    var result = mergeJoinResponses([firstResponse, secondResponse]);
    assert.deepEqual(result, mergedMembers, 'members are merged');

    firstResponse.checksum = 123456789;
    result = mergeJoinResponses([firstResponse, secondResponse]);
    assert.deepEqual(result, mergedMembers, 'members are merged');

    assert.end();

    function createResponse(checksum, members) {
        return {
            checksum: checksum,
            members: members
        };
    }
});
