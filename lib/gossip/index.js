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

var metrics = require('metrics');
var GossipEvents = require('./events.js');
var sendPing = require('./ping-sender.js').sendPing;
var sendPingReqs = require('./ping-req-sender.js');

var util = require('util');
var EventEmitter = require('events').EventEmitter;


function Gossip(options) {
    this.ringpop = options.ringpop;
    this.minProtocolPeriod = options.minProtocolPeriod ||
        Gossip.Defaults.minProtocolPeriod;
    this.logger = this.ringpop.loggerFactory.getLogger('gossip');

    this.isPinging = false;
    this.isStopped = true;
    this.lastProtocolPeriod = Date.now();
    this.lastProtocolRate = 0;
    this.numProtocolPeriods = 0;
    this.protocolPeriodTimer = null;
    this.protocolRateTimer = null;
    this.protocolTiming = new metrics.Histogram();
    this.protocolTiming.update(this.minProtocolPeriod);
}

util.inherits(Gossip, EventEmitter);

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

Gossip.prototype.getStatus = function getStatus() {
    return this.isStopped ? Gossip.Status.Stopped : Gossip.Status.Started;
};

Gossip.prototype.run = function run() {
    var self = this;

    var protocolDelay = this.computeProtocolDelay();
    this.ringpop.stat('timing', 'protocol.delay', protocolDelay);

    var startTime = new Date();
    this.protocolPeriodTimer = setTimeout(function onGossipTimer() {
        var pingStartTime = Date.now();

        self.tick(function onMemberPinged() {
            self.lastProtocolPeriod = Date.now();
            self.numProtocolPeriods++;
            self.ringpop.stat('timing', 'protocol.frequency', startTime);
            self.protocolTiming.update(Date.now() - pingStartTime); // This keeps the protocol rate in check

            if (self.isStopped) {
                self.logger.debug('ringpop gossip stopped recurring gossip loop', {
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
        this.logger.debug('ringpop gossip has already started', {
            local: this.ringpop.whoami()
        });
        return;
    }

    this.ringpop.membership.shuffle();
    this.run();
    this.startProtocolRateTimer();
    this.isStopped = false;

    this.logger.debug('ringpop started gossip protocol', {
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
        this.logger.warn('ringpop gossip is already stopped', {
            local: this.ringpop.whoami()
        });
        return;
    }

    clearInterval(this.protocolRateTimer);
    this.protocolRateTimer = null;

    clearTimeout(this.protocolPeriodTimer);
    this.protocolPeriodTimer = null;

    this.isStopped = true;

    this.logger.debug('ringpop stopped gossip protocol', {
        local: this.ringpop.whoami()
    });
};

Gossip.prototype.tick = function tick(callback) {
    callback = callback || function() {};

    if (this.isPinging) {
        this.logger.warn('ringpop gossip aborting ping because one is in progress');
        return callback();
    }

    if (!this.ringpop.isReady) {
        this.logger.warn('ringpop gossip ping started before ring initialized');
        return callback();
    }

    var member = this.ringpop.memberIterator.next();

    if (! member) {
        this.logger.warn('ringpop gossip no usable nodes at protocol period');
        return callback();
    }

    var self = this;
    this.isPinging = true;
    var start = new Date();
    sendPing({
        ringpop: self.ringpop,
        target: member
    }, function(err) {
        self.ringpop.stat('timing', 'ping', start);

        // If ping results in a legitimate error, perform ping-req.
        if (err) {
            self.emit('sendingPingReqs', new GossipEvents.SendingPingReqsEvent());
            var pingReqStartTime = new Date();
            // TODO The pinged member's status could have changed to
            // faulty by the time we received and processed the ping
            // response. There are no ill effects to membership state
            // by sending a ping-req to the faulty member (and processing
            // the response), though it does delay the protocol period
            // unnecessarily. We may want to bypass the ping-req here
            // if the member's status is faulty.
            sendPingReqs({
                ringpop: self.ringpop,
                unreachableMember: member,
                pingReqSize: self.ringpop.pingReqSize
            }, function onPingReq() {
                self.ringpop.stat('timing', 'ping-req', pingReqStartTime);
                self.isPinging = false;

                callback.apply(null, Array.prototype.splice.call(arguments, 0));
            });
            return;
        }

        self.isPinging = false;
        callback();
    });
};

Gossip.Defaults = {
    minProtocolPeriod: 200
};

Gossip.Status = {
    Started: 'started',
    Stopped: 'stopped'
};

module.exports = Gossip;
