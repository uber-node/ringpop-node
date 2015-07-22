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
}

// make sure that callback doesn't get run twice
PingSender.prototype.doCallback = function doCallback(isOk, bodyObj) {
    bodyObj = bodyObj || {};

    this.ring.debugLog('ping response member=' + this.address + ' isOk=' + isOk + ' changes=' + JSON.stringify(bodyObj.changes), 'p');

    if (this.callback) {
        this.callback(isOk, bodyObj);
        this.callback = null;
    }
};

PingSender.prototype.send = function send() {
    var self = this;

    var membership = this.ring.membership;

    var changes = this.ring.dissemination.issueAsSender();
    this.ring.debugLog('ping send member=' + this.address + ' changes=' + JSON.stringify(changes), 'p');
    this.ring.clientServer.ping({
        host: this.address,
        timeout: this.ring.pingTimeout,
        body: {
            checksum: membership.checksum,
            changes: changes,
            source: this.ring.whoami(),
            sourceIncarnationNumber: membership.getIncarnationNumber()
        }
    }, onPing);

    function onPing(err, res) {
        if (err) {
            self.ring.debugLog('ping failed member=' + self.address + ' err=' + err.message, 'p');
            return self.doCallback(false);
        }

        if (res && res.changes) {
            self.ring.membership.update(res.changes);
            return self.doCallback(true, res);
        }
        self.ring.logger.warn('ping failed member=' + self.address + ' bad response body=' + res.toString());
        self.doCallback(false);
    }
};

module.exports = function sendPing(opts, callback) {
    opts.ringpop.stat('increment', 'ping.send');

    var sender = new PingSender(opts.ringpop, opts.target, callback);
    sender.send();
};
