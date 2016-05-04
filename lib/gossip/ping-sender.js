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

function PingSender(ring, member) {
    this.ring = ring;
    this.address = member.address || member;
    this.gossipLogger = this.ring.loggerFactory.getLogger('gossip');
}

PingSender.prototype.onPing = function onPing(err, res, callback) {
    if (!callback) {
        return;
    }

    if (err) {
        this.gossipLogger.warn('ringpop ping failed', {
            local: this.ring.whoami(),
            member: this.address,
            err: err
        });
        callback(err);
        return;
    }

    if (!res || !res.changes) {
        this.gossipLogger.warn('ping failed member=' + this.address + ' bad response body=' + res);
        callback(new Error('Ping failed: no response'));
        return;
    }

    this.gossipLogger.info('ringpop ping response', {
        local: this.ring.whoami(),
        member: this.address,
        err: err,
        res: res
    });
    this.ring.membership.update(res.changes);
    callback(err, res);
    return;
};

PingSender.prototype.sendChanges = function sendChanges(changes, callback) {
    var self = this;

    self.gossipLogger.info('ringpop ping send', {
        local: self.ring.whoami(),
        member: self.address,
        changes: changes
    });
    self.ring.client.protocolPing({
        host: self.address,
        retryLimit: self.ring.config.get('tchannelRetryLimit'),
        timeout: self.ring.pingTimeout
    }, {
        checksum: self.ring.membership.checksum,
        changes: changes,
        source: self.ring.whoami(),
        sourceIncarnationNumber: self.ring.membership.getIncarnationNumber()
    }, callback);
};

PingSender.prototype.send = function send(callback) {
    var self = this;

    self.ring.dissemination.issueAsSender(function issues(changes, onIssue) {
        self.sendChanges(changes, function changesSent(err, res) {
            onIssue(err);
            self.onPing(err, res, callback);
        });
    });
};

PingSender.sendPing = function sendPing(opts, callback) {
    opts.ringpop.stat('increment', 'ping.send');

    var sender = new PingSender(opts.ringpop, opts.target);
    sender.send(callback);
};

module.exports = PingSender;
