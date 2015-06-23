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
var util = require('util');

function Membership(ringpop) {
    this.ringpop = ringpop;
    this.members = [];
    this.membersByAddress = {};
    this.checksum = null;

    this.stashedChanges = [];
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

    this.ringpop.stat('timing', 'compute-checksum', start);
    this.ringpop.stat('gauge', 'checksum', this.checksum);

    return this.checksum;
};

Membership.prototype.findMemberByAddress = function findMemberByAddress(address) {
    return this.membersByAddress[address];
};

Membership.prototype.generateChecksumString = function generateChecksumString() {
    var checksumStrings = new Array(this.members.length);

    for (var i = 0; i < this.members.length; i++) {
        var member = this.members[i];

        checksumStrings[i] = member.checksumString;
    }

    checksumStrings = checksumStrings.sort();

    var checksumString = '';

    for (var j = 0; j < checksumStrings.length; j++) {
        checksumString += checksumStrings[j];
    }

    return checksumString.substring(0, checksumString.length - 1);
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

Membership.prototype.makeAlive = function makeAlive(address, incarnationNumber, isLocalMemberAlive) {
    var localMember = this.localMember || {};

    return this.update({
        source: localMember.address,
        sourceIncarnationNumber: localMember.incarnationNumber,
        address: address,
        status: Member.Status.alive,
        incarnationNumber: incarnationNumber,
        timestamp: Date.now()
    }, isLocalMemberAlive);
};

Membership.prototype.makeFaulty = function makeFaulty(address, incarnationNumber) {
    var localMember = this.localMember || {};

    return this.update({
        source: localMember.address,
        sourceIncarnationNumber: localMember.incarnationNumber,
        address: address,
        status: Member.Status.faulty,
        incarnationNumber: incarnationNumber,
        timestamp: Date.now()
    });
};

Membership.prototype.makeLeave = function makeLeave(address, incarnationNumber) {
    var localMember = this.localMember || {};

    return this.update({
        source: localMember.address,
        sourceIncarnationNumber: localMember.incarnationNumber,
        address: address,
        status: Member.Status.leave,
        incarnationNumber: incarnationNumber,
        timestamp: Date.now()
    });
};

Membership.prototype.makeSuspect = function makeSuspect(address, incarnationNumber) {
    var localMember = this.localMember || {};

    return this.update({
        source: localMember.address,
        sourceIncarnationNumber: localMember.incarnationNumber,
        address: address,
        status: Member.Status.suspect,
        incarnationNumber: incarnationNumber,
        timestamp: Date.now()
    });
};

Membership.prototype.set = function set(memberships) {
    if (!Array.isArray(memberships) || memberships.length === 0) {
        return;
    }

    var self = this;
    var sameChecksums = true;
    var lastChecksum = null;

    // Variables local to loops below
    var i;
    var membership;
    var update;

    for (i = 0; i < memberships.length; i++) {
        membership = memberships[i];

        // Versions of ringpop v9.8.12 and prior do not include the membership checksum. If there's
        // any of those in this collection, then invalidate the `sameChecksums` value.
        if (lastChecksum !== null && lastChecksum !== membership.checksum || !membership.checksum) {
            sameChecksums = false;
        }

        lastChecksum = membership.checksum || null;
    }

    var mergeIndex = {};
    var mergedMembership;

    if (sameChecksums) {
        mergedMembership = memberships[0].members;
    } else {
        for (i = 0; i < memberships.length; i++) {
            membership = memberships[i].members;

            for (var j = 0; j < membership.length; j++) {
                update = membership[j];

                // Refrain from adding local member on join
                if (update.address === this.ringpop.whoami()) {
                    continue;
                }

                mergeIntoIndex(update);
            }
        }

        var mergeIndexKeys = Object.keys(mergeIndex);

        mergedMembership = new Array(mergeIndexKeys.length);

        for (i = 0; i < mergeIndexKeys.length; i++) {
            mergedMembership[i] = mergeIndex[mergeIndexKeys[i]];
        }
    }

    mergeStashedChanges();
    var changeset = addMergedMembership();

    this.computeChecksum();
    this.emit('set', changeset);

    function addMergedMembership() {
        var changeset = new Array(mergedMembership.length);

        for (var i = 0; i < mergedMembership.length; i++) {
            var update = mergedMembership[i];

            var member = new Member(
                update.address,
                update.status,
                update.incarnationNumber);

            self.members.push(member);
            self.membersByAddress[member.address] = member;

            changeset[i] = update;
        }

        return changeset;
    }

    function mergeIntoIndex(update) {
        var memberUpdate = mergeIndex[update.address];

        if (!memberUpdate || update.incarnationNumber > memberUpdate.incarnationNumber) {
            mergeIndex[update.address] = update;
        }
    }

    function mergeStashedChanges() {
        for (var i = 0; i < self.stashedChanges.length; i++) {
            mergeIntoIndex(self.stashedChanges[i]);
        }
    }
};

Membership.prototype.update = function update(changes, isLocalMemberAlive) {
    changes = Array.isArray(changes) ? changes : [changes];

    if (!this.ringpop.isReady && !isLocalMemberAlive) {
        this.stashedChanges = this.stashedChanges.concat(changes);
        return;
    }

    this.ringpop.stat('gauge', 'changes.apply', changes.length);

    if (changes.length === 0) {
        return;
    }

    // Changes will be evaluated against membership update rules.
    // Not all changes will be applied.
    var updates = [];

    for (var i = 0 ; i < changes.length; i++) {
        var change = changes[i];

        if (this.updateOne(change)) {
            updates.push(change);
        }
    }

    if (updates.length > 0) {
        this.computeChecksum();
        this.emit('updated', updates);
    }

    return updates;
};

Membership.prototype.updateOne = function updateOne(change) {
    var self = this;

    var member = this.findMemberByAddress(change.address);

    // If first time seeing member, take change wholesale.
    if (!member) {
        makeUpdate(member, change);
        return true;
    }

    // If is local override, reassert that member is alive!
    if (MembershipUpdateRules.isLocalSuspectOverride(this.ringpop, member, change) ||
        MembershipUpdateRules.isLocalFaultyOverride(this.ringpop, member, change)) {
        var assertion = {
            status: Member.Status.alive,
            incarnationNumber: Date.now()
        };

        makeUpdate(member, _.extend(change, assertion));
        return true;
    }

    // If non-local update, evaluate rules.
    if (MembershipUpdateRules.isAliveOverride(member, change) ||
        MembershipUpdateRules.isSuspectOverride(member, change) ||
        MembershipUpdateRules.isFaultyOverride(member, change) ||
        MembershipUpdateRules.isLeaveOverride(member, change)) {
        makeUpdate(member, change);
        return true;
    }

    return false;

    function makeUpdate(member, update) {
        var address = update.address;
        var incarnationNumber = update.incarnationNumber;

        if (typeof address === 'undefined' ||
            address === null ||
            typeof incarnationNumber === 'undefined' ||
            incarnationNumber === null) {
            // TODO Maybe throw?
            return;
        }

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

        return member;
    }
};

Membership.prototype.shuffle = function shuffle() {
    this.members = _.shuffle(this.members);
};

Membership.prototype.toString = function toString() {
    return JSON.stringify(_.pluck(this.members, 'address'));
};

module.exports = Membership;
