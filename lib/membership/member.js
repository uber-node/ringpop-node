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

var _ = require('underscore');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

function Member(ringpop, update) {
    this.ringpop = ringpop;
    this.address = update.address;
    this.status = update.status;
    this.incarnationNumber = update.incarnationNumber;
}

util.inherits(Member, EventEmitter);

// This function is named with the word "evaluate" because it is not
// guaranteed that the update will be applied. Naming it "update()"
// would have been misleading.
Member.prototype.evaluateUpdate = function evaluateUpdate(update) {
    // The local override and "other" override rules that are evaluated
    // here stem from the rules defined in the SWIM paper. They deviate
    // a bit from that literature since Ringpop has added the "leave"
    // status and retains faulty members in its membership list.
    if (this._isLocalOverride(update)) {
        // Override intended update. Assert aliveness!
        update = _.defaults({
            status: Member.Status.alive,
            incarnationNumber: Date.now()
        }, update);
    } else if (!this._isOtherOverride(update)) {
        return;
    }

    // We've got an update. Apply all-the-things.
    if (this.status !== update.status) {
        this.status = update.status;
    }

    if (this.incarnationNumber !== update.incarnationNumber) {
        this.incarnationNumber = update.incarnationNumber;
    }

    this.emit('updated', update);

    return true;
};

Member.prototype.getStats = function getStats() {
    return {
        address: this.address,
        status: this.status,
        incarnationNumber: this.incarnationNumber
    };
};

Member.prototype._isLocalOverride = function _isLocalOverride(update) {
    var self = this;

    return isLocalFaultyOverride() || isLocalSuspectOverride();

    function isLocalFaultyOverride() {
        return self.ringpop.whoami() === self.address &&
            update.status === Member.Status.faulty;
    }

    function isLocalSuspectOverride() {
        return self.ringpop.whoami() === self.address &&
            update.status === Member.Status.suspect;
    }
};

Member.prototype._isOtherOverride = function _isOtherOverride(update) {
    var self = this;

    return isAliveOverride() || isSuspectOverride() || isFaultyOverride() ||
        isLeaveOverride();

    function isAliveOverride() {
        return update.status === 'alive' &&
            Member.Status[self.status] &&
            update.incarnationNumber > self.incarnationNumber;
    }

    function isFaultyOverride() {
        return update.status === 'faulty' &&
            ((self.status === 'suspect' && update.incarnationNumber >= self.incarnationNumber) ||
            (self.status === 'faulty' && update.incarnationNumber > self.incarnationNumber) ||
            (self.status === 'alive' && update.incarnationNumber >= self.incarnationNumber));
    }

    function isLeaveOverride() {
        return update.status === 'leave' &&
            self.status !== Member.Status.leave &&
            update.incarnationNumber >= self.incarnationNumber;
    }

    function isSuspectOverride() {
        return update.status === 'suspect' &&
            ((self.status === 'suspect' && update.incarnationNumber > self.incarnationNumber) ||
            (self.status === 'faulty' && update.incarnationNumber > self.incarnationNumber) ||
            (self.status === 'alive' && update.incarnationNumber >= self.incarnationNumber));
    }
};

Member.Status = {
    alive: 'alive',
    faulty: 'faulty',
    leave: 'leave',
    suspect: 'suspect'
};

module.exports = Member;
