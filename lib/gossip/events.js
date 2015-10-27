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

function ChangesPendingEvent() {
    this.name = this.constructor.name;
}

function NoSyncTargetEvent() {
    this.name = this.constructor.name;
}

function SyncEmptyEvent() {
    this.name = this.constructor.name;
}

function SyncFailedEvent() {
    this.name = this.constructor.name;
}

function SyncedEvent(membershipChanges) {
    this.name = this.constructor.name;
    this.membershipChanges = membershipChanges;
}

function SyncerAlreadyStartedEvent() {
    this.name = this.constructor.name;
}

function SyncerAlreadyStoppedEvent() {
    this.name = this.constructor.name;
}

function SyncerAlreadySyncingEvent() {
    this.name = this.constructor.name;
}

function SyncerDisabledEvent() {
    this.name = this.constructor.name;
}

function SyncerStartedEvent() {
    this.name = this.constructor.name;
}

function SyncerStoppedEvent() {
    this.name = this.constructor.name;
}

function SyncerSyncingEvent() {
    this.name = this.constructor.name;
}

module.exports = {
    ChangesPendingEvent: ChangesPendingEvent,
    NoSyncTargetEvent: NoSyncTargetEvent,
    SyncEmptyEvent: SyncEmptyEvent,
    SyncFailedEvent: SyncFailedEvent,
    SyncedEvent: SyncedEvent,
    SyncerAlreadyStartedEvent: SyncerAlreadyStartedEvent,
    SyncerAlreadyStoppedEvent: SyncerAlreadyStoppedEvent,
    SyncerAlreadySyncingEvent: SyncerAlreadySyncingEvent,
    SyncerDisabledEvent: SyncerDisabledEvent,
    SyncerStartedEvent: SyncerStartedEvent,
    SyncerStoppedEvent: SyncerStoppedEvent,
    SyncerSyncingEvent: SyncerSyncingEvent
};
