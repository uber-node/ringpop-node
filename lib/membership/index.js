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

var _ = require('underscore');
var EventEmitter = require('events').EventEmitter;
var Member = require('./member.js');
var MemberDampScore = require('./member_damp_score.js');
var MembershipEvents = require('./events.js');
var mergeMembershipChangesets = require('./merge.js');
var timers = require('timers');
var Update = require('./update.js');
var util = require('util');

function Membership(opts) {
    this.ringpop = opts.ringpop; // assumed to be present
    this.setTimeout = opts.setTimeout || timers.setTimeout;
    this.clearTimeout = opts.clearTimeout || timers.clearTimeout;
    this.logger = this.ringpop.loggerFactory.getLogger('membership');

    this.members = [];
    this.membersByAddress = {};
    this.checksum = null;
    this.stashedUpdates = [];
    this.decayTimer = null;
    this.localMember = null;
}

util.inherits(Membership, EventEmitter);

Membership.prototype.collectDampScores =
        function collectDampScores(memberAddresses) {
    var self = this;
    return memberAddresses.reduce(function reduce(result, address) {
        var member = self.findMemberByAddress(address);
        if (member) {
            result.push(new MemberDampScore(member.address, member.dampScore));
        }
        return result;
    }, []);
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

    var prevChecksum = this.checksum;
    this.checksum = this.ringpop.hashFunc(this.generateChecksumString());

    this.emit('checksumComputed', new MembershipEvents.ChecksumComputedEvent(
        this.checksum, prevChecksum));
    this.ringpop.stat('timing', 'compute-checksum', start);
    this.ringpop.stat('gauge', 'checksum', this.checksum);
    if (prevChecksum !== this.checksum) {
        this._emitChecksumUpdate();
    }

    return this.checksum;
};

Membership.prototype._emitChecksumUpdate = function _emitChecksumUpdate() {
    // make counts = {'alive': 12, 'faulty': 3, 'suspect': 0, 'leave': 0}
    var counts = {};
    var keys = Object.keys(Member.Status);
    for (var i = 0; i < keys.length; ++i) {
        counts[Member.Status[keys[i]]] = 0;
    }
    for (i = 0; i < this.members.length; ++i) {
        counts[this.members[i].status] += 1;
    }

    this.emit('checksumUpdate', {
        id: this.ringpop.whoami(),
        address: this.ringpop.whoami(),
        timestamp: Date.now(),
        checksum: this.checksum,
        membershipStatusCounts: counts,
    });
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

        // Don't include Tombstone nodes in the checksum to avoid
        // bringing them back to life through full syncs
        if (member.status === Member.Status.tombstone) {
            continue;
        }

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
    var self = this;

    return {
        checksum: this.checksum,
        members: getMemberStats().sort(function (a, b) {
            return a.address.localeCompare(b.address);
        })
    };

    function getMemberStats() {
        return self.members.map(function map(member) {
            return member.getStats();
        });
    }
};

Membership.prototype.hasMember = function hasMember(member) {
    return !!this.findMemberByAddress(member.address);
};

Membership.prototype.isPingable = function isPingable(member) {
    return member.address !== this.ringpop.whoami() &&
            Member.isStatusPingable(member.status);
};

/**
 * Change the status of the local member to alive
 * @see Membership#setLocalStatus
 * @see Member.Status.alive
 */
Membership.prototype.makeLocalAlive = function makeLocalAlive(){
    this.setLocalStatus(Member.Status.alive);
};

/**
 * Bump the incarnation number of the local member and return an update that
 * described the current state of the local member.
 *
 * @returns {Update} The update to gossip around
 * @private
 */
Membership.prototype._reincarnate = function _reincarnate() {
    this.localMember.incarnationNumber = Date.now();

    return new Update(this.localMember, this.localMember);
};

/**
 * Change the status of the local member. This will also bump the incarnation
 * number of the local member.
 *
 * @param {Member.Status} status The new status
 */
Membership.prototype.setLocalStatus = function setLocalStatus(status) {
    if (this.localMember) {
        if (status === Member.Status.leave) {
            this.emit('event',
                new MembershipEvents.LocalMemberLeaveEvent(this.localMember, this.localMember.status));
        }

        this.localMember.status = status;
    } else {
        this.localMember = new Member(this.ringpop, new Update({
            address: this.ringpop.whoami(),
            incarnationNumber: Date.now(),
            status: status
        }));
        this.members.push(this.localMember);
        this.membersByAddress[this.localMember.address] = this.localMember;
    }

    var update = this._reincarnate();
    this._postLocalUpdate(update);
};

/**
 * Post an 'updated' event describing the local member's current state and
 * recompute the membership checksum.
 * @private
 */
Membership.prototype._postLocalUpdate = function _postLocalUpdate(update){
    this.computeChecksum();
    this.emit('updated', [update]);
};

/**
 * Make a change to the member list.
 *
 * @param {string} address the address of the member.
 * @param {int} incarnationNumber The incarnationNumber of the member.
 * @param {Member.Status} status The (new) status of the member.
 */
Membership.prototype.makeChange = function makeChange(address, incarnationNumber, status) {
    this.ringpop.stat('increment', 'make-'+status);
    var member = this.findMemberByAddress(address);

    var change = new Update(member, this.localMember);

    // in case member is not (yet) known
    change.address = address;

    // overwrite with provided state
    change.incarnationNumber = incarnationNumber;
    change.status = status;

    return this._updateMember(change);
};

