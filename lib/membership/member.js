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
var MembershipEvents = require('./events.js');
var numOrDefault = require('../util.js').numOrDefault;
var util = require('util');

function Member(ringpop, update) {
    this.ringpop = ringpop;
    this.address = update.address;
    this.status = update.status;
    this.incarnationNumber = update.incarnationNumber;
    this.dampScore = numOrDefault(update.dampScore,
        ringpop.config.get('dampScoringInitial'));
    this.dampedTimestamp = update.dampedTimestamp;

    this.lastUpdateTimestamp = null;
    this.lastUpdateDampScore = this.dampScore;
    this.Date = Date;
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
    if (oldDampScore > reuseLimit && this.dampScore <= reuseLimit &&
            this.status === Member.Status.damped) {
        this.ringpop.logger.info('ringpop damped member reached reuse limit', {
            local: this.ringpop.whoami(),
            member: this.getId(),
            dampScore: this.dampScore,
            reuseLimit: reuseLimit
        });
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
        update = _.defaults({
            status: Member.Status.alive,
            incarnationNumber: this.Date.now()
        }, update);
    } else if (!this._isOtherOverride(update)) {
        return;
    }

    // We've got an update. Apply all-the-things.
    var oldStatus = this.status;
    if (this.status !== update.status) {
        this.status = update.status;
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

    this._maybeEmitLocalMemberEvent(oldStatus);
    this.emit('updated', update);

    // lastUpdateTimestamp must be updated after the penalty is applied
    // because decaying the damp score uses the last timestamp to calculate
    // the rate of decay.
    this.lastUpdateTimestamp = this.Date.now();

    return true;
};

Member.prototype.getId = function getId() {
    return this.address;
};

Member.prototype.getStats = function getStats() {
    return {
        address: this.address,
        status: this.status,
        incarnationNumber: this.incarnationNumber,
        dampScore: this.dampScore
    };
};

// Reuse is treated as the opposite of damping. When
// a member is reused, it asserts is aliveness.
Member.prototype.reuse = function reuse() {
    if (this.status !== Member.Status.damped) {
        this.ringpop.logger.warn('ringpop cannot undo damping for a member that is not damped', {
            local: this.ringpop.whoami(),
            member: this.getId(),
            status: this.status
        });
        return false;
    }

    var oldStatus = this.status;
    this.status = Member.Status.alive;
    this.incarnationNumber = this.Date.now();
    this.dampScore = this.ringpop.config.get('dampScoringInitial');
    this._maybeEmitLocalMemberEvent(oldStatus);

    return true;
};

Member.prototype._applyUpdatePenalty = function _applyUpdatePenalty() {
    var config = this.ringpop.config; // var defined for convenience

    this.decayDampScore();

    // Keep within upper bound
    this.dampScore = Math.min(this.dampScore + config.get('dampScoringPenalty'),
        config.get('dampScoringMax'));

    var suppressLimit = config.get('dampScoringSuppressLimit');
    if (this.status !== Member.Status.damped &&
            this.dampScore > suppressLimit) {
        this.ringpop.logger.info('ringpop member damp score exceeded suppress limit', {
            local: this.ringpop.whoami(),
            member: this.address,
            dampScore: this.dampScore,
            suppressLimit: suppressLimit
        });
        this.emit('suppressLimitExceeded');
    }
};

Member.prototype._isLocalOverride = function _isLocalOverride(update) {
    var self = this;

    // A member only refutes itself being set to suspect or faulty. It
    // cannot refute the leave or damped status.
    return isLocalFaultyOverride() || isLocalSuspectOverride();

    function isLocalFaultyOverride() {
        return self.ringpop.whoami() === self.address &&
            update.status === Member.Status.faulty;
    }

    function isLocalSuspectOverride() {
        return self.ringpop.whoami() === self.address &&
            update.status === Member.Status.suspect;
    }
};

Member.prototype._isOtherOverride = function _isOtherOverride(update) {
    var self = this;

    return isAliveOverride() || isSuspectOverride() || isFaultyOverride() ||
        isLeaveOverride() || isDampedOverride();

    function isAliveOverride() {
        return update.status === 'alive' &&
            self.status !== Member.Status.damped &&
            update.incarnationNumber > self.incarnationNumber;
    }

    function isDampedOverride() {
        return update.status === Member.Status.damped &&
            self.status !== Member.Status.damped;
    }

    function isFaultyOverride() {
        return update.status === 'faulty' &&
            ((self.status === 'suspect' && update.incarnationNumber >= self.incarnationNumber) ||
            (self.status === 'faulty' && update.incarnationNumber > self.incarnationNumber) ||
            (self.status === 'alive' && update.incarnationNumber >= self.incarnationNumber));
    }

    function isLeaveOverride() {
        return update.status === 'leave' &&
            self.status !== Member.Status.leave &&
            self.status !== Member.Status.damped && // leave does not override damped
            update.incarnationNumber >= self.incarnationNumber;
    }

    function isSuspectOverride() {
        return update.status === 'suspect' &&
            ((self.status === 'suspect' && update.incarnationNumber > self.incarnationNumber) ||
            (self.status === 'faulty' && update.incarnationNumber > self.incarnationNumber) ||
            (self.status === 'alive' && update.incarnationNumber >= self.incarnationNumber));
    }
};

Member.prototype._maybeEmitLocalMemberEvent = function _maybeEmitLocalMemberEvent(oldStatus) {
    var events = MembershipEvents;
    var AliveEvent = events.LocalMemberAliveEvent;
    var DampedEvent = events.LocalMemberDampedEvent;
    var LeaveEvent = events.LocalMemberLeaveEvent;
    var ReusedEvent = events.LocalMemberReusedEvent;

    if (this.address === this.ringpop.whoami()) {
        if (this.status === Member.Status.leave) {
            this.ringpop.membership.emit(LeaveEvent.name, new LeaveEvent({
                member: this,
                oldStatus: oldStatus
            }));
        } else if (this.status === Member.Status.damped) {
            this.ringpop.membership.emit(DampedEvent.name, new DampedEvent({
                member: this,
                oldStatus: oldStatus
            }));
        } else if (this.status === Member.Status.reuse) {
            this.ringpop.membership.emit(ReusedEvent.name, new ReusedEvent({
                member: this
            }));
        } else if (this.status === Member.Status.alive) {
            this.ringpop.membership.emit(AliveEvent.name, new AliveEvent({
                member: this,
                oldStatus: oldStatus
            }));
        }
    }
};

Member.Status = {
    alive: 'alive',
    damped: 'damped',
    faulty: 'faulty',
    leave: 'leave',
    suspect: 'suspect'
};

module.exports = Member;
