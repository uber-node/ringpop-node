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
var _ = require('underscore');
var farmhash = require('farmhash');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var LOG_10 = Math.log(10);

function Dissemination(ringpop) {
    this.ringpop = ringpop;
    this.ringpop.on('changed', this.onRingChanged.bind(this));

    this.changes = {};
    this.maxPiggybackCount = 1;
    this.piggybackFactor = 15; // A lower piggyback factor leads to more full-syncs
}

Dissemination.prototype.addChange = function addChange(change) {
    this.changes[change.address] = change;
};

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
    }
};

Dissemination.prototype.getChanges = function getChanges(checksum, source) {
    var changesToDisseminate = [];

    for (var address in this.changes) {
        var change = this.changes[address];

        // TODO We're bumping the piggyback count even though
        // we don't know whether the change successfully made
        // it over to the other side. This can result in undesired
        // full-syncs.
        change.piggybackCount += 1;

        if (change.piggybackCount > this.maxPiggybackCount) {
            delete this.changes[address];
            continue;
        }

        changesToDisseminate.push({
            address: change.address,
            status: change.status,
            incarnationNumber: change.incarnationNumber
        });
    }

    this.ringpop.stat('gauge', 'changes.disseminate', changesToDisseminate.length);

    if (changesToDisseminate.length) {
        return changesToDisseminate;
    } else if (checksum && this.ringpop.membership.checksum !== checksum) {
        this.ringpop.stat('increment', 'full-sync');
        this.ringpop.logger.info('full sync', {
            localChecksum: this.ringpop.membership.checksum,
            remoteChecksum: checksum,
            remoteNode: source
        });

        return this.ringpop.membership.getState();
    } else {
        return [];
    }
};

Dissemination.prototype.onRingChanged = function onRingChanged() {
    this.adjustMaxPiggybackCount();
};

function MemberIterator(ring) {
    this.ring = ring;
    this.currentIndex = -1;
    this.currentRound = 0;
}

MemberIterator.prototype.next = function next() {
    var membersVisited = {};
    var maxMembersToVisit = this.ring.membership.getMemberCount();

    while (Object.keys(membersVisited).length < maxMembersToVisit) {
        this.currentIndex++;

        if (this.currentIndex >= this.ring.membership.getMemberCount()) {
            this.currentIndex = 0;
            this.currentRound++;
            this.ring.membership.shuffle();
        }

        var member = this.ring.membership.getMemberAt(this.currentIndex);

        membersVisited[member.address] = true;

        if (Membership.isPingable(member)) {
            return member;
        }
    }

    return null;
};

function Membership(ringpop) {
    this.ringpop = ringpop;
    this.members = [];
    this.version = 0;
    this.checksum = null;
}

util.inherits(Membership, EventEmitter);

Membership.isAliveOverride = function isAliveOverride(member, change) {
    return change.status === 'alive' &&
        ((member.status === 'suspect' && change.incarnationNumber > member.incarnationNumber) ||
        (member.status === 'faulty' && change.incarnationNumber > member.incarnationNumber) ||
        (member.status === 'alive' && change.incarnationNumber > member.incarnationNumber));
};

Membership.isFaultyOverride = function isFaultyOverride(member, change) {
    return change.status === 'faulty' &&
        ((member.status === 'suspect' && change.incarnationNumber >= member.incarnationNumber) ||
        (member.status === 'faulty' && change.incarnationNumber > member.incarnationNumber) ||
        (member.status === 'alive' && change.incarnationNumber > member.incarnationNumber));
};

Membership.isLocalFaultyOverride = function isLocalFaultyOverride(member, change) {
    return member.isLocal && change.status === 'faulty';
};

Membership.isLocalSuspectOverride = function isLocalSuspectOverride(member, change) {
    return member.isLocal && change.status === 'suspect';
};

Membership.isSuspectOverride = function isSuspectOverride(member, change) {
    return change.status === 'suspect' &&
        ((member.status === 'suspect' && change.incarnationNumber > member.incarnationNumber) ||
        (member.status === 'faulty' && change.incarnationNumber > member.incarnationNumber) ||
        (member.status === 'alive' && change.incarnationNumber >= member.incarnationNumber));
};

Membership.isPingable = function isPingable(member) {
    return !member.isLocal && member.status === 'alive' || member.status === 'suspect';
};

Membership.prototype.addMember = function addMember(member, force, noEvent) {
    if (!force && this.hasMember(member)) {
        return;
    }

    var newMember = {
        address: member.address,
        status: member.status || 'alive',
        incarnationNumber: member.incarnationNumber || +new Date(),
        isLocal: this.ringpop.hostPort === member.address
    };

    if (newMember.isLocal) {
        this.localMember = newMember;
    }

    this.members.splice(this.getJoinPosition(), 0, newMember);

    if (!noEvent) {
        this._emitUpdated(_.extend(newMember, { type: 'new' }));
    }
};

