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

function ChangesExhaustedEvent() {
    this.name = this.constructor.name;
}

function DampReqFailedEvent(err) {
    this.name = this.constructor.name;
    this.err = err;
}

function DampReqUnsatisfiedEvent() {
    this.name = this.constructor.name;
}

function DampedEvent() {
    this.name = this.constructor.name;
}

function DampedMemberExpirationEvent(undampedMembers) {
    this.name = this.constructor.name;
    this.undampedMembers = undampedMembers;
}

function DamperStartedEvent() {
    this.name = this.constructor.name;
}

function DampedLimitExceededEvent() {
    this.name = this.constructor.name;
}

function DampingInconclusiveEvent() {
    this.name = this.constructor.name;
}

function SendingPingReqsEvent() {
    this.name = this.constructor.name;
}

module.exports = {
    ChangesExhaustedEvent: ChangesExhaustedEvent,
    DampReqFailedEvent: DampReqFailedEvent,
    DampReqUnsatisfiedEvent: DampReqUnsatisfiedEvent,
    DampedEvent: DampedEvent,
    DampedLimitExceededEvent: DampedLimitExceededEvent,
    DampedMemberExpirationEvent: DampedMemberExpirationEvent,
    DamperStartedEvent: DamperStartedEvent,
    DampingInconclusiveEvent: DampingInconclusiveEvent,
    SendingPingReqsEvent: SendingPingReqsEvent
};
