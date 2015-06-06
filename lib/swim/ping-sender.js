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
var safeParse = require('../util').safeParse;

function PingSender(ring, member, callback) {
    this.ring = ring;
    this.address = member.address || member;
    this.callback = callback;
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

PingSender.prototype.send = function send() {
    var options = {
        host: this.address,
        timeout: this.ring.pingTimeout,
        serviceName: 'ringpop',
        hasNoParent: true,
        trace: false,
        headers: {
            'as': 'raw',
            'cn': 'ringpop'
        }
    };

    var changes = this.ring.dissemination.issueChanges();
    var body = JSON.stringify({
        checksum: this.ring.membership.checksum,
        changes: changes,
        source: this.ring.whoami()
    });

    this.ring.debugLog('ping send member=' + this.address + ' changes=' + JSON.stringify(changes), 'p');

    var self = this;
    this.ring.channel
        .waitForIdentified({
            host: options.host
        }, onIdentified);

    function onIdentified(err) {
        if (err) {
            return self.onPing(err);
        }

        self.ring.channel
            .request(options)
            .send('/protocol/ping', null, body, function(err, res, arg2, arg3) {
                if (!err && !res.ok) {
                    err = new Error(String(arg3));
                }
                self.onPing(err, arg2, arg3);
            });
    }
};

module.exports = function sendPing(opts, callback) {
    opts.ringpop.stat('increment', 'ping.send');

    var sender = new PingSender(opts.ringpop, opts.target, callback);
    sender.send();
};
