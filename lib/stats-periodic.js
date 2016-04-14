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

var timers = require('timers');

// local constants
var periodDefault = 5000;
var periodMinimum = 10;

//
// Periodic Stats Timers are bound as such:
//   default:  5000 (see above)
//   <=0    -> disabled (-1)
//   (0,10) -> 10
//   >=10   -> unchanged
//
// Currently supported:
// {
//   timers: { ... }           // (like timer-shim, built in timers module)
//   periods: {
//     default: period-in-ms
//     minimum: period-in-ms   // never allow below this, typ. 10ms
//     membershipChecksum: period-in-ms
//     ringChecksum: period-in-ms
//   }
// }
//
function PeriodicStats(ringpop, options) {
    options = options || {};
    var periods = options.periods || {};

    this.ringpop = ringpop;
    this.options = options;
    this.logger = ringpop.logger;
    this.timers = this.options.timers || ringpop.timers || timers;
    this.running = false;

    this.periodDefault = periods.default || periodDefault;
    this.periodMinimum = periods.minimum || periodMinimum;

    this.membershipChecksumPeriod = this.normalizePeriod(periods.membershipChecksum);
    this.ringChecksumPeriod = this.normalizePeriod(periods.ringChecksum);
}

PeriodicStats.prototype.start = function start() {
    var self = this;

    var setInterval = self.timers.setInterval;

    self.membershipChecksumTimer =
        setInterval(emitMembershipChecksum, self.membershipChecksumPeriod);
    self.membershipChecksumTimer.unref();

    self.ringChecksumTimer =
        setInterval(emitRingChecksum, self.ringChecksumPeriod);
    self.ringChecksumTimer.unref();

    self.running = true;
    return;

    function emitMembershipChecksum() {
        var checksum = self.ringpop.membership.checksum;
        if (checksum !== null && checksum !== undefined) {
            self.ringpop.stat('gauge', 'membership.checksum-periodic', checksum);
        }
    }

    function emitRingChecksum() {
        var checksum = self.ringpop.ring.checksum;
        if (checksum !== null && checksum !== undefined) {
            self.ringpop.stat('gauge', 'ring.checksum-periodic', checksum);
        }
    }
}

PeriodicStats.prototype.stop = function stop() {
    var clearInterval = this.timers.clearInterval;

    this.membershipChecksumTimer && clearInterval(this.membershipChecksumTimer);
    this.membershipChecksumTimer = null;

    this.ringChecksumTimer && clearInterval(this.ringChecksumTimer);
    this.ringChecksumTimer = null;

    this.running = false;
}

PeriodicStats.prototype.normalizePeriod = function normalizePeriod(period) {
    if (period === null || period === undefined) {
        return this.periodDefault;
    }
    if (isNaN(period)) {
        this.logger.warn('invalid stats period found; using default', {
            local: this.ringpop.whoami(),
            period: period,
            default: this.periodDefault
        });
        return this.periodDefault;
    }
    if (period < 0 || period === 0) {
        return -1;
    }
    if (period < 10) {
        this.logger.info('too aggressive stats period found; using minimum', {
            local: this.ringpop.whoami(),
            period: period,
            minimum: this.periodMinimum
        });
        return 10;
    }
    return Number(period);
}

module.exports = PeriodicStats;
