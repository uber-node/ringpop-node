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

var TypedError = require('error/typed');
var validateHostPort = require('../../lib/util').validateHostPort;

var BlacklistedError = TypedError({
    type: 'ringpop.invalid-join.blacklist',
    message: '{joiner} tried joining a cluster, but its host is part of the' +
        ' blacklist: {blacklist}',
    blacklist: null,
    joiner: null
});

var DenyJoinError = TypedError({
    type: 'ringpop.deny-join',
    message: 'Node is currently configured to deny joins'
});

var InvalidJoinAppError = TypedError({
    type: 'ringpop.invalid-join.app',
    message: 'A node tried joining a different app cluster. The expected app' +
        ' ({expected}) did not match the actual app ({actual}).',
    expected: null,
    actual: null
});

var SelfJoinError = TypedError({
    type: 'ringpop.self-join',
    message:  'A node tried joining a cluster by attempting to join itself.' +
        ' The joiner ({actual}) must join someone else.',
    actual: null
});

var InvalidJoinSourceError = TypedError({
    type: 'ringpop.invalid-join.source',
    message:  'A node tried joining a cluster with an invalid host-port ({actual})',
    actual: null
});

function validateDenyingJoins(ringpop, callback) {
    if (ringpop.isDenyingJoins) {
        callback(DenyJoinError());
        return false;
    }

    return true;
}

function validateJoinerAddress(ringpop, joiner, callback) {
    if (joiner === ringpop.whoami()) {
        callback(SelfJoinError({
            actual: joiner
        }));
        return false;
    }

    if (!validateHostPort(joiner)) {
        callback(InvalidJoinSourceError({
            actual: joiner
        }));
        return false;
    }

    var blacklist = ringpop.config.get('memberBlacklist');
    if (anyBlacklisted()) {
        callback(BlacklistedError({
            joiner: joiner,
            blacklist: blacklist
        }));
        return false;
    }

    return true;

    function anyBlacklisted() {
        return Array.isArray(blacklist) && blacklist.some(
                function some(pattern) {
            return pattern.test(joiner);
        });
    }
}

function validateJoinerApp(ringpop, app, callback) {
    if (app !== ringpop.app) {
        callback(InvalidJoinAppError({
            expected: ringpop.app,
            actual: app
        }));
        return false;
    }

    return true;
}

module.exports = function createJoinHandler(ringpop) {
    return function handleJoin(arg1, arg2, hostInfo, callback) {
        var body = arg2;
        if (body === null) {
            return callback(new Error('need JSON req body with source and incarnationNumber'));
        }

        var app = body.app;
        var source = body.source;
        var incarnationNumber = body.incarnationNumber;
        if (app === undefined || source === undefined || incarnationNumber === undefined) {
            return callback(new Error('need req body with app, source and incarnationNumber'));
        }

        ringpop.stat('increment', 'join.recv');

        if (!validateDenyingJoins(ringpop, callback) ||
            !validateJoinerAddress(ringpop, source, callback) ||
            !validateJoinerApp(ringpop, app, callback)) {
            return;
        }

        ringpop.serverRate.mark();
        ringpop.totalRate.mark();

        callback(null, null, {
            app: ringpop.app,
            coordinator: ringpop.whoami(),
            membership: ringpop.dissemination.membershipAsChanges(),
            membershipChecksum: ringpop.membership.checksum
        });
    };
};
