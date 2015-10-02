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

var DampReqRequest = require('../../request_response.js').DampReqRequest;
var TypedError = require('error/typed');

var UnattainableRValError = TypedError({
    type: 'ringpop.damping.unattainable-rval',
    message: 'Unable to attain damp-req r-val',
    flappyMember: null,
    rVal: null,
    errors: null
});

function Damping(opts) {
    this.ringpop = opts.ringpop;
    this.dampPending = {};
    this.dampPendingBacklog = [];
}

Damping.prototype.initiateSubprotocol = function initiateSubprotocol(flappyMember) {
    var self = this;
    var config = this.ringpop.config;
    var logger = this.ringpop.logger;

    var dampedCurrent = this.ringpop.membership.getDampedPercentage();
    var dampedMax = config.get('dampedMaxPercentage');
    if (dampedCurrent >= dampedMax) {
        logger.info('ringpop damping reached maximum allowable damped members', {
            local: this.ringpop.whoami(),
            member: flappyMember.getId(),
            dampedCurrent: dampedCurrent,
            dampedMax: dampedMax
        });
        return;
    }

    if (this.dampPending[flappyMember.getId()]) {
        logger.info('ringpop damping subprotocol already in progress', {
            local: this.ringpop.whoami(),
            member: flappyMember.getId()
        });
        return;
    }

    var numDampPending = Object.keys(this.dampPending).length;
    var dampPendingLimit = config.get('dampPendingLimit');
    if (numDampPending >= dampPendingLimit) {
        var backlogDepth = this.dampPendingBacklog.length;
        var backlogMax = config.get('dampPendingBacklogMax');
        if (backlogDepth >= backlogMax) {
            logger.warn('ringpop damp pending backlog reached max depth', {
                local: this.ringpop.whoami(),
                member: flappyMember.getId(),
                backlogDepth: backlogDepth,
                backlogMax: backlogMax
            });
            return;
        }

        // Abort if member is already in backlog
        for (var i = 0; i < backlogDepth; i++) {
            if (this.dampPendingBacklog[i].getId() === flappyMember.getId()) {
                logger.warn('ringpop damp pending is already backlogged', {
                    local: this.ringpop.whoami(),
                    member: flappyMember.getId(),
                    backlogDepth: backlogDepth,
                    backlogMax: backlogMax,
                    position: i
                });
                return;
            }
        }

        logger.info('ringpop backlogging damping subprotocol', {
            local: this.ringpop.whoami(),
            member: flappyMember.getId(),
            numDampPending: numDampPending,
            dampPendingLimit: dampPendingLimit
        });
        this.dampPendingBacklog.push(flappyMember);
        return;
    }

    var nVal = config.get('dampReqNVal');
    var dampReqMembers = this.ringpop.membership.getRandomPingableMembers(
        nVal, [flappyMember.address]);

    var rVal = config.get('dampReqRVal');
    if (dampReqMembers.length < rVal) {
        logger.warn('ringpop damping subprotocol aborted due to lack of selectable damp req members', {
            local: this.ringpop.whoami(),
            flappyMember: flappyMember.getId(),
            rVal: rVal,
            nVal: nVal,
            numDampReqMembers: dampReqMembers.length
        });
        return;
    }

    this.dampPending[flappyMember.getId()] = true;
    this._fanoutDampReqs(flappyMember, dampReqMembers, onDampReqs);

    var suppressLimit = config.get('dampScoringSuppressLimit');
    function onDampReqs(err, res) {
        if (err) {
            logger.warn('ringpop damping subprotocol failed to gather damp scores', {
                local: self.ringpop.whoami(),
                dampReqMembers: dampReqMembers,
                errors: err
            });
        } else if (res.some(function each(result) {
            return result.dampScore < suppressLimit;
        })) {
            logger.info('ringpop damping subprotocol unable to confirm member flappiness', {
                local: self.ringpop.whoami(),
                suppressLimit: suppressLimit,
                results: res
            });
        } else {
            self.ringpop.membership.makeDamped(flappyMember.getId(),
                flappyMember.incarnationNumber);
        }

        self._cleanupDampPending(flappyMember);
    }
};

Damping.prototype._cleanupDampPending = function _cleanupDampPending(flappyMember) {
    delete this.dampPending[flappyMember.getId()];

    var backloggedMember = this.dampPendingBacklog.shift();
    if (backloggedMember) {
        this.initiateSubprotocol(backloggedMember);
    }
};

Damping.prototype._fanoutDampReqs = function _fanoutDampReqs(flappyMember, dampReqMembers, callback) {
    var self = this;
    var rVal = this.ringpop.config.get('dampReqRVal');

    var request = new DampReqRequest(this.ringpop, {
        flappyMemberAddr: flappyMember.getId()
    });
    for (var i = 0; i < dampReqMembers.length; i++) {
        var dampReqAddr = dampReqMembers[i].address;
        this.ringpop.client.protocolDampReq(dampReqAddr, request,
            dampReqCallback(dampReqAddr));
    }

    var numPendingReqs = dampReqMembers.length;
    var errors = [];
    var results = [];

    function dampReqCallback(addr) {
        return function onDampReq(err, res) {
            // Prevents double-callback
            if (typeof callback !== 'function') return;

            numPendingReqs--;

            if (err) {
                errors.push(err);
            } else {
                if (Array.isArray(res.changes)) {
                    self.ringpop.membership.update(res.changes);
                }

                // Enrich the result with the addr of the damp
                // req member for reporting purposes.
                res.dampReqAddr = addr;
                results.push(res);
            }

            // The first rVal requests will be reported.
            if (results.length >= rVal) {
                callback(null, results);
                callback = null;
            }

            if (numPendingReqs < rVal - results.length) {
                callback(UnattainableRValError({
                    flappyMember: flappyMember.getId(),
                    rVal: rVal,
                    errors: errors
                }));
                callback = null;
            }
        };
    }
};

module.exports = Damping;
