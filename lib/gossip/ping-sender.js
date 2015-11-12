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

function PingSender(ring, member, callback) {
    this.ring = ring;
    this.address = member.address || member;
    this.callback = callback;
    this.gossipLogger = this.ring.loggerFactory.getLogger('gossip');
}

PingSender.prototype.onPing = function onPing(err, res) {
    if (!this.callback) {
        return;
    }

    if (err) {
        this.gossipLogger.warn('ringpop ping failed', {
            local: this.ring.whoami(),
            member: this.address,
            err: err
        });
        this.callback(err);
        this.callback = null;
        return;
    }

    if (!res || !res.changes) {
        this.gossipLogger.warn('ping failed member=' + this.address + ' bad response body=' + res);
        return this.doCallback(false);
    }

    this.ring.membership.update(res.changes);
    return this.doCallback(true, res);
};

// make sure that callback doesn't get run twice
PingSender.prototype.doCallback = function doCallback(isOk, bodyObj) {
    bodyObj = bodyObj || {};

    this.gossipLogger.info('ringpop ping response', {
        local: this.ring.whoami(),
        member: this.address,
        err: err,
        res: res
    });

    if (res && res.changes) {
        this.ring.membership.update(res.changes);
    }

    this.callback(null, res);
    this.callback = null;
};

PingSender.prototype.send = function send() {
    var changes = this.ring.dissemination.issueAsSender();
    this.gossipLogger.info('ringpop ping send', {
        local: this.ring.whoami(),
        member: this.address,
        changes: changes
    });

    var self = this;
    this.ring.client.protocolPing({
        host: this.address,
        retryLimit: 1,
        timeout: this.ring.pingTimeout
    }, {
        checksum: this.ring.membership.checksum,
        changes: changes,
        source: this.ring.whoami(),
        sourceIncarnationNumber: this.ring.membership.getIncarnationNumber()
    }, function onPing(err, res) {
        self.onPing(err, res);
    });
};

module.exports = function sendPing(opts, callback) {
    opts.ringpop.stat('increment', 'ping.send');

    var sender = new PingSender(opts.ringpop, opts.target, callback);
    sender.send();
};
