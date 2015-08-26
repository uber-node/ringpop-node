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

var Member = require('./member.js');

function isAliveOverride(member, change) {
    return change.status === 'alive' &&
        Member.Status[member.status] &&
        change.incarnationNumber > member.incarnationNumber;
}

function isFaultyOverride(member, change) {
    return change.status === 'faulty' &&
        ((member.status === 'suspect' && change.incarnationNumber >= member.incarnationNumber) ||
        (member.status === 'faulty' && change.incarnationNumber > member.incarnationNumber) ||
        (member.status === 'alive' && change.incarnationNumber >= member.incarnationNumber));
}

function isLeaveOverride(member, change) {
    return change.status === 'leave' &&
        member.status !== Member.Status.leave &&
        change.incarnationNumber >= member.incarnationNumber;
}

function isLocalFaultyOverride(ringpop, member, change) {
    return ringpop.whoami() === member.address &&
        change.status === Member.Status.faulty;
}

function isLocalSuspectOverride(ringpop, member, change) {
    return ringpop.whoami() === member.address &&
        change.status === Member.Status.suspect;
}

function isSuspectOverride(member, change) {
    return change.status === 'suspect' &&
        ((member.status === 'suspect' && change.incarnationNumber > member.incarnationNumber) ||
        (member.status === 'faulty' && change.incarnationNumber > member.incarnationNumber) ||
        (member.status === 'alive' && change.incarnationNumber >= member.incarnationNumber));
}

module.exports = {
    isAliveOverride: isAliveOverride,
    isFaultyOverride: isFaultyOverride,
    isLeaveOverride: isLeaveOverride,
    isLocalFaultyOverride: isLocalFaultyOverride,
    isLocalSuspectOverride: isLocalSuspectOverride,
    isSuspectOverride: isSuspectOverride
};