Membership.prototype.makeDamped = function makeDamped(address/*, incarnationNumber*/) {
    //TODO this statter should be removed when this function actually calls makeChange to prevent "double statting"!
    this.ringpop.stat('increment', 'make-damped');
    var level = this.ringpop.config.get('dampedErrorLoggingEnabled') ? 'error' : 'warn';
    this.ringpop.logger[level]('ringpop member would have been damped', {
        local: this.ringpop.whoami(),
        damped: address
    });
    // TODO Apply damped status to member
    //return this.makeChange(address, incarnationNumber, Member.Status.damped);
};

Membership.prototype.makeFaulty = function makeFaulty(address, incarnationNumber) {
    return this.makeChange(address, incarnationNumber, Member.Status.faulty);
};

Membership.prototype.makeSuspect = function makeSuspect(address, incarnationNumber) {
    return this.makeChange(address, incarnationNumber, Member.Status.suspect);
};

Membership.prototype.makeTombstone = function makeTombstone(address, incarnationNumber) {
    return this.makeChange(address, incarnationNumber, Member.Status.tombstone);
};

Membership.prototype.removeMember = function removeMember(address) {
    var hasMember = _.has(this.membersByAddress, address);
    if (!hasMember) {
        return;
    }
    var memberToDelete = this.membersByAddress[address];
    delete this.membersByAddress[address];
    this.members = _.without(this.members, memberToDelete);
    this.computeChecksum();
};

Membership.prototype.evict = function evict(address) {
    if (this.localMember.address === address) {
        this.logger.error('ringpop tried to evict the local member from the memberlist, action has been prevented');
        return;
    }
    this.removeMember(address);
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
        this.logger.debug('ringpop membership set consolidated stashed updates', {
            local: this.ringpop.whoami(),
            numStashedUpdates: numStashedUpdates,
            numMergedUpdates: updates.length
        });
    }

    for (var i = 0; i < updates.length; i++) {
        var update = updates[i];
        // avoid indefinite tombstones by not creating new nodes directly in
        // this state when applying stashed updates
        if (update.status === Member.Status.tombstone) {
            continue;
        }
        var member = this._createMember(update);
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

Membership.prototype.update = function update(changes) {
    changes = Array.isArray(changes) ? changes : [changes];

    this.ringpop.stat('gauge', 'changes.apply', changes.length);

    if (changes.length === 0) {
        return [];
    }

    // Buffer updates until ready.
    if (!this.ringpop.isReady) {
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

        if (Member.shouldProcessGossip(member, change)) {
            if (change.address === self.localMember.address) {
                self.ringpop.stat('increment', 'refuted-update');

                change = self._reincarnate();
            } else {
                if (!member) {
                    member = this._createMember(change);

                    this.members.splice(this.getJoinPosition(), 0, member);
                    this.membersByAddress[member.address] = member;
                } else {
                    member.applyUpdate(change);
                }
            }
            if (change.source !== self.ringpop.whoami()) {
                self.logger.debug('ringpop applied remote update', {
                    local: self.ringpop.whoami(),
                    remote: change.source,
                    updateId: change.id
                });
            }

            updates.push(change);
        }
    }

    if (updates.length > 0) {
        this.computeChecksum();
        this.emit('updated', updates);
    }

    return updates;
};

Membership.prototype.shuffle = function shuffle() {
    this.members = _.shuffle(this.members);
};

Membership.prototype.startDampScoreDecayer = function startDampScoreDecayer() {
    var self = this;

    if (this.decayTimer) {
        return;
    }

    schedule();

    function schedule() {
        var config = self.ringpop.config; // for convenience
        if (!config.get('dampScoringDecayEnabled')) {
            return;
        }

        self.decayTimer = self.setTimeout(function onTimeout() {
            self._decayMembersDampScore();
            schedule(); // loop until stopped or disabled
        }, config.get('dampScoringDecayInterval'));
    }
};

Membership.prototype.stopDampScoreDecayer = function stopDampScoreDecayer() {
    if (this.decayTimer) {
        clearTimeout(this.decayTimer);
        this.decayTimer = null;
    }
};

Membership.prototype.toString = function toString() {
    return JSON.stringify(_.pluck(this.members, 'address'));
};

Membership.prototype._createMember = function _createMember(update) {
    var member = new Member(this.ringpop, update);
    return member;
};

Membership.prototype._decayMembersDampScore = function _decayMembersDampScore() {
    // TODO Slightly inefficient. We don't need to run through the entire
    // membership list decaying damp scores. We really only need to decay
    // the scores of members that have not had their scores reset to 0.
    // Consider a more efficient decay mechanism.
    for (var i = 0; i < this.members.length; i++) {
        this.members[i].decayDampScore();
    }
};

Membership.prototype._updateMember = function _updateMember(update) {
    var updates = this.update(update);

    if (updates.length > 0) {
        this.logger.debug('ringpop member declares other member ' +
            update.status, {
                local: this.ringpop.whoami(),
                update: updates[0]
        });
    }

    return updates;
};

module.exports = function initMembership(ringpop) {
    // It would be more correct to start Membership's background decayer once
    // we know that a member has been penalized for a flap. But it's
    // OK to start prematurely.
    var membership = new Membership({ ringpop: ringpop });
    membership.startDampScoreDecayer();
    return membership;
};
