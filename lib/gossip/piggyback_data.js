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

function PiggybackData(dissemination) {
    this.dissemination = dissemination;
    this.membershipChanges = {}; // indexed by address
    this.counts = {}; // indexed by id
}

PiggybackData.prototype.clear = function clear() {
    this.membershipChanges = {};
    this.counts = {};
};

PiggybackData.prototype.issue = function issue(yieldTo) {
    // Yield changes until they exceed maximum piggyback count.
    // When they do, mark them for deletion after yielding all
    // possible changes.
    var purgeable = [];
    var addresses = Object.keys(this.membershipChanges);
    for (var i = 0; i < addresses.length; i++) {
        var change = this.membershipChanges[addresses[i]];
        var count = this.counts[change.id];

        if (count > this.dissemination.maxPiggybackCount) {
            purgeable.push(change);
            continue;
        }

        yieldTo(change);
        this.counts[change.id]++;
    }

    this._purgeChanges(purgeable);
};

PiggybackData.prototype.recordChange = function recordChange(change) {
    this.membershipChanges[change.address] = change;
    this.counts[change.id] = 0;
};

PiggybackData.prototype._deleteChange = function _deleteChange(change) {
    delete this.membershipChanges[change.address];
    delete this.counts[change.id];
};

PiggybackData.prototype._purgeChanges = function _purgeChanges(changes) {
    for (var i = 0; i < changes.length; i++) {
        this._deleteChange(changes[i]);
    }
};

module.exports = PiggybackData;
