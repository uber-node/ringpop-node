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

var _ = require('underscore');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var MAX_NUM_UPDATES = 250;

function numOrDefault(value, defaultValue) {
    return typeof value === 'number' ? value : defaultValue;
}

function MembershipUpdateRollup(options) {
    this.ringpop = options.ringpop;
    this.flushInterval = options.flushInterval;
    this.maxNumUpdates = numOrDefault(options.maxNumUpdates, MAX_NUM_UPDATES);

    this.buffer = {};
    this.firstUpdateTime = null;
    this.lastFlushTime = null;
    this.lastUpdateTime = null;
    this.flushTimer = null;
}

util.inherits(MembershipUpdateRollup, EventEmitter);

MembershipUpdateRollup.prototype.addUpdates = function addUpdates(updates) {
    var ts = Date.now();

    for (var i = 0; i < updates.length; i++) {
        var update = updates[i];

        if (!this.buffer[update.address]) {
            this.buffer[update.address] = [];
        }

        // TODO Replace _.extend with extend module
        var updateWithTimestamp = _.extend({ ts: ts }, update);
        this.buffer[update.address].push(updateWithTimestamp);
    }
};

MembershipUpdateRollup.prototype.destroy = function destroy() {
    clearTimeout(this.flushTimer);
};

MembershipUpdateRollup.prototype.flushBuffer = function flushBuffer() {
    // Nothing to flush if no updates are present in buffer
    if (Object.keys(this.buffer).length === 0) {
        return;
    }

    var now = Date.now();

    var numUpdates = this.getNumUpdates();
    this.ringpop.logger.debug('ringpop flushed membership update buffer', {
        local: this.ringpop.whoami(),
        checksum: this.ringpop.membership.checksum,
        sinceFirstUpdate: this.lastUpdateTime && (this.lastUpdateTime - this.firstUpdateTime),
        sinceLastFlush: this.lastFlushTime && (now - this.lastFlushTime),
        numUpdates: numUpdates,
        updates: numUpdates < this.maxNumUpdates ? this.buffer : null
    });

    this.buffer = {};
    this.firstUpdateTime = null;
    this.lastUpdateTime = null;
    this.lastFlushTime = now;
    this.emit('flushed');
};

MembershipUpdateRollup.prototype.getNumUpdates = function getNumUpdates() {
    var self = this;
    return Object.keys(this.buffer).reduce(function eachKey(total, key) {
        return total + self.buffer[key].length;
    }, 0);
};

MembershipUpdateRollup.prototype.renewFlushTimer = function renewFlushTimer() {
    clearTimeout(this.flushTimer);

    this.flushTimer = setTimeout(
        this.flushBuffer.bind(this), this.flushInterval);
};

MembershipUpdateRollup.prototype.trackUpdates = function trackUpdates(updates) {
    if (!Array.isArray(updates) || updates.length === 0) {
        return;
    }

    var sinceLastUpdate = Date.now() - this.lastUpdateTime;
    if (sinceLastUpdate >= this.flushInterval) {
        this.flushBuffer();
    }

    if (!this.firstUpdateTime) {
        this.firstUpdateTime = Date.now();
    }

    this.renewFlushTimer();
    this.addUpdates(updates);
    this.lastUpdateTime = Date.now();
};

module.exports = MembershipUpdateRollup;
