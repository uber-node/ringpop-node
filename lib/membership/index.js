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
var timers = require('timers');
var util = require('util');
var uuid = require('node-uuid');

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
        local: this.ringpop.whoami(),
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
    return this._makeUpdate(address, incarnationNumber, Member.Status.alive,
        address === this.ringpop.whoami());
};

Membership.prototype.makeFaulty = function makeFaulty(address, incarnationNumber) {
    this.ringpop.stat('increment', 'make-faulty');
    return this._makeUpdate(address, incarnationNumber, Member.Status.faulty);
};

Membership.prototype.makeLeave = function makeLeave(address, incarnationNumber) {
    this.ringpop.stat('increment', 'make-leave');
    return this._makeUpdate(address, incarnationNumber, Member.Status.leave);
};

Membership.prototype.makeSuspect = function makeSuspect(address, incarnationNumber) {
    this.ringpop.stat('increment', 'make-suspect');
    return this._makeUpdate(address, incarnationNumber, Member.Status.suspect);
};

// XXX debatable that instead of maintaining changes + callback pairs, we should
// only support an emit('update') event which gives the entire stash update.
Membership.prototype.update = function update(changes, callback) {
    var self = this;

    changes = changes || [];
    changes = Array.isArray(changes) ? changes : [changes];
    self.stashedUpdates.push({
        changes: changes,
        callback: callback,
    });

    if (!self._applyTimer) {
        self._applyTimer = setTimeout(function updateApply() {
            self._applyTimer = null;
            for (var i = 0; i < self.stashedUpdates.length; ++i) {
                var update = self.stashedUpdates[i];
                var changes = update.changes;
                var callback = update.callback;
                self._apply(changes, callback);
            }
            self.stashedUpdates = [];
        }, self.ringpop.config.get('membershipUpdateBatchDelay'));
    }
};

Membership.prototype.updateSync = function update(changes) {
    changes = changes || [];
    changes = Array.isArray(changes) ? changes : [changes];

    var updates = null;
    this._apply(changes, function applying(appliedUpdates) {
        updates = appliedUpdates;
    });
    return updates;
};

// Apply any outstanding batched updates, synchronously calling given callback.
Membership.prototype._apply = function _apply(changes, callback) {
    // Changes will be evaluated against membership update rules.
    // Not all changes will be applied.
    var self = this;
    var updates = [];

    for (var i = 0 ; i < changes.length; i++) {
        var change = changes[i];
        var member = self.findMemberByAddress(change.address);

        if (!member) {
            member = self._createMember(change);

            // localMember is carried around as a convenience.
            if (member.address === self.ringpop.whoami()) {
                self.localMember = member;
            }

            self.members.splice(self.getJoinPosition(), 0, member);
            self.membersByAddress[member.address] = member;

            // Note that I am invoking the 'updated' event handler here. There
            // are two reasons for that. Firstly, what the handler does is
            // necessary here too. Secondly, it is convenient to reuse it.
            onMemberUpdated(change);

            continue;
        }

        // One-time subscription for batching applied updates
        member.once('updated', onMemberUpdated);
        member.evaluateUpdate(change);
        member.removeListener('updated', onMemberUpdated);
    }

    if (updates.length > 0) {
        self.computeChecksum();
        self.emit('updated', updates);
    }
    if (callback) {
        callback(updates);
    }

    self.ringpop.stat('gauge', 'changes.apply', changes.length);
    self.ringpop.stat('gauge', 'changes.update', updates.length);
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

Membership.prototype._makeUpdate = function _makeUpate(address,
        incarnationNumber, status, isLocal) {
    var localMember = this.localMember || {
        address: address,
        incarnationNumber: incarnationNumber
    };

    var updateId = uuid.v4();
    var updates = this.updateSync({
        id: updateId,
        source: localMember.address,
        sourceIncarnationNumber: localMember.incarnationNumber,
        address: address,
        status: status,
        incarnationNumber: incarnationNumber,
        timestamp: Date.now()
    }, null, isLocal);

    if (updates.length > 0) {
        var logData = {};
        logData.local = this.ringpop.whoami();
        logData[status] = address;
        logData.updateId = updateId;
        this.ringpop.logger.debug('ringpop member declares other member ' + status, logData);
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
