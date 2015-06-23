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

var InvalidJoinSourceError = TypedError({
    type: 'ringpop.invalid-join.source',
    message:  'A node tried joining a cluster by attempting to join itself.' +
        ' The joiner ({actual}) must join someone else.',
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
        callback(InvalidJoinSourceError({
            actual: joiner
        }));
        return false;
    }

    return true;
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

// It used to be the case that the node joining was added to membership by
// this join receiver. It is no longer the case. This is because adding
// to membership would result in immediate dissemination of its information
// around the cluster and subsequent pings to the new node by all other nodes.
// Receiving pings while a node is in the middle of its join process is
// detrimental. Joining is delicate as we need it to be as efficient and fast
// as possible; low startup times are necessary to prevent ring fluctuations.
// Now, the responsibility of disseminating the joining node's information
// lies squarely on the shoulders of the joining now itself.
module.exports = function recvJoin(opts, callback) {
    var ringpop = opts.ringpop;

    ringpop.stat('increment', 'join.recv');

    if (!validateDenyingJoins(ringpop, callback) ||
        !validateJoinerAddress(ringpop, opts.source, callback) ||
        !validateJoinerApp(ringpop, opts.app, callback)) {
        return;
    }

    ringpop.serverRate.mark();
    ringpop.totalRate.mark();

    callback(null, {
        app: ringpop.app,
        coordinator: ringpop.whoami(),
        membership: ringpop.dissemination.fullSync(),
        membershipChecksum: ringpop.membership.checksum
    });
};
