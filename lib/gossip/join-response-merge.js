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

var mergeMembershipChangesets = require('../membership/merge.js');

function hasSameChecksums(joinResponses) {
    var lastChecksum = -1;

    for (var i = 0; i < joinResponses.length; i++) {
        var response = joinResponses[i];

        if (!response.checksum || (lastChecksum !== -1 && lastChecksum !== response.checksum)) {
            return false;
        }

        lastChecksum = response.checksum;
    }

    return true;
}

function mergeJoinResponses(ringpop, joinResponses) {
    if (!Array.isArray(joinResponses) || joinResponses.length === 0) {
        return [];
    }

    if (hasSameChecksums(joinResponses)) {
        return joinResponses[0].members;
    }

    return mergeMembershipChangesets(ringpop, mapResponses());

    function mapResponses() {
        return joinResponses.map(function mapResponse(response) {
            return response.members;
        });
    }
}

module.exports = mergeJoinResponses;
