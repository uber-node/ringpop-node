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
var clearTimeout = require('timers').clearTimeout;
var globalSetTimeout = require('timers').setTimeout;
var metrics = require('metrics');
var safeParse = require('./util').safeParse;
var TypedError = require('error/typed');

function PingReqSender(ring, member, target, callback) {
    this.ring = ring;
    this.member = member;
    this.target = target;
    this.callback = callback;

    var options = {
        host: member.address,
        timeout: this.ring.pingReqTimeout
    };
    var body = JSON.stringify({
        checksum: this.checksum,
        changes: this.ring.issueMembershipChanges(),
        source: this.ring.whoami(),
        target: target.address
    });

    var self = this;
    this.ring.channel.send(options, '/protocol/ping-req', null, body, function(err, res1, res2) {
        self.onPingReq(err, res1, res2);
    });
}

PingReqSender.prototype.onPingReq = function (err, res1, res2) {
    if (err) {
        this.ring.logger.warn('bad response to ping-req from ' + this.member.address + ' err=' + err.message);
        return this.callback(true);
    }

    var bodyObj = safeParse(res2.toString());
    if (! bodyObj || !bodyObj.changes || bodyObj.pingStatus === 'undefined') {
        this.ring.logger.warn('bad response body in ping-req from ' + this.member.address);
        return this.callback(true);
    }

    this.ring.membership.update(bodyObj.changes);
    this.ring.debugLog('ping-req recv peer=' + this.member.address + ' target=' + this.target.address + ' isOk=' + bodyObj.pingStatus);
    this.callback(!!!bodyObj.pingStatus); // I don't not totally understand this line
};

function PingSender(ring, member, callback) {
    this.ring = ring;
    this.address = member.address || member;
    this.callback = callback;

    var options = {
        host: this.address,
        timeout: ring.pingTimeout
    };
    var changes = ring.issueMembershipChanges();
    var body = JSON.stringify({
        checksum: ring.membership.checksum,
        changes: changes,
        source: ring.whoami()
    });

    this.ring.debugLog('ping send member=' + this.address + ' changes=' + JSON.stringify(changes), 'p');

    var self = this;
    this.ring.channel.send(options, '/protocol/ping', null, body, function(err, res1, res2) {
        self.onPing(err, res1, res2);
    });
}

PingSender.prototype.onPing = function onPing(err, res1, res2) {
    if (err) {
        this.ring.debugLog('ping failed member=' + this.address + ' err=' + err.message, 'p');
        return this.doCallback(false);
    }

    var bodyObj = safeParse(res2.toString());
    if (bodyObj && bodyObj.changes) {
        this.ring.membership.update(bodyObj.changes);
        return this.doCallback(true, bodyObj);
    }
    this.ring.logger.warn('ping failed member=' + this.address + ' bad response body=' + res2.toString());
    return this.doCallback(false);
};

// make sure that callback doesn't get run twice
PingSender.prototype.doCallback = function doCallback(isOk, bodyObj) {
    bodyObj = bodyObj || {};

    this.ring.debugLog('ping response member=' + this.address + ' isOk=' + isOk + ' changes=' + JSON.stringify(bodyObj.changes), 'p');

    if (this.callback) {
        this.callback(isOk, bodyObj);
        this.callback = null;
    }
};

function Gossip(ringpop) {
    this.ringpop = ringpop;

    this.isStopped = true;
    this.lastProtocolPeriod = Date.now();
    this.lastProtocolRate = 0;
    this.minProtocolPeriod = 200;
    this.numProtocolPeriods = 0;
    this.protocolTiming = new metrics.Histogram();
    this.protocolTiming.update(this.minProtocolPeriod);
    this.protocolPeriodTimer = null;
    this.protocolRateTimer = null;
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
                    local: self.ringpop.membership.getLocalMemberAddress()
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
            local: this.ringpop.membership.getLocalMemberAddress()
        });
        return;
    }

    this.ringpop.membership.shuffle();
    this.run();
    this.startProtocolRateTimer();
    this.isStopped = false;

    this.ringpop.logger.debug('started gossip protocol', {
        local: this.ringpop.membership.getLocalMemberAddress()
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
            local: this.ringpop.membership.getLocalMemberAddress()
        });
        return;
    }

    clearInterval(this.protocolRateTimer);
    this.protocolRateTimer = null;

    clearTimeout(this.protocolPeriodTimer);
    this.protocolPeriodTimer = null;

    this.isStopped = true;

    this.ringpop.logger.debug('stopped gossip protocol', {
        local: this.ringpop.membership.getLocalMemberAddress()
    });
};

function Suspicion(ringpop) {
    this.ringpop = ringpop;
    this.isStoppedAll = null;
    this.timers = {};
    this.period = 5000;
}

Suspicion.prototype.reenable = function reenable() {
    if (this.isStoppedAll !== true) {
        this.ringpop.logger.warn('cannot reenable suspicion protocol because it was never disabled', {
            local: this.ringpop.membership.getLocalMemberAddress()
        });
        return;
    }

    this.isStoppedAll = null;

    this.ringpop.logger.debug('reenabled suspicion protocol', {
        local: this.ringpop.membership.getLocalMemberAddress()
    });
};

Suspicion.prototype.setTimeout = function setTimeout(fn) {
    return globalSetTimeout(fn, this.period);
};

Suspicion.prototype.start = function start(member) {
    if (this.isStoppedAll === true) {
        this.ringpop.logger.debug('cannot start a suspect period because suspicion has not been reenabled', {
            local: this.ringpop.membership.getLocalMemberAddress()
        });
        return;
    }

    if (member.address === this.ringpop.membership.getLocalMemberAddress()) {
        this.ringpop.logger.debug('cannot start a suspect period for the local member', {
            local: this.ringpop.membership.getLocalMemberAddress(),
            suspect: member.address
        });
        return;
    }

    if (this.timers[member.address]) {
        this.stop(member);
    }

    var self = this;
    this.timers[member.address] = this.setTimeout(function() {
        self.ringpop.membership.makeFaulty(member.address);
        self.ringpop.logger.info('ringpop member declares member faulty', {
            local: self.ringpop.whoami(),
            faulty: member.address
        });
    });

    this.ringpop.logger.debug('started suspect period', {
        local: this.ringpop.membership.getLocalMemberAddress(),
        suspect: member.address
    });
};

Suspicion.prototype.stop = function stop(member) {
    clearTimeout(this.timers[member.address]);
    delete this.timers[member.address];

    this.ringpop.logger.debug('stopped members suspect timer', {
        local: this.ringpop.membership.getLocalMemberAddress(),
        suspect: member.address
    });
};

Suspicion.prototype.stopAll = function stopAll() {
    this.isStoppedAll = true;

    var timerKeys = Object.keys(this.timers);

    if (timerKeys.length === 0) {
        this.ringpop.logger.debug('stopped no suspect timers', {
            local: this.ringpop.membership.getLocalMemberAddress()
        });
        return;
    }

    timerKeys.forEach(function clearSuspect(timerKey) {
        clearTimeout(this.timers[timerKey]);
        delete this.timers[timerKey];
    }, this);

    this.ringpop.logger.debug('stopped all suspect timers', {
        local: this.ringpop.membership.getLocalMemberAddress(),
        numTimers: timerKeys.length
    });
};

module.exports = {
    Gossip: Gossip,
    PingReqSender: PingReqSender,
    PingSender: PingSender,
    Suspicion: Suspicion
};
