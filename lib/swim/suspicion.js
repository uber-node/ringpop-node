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

function Suspicion(options) {
    this.ringpop = options.ringpop;
    this.period = options.suspicionTimeout ||
        Suspicion.Defaults.suspicionTimeout;

    this.isStoppedAll = null;
    this.timers = {};
}

Suspicion.prototype.reenable = function reenable() {
    if (this.isStoppedAll !== true) {
        this.ringpop.logger.warn('cannot reenable suspicion protocol because it was never disabled', {
            local: this.ringpop.whoami()
        });
        return;
    }

    this.isStoppedAll = null;

    this.ringpop.logger.debug('reenabled suspicion protocol', {
        local: this.ringpop.whoami()
    });
};

Suspicion.prototype.start = function start(member) {
    if (this.isStoppedAll === true) {
        this.ringpop.logger.debug('cannot start a suspect period because suspicion has not been reenabled', {
            local: this.ringpop.whoami()
        });
        return;
    }

    if (member.address === this.ringpop.whoami()) {
        this.ringpop.logger.debug('cannot start a suspect period for the local member', {
            local: this.ringpop.whoami(),
            suspect: member.address
        });
        return;
    }

    if (this.timers[member.address]) {
        this.stop(member);
    }

    var self = this;
    this.timers[member.address] = setTimeout(function() {
        self.ringpop.membership.makeFaulty(member.address,
            member.incarnationNumber);
    }, self.period);

    this.ringpop.logger.debug('started suspect period', {
        local: this.ringpop.whoami(),
        suspect: member.address
    });
};

Suspicion.prototype.stop = function stop(member) {
    clearTimeout(this.timers[member.address]);
    delete this.timers[member.address];

    this.ringpop.logger.debug('stopped members suspect timer', {
        local: this.ringpop.whoami(),
        suspect: member.address
    });
};

Suspicion.prototype.stopAll = function stopAll() {
    this.isStoppedAll = true;

    var timerKeys = Object.keys(this.timers);

    if (timerKeys.length === 0) {
        this.ringpop.logger.debug('stopped no suspect timers', {
            local: this.ringpop.whoami()
        });
        return;
    }

    timerKeys.forEach(function clearSuspect(timerKey) {
        clearTimeout(this.timers[timerKey]);
        delete this.timers[timerKey];
    }, this);

    this.ringpop.logger.debug('stopped all suspect timers', {
        local: this.ringpop.whoami(),
        numTimers: timerKeys.length
    });
};

Suspicion.Defaults = {
    suspicionTimeout: 5000
};

module.exports = Suspicion;
