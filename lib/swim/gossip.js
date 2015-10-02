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

var MembershipEvents = require('../membership/events.js');
var metrics = require('metrics');

function Gossip(options) {
    this.ringpop = options.ringpop;
    this.ringpop.on('ready', this._onRingpopReady.bind(this));
    this._registerMembershipEvents(this.ringpop.membership);
    this.minProtocolPeriod = options.minProtocolPeriod || Gossip.Defaults.minProtocolPeriod;

    this.isStopped = true;
    this.lastProtocolPeriod = Date.now();
    this.lastProtocolRate = 0;
    this.numProtocolPeriods = 0;
    this.protocolPeriodTimer = null;
    this.protocolRateTimer = null;
    this.protocolTiming = new metrics.Histogram();

    this.protocolTiming.update(this.minProtocolPeriod);
}

Gossip.prototype.computeProtocolDelay = function computeProtocolDelay() {
    if (this.numProtocolPeriods) {
        var target = this.lastProtocolPeriod + this.lastProtocolRate;
        return Math.max(target - Date.now(), this.minProtocolPeriod);
    } else {
        // Delay for first tick will be staggered from 0 to `minProtocolPeriod` ms.
        return Math.floor(Math.random() * (this.minProtocolPeriod + 1));
    }
};

Gossip.prototype.computeProtocolRate = function computeProtocolRate() {
    var observed = this.protocolTiming.percentiles([0.5])['0.5'] * 2;
    return Math.max(observed, this.minProtocolPeriod);
};

Gossip.prototype.run = function run() {
    var self = this;

    var protocolDelay = this.computeProtocolDelay();
    this.ringpop.stat('timing', 'protocol.delay', protocolDelay);

    var startTime = new Date();
    this.protocolPeriodTimer = setTimeout(function onGossipTimer() {
        var pingStartTime = Date.now();

        self.ringpop.pingMemberNow(function onMemberPinged() {
            self.lastProtocolPeriod = Date.now();
            self.numProtocolPeriods++;
            self.ringpop.stat('timing', 'protocol.frequency', startTime);
            self.protocolTiming.update(Date.now() - pingStartTime); // This keeps the protocol rate in check

            if (self.isStopped) {
                self.ringpop.logger.debug('stopped recurring gossip loop', {
                    local: self.ringpop.whoami()
                });
                return;
            }

            self.run();
        });
    }, protocolDelay);
};

Gossip.prototype.start = function start() {
    if (!this.isStopped) {
        this.ringpop.logger.debug('gossip has already started', {
            local: this.ringpop.whoami()
        });
        return;
    }

    this.ringpop.membership.shuffle();
    this.run();
    this.startProtocolRateTimer();
    this.isStopped = false;

    this.ringpop.logger.debug('started gossip protocol', {
        local: this.ringpop.whoami()
    });
};

Gossip.prototype.startProtocolRateTimer = function startProtocolRateTimer() {
    var self = this;
    this.protocolRateTimer = setInterval(function () {
        self.lastProtocolRate = self.computeProtocolRate();
    }, 1000);
};

Gossip.prototype.stop = function stop() {
    if (this.isStopped) {
        this.ringpop.logger.warn('gossip is already stopped', {
            local: this.ringpop.whoami()
        });
        return;
    }

    clearInterval(this.protocolRateTimer);
    this.protocolRateTimer = null;

    clearTimeout(this.protocolPeriodTimer);
    this.protocolPeriodTimer = null;

    this.isStopped = true;

    this.ringpop.logger.debug('stopped gossip protocol', {
        local: this.ringpop.whoami()
    });
};

Gossip.prototype._onRingpopReady = function _onRingpopReady() {
    if (this.ringpop.config.get('autoGossip')) {
        this.start();
    }
};

Gossip.prototype._registerMembershipEvents = function _registerMembershipEvents(membership) {
    var events = MembershipEvents;
    membership.on(events.LocalMemberAliveEvent.name, this.start.bind(this));
    membership.on(events.LocalMemberDampedEvent.name, this.stop.bind(this));
    membership.on(events.LocalMemberLeaveEvent.name, this.stop.bind(this));
    membership.on(events.LocalMemberReusedEvent.name, this.start.bind(this));
};

Gossip.Defaults = {
    minProtocolPeriod: 200
};

module.exports = Gossip;
