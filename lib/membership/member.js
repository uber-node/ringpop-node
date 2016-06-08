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

var EventEmitter = require('events').EventEmitter;
var events = require('./events.js');
var numOrDefault = require('../util.js').numOrDefault;
var util = require('util');

function Member(ringpop, update) {
    this.ringpop = ringpop;
    this.id = update.address;
    this.address = update.address;
    this.status = update.status;
    this.incarnationNumber = update.incarnationNumber;
    this.dampScore = numOrDefault(update.dampScore,
        ringpop.config.get('dampScoringInitial'));
    this.dampedTimestamp = update.dampedTimestamp;

    this.lastUpdateTimestamp = null;
    this.lastUpdateDampScore = this.dampScore;
    this.Date = Date;
    this.dampingLogger = this.ringpop.loggerFactory.getLogger('damping');
}

util.inherits(Member, EventEmitter);

Member.prototype.decayDampScore = function decayDampScore() {
    var config = this.ringpop.config; // for convenience

    if (this.dampScore === null || typeof this.dampScore === 'undefined') {
        this.dampScore = config.get('dampScoringInitial');
        return;
    }

    // Apply exponential decay of damp score, formally:
    // score(t2) = score(t1) * e^(-(t2-t1) * ln2 / halfLife)
    var timeSince = (this.Date.now() - this.lastUpdateTimestamp) / 1000; // in seconds
    var decay = Math.pow(Math.E, -1 * timeSince * Math.LN2 /
        config.get('dampScoringHalfLife'));

    // - Round to nearest whole. Scoring doesn't need any finer precision.
    // - Keep within lower bound.
    var oldDampScore = this.dampScore;
    this.dampScore = Math.max(Math.round(this.lastUpdateDampScore * decay),
        config.get('dampScoringMin'));

    var reuseLimit = config.get('dampScoringReuseLimit');
    if (oldDampScore > reuseLimit && this.dampScore <= reuseLimit) {
        this.dampingLogger.debug('ringpop member damp score fell below reuse limit', {
            local: this.ringpop.whoami(),
            member: this.address,
            oldDampScore: oldDampScore,
            dampScore: this.dampScore,
            reuseLimit: reuseLimit
        });
        this.ringpop.membership.emit('memberReusable',
            new events.DampingReusableEvent(this, oldDampScore));
    }

    this.emit('dampScoreDecayed', this.dampScore, oldDampScore);
};

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
        this.ringpop.stat('increment', 'refuted-update');
        var newIncNumber = this.Date.now();
        update = {
            source: this.ringpop.whoami(),
            sourceIncarnationNumber: newIncNumber,
            address: this.address,
            status: Member.Status.alive,
            incarnationNumber: newIncNumber
        };
    } else if (!this._isOtherOverride(update)) {
        return;
    }

    // We've got an update. Apply all-the-things.
    var oldStatus = this.status;
    if (this.status !== update.status) {
        this.status = update.status;

        if (this.address === this.ringpop.whoami()) {
            if (this.status === Member.Status.leave) {
                this.ringpop.membership.emit('event',
                    new events.LocalMemberLeaveEvent(this, oldStatus));
            }
        }
    }

    if (this.incarnationNumber !== update.incarnationNumber) {
        this.incarnationNumber = update.incarnationNumber;
    }

    // For damping. Also, you are not allowed to penalize yourself.
    if (this.ringpop.config.get('dampScoringEnabled') &&
            update.address !== this.ringpop.whoami()) {
        // So far, this is very liberal treatment of a flap. Any update
        // will be penalized. The scoring levers will control persistent
        // flaps. We'll eventually get _real_ good at identifying flaps
        // and apply penalties more strictly.
        this._applyUpdatePenalty();
        this.lastUpdateDampScore = this.dampScore;
    }

    this.emit('updated', update);

    // lastUpdateTimestamp must be updated after the penalty is applied
    // because decaying the damp score uses the last timestamp to calculate
    // the rate of decay.
    this.lastUpdateTimestamp = this.Date.now();

    return true;
};

Member.prototype.getStats = function getStats() {
    return {
        address: this.address,
        status: this.status,
        incarnationNumber: this.incarnationNumber,
        dampScore: this.dampScore
    };
};

Member.prototype._applyUpdatePenalty = function _applyUpdatePenalty() {
    var config = this.ringpop.config; // var defined for convenience

    this.decayDampScore();

    // Keep within upper bound
    var oldDampScore = this.dampScore;
    this.dampScore = Math.min(this.dampScore + config.get('dampScoringPenalty'),
        config.get('dampScoringMax'));

    var suppressLimit = config.get('dampScoringSuppressLimit');
    if (oldDampScore < suppressLimit && this.dampScore >= suppressLimit) {
        this.ringpop.membership.emit('memberSuppressLimitExceeded',
            new events.DampingSuppressLimitExceededEvent(this));
        this.dampingLogger.debug('ringpop member damp score exceeded suppress limit', {
            local: this.ringpop.whoami(),
            member: this.address,
            oldDampScore: oldDampScore,
            dampScore: this.dampScore,
            suppressLimit: suppressLimit
        });
    }
};

Member.prototype._isLocalOverride = function _isLocalOverride(update) {
    if (this.ringpop.whoami() !== this.address) {
        return false;
    }

    return update.status === Member.Status.faulty ||
        update.status === Member.Status.suspect ||
        update.status === Member.Status.tombstone;
};

Member.prototype._isOtherOverride = function _isOtherOverride(update) {
    var self = this;

    // update is newer than current member
    if (update.incarnationNumber > self.incarnationNumber) {
        return true;
    }
    // update is older than current member
    if (update.incarnationNumber < self.incarnationNumber) {
        return false;
    }

    return Member.statusPrecedence(update.status) > Member.statusPrecedence(self.status);
};

Member.Status = {
    alive: 'alive',
    faulty: 'faulty',
    leave: 'leave',
    suspect: 'suspect',
    tombstone: 'tombstone'
};

/**
 * Check if a status is pingable. A node would be pinged if its status is either alive or suspect.
 *
 * @param {string} status a valid status (@see {Member.Status})
 * @returns {boolean} true if pingable, false otherwise.
 */
Member.isStatusPingable = function isStatusPingable(status) {
    switch (status) {
        case Member.Status.alive:
        case Member.Status.suspect:
            return true;
        default:
            return false;
    }
};

/**
 * Get the precedence of a status.
 *
 * @param {string} status a valid status (@see {Member.Status})
 * @returns {number} A higher number would mean that the status is considered as a higher priority.
 */
Member.statusPrecedence = function statusPrecedence(status) {
    switch (status) {
        case Member.Status.alive:
            return 0;
        case Member.Status.suspect:
            return 1;
        case Member.Status.faulty:
            return 2;
        case Member.Status.leave:
            return 3;
        case Member.Status.tombstone:
            return 4;
        default:
            // unknown states will never have precedence
            return -1;
    }
};

module.exports = Member;
