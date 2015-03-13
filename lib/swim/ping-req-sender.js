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

function PingReqSender(ring, member, target, callback) {
    this.ring = ring;
    this.member = member;
    this.target = target;
    this.callback = callback;

    var options = {
        host: member.address,
        timeout: this.ring.pingReqTimeout
    };
    var body = JSON.stringify({
        checksum: this.ring.membership.checksum,
        changes: this.ring.issueMembershipChanges(),
        source: this.ring.whoami(),
        target: target.address
    });

    var self = this;
    this.ring.channel.send(options, '/protocol/ping-req', null, body, function(err, res1, res2) {
        self.onPingReq(err, res1, res2);
    });
}

PingReqSender.prototype.onPingReq = function (err, res1, res2) {
    if (err) {
        this.ring.logger.warn('bad response to ping-req from ' + this.member.address + ' err=' + err.message);
        return this.callback(true);
    }

    var bodyObj = safeParse(res2.toString());
    if (! bodyObj || !bodyObj.changes || bodyObj.pingStatus === 'undefined') {
        this.ring.logger.warn('bad response body in ping-req from ' + this.member.address);
        return this.callback(true);
    }

    this.ring.membership.update(bodyObj.changes);
    this.ring.debugLog('ping-req recv peer=' + this.member.address + ' target=' + this.target.address + ' isOk=' + bodyObj.pingStatus);
    this.callback(!!!bodyObj.pingStatus); // I don't not totally understand this line
};

module.exports = PingReqSender;
