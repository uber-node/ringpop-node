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

function ChecksumComputedEvent(checksum, oldChecksum) {
    this.name = this.constructor.name;
    this.checksum = checksum;
    this.oldChecksum = oldChecksum;
    this.timestamp = Date.now();
}

// A member becomes reusable when the damp score of a previously damped member
// falls below the reuse limit as specified in config.js by
// dampScoringReuseLimit.
function DampingReusableEvent(member, oldDampScore) {
    this.name = this.constructor.name;
    this.member = member;
    this.oldDampScore = oldDampScore;
}

function DampingSuppressLimitExceededEvent(member) {
    this.name = this.constructor.name;
    this.member = member;
}

function LocalMemberLeaveEvent(member, oldStatus) {
    this.name = this.constructor.name;
    this.member = member;
    this.oldStatus = oldStatus;
}

module.exports = {
    ChecksumComputedEvent: ChecksumComputedEvent,
    DampingReusableEvent: DampingReusableEvent,
    DampingSuppressLimitExceededEvent: DampingSuppressLimitExceededEvent,
    LocalMemberLeaveEvent: LocalMemberLeaveEvent
};
