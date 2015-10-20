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

    if (this.ringpop.config.get('syncerEnabled') === false) {
        this.ringpop.logger.warn('ringpop syncer is disabled', {
            local: this.ringpop.whoami()
        });
        return;
    }

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

Syncer.prototype.sync = function sync(callback) {
    var self = this;
    var pingableMember = this.memberIterator.next();
    if (!pingableMember) {
        this.ringpop.logger.debug('ringpop syncer next member does not exist', {
            local: this.ringpop.whoami()
        });
        process.nextTick(function onTick() {
            callback();
        });
        return;
    }

    this.ringpop.stat('increment', 'sync.send.attempt');
    var membershipChecksum = this.ringpop.membership.checksum;
    var head = {
        gzip: this.ringpop.config.get('syncGzipEnabled')
    };
    var body = {
        membershipChecksum: membershipChecksum
    };
    this.ringpop.client.protocolSync(pingableMember.address, head, body,
            function onSync(err, response) {
        if (err) {
            self.ringpop.stat('increment', 'sync.send.error');
            self.ringpop.logger.warn('ringpop protocol sync error', {
                local: self.ringpop.whoami(),
                target: pingableMember.address,
                err: err
            });
            callback();
            return;
        }

        self.ringpop.stat('increment', 'sync.send.success');
        var membershipChanges = response.membershipChanges;
        if (Array.isArray(membershipChanges) && membershipChanges.length > 0) {
            var updates = self.ringpop.membership.update(response.membershipChanges);
            self.ringpop.logger.info('ringpop syncer applied membership changes', {
                local: self.ringpop.whoami(),
                target: pingableMember.address,
                prevChecksum: membershipChecksum,
                currentChecksum: self.ringpop.membership.checksum,
                targetChecksum: response.membershipChecksum,
                numMembershipChanges: membershipChanges.length,
                numUpdatesApplied: updates.length
            });
        }

        callback();
    });
};

module.exports = Syncer;
