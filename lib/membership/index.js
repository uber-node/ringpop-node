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
var mergeMembershipChangesets = require('./merge.js');
var timers = require('timers');
var update = require('./update.js');
var util = require('util');

var LeaveUpdate = update.LeaveUpdate;
var Update = update.Update;

function Membership(opts) {
    this.ringpop = opts.ringpop; // assumed to be present
    this.setTimeout = opts.setTimeout || timers.setTimeout;
    this.clearTimeout = opts.clearTimeout || timers.clearTimeout;

    this.members = [];
    this.membersByAddress = {};
    this.checksum = null;
    this.stashedUpdates = [];
    this.decayTimer = null;
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

    var prevChecksum = this.checksum;
    this.checksum = farmhash.hash32(this.generateChecksumString());

    this.emit('checksumComputed');
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
        (member.status === 'alive' ||
        member.status === 'suspect');
};

Membership.prototype.makeAlive = function makeAlive(address, incarnationNumber) {
    this.ringpop.stat('increment', 'make-alive');
    var isLocal = address === this.ringpop.whoami();
    return this._updateMember(new Update(address, incarnationNumber,
        Member.Status.alive, this.localMember), isLocal);
};

Membership.prototype.makeFaulty = function makeFaulty(address, incarnationNumber) {
    this.ringpop.stat('increment', 'make-faulty');
    return this._updateMember(new Update(address, incarnationNumber,
        Member.Status.faulty, this.localMember));
};

Membership.prototype.makeLeave = function makeLeave(address, incarnationNumber) {
    this.ringpop.stat('increment', 'make-leave');
    return this._updateMember(new LeaveUpdate(address, incarnationNumber,
        this.localMember));
};

Membership.prototype.makeSuspect = function makeSuspect(address, incarnationNumber) {
    this.ringpop.stat('increment', 'make-suspect');
    return this._updateMember(new Update(address, incarnationNumber,
        Member.Status.suspect, this.localMember));
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

Membership.prototype.update = function update(changes, isLocal) {
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

        if (!member) {
            member = this._createMember(change);

            // localMember is carried around as a convenience.
            if (member.address === this.ringpop.whoami()) {
                this.localMember = member;
            }

            this.members.splice(this.getJoinPosition(), 0, member);
            this.membersByAddress[member.address] = member;

            // Note that I am invoking the 'updated' event handler here. There
            // are two reasons for that. Firstly, what the handler does is
            // necessary here too. Secondly, it is convenient to reuse it.
            onMemberUpdated(change);

            continue;
        }

        // One-time subscription for batching applied updates. Make
        // sure to unsubscribe immediately after evaluating the update.
        // Events are expected to be emitted synchronously and are not
        // guaranteed if the update is determined to be invalid or
        // redundant.
        member.once('updated', onMemberUpdated);
        member.evaluateUpdate(change);
        member.removeListener('updated', onMemberUpdated);
    }

    if (updates.length > 0) {
        this.computeChecksum();
        this.emit('updated', updates);
    }

    return updates;

    function onMemberUpdated(update) {
        if (update.source !== self.ringpop.whoami()) {
            self.ringpop.logger.debug('ringpop applied remote update', {
                local: self.ringpop.whoami(),
                remote: update.source,
                updateId: update.id
            });
        }

        updates.push(update);
    }
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
    var self = this;

    var member = new Member(this.ringpop, update);
    member.on('suppressLimitExceeded', onExceeded);
    return member;

    function onExceeded() {
        self.emit('memberSuppressLimitExceeded', member);
    }
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

Membership.prototype._updateMember = function _updateMember(update, isLocal) {
    var updates = this.update(update, isLocal);

    if (updates.length > 0) {
        this.ringpop.logger.debug('ringpop member declares other member ' +
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
    var membership = new Membership({
        ringpop: ringpop
    });
    membership.on('memberSuppressLimitExceeded', onExceeded);
    membership.startDampScoreDecayer();
    ringpop.on('destroyed', onDestroyed);
    return membership;

    function onDestroyed() {
        membership.stopDampScoreDecayer();
    }

    function onExceeded(/*member*/) {
        // TODO Initiate flap damping subprotocol
    }
};
