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
var farmhash = require('farmhash');
var Member = require('./member.js');
var MembershipUpdateRules = require('./membership-update-rules.js');
var mergeMembershipChangesets = require('./membership-changeset-merge.js');
var util = require('util');
var uuid = require('node-uuid');

function Membership(ringpop) {
    this.ringpop = ringpop;
    this.members = [];
    this.membersByAddress = {};
    this.checksum = null;
    this.stashedUpdates = [];
}

util.inherits(Membership, EventEmitter);

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

    this.emit('checksumComputed');
    this.ringpop.stat('timing', 'compute-checksum', start);
    this.ringpop.stat('gauge', 'checksum', this.checksum);

    return this.checksum;
};

Membership.prototype.findMemberByAddress = function findMemberByAddress(address) {
    return this.membersByAddress[address];
};

Membership.prototype.generateChecksumString = function generateChecksumString() {
    var copiedMembers = this.members.slice();
    var sortedMembers = copiedMembers.sort(function sort(a, b) {
        if (a.address < b.address) {
            return -1;
        } else if (a.address > b.address) {
            return 1;
        } else {
            return 0;
        }
    });

    var checksumString = '';

    for (var i = 0; i < sortedMembers.length; ++i) {
        var member = sortedMembers[i];

        checksumString += member.address +
            member.status +
            member.incarnationNumber + ';';
    }

    return checksumString.slice(0, -1);
};

Membership.prototype.getIncarnationNumber = function getIncarnationNumber() {
    return this.localMember && this.localMember.incarnationNumber;
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
    var self = this;

    // TODO Revisit to make faster
    return _.chain(this.members)
        .reject(function(member) { return excluding.indexOf(member.address) > -1; })
        .filter(function(member) { return self.isPingable(member); })
        .sample(n)
        .value();
};

Membership.prototype.getStats = function getStats() {
    return {
        checksum: this.checksum,
        members: this.members.sort(function (a, b) {
            return a.address.localeCompare(b.address);
        })
    };
};

Membership.prototype.hasMember = function hasMember(member) {
    return !!this.findMemberByAddress(member.address);
};

Membership.prototype.isPingable = function isPingable(member) {
    return member.address !== this.ringpop.whoami() &&
        (member.status === 'alive' ||
        member.status === 'suspect');
};

Membership.prototype.makeAlive = function makeAlive(address, incarnationNumber) {
    return makeUpdate(this, address, incarnationNumber, Member.Status.alive,
        address === this.ringpop.whoami());
};

Membership.prototype.makeFaulty = function makeFaulty(address, incarnationNumber) {
    return makeUpdate(this, address, incarnationNumber, Member.Status.faulty);
};

Membership.prototype.makeLeave = function makeLeave(address, incarnationNumber) {
    return makeUpdate(this, address, incarnationNumber, Member.Status.leave);
};

Membership.prototype.makeSuspect = function makeSuspect(address, incarnationNumber) {
    return makeUpdate(this, address, incarnationNumber, Member.Status.suspect);
};

// Sets stashed updates. set() is different from update() in that it bypasses
// evaluating membership update rules and places new members at the end of the
// membership list rather than in a random position as defined by
// `getJoinPosition`. Set is meant to be called only once, after bootstrap.
Membership.prototype.set = function set() {
    // stashedUpdates is set to null once initial membership
    // updates have been set.
    if (this.ringpop.isReady || this.stashedUpdates === null) {
        return;
    }

    if (!Array.isArray(this.stashedUpdates) || this.stashedUpdates.length === 0) {
        return;
    }

    var updates = mergeMembershipChangesets(this.ringpop, this.stashedUpdates);

    var numStashedUpdates = this.stashedUpdates.reduce(reduceUpdates, 0);

    if (numStashedUpdates > updates.length) {
        this.ringpop.logger.debug('ringpop membership set consolidated stashed updates', {
            local: this.ringpop.whoami(),
            numStashedUpdates: numStashedUpdates,
            numMergedUpdates: updates.length
        });
    }

    for (var i = 0; i < updates.length; i++) {
        var update = updates[i];

        var member = new Member(
            update.address,
            update.status,
            update.incarnationNumber);

        this.members.push(member);
        this.membersByAddress[member.address] = member;
    }

    this.stashedUpdates = null;

    this.computeChecksum();
    this.emit('set', updates);

    function reduceUpdates(total, updates) {
        total += updates.length;
        return total;
    }
};

