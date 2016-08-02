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

/**
 * @interface IMember
 *
 * The interface that defines a member object.
 *
 * @property {string} address The address of the member
 * @property {number} incarnationNumber The incarnation number of the member
 * @property {Member.Status} status The status of the member
 */

/**
 * Create a new member
 * @param {Ringpop} ringpop the ringpop instance
 * @param {Update} update the update that returns this member.
 *
 * @property {string} address The address of the member
 * @property {number} incarnationNumber The incarnation number of the member
 * @property {Member.Status} status The status of the member
 *
 * @constructor
 * @implements IMember
 */
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

// We've got an update. Apply all-the-things.
Member.prototype.applyUpdate = function applyUpdate(update) {
    this.status = update.status;
    this.incarnationNumber = update.incarnationNumber;

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

/**
 * Enum for member status.
 *
 * @enum {string}
 */
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

/**
 * Determine if the incoming gossip should be processed or not.
 * The update should be processed if:
 *  - the update is about an unknown member and the status is not 'tombstone'
 *  - the new status takes precedence over the current known status
 *    (@see Member~statusPrecedence)
 *  - the incarnation number is newer

 * @param {Member} [member] The current member or null when the member is currently
 *  unknown.
 * @param {IMember} gossip The incoming update
 * @returns {boolean} if the gossip should be processed or can safely be ignored.
 */
Member.shouldProcessGossip = function shouldProcessGossip(member, gossip) {
    // don't accept tombstone update on unknown member
    if (gossip.status === Member.Status.tombstone && !member) {
        return false;
    }

    // accept changes on new members
    if (!member) {
        return true;
    }

    // gossip is older than current member
    if (gossip.incarnationNumber < member.incarnationNumber) {
        return false;
    }

    // gossip is newer than current member
    if (gossip.incarnationNumber > member.incarnationNumber) {
        return true;
    }

    // gossip takes precedence over current member
    if (Member.statusPrecedence(gossip.status) > Member.statusPrecedence(member.status) ){
        return true;
    }

    return false;
};

module.exports = Member;