Membership.prototype.computeChecksum = function computeChecksum() {
    /* The membership checksum is a farmhash of the checksum string computed
     * for each member then joined with all other member checksum strings by ';'.
     * As an example, the checksum string for a member might be:
     *
     *     localhost:3000alive1414142122274
     *
     * And joined together with other members:
     *
     *    localhost:3000alive1414142122274;localhost:3001alive1414142122275
     *
     * The member fields that are part of the checksum string are: address, status and
     * incarnation number.
     */
    var start = new Date();

    this.checksum = farmhash.hash32(this.generateChecksumString());

    this.ringpop.stat('timing', 'compute-checksum', start);
    this.ringpop.stat('gauge', 'checksum', this.checksum);

    return this.checksum;
};

Membership.prototype.hasMember = function hasMember(member) {
    return !!this.findMemberByAddress(member.address);
};

Membership.prototype.findMemberByAddress = function findMemberByAddress(address) {
    return _.find(this.members, function(member) {
        return member.address === address;
    });
};

Membership.prototype.generateChecksumString = function generateChecksumString() {
    var checksumStrings = [];

    for (var i = 0; i < this.members.length; ++i) {
        var member = this.members[i];

        checksumStrings.push(member.address + member.status + member.incarnationNumber);
    }

    return checksumStrings.sort().join(';');
};

Membership.prototype.getJoinPosition = function getJoinPosition() {
    return Math.floor(Math.random() * (this.members.length - 0)) + 0;
};

Membership.prototype.getMemberAt = function getMemberAt(index) {
    return this.members[index];
};

Membership.prototype.getMemberCount = function getMemberCount() {
    return this.members.length;
};

Membership.prototype.getRandomPingableMembers = function(n, excluding) {
    // TODO Revisit to make faster
    return _.chain(this.members)
        .reject(function(member) { return excluding.indexOf(member.address) > -1; })
        .filter(function(member) { return Membership.isPingable(member); })
        .sample(n)
        .value();
};

Membership.prototype.getState = function(incomingChecksum) {
    return this.members.map(function(member) {
        return {
            address: member.address,
            status: member.status,
            incarnationNumber: member.incarnationNumber
        };
    });
};

Membership.prototype.getStats = function getStats() {
    return {
        checksum: this.checksum,
        members: this.getState().sort(function (a, b) {
            return a.address.localeCompare(b.address);
        }),
        version: this.version
    };
};

Membership.prototype.shuffle = function shuffle() {
    this.members = _.shuffle(this.members);
};

Membership.prototype.toString = function toString() {
    return JSON.stringify(_.pluck(this.members, 'address'));
};

Membership.prototype.update = function update(changes) {
    changes = Array.isArray(changes) ? changes : [];
    this.ringpop.stat('gauge', 'changes.apply', changes.length);

    if (changes.length === 0) {
        return;
    }

    var updates = [];

    for (var i = 0 ; i < changes.length; i++) {
        var change = changes[i];
        var member = this.findMemberByAddress(change.address);

        if (member) {
            if (Membership.isLocalSuspectOverride(member, change) || Membership.isLocalFaultyOverride(member, change)) {
                // Local node should never allow itself to become suspect or faulty. In response,
                // it affirms its "aliveness" and bumps its incarnation number.
                member.status = 'alive';
                member.incarnationNumber = +new Date();
                updates.push(_.extend(member, { type: 'alive' }));
            } else if (Membership.isAliveOverride(member, change)) {
                member.status = 'alive';
                member.incarnationNumber = change.incarnationNumber || member.incarnationNumber;
                updates.push(_.extend(member, { type: 'alive' }));
            } else if (Membership.isSuspectOverride(member, change)) {
                member.status = 'suspect';
                member.incarnationNumber = change.incarnationNumber || member.incarnationNumber;
                updates.push(_.extend(member, { type: 'suspect' }));
            } else if (Membership.isFaultyOverride(member, change)) {
                member.status = 'faulty';
                member.incarnationNumber = change.incarnationNumber || member.incarnationNumber;
                updates.push(_.extend(member, { type: 'faulty' }));
            }
        } else {
            member = {
                address: change.address,
                status: change.status,
                incarnationNumber: change.incarnationNumber
            };
            this.addMember(member, true, true);
            updates.push(_.extend(member, { type: 'new' }));
        }
    }

    if (updates.length > 0) {
        this._emitUpdated(updates);
    }
};

Membership.prototype._emitUpdated = function _emitUpdated(updates) {
    updates = Array.isArray(updates) ? updates : [updates];

    this.version++;
    this.computeChecksum();

    this.emit('updated', updates);
};

module.exports = {
    Dissemination: Dissemination,
    MemberIterator: MemberIterator,
    Membership: Membership
};
