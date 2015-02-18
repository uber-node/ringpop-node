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
var createConfigurables = require('./configurables.js');
var globalSetTimeout = require('timers').setTimeout;
var metrics = require('metrics');
var safeParse = require('./util').safeParse;
var TypedError = require('error/typed');

var NoHostsError = TypedError({
    message: 'Could not find any hosts in bootstrap to join.\n' +
        'Try adding more bootstrapHosts.\n',
    type: 'ringpop.swim.no-hosts',
    bootstrapHosts: null
});

function AdminJoiner(params) {
    this.ringpop = params.ringpop;
    this.target = params.target;
    this.callback = params.callback;
    this.maxJoinDuration = params.maxJoinDuration;
    this.configurables = createConfigurables(this.ringpop);

    if (typeof this.target === 'function') {
        this.callback = this.target;
        this.target = null;
    }

    this.isAborted = false;
    this.currentPeer = null;
    this.timer = null;
    this.peersJoined = {};
    this.joinStart = new Date();
    this.candidateHosts = this.selectCandidateHosts();
    this.peersToJoin = Math.min(this.configurables.joinSize(), this.candidateHosts.length);
}

AdminJoiner.prototype.selectCandidateHosts = function selectCandidateHosts() {
    var self = this;

    return this.ringpop.bootstrapHosts.filter(function (hostPort) {
        return hostPort !== self.ringpop.hostPort;
    });
};

AdminJoiner.prototype.sendJoin = function sendJoin() {
    if (this.candidateHosts.length === 0) {
        this.ringpop.logger.warn('no hosts in bootstrap set to join');
        if (this.callback) {
            this.callback(NoHostsError({
                bootstrapHosts: this.ringpop.bootstrapHosts
            }));
        }
        return;
    }

    if (this.target && this.target !== this.ringpop.hostPort) {
        this.currentPeer = this.target;
    } else {
        this.currentPeer = this.candidateHosts[Math.floor(Math.random() * this.candidateHosts.length)];
    }

    if (this.peersJoined[this.currentPeer]) {
        this.rejoin();
        return;
    }

    var options = {
        host: this.currentPeer,
        timeout: this.configurables.pingReqTimeout()
    };
    var local = this.ringpop.membership.localMember;
    var body = {
        app: this.ringpop.app,
        source: local.address,
        incarnationNumber: local.incarnationNumber
    };
    var self = this;
    this.ringpop.channel.send(options, '/protocol/join', null, body, function (err, res1, res2) {
        self.onJoin(err, res1, res2);
    });
};

AdminJoiner.prototype.onJoin = function onJoin(err, res1, res2) {
    if (this.isAborted) {
        return;
    }

    var currentJoinDuration = new Date() - this.joinStart;
    if (currentJoinDuration > this.maxJoinDuration) {
        this.isAborted = true;

        var exceededMsg = 'max join duration exceeded. join aborted';
        this.ringpop.logger.error(exceededMsg, {
            address: this.ringpop.hostPort,
            currentJoinDuration: currentJoinDuration,
            maxJoinDuration: this.maxJoinDuration
        });

        if (this.callback) {
            var err = new Error(exceededMsg);
            err.type = 'ringpop.join-duration-exceeded';
            this.callback(err);
        }

        return;
    }

    if (err) {
        this.ringpop.logger.warn('join cluster failed', {
            err: err.message,
            senderAddress: this.ringpop.hostPort,
            senderApp: this.ringpop.app,
            receiverAddress: this.currentPeer,
            numJoined: Object.keys(this.peersJoined).length,
            numToJoin: this.peersToJoin,
            currentJoinDuration: new Date() - this.joinStart,
            maxJoinDuration: this.maxJoinDuration
        });
        this.rejoin();
        return;
    }

    this.peersJoined[this.currentPeer] = true;

    var bodyObj = safeParse(res2.toString());
    var coordinator = bodyObj && bodyObj.coordinator;
    var membership = bodyObj && bodyObj.membership;

    this.ringpop.logger.info('joined cluster', {
        senderAddress: this.ringpop.hostPort,
        senderApp: this.ringpop.app,
        receiverAddress: coordinator,
        receiverApp: bodyObj.app,
        numJoined: Object.keys(this.peersJoined).length,
        numToJoin: this.peersToJoin
    });

    this.ringpop.membership.update(membership);

    if (Object.keys(this.peersJoined).length < this.peersToJoin) {
        this.rejoin();
    } else if (this.callback) {
        this.callback();
    }
};

