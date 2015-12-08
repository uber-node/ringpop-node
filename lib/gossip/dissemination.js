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

var LOG_10 = Math.log(10);

function Dissemination(ringpop) {
    this.ringpop = ringpop;
    this.ringpop.on('ringChanged', this.onRingChanged.bind(this));

    this.membershipChangesById = {};
    this.membershipChangesByAddress = {};
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
        this.ringpop.logger.debug('adjusted max piggyback count', {
            newPiggybackCount: this.maxPiggybackCount,
            oldPiggybackCount: prevPiggybackCount,
            piggybackFactor: this.piggybackFactor,
            serverCount: serverCount
        });

        this.emit('maxPiggybackCountAdjusted');
    }
};

Dissemination.prototype.clearChanges = function clearChanges() {
    this.membershipChangesByAddress = {};
    this.membershipChangesById = {};
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

Dissemination.prototype.issueAsSender = function issueAsSender(issuable) {
    var self = this;
    var membershipChanges = this._issueAs(null, function map(changes) {
        return changes;
    });

    issuable(membershipChanges, function onIssue(err) {
        if (err) {
            self.ringpop.logger.warn('ringpop dissemination not bumping piggyback count', {
                local: self.ringpop.whoami(),
                err: err,
                numMembershipChanges: membershipChanges.length
            })
            return;
        }

        for (var i = 0; i < membershipChanges.length; i++) {
            var change = self.membershipChangesById[membershipChanges[i].id];
            if (change) {
                change.piggybackCount++;
                change.outstandingPiggybacks--;
            }
        }
    });
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
        } else if (self.ringpop.membership.checksum !== senderChecksum) {
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
    this.membershipChangesByAddress[change.address] = change;
};

Dissemination.prototype.resetMaxPiggybackCount = function resetMaxPiggybackCount() {
    this.maxPiggybackCount = Dissemination.Defaults.maxPiggybackCount;
};

Dissemination.prototype._issueAs = function _issueAs(filterChange, mapChanges) {
    var changesToDisseminate = [];

    var changedNodes = Object.keys(this.membershipChangesByAddress);

    for (var i = 0; i < changedNodes.length; i++) {
        var address = changedNodes[i];
        var change = this.membershipChangesByAddress[address];

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
            delete this.membershipChangesByAddress[address];
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
