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

var errors = require('../../lib/errors.js');
var safeParse = require('../../lib/util.js').safeParse;
var sendJoin = require('../../lib/swim/join-sender.js').joinCluster;
var TypedError = require('error/typed');

var RedundantLeaveError = TypedError({
    type: 'ringpop.invalid-leave.redundant',
    message: 'A node cannot leave its cluster when it has already left.'
});

function createJoinHandler(ringpop) {
    return function handleJoin(arg1, arg2, hostInfo, callback) {
        if (!ringpop.membership.localMember) {
            process.nextTick(function() {
                callback(errors.InvalidLocalMemberError());
            });
            return;
        }

        // Handle rejoin for member that left.
        if (ringpop.membership.localMember.status === 'leave') {
            // Assert local member is alive.
            ringpop.membership.makeAlive(ringpop.whoami(), Date.now());
            callback();
            return;
        }

        sendJoin({
            ringpop: ringpop,
            maxJoinDuration: ringpop.maxJoinDuration,
            joinSize: ringpop.joinSize
        }, function onJoin(err, candidateHosts) {
            if (err) {
                callback(err);
                return;
            }

            callback(null, null, JSON.stringify({
                candidateHosts: candidateHosts
            }));
        });
    };
}

function createLeaveHandler(ringpop) {
    return function handleLeave(arg1, arg2, hostInfo, callback) {
        if (typeof callback !== 'function') {
            callback = function noop() {};
        }

        if (!ringpop.membership.localMember) {
            process.nextTick(function() {
                callback(errors.InvalidLocalMemberError());
            });
            return;
        }

        if (ringpop.membership.localMember.status === 'leave') {
            process.nextTick(function() {
                callback(RedundantLeaveError());
            });
            return;
        }

        // TODO Explicitly infect other members (like admin join)?
        ringpop.membership.makeLeave(ringpop.whoami(),
            ringpop.membership.localMember.incarnationNumber);

        process.nextTick(function() {
            callback(null, null, 'ok');
        });
    };
}

function createReuseHandler(ringpop) {
    return function handleReuse(arg2, arg3, hostInfo, callback) {
        var body = safeParse(arg3.toString());
        var memberAddr = body && body.memberAddr ? body.memberAddr : ringpop.whoami();
        ringpop.membership.reuseMember(memberAddr);
        callback(null, null, JSON.stringify(null));
    };
}

module.exports = {
    memberJoin: {
        endpoint: '/admin/member/join',
        handler: createJoinHandler
    },
    memberLeave: {
        endpoint: '/admin/member/leave',
        handler: createLeaveHandler
    },
    memberReuse: {
        endpoint: '/admin/member/reuse',
        handler: createReuseHandler
    }
};
