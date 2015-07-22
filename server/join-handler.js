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

var thriftUtils = require('./thrift-utils.js');
var TypedError = require('error/typed');

var respondWithBadRequest = thriftUtils.respondWithBadRequest;
var validateBodyParams = thriftUtils.validateBodyParams;
var wrapCallbackAsThrift = thriftUtils.wrapCallbackAsThrift;

var DenyJoinError = TypedError({
    type: 'ringpop.deny-join',
    message: 'Node is currently configured to deny joins',
    nameAsThrift: 'denyingJoins'
});

var InvalidJoinAppError = TypedError({
    type: 'ringpop.invalid-join.app',
    message: 'A node tried joining a different app cluster. The expected app' +
        ' ({expected}) did not match the actual app ({actual}).',
    expected: null,
    actual: null,
    nameAsThrift: 'invalidJoinApp'
});

var InvalidJoinSourceError = TypedError({
    type: 'ringpop.invalid-join.source',
    message:  'A node tried joining a cluster by attempting to join itself.' +
        ' The joiner ({actual}) must join someone else.',
    actual: null,
    nameAsThrift: 'invalidJoinSource'
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

module.exports = function createJoinHandler(ringpop) {
    /* jshint maxparams: 5 */
    return function handleJoin(opts, req, head, body, callback) {
        ringpop.stat('increment', 'join.recv');

        if (!body) {
            respondWithBadRequest(callback, 'body is required');
            return;
        }

        // validateBodyParams will call callback if invalid
        if (!validateBodyParams(body, ['app', 'source', 'incarnationNumber'],
            callback)) {
            return;
        }

        var thriftCallback = wrapCallbackAsThrift(callback);

        // NOTE Validators call callback if invalid.
        if (!validateDenyingJoins(ringpop, thriftCallback) ||
            !validateJoinerAddress(ringpop, body.source, thriftCallback) ||
            !validateJoinerApp(ringpop, body.app, thriftCallback)) {
            return;
        }

        ringpop.serverRate.mark();
        ringpop.totalRate.mark();

        ringpop.membership.makeAlive(body.source, body.incarnationNumber);

        thriftCallback(null, {
            changes: ringpop.dissemination.fullSync(),
            membershipChecksum: ringpop.membership.checksum
        });
    };
};
