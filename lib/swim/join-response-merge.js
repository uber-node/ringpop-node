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

function mergeJoinResponses(joinResponses) {
    if (!Array.isArray(joinResponses) || joinResponses.length === 0) {
        return [];
    }

    var mergeIndex = {};

    for (var i = 0; i < joinResponses.length; i++) {
        var members = joinResponses[i].members;

        for (var j = 0; j < members.length; j++) {
            var member = members[j];

            var indexVal = mergeIndex[member.address];

            if (!indexVal || indexVal.incarnationNumber < member.incarnationNumber) {
                mergeIndex[member.address] = member;
            }
        }
    }

    var indexKeys = Object.keys(mergeIndex);
    var updates = new Array(indexKeys.length);

    for (i = 0; i < indexKeys.length; i++) {
        updates[i] = mergeIndex[indexKeys[i]];
    }

    return updates;
}

module.exports = mergeJoinResponses;
