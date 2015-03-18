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
var TypedError = require('error/typed');

var BadPingReqPingStatusError = TypedError({
    type: 'ringpop.ping-req.bad-ping-status',
    message: 'Bad ping status from ping-req ping',
    selected: null,
    target: null
});

var BadPingReqRespBodyError = TypedError({
    type: 'ringpop.ping-req.bad-resp-body',
    message: 'Bad response from ping-req: {body}',
    selected: null,
    target: null,
    body: null
});

var NoMembersError = TypedError({
    type: 'ringpop.ping-req.no-members',
    message: 'No selectable ping-req members'
});

var PingReqInconclusiveError = TypedError({
    type: 'ringpop.ping-req.inconclusive',
    message: 'Ping-req is inconclusive'
});

var PingReqPingError = TypedError({
    type: 'ringpop.ping-req.ping',
    message: 'An error occurred on ping-req ping: {errMessage}',
    errMessage: null
});

function PingReqSender(ring, member, target, callback) {
    this.ring = ring;
    this.member = member;
    this.target = target;
    this.callback = callback;
}

PingReqSender.prototype.send = function send() {
    var self = this;

    this.ring.channel
        .waitForIdentified({
            host: sendOptions(this).host
        }, onIdentified);

    function onIdentified(err) {
        if (err) {
            return self.onPingReq(err);
        }

        self.ring.channelWrapper.pingReq({
            host: self.member.address,
            timeout: self.ring.pingReqTimeout,
            body: {
                checksum: self.ring.membership.checksum,
                changes: self.ring.dissemination.issueChanges(),
                source: self.ring.whoami(),
                target: self.target.address
            }
        }, onPingReq);
    }

    function onPingReq(err, res) {
        // TODO Make this less janky. Compare against TypedError type.
        if (err && err.type === 'ringpop.ping-req.target-unreachable') {
            if (err.changes) {
                self.ring.membership.update(err.changes);
            }

            self.ring.logger.debug('ping-req target is unreachable', {
                local: self.ring.whoami(),
                member: self.member.address,
                target: self.target.address
            });

            self.callback(BadPingReqPingStatusError({
                selected: self.member.address,
                target: self.target.address
            }));
            return;
        }

        if (err) {
            self.ring.logger.warn('bad response to ping-req from ' + self.member.address + ' err=' + err.message);
            self.callback(PingReqPingError({
                errMessage: err.message
            }));
            return;
        }

        if (!res || !res.changes) {
            self.ring.logger.warn('bad response body in ping-req from ' + self.member.address);
            self.callback(BadPingReqRespBodyError({
                selected: self.member.address,
                target: self.target.address,
                body: (res && res.toString())
            }));
            return;
        }

        self.ring.membership.update(res.changes);

        self.ring.logger.debug('ping-req target is reachable', {
            local: self.ring.whoami(),
            member: self.member.address,
            target: self.target.address
        });

        self.callback();
    }
};

module.exports = function sendPingReq(opts, callback) {
    var ringpop = opts.ringpop;
    var unreachableMember = opts.unreachableMember;
    var pingReqSize = opts.pingReqSize;

    ringpop.stat('increment', 'ping-req.send');

    var pingReqMembers = randomMembers();
    ringpop.stat('timing', 'ping-req.other-members', pingReqMembers.length);

    if (pingReqMembers.length === 0) {
        callback(NoMembersError());
        return;
    }

    var addrs = pingReqAddrs(pingReqMembers);
    var calledBack = false;
    var errors = [];
    var startTime = Date.now();
    var unreachableMemberInfo = {
        address: unreachableMember.address,
        startingStatus: unreachableMember.status
    };

    for (var i = 0; i < pingReqMembers.length; i++) {
        var pingReqMember = pingReqMembers[i];

        // TODO Cleanup this log site
        ringpop.debugLog('ping-req send peer=' + pingReqMember.address +
            ' target=' + unreachableMember.address, 'p');

        var sender = new PingReqSender(ringpop, pingReqMember, unreachableMember,
            onPingReqHandler(pingReqMember, pingReqMember.status));
        sender.send();
    }

    function onPingReqHandler(pingReqMember, startingStatus) {
        return function onPingReq(err) {
            if (calledBack) {
                return;
            }

            var pingReqMemberInfo = {
                address: pingReqMember.address,
                startingStatus: startingStatus,
                endingStatus: pingReqMember.status
            };

            // NOTE If the member is reachable, we don't explicitly
            // mark the unreachable member alive here. It happens
            // through implicit exchange of membership updates on
            // ping-req requests and responses.
            if (!err) {
                ringpop.logger.info('ringpop ping-req determined member is reachable', {
                    local: ringpop.whoami(),
                    errors: errors,
                    numErrors: errors.length,
                    numPingReqMembers: pingReqMembers.length,
                    pingReqAddrs: addrs,
                    pingReqMemberInfo: pingReqMemberInfo,
                    totalPingReqTime: Date.now() - startTime,
                    unreachableMemberInfo: unreachableMemberInfo
                });

                calledBack = true;
                callback(null, {
                    pingReqAddrs: addrs,
                    pingReqSuccess: pingReqMemberInfo
                });
                return;
            }

            errors.push(err);

            if (errors.length < pingReqMembers.length) {
                // Keep waiting for responses...
                return;
            }

            // A ping-req request may result in many types of errors.
            // The only ones that should count against the unreachable
            // member are those that have a valid response from a
            // chosen ping-req member that also could not reach that
            // member. If all errors are of that type, then make the
            // unreachable member a suspect.
            var numPingReqStatusErrs = 0;

            for (var i = 0; i < errors.length; i++) {
                var error = errors[i];

                if (error.type === 'ringpop.ping-req.bad-ping-status') {
                    numPingReqStatusErrs++;
                }
            }

            if (numPingReqStatusErrs > 0) {
                ringpop.logger.warn('ringpop ping-req determined member is unreachable', {
                    local: ringpop.whoami(),
                    errors: errors,
                    numErrors: errors.length,
                    numPingReqMembers: pingReqMembers.length,
                    numPingReqStatusErrs: numPingReqStatusErrs,
                    pingReqAddrs: addrs,
                    totalPingReqTime: Date.now() - startTime,
                    unreachableMemberInfo: unreachableMemberInfo
                });

                ringpop.membership.makeSuspect(unreachableMember.address,
                    unreachableMember.incarnationNumber);

                calledBack = true;
                callback(null, {
                    pingReqAddrs: addrs,
                    pingReqErrs: errors
                });
            } else {
                ringpop.logger.warn('ringpop ping-req inconclusive due to errors', {
                    local: ringpop.whoami(),
                    errors: errors,
                    numErrors: errors.length,
                    numPingReqMembers: pingReqMembers.length,
                    numPingReqStatusErrs: numPingReqStatusErrs,
                    pingReqAddrs: addrs,
                    totalPingReqTime: Date.now() - startTime,
                    unreachableMemberInfo: unreachableMemberInfo
                });

                calledBack = true;
                callback(PingReqInconclusiveError());
            }
        };
    }

    function pingReqAddrs(pingReqMembers) {
        return pingReqMembers.map(function mapMember(member) {
            return member.address;
        });
    }

    function randomMembers() {
        return ringpop.membership.getRandomPingableMembers(
            pingReqSize, [unreachableMember.address]);
    }
};
