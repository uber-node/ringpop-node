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

var gossipLogger = require('../loggers.js').gossipLogger;

function Pinger(ring, member) {
    this.ring = ring;
    this.address = member.address || member;
}

// make sure that callback doesn't get run twice
Pinger.prototype.send = function send(callback) {
    var self = this;
    var changes = this.ring.dissemination.issueAsSender();

    gossipLogger(this.ring, 'ringpop pinger ping send', {
        local: this.ring.whoami(),
        member: this.address,
        changes: changes
    });
    this.ring.client.protocolPing({
        host: this.address,
        timeout: this.ring.pingTimeout
    }, {
        checksum: this.ring.membership.checksum,
        changes: changes,
        source: this.ring.whoami(),
        sourceIncarnationNumber: this.ring.membership.getIncarnationNumber()
    }, onPing);

    function onPing(err, res) {
        if (typeof callback !== 'function') return;

        if (err) {
            gossipLogger(self.ring, 'ringpop pinger ping failed', {
                local: self.ring.whoami(),
                err: err
            });
            callback(err);
            callback = null;
            return;
        }

        var changes = res && res.changes;
        if (Array.isArray(changes)) {
            self.ring.membership.update(changes);
        }

        gossipLogger(self.ring, 'ringpop pinger ping response', {
            local: self.ring.whoami(),
            member: self.address,
            changes: changes
        });
        callback();
        callback = null;
    }
};

module.exports = function sendPing(opts, callback) {
    opts.ringpop.stat('increment', 'ping.send');

    var sender = new Pinger(opts.ringpop, opts.target);
    sender.send(callback);
};
