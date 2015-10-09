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

var globalTimers = require('timers');
var MemberIterator = require('../membership/iterator.js');

function Syncer(opts) {
    this.ringpop = opts.ringpop;
    this.timers = opts.timers || globalTimers;
    this.syncTimer = null;
}

Syncer.prototype.start = function start() {
    var self = this;

    if (this.syncTimer) {
        this.ringpop.logger.warn('ringpop sync timer already started', {
            local: this.ringpop.whoami()
        });
        return;
    }

    schedule();
    this.memberIterator = new MemberIterator(this.ringpop);

    function schedule() {
        self.syncTimer = self.timers.setTimeout(function onTimeout() {
            self.sync(function onSync() {
                schedule();
            });
        }, self.ringpop.config.get('syncInterval'));
    }
};

Syncer.prototype.stop = function stop() {
    if (!this.syncTimer) {
        this.ringpop.logger.warn('ringpop sync timer already stopped', {
            local: this.ringpop.whoami()
        });
        return;
    }

    this.timers.clearTimeout(this.syncTimer);
    this.syncTimer = null;
};

Syncer.prototype.sync = function sync() {
    var self = this;
    var pingableMember = this.memberIterator.next();
    this.ringpop.stat('increment', 'sync.send');
    this.ringpop.client.protocolSync(pingableMember.address, {
        membershipChecksum: this.ringpop.membership.checksum
    }, function onSync(err, response) {
        if (err) {
            return;
        }

        self.ringpop.membership.update(response.membershipChanges);
    });
};

module.exports = Syncer;
