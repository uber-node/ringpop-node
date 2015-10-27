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

var EventEmitter = require('events').EventEmitter;
var util = require('util');

var EMPTY = [];
var LOG_10 = Math.log(10);

function Dissemination(ringpop) {
    this.ringpop = ringpop;
    this.ringpop.on('ringChanged', this.onRingChanged.bind(this));

    this.membershipChanges = {};
    this.maxPiggybackCount = Dissemination.Defaults.maxPiggybackCount;
    this.piggybackFactor = Dissemination.Defaults.piggybackFactor;
}

util.inherits(Dissemination, EventEmitter);

Dissemination.prototype.adjustMaxPiggybackCount = function adjustMaxPiggybackCount() {
    var serverCount = this.ringpop.ring.getServerCount();
    var prevPiggybackCount = this.maxPiggybackCount;
    var newPiggybackCount = this.piggybackFactor * Math.ceil(Math.log(serverCount + 1) / LOG_10);

    if (this.maxPiggybackCount !== newPiggybackCount) {
        this.maxPiggybackCount = newPiggybackCount;
        this.ringpop.stat('gauge', 'max-piggyback', this.maxPiggybackCount);
        this.ringpop.logger.debug('ringpop dissemination adjusted max piggyback count', {
            local: this.ringpop.whoami(),
            newPiggybackCount: this.maxPiggybackCount,
            oldPiggybackCount: prevPiggybackCount,
            piggybackFactor: this.piggybackFactor,
            serverCount: serverCount
        });

        this.emit('maxPiggybackCountAdjusted');
    }
};

Dissemination.prototype.clearChanges = function clearChanges() {
    this.membershipChanges = {};
};

Dissemination.prototype.fullSync = function fullSync() {
    var changes = [];

    for (var i = 0; i < this.ringpop.membership.members.length; i++) {
        var member = this.ringpop.membership.members[i];

        changes.push({
            source: this.ringpop.whoami(),
            address: member.address,
            status: member.status,
            incarnationNumber: member.incarnationNumber
        });
    }

    return changes;
};

Dissemination.prototype.isEmpty = function isEmpty() {
    return Object.keys(this.membershipChanges).length === 0;
};

Dissemination.prototype.maybeFullSync = function maybeFullSync(membershipChecksum) {
    // If there are still changes left to disseminate or the membership checksums
    // are the same, return no membership changes.
    if (!this.isEmpty() ||
            membershipChecksum === this.ringpop.membership.checksum) {
        return EMPTY;
    }

    return this.fullSync();
};

Dissemination.prototype.issueAsSender = function issueAsSender() {
    return this._issueAs(null, mapChanges);

    function mapChanges(changes) {
        return changes;
    }
};

Dissemination.prototype.issueAsReceiver = function issueAsReceiver(senderAddr, senderIncarnationNumber, senderChecksum) {
    var self = this;

    return this._issueAs(filterChange, mapChanges);

    function filterChange(change) {
        return !!(senderAddr &&
            senderIncarnationNumber &&
            change.source &&
            change.sourceIncarnationNumber &&
            senderAddr === change.source &&
            senderIncarnationNumber === change.sourceIncarnationNumber);
    }

    function mapChanges(changes) {
        // If no changes left to disseminate and checksums do not match, perform a full-sync.
        if (changes.length > 0) {
            return changes;
        } else if (self.ringpop.config.get('syncerEnabled') === false &&
                self.ringpop.membership.checksum !== senderChecksum) {
            self.ringpop.stat('increment', 'full-sync');
            self.ringpop.logger.info('full sync', {
                local: self.ringpop.whoami(),
                localChecksum: self.ringpop.membership.checksum,
                dest: senderAddr,
                destChecksum: senderChecksum
            });

            // TODO Somehow send back indication of isFullSync
            return self.fullSync();
        } else {
            return [];
        }
    }
};

Dissemination.prototype.onRingChanged = function onRingChanged() {
    this.adjustMaxPiggybackCount();
};

Dissemination.prototype.recordChange = function recordChange(change) {
    this.membershipChanges[change.address] = change;
};

Dissemination.prototype.resetMaxPiggybackCount = function resetMaxPiggybackCount() {
    this.maxPiggybackCount = Dissemination.Defaults.maxPiggybackCount;
};

Dissemination.prototype._issueAs = function _issueAs(filterChange, mapChanges) {
    var changesToDisseminate = [];

    var changedNodes = Object.keys(this.membershipChanges);

    for (var i = 0; i < changedNodes.length; i++) {
        var address = changedNodes[i];
        var change = this.membershipChanges[address];

        // TODO We're bumping the piggyback count even though
        // we don't know whether the change successfully made
        // it over to the other side. This can result in undesired
        // full-syncs.
        if (typeof change.piggybackCount === 'undefined') {
            change.piggybackCount = 0;
        }

        if (typeof filterChange === 'function' && filterChange(change)) {
            this.ringpop.stat('increment', 'filtered-change');
            continue;
        }

        change.piggybackCount += 1;

        if (change.piggybackCount > this.maxPiggybackCount) {
            delete this.membershipChanges[address];
            continue;
        }

        // TODO Include change timestamp
        changesToDisseminate.push({
            id: change.id,
            source: change.source,
            sourceIncarnationNumber: change.sourceIncarnationNumber,
            address: change.address,
            status: change.status,
            incarnationNumber: change.incarnationNumber
        });
    }

    this.ringpop.stat('gauge', 'changes.disseminate', changesToDisseminate.length);

    return mapChanges(changesToDisseminate);
};

Dissemination.Defaults = {
    maxPiggybackCount: 1,
    piggybackFactor: 15 // A lower piggyback factor leads to more full-syncs
};

module.exports = Dissemination;
