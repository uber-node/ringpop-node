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
var safeParse = require('./util').safeParse;

function AdminJoiner(params) {
    this.ringpop = params.ringpop;
    this.target = params.target;
    this.callback = params.callback;
    this.maxJoinDuration = params.maxJoinDuration;

    if (typeof this.target === 'function') {
        this.callback = this.target;
        this.target = null;
    }

    this.isAborted = false;
    this.currentPeer = null;
    this.timer = null;
    this.peersJoined = {};
    this.joinStart = new Date();
    this.candidateHosts = this.selectCandidateHosts();
    this.peersToJoin = Math.min(this.ringpop.joinSize, this.candidateHosts.length);
}

AdminJoiner.prototype.selectCandidateHosts = function selectCandidateHosts() {
    var self = this;

    return this.ringpop.bootstrapHosts.filter(function (hostPort) {
        return hostPort !== self.ringpop.hostPort;
    });
};

AdminJoiner.prototype.sendJoin = function sendJoin() {
    if (this.candidateHosts.length === 0) {
        this.ringpop.logger.warn('no hosts in bootstrap set to join');
        return;
    }

    if (this.target && this.target !== this.ringpop.hostPort) {
        this.currentPeer = this.target;
    } else {
        this.currentPeer = this.candidateHosts[Math.floor(Math.random() * this.candidateHosts.length)];
    }

    if (this.peersJoined[this.currentPeer]) {
        this.rejoin();
        return;
    }

    var options = {
        host: this.currentPeer,
        timeout: this.ringpop.pingReqTimeout
    };
    var local = this.ringpop.membership.localMember;
    var body = {
        app: this.ringpop.app,
        source: local.address,
        incarnationNumber: local.incarnationNumber
    };
    var self = this;
    this.ringpop.channel.send(options, '/protocol/join', null, body, function (err, res1, res2) {
        self.onJoin(err, res1, res2);
    });
};

AdminJoiner.prototype.onJoin = function onJoin(err, res1, res2) {
    if (this.isAborted) {
        return;
    }

    var currentJoinDuration = new Date() - this.joinStart;
    if (currentJoinDuration > this.maxJoinDuration) {
        this.isAborted = true;

        var exceededMsg = 'max join duration exceeded. join aborted';
        this.ringpop.logger.error(exceededMsg, {
            address: this.ringpop.hostPort,
            currentJoinDuration: currentJoinDuration,
            maxJoinDuration: this.maxJoinDuration
        });

        if (this.callback) {
            var err = new Error(exceededMsg);
            err.type = 'ringpop.join-duration-exceeded';
            this.callback(err);
        }

        return;
    }

    if (err) {
        this.ringpop.logger.warn('join cluster failed', {
            err: err.message,
            senderAddress: this.ringpop.hostPort,
            senderApp: this.ringpop.app,
            receiverAddress: this.currentPeer,
            numJoined: Object.keys(this.peersJoined).length,
            numToJoin: this.peersToJoin,
            currentJoinDuration: new Date() - this.joinStart,
            maxJoinDuration: this.maxJoinDuration
        });
        this.rejoin();
        return;
    }

    this.peersJoined[this.currentPeer] = true;

    var bodyObj = safeParse(res2.toString());
    var coordinator = bodyObj && bodyObj.coordinator;
    var membership = bodyObj && bodyObj.membership;

    this.ringpop.logger.info('joined cluster', {
        senderAddress: this.ringpop.hostPort,
        senderApp: this.ringpop.app,
        receiverAddress: coordinator,
        receiverApp: bodyObj.app,
        numJoined: Object.keys(this.peersJoined).length,
        numToJoin: this.peersToJoin
    });

    this.ringpop.membership.update(membership);

    if (Object.keys(this.peersJoined).length < this.peersToJoin) {
        this.rejoin();
    } else if (this.callback) {
        this.callback();
    }
};

AdminJoiner.prototype.rejoin = function rejoin() {
    var self = this;

    // TODO - magic number alert
    this.timer = setTimeout(sendJoin, 20);

    function sendJoin() {
        self.sendJoin();
    }
};

AdminJoiner.prototype.destroy = function destroy() {
    clearTimeout(this.timer);
}

function PingReqSender(ring, member, target, callback) {
    this.ring = ring;
    this.member = member;
    this.target = target;
    this.callback = callback;

    var options = {
        host: member.address,
        timeout: this.ring.pingReqTimeout
    };
    var body = {
        checksum: this.checksum,
        changes: this.ring.issueMembershipChanges(),
        source: this.ring.whoami(),
        target: target.address
    };

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
    this.ring.logger.debug('ping-req recv peer=' + this.member.address + ' target=' + this.target.address + ' isOk=' + bodyObj.pingStatus);
    this.callback(!!!bodyObj.pingStatus); // I don't not totally understand this line
};

function PingSender(ring, member, callback) {
    this.ring = ring;
    this.address = member.address || member;
    this.callback = callback;

    var options = {
        host: this.address,
        timeout: ring.pingTimeout
    };
    var changes = ring.issueMembershipChanges();
    var body = {
        checksum: ring.membership.checksum,
        changes: changes,
        source: ring.whoami()
    };

    this.ring.logger.debug('ping send member=' + this.address + ' changes=' + JSON.stringify(changes), 'p');

    var self = this;
    this.ring.channel.send(options, '/protocol/ping', null, body, function(err, res1, res2) {
        self.onPing(err, res1, res2);
    });
}

PingSender.prototype.onPing = function onPing(err, res1, res2) {
    if (err) {
        this.ring.logger.debug('ping failed member=' + this.address + ' err=' + err.message, 'p');
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

    this.ring.logger.debug('ping response member=' + this.address + ' isOk=' + isOk + ' changes=' + JSON.stringify(bodyObj.changes), 'p');

    if (this.callback) {
        this.callback(isOk, bodyObj);
        this.callback = null;
    }
};

module.exports = {
    AdminJoiner: AdminJoiner,
    PingReqSender: PingReqSender,
    PingSender: PingSender
};