Membership.prototype.update = function update(changes, isLocal) {
    if (!changes) {
        return;
    }

    changes = Array.isArray(changes) ? changes : [changes];

    this.ringpop.stat('gauge', 'changes.apply', changes.length);

    if (changes.length === 0) {
        return [];
    }

    // Buffer updates until ready.
    if (!isLocal && !this.ringpop.isReady) {
        if (Array.isArray(this.stashedUpdates)) {
            this.stashedUpdates.push(changes);
        }

        return [];
    }

    // Changes will be evaluated against membership update rules.
    // Not all changes will be applied.
    var self = this;
    var updates = [];

    for (var i = 0 ; i < changes.length; i++) {
        var change = changes[i];

        var member = this.findMemberByAddress(change.address);

        // If first time seeing member, take change wholesale.
        if (!member) {
            applyUpdate(change);
            updates.push(change);
            continue;
        }

        // If is local override, reassert that member is alive!
        if (MembershipUpdateRules.isLocalSuspectOverride(this.ringpop, member, change) ||
            MembershipUpdateRules.isLocalFaultyOverride(this.ringpop, member, change)) {
            var assertion = {
                status: Member.Status.alive,
                incarnationNumber: Date.now()
            };

            applyUpdate(_.extend(change, assertion));
            updates.push(change);
            continue;
        }

        // If non-local update, take change wholesale.
        if (MembershipUpdateRules.isAliveOverride(member, change) ||
            MembershipUpdateRules.isSuspectOverride(member, change) ||
            MembershipUpdateRules.isFaultyOverride(member, change) ||
            MembershipUpdateRules.isLeaveOverride(member, change)) {
            applyUpdate(change);
            updates.push(change);
        }
    }

    if (updates.length > 0) {
        this.computeChecksum();
        this.emit('updated', updates);
    }

    return updates;

    function applyUpdate(update) {
        var address = update.address;
        var incarnationNumber = update.incarnationNumber;

        if (typeof address === 'undefined' ||
            address === null ||
            typeof incarnationNumber === 'undefined' ||
            incarnationNumber === null) {
            // TODO Maybe throw?
            return;
        }

        var member = self.findMemberByAddress(address);

        if (!member) {
            member = new Member(address, update.status, incarnationNumber);

            // TODO localMember is carried around as a convenience.
            // Get rid of it eventually.
            if (member.address === self.ringpop.whoami()) {
                self.localMember = member;
            }

            self.members.splice(self.getJoinPosition(), 0, member);
            self.membersByAddress[member.address] = member;
        }

        member.status = update.status;
        member.incarnationNumber = incarnationNumber;

        if (update.source !== self.ringpop.whoami()) {
            self.ringpop.logger.debug('ringpop applied remote update', {
                local: self.ringpop.whoami(),
                remote: update.source,
                updateId: update.id
            });
        }

        return member;
    }
};

Membership.prototype.shuffle = function shuffle() {
    this.members = _.shuffle(this.members);
};

Membership.prototype.toString = function toString() {
    return JSON.stringify(_.pluck(this.members, 'address'));
};

/* jshint maxparams: 5 */
function makeUpdate(membership, address, incarnationNumber, status, isLocal) {
    var ringpop = membership.ringpop;

    var localMember = membership.localMember || {
        address: address,
        incarnationNumber: incarnationNumber
    };

    var updateId = uuid.v4();
    var updates = membership.update({
        id: updateId,
        source: localMember.address,
        sourceIncarnationNumber: localMember.incarnationNumber,
        address: address,
        status: status,
        incarnationNumber: incarnationNumber,
        timestamp: Date.now()
    }, isLocal);

    if (updates.length > 0) {
        var logData = {};
        logData.local = ringpop.whoami();
        logData[status] = address;
        logData.updateId = updateId;
        ringpop.logger.debug('ringpop member declares other member ' + status, logData);
    }

    return updates;
}

module.exports = Membership;