AdminJoiner.prototype.rejoin = function rejoin() {
    var self = this;

    // TODO - magic number alert
    this.timer = setTimeout(sendJoin, 20);

    function sendJoin() {
        self.sendJoin();
    }
};

AdminJoiner.prototype.destroy = function destroy() {
    clearTimeout(this.timer);
};

function PingReqSender(ringpop, member, target, callback) {
    this.ringpop = ringpop;
    this.member = member;
    this.target = target;
    this.callback = callback;
    this.configurables = createConfigurables(this.ringpop);

    var options = {
        host: member.address,
        timeout: this.configurables.pingReqTimeout()
    };
    var body = {
        checksum: this.checksum,
        changes: this.ringpop.issueMembershipChanges(),
        source: this.ringpop.whoami(),
        target: target.address
    };

    var self = this;
    this.ringpop.channel.send(options, '/protocol/ping-req', null, body, function(err, res1, res2) {
        self.onPingReq(err, res1, res2);
    });
}

PingReqSender.prototype.onPingReq = function (err, res1, res2) {
    if (err) {
        this.ringpop.logger.warn('bad response to ping-req from ' + this.member.address + ' err=' + err.message);
        return this.callback(true);
    }

    var bodyObj = safeParse(res2.toString());
    if (! bodyObj || !bodyObj.changes || bodyObj.pingStatus === 'undefined') {
        this.ringpop.logger.warn('bad response body in ping-req from ' + this.member.address);
        return this.callback(true);
    }

    this.ringpop.membership.update(bodyObj.changes);
    this.ringpop.debugLog('ping-req recv peer=' + this.member.address + ' target=' + this.target.address + ' isOk=' + bodyObj.pingStatus);
    this.callback(!!!bodyObj.pingStatus); // I don't not totally understand this line
};

function PingSender(ringpop, member, callback) {
    this.ringpop = ringpop;
    this.address = member.address || member;
    this.callback = callback;
    this.configurables = createConfigurables(this.ringpop);

    var options = {
        host: this.address,
        timeout: this.configurables.pingTimeout()
    };
    var changes = this.ringpop.issueMembershipChanges();
    var body = {
        checksum: this.ringpop.membership.checksum,
        changes: changes,
        source: this.ringpop.whoami()
    };

    this.ringpop.debugLog('ping send member=' + this.address + ' changes=' + JSON.stringify(changes), 'p');

    var self = this;
    this.ringpop.channel.send(options, '/protocol/ping', null, body, function(err, res1, res2) {
        self.onPing(err, res1, res2);
    });
}

PingSender.prototype.onPing = function onPing(err, res1, res2) {
    if (err) {
        this.ringpop.debugLog('ping failed member=' + this.address + ' err=' + err.message, 'p');
        return this.doCallback(false);
    }

    var bodyObj = safeParse(res2.toString());
    if (bodyObj && bodyObj.changes) {
        this.ringpop.membership.update(bodyObj.changes);
        return this.doCallback(true, bodyObj);
    }
    this.ringpop.logger.warn('ping failed member=' + this.address + ' bad response body=' + res2.toString());
    return this.doCallback(false);
};

// make sure that callback doesn't get run twice
PingSender.prototype.doCallback = function doCallback(isOk, bodyObj) {
    bodyObj = bodyObj || {};

    this.ringpop.debugLog('ping response member=' + this.address + ' isOk=' + isOk + ' changes=' + JSON.stringify(bodyObj.changes), 'p');

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
    AdminJoiner: AdminJoiner,
    Gossip: Gossip,
    PingReqSender: PingReqSender,
    PingSender: PingSender,
    Suspicion: Suspicion
};
