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

var Member = require('../membership/member');
var _ = require('underscore');

function StateTransitions(options) {
    this.ringpop = options.ringpop;

    var p = _.defaults({}, options.periods, StateTransitions.Defaults);
    this.suspectTimeout = p.suspect;
    this.faultyTimeout = p.faulty;
    this.tombstoneTimeout = p.tombstone;

    this.logger = this.ringpop.loggerFactory.getLogger('statetransitions');

    this.enabled = true;
    this.timers = {};
}

StateTransitions.prototype.enable = function enable() {
    if (this.enabled) {
        this.logger.error('ringpop cannot enable state transitions because it was never disabled', {
            local: this.ringpop.whoami()
        });
        return;
    }

    this.enabled = true;

    this.logger.debug('enabled state transitions protocol', {
        local: this.ringpop.whoami()
    });
};

StateTransitions.prototype.scheduleSuspectToFaulty = function scheduleSuspectToFaulty(member) {
    var self = this;
    this.schedule(member, Member.Status.suspect, this.suspectTimeout, function suspectToFaulty() {
        self.ringpop.membership.makeFaulty(member.address,
            member.incarnationNumber);
    });
};

StateTransitions.prototype.scheduleFaultyToTombstone = function scheduleFaultyToTombstone(member) {
    var self = this;
    this.schedule(member, Member.Status.faulty, this.faultyTimeout, function faultyToTombstone() {
        self.ringpop.membership.makeTombstone(member.address,
            member.incarnationNumber);
    });
};

StateTransitions.prototype.scheduleTombstoneToEvict = function scheduleTombstoneToEvict(member) {
    var self = this;
    this.schedule(member, Member.Status.tombstone, this.tombstoneTimeout, function tombstoneToEvict() {
        self.ringpop.membership.evict(member.address);
    });
};

StateTransitions.prototype.schedule = function schedule(member, state, timeout, transition) {
    if (!this.enabled) {
        this.logger.error('cannot start a state transition because state transitions has not been enabled', {
            local: this.ringpop.whoami()
        });
        return;
    }

    if (member.address === this.ringpop.whoami()) {
        this.logger.debug('cannot start a state transition for the local member', {
            local: this.ringpop.whoami(),
            member: member.address
        });
        return;
    }

    var timer = this.timers[member.address];
    if (timer) {
        if (timer.state === state) {
            this.logger.warn('redundant call to schedule a state transition for member, ignored', {
                local: this.ringpop.whoami(),
                member: member.address,
                state: state,
            });
            return;
        }
        // cancel the previously scheduled transition for the member
        this.cancel(member);
    }

    this.timers[member.address] = {
        timer: setTimeout(transition, timeout),
        state: state
    };

    this.logger.debug('started state transition for member', {
        local: this.ringpop.whoami(),
        member: member.address,
        state: state
    });
};

StateTransitions.prototype.cancel = function cancel(member) {
    var timer = this.timers[member.address];
    if (!timer) {
        this.logger.warn('no state transition for member', {
            local: this.ringpop.whoami(),
            member: member.address
        });
        return;
    }
    clearTimeout(timer.timer);
    delete this.timers[member.address];
    this.logger.debug('cancelled state transition for member', {
        local: this.ringpop.whoami(),
        member: member.address,
        state: timer.state
    });
};

StateTransitions.prototype.disable = function disable() {
    this.enabled = false;

    var timerKeys = Object.keys(this.timers);

    if (timerKeys.length === 0) {
        this.logger.debug('no state transitions to cancel', {
            local: this.ringpop.whoami()
        });
        return;
    }

    timerKeys.forEach(function clearTimers(timerKey) {
        clearTimeout(this.timers[timerKey].timer);
        delete this.timers[timerKey];
    }, this);

    this.logger.debug('cancelled all state transitions', {
        local: this.ringpop.whoami(),
        numTimers: timerKeys.length
    });
};

StateTransitions.Defaults = {
    suspect: 5 * 1000, // 5s
    faulty: 24 * 60 * 60 * 1000, // 24h
    tombstone: 60 * 1000, // 60s
};

module.exports = StateTransitions;
