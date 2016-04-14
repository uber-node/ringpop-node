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

var ClientRequest = require('../../client_request.js');
var ClientRequestErrors = require('../../client_request_errors.js');
var ClientRequestStates = require('../../client_request_states.js');
var test = require('tape');

var noop = function noop() {};

function createRequest(wedgedChannel, callback) {
    var dummyClient = {
        logger: {
            canLogAt: function canLogAt() { return false; },
            error: function noop(){}
        },
        ringpop: {
            whoami: function whoami() { return 'whoever'; }
        },
        subChannel: wedgedChannel
    };
    var opts = {
        host: '192.0.2.1:1'
    };
    return new ClientRequest(dummyClient, opts, null, null, null, null,
        callback);
}

test('waitForIdentified request after cancel', function t(assert) {
    assert.plan(2);

    // Verify alreadyCanceled event emitted after wedged channel unwedges
    // and calls its waitForIdentified callback.
    var waitForIdentifiedCallback;
    var wedgedChannel = {
        waitForIdentified: function(_, callback) {
            waitForIdentifiedCallback = callback;
        }
    };
    var request = createRequest(wedgedChannel, function onSend() {
        // Unwedge channel once the requests callback is invoked by the cancel()
        // call below.
        waitForIdentifiedCallback(new Error('tchannelerror'));
    });
    request.once('alreadyCanceled', function onAlreadyCanceled(err) {
        assert.equals(err.type,
            ClientRequestErrors.WaitForIdentifiedAfterCancelError().type,
            'wait for identified error');
    });
    request.send();
    request.cancel();
    assert.equals(request.state, ClientRequestStates.waitForIdentifiedPost,
        'after wait for identified state');
    assert.end();
});

test('subChannel request after cancel', function t(assert) {
    assert.plan(2);

    // Verify alreadyCanceled event emitted after wedged channel unwedges
    // and calls its send callback.
    var sendCallback;
    var sender = {
        send: function send(_, _2, _3, callback) {
            sendCallback = callback;
        }
    };
    var wedgedChannel = {
        waitForIdentified: function(_, callback) {
            callback();
        },
        request: function request() { return sender; }
    };
    var request = createRequest(wedgedChannel, function onSend() {
        // Unwedge channel once the requests callback is invoked by the cancel()
        // call below.
        sendCallback(Error('tchannelerror'));
    });
    request.once('alreadyCanceled', function onAlreadyCanceled(err) {
        assert.equals(err.type,
            ClientRequestErrors.SubChannelRequestAfterCancelError().type,
            'sub-channel request error');
    });
    request.send();
    request.cancel();
    assert.equals(request.state, ClientRequestStates.subChannelRequestPost,
        'after wait for identified state');
    assert.end();
});

test('canceled request in correct state', function t(assert) {
    assert.plan(2);

    var dummyChannel = {
        waitForIdentified: noop
    };
    var request = createRequest(dummyChannel, noop);
    request.send();
    request.cancel();
    assert.ok(request.isCanceled, 'request is canceled');
    assert.equals(null, request.callback, 'callback is nullified');
    assert.end();
});

test('double cancel; callback already called', function t(assert) {
    assert.pass(1);

    var dummyChannel = {
        waitForIdentified: noop
    };
    var request = createRequest(dummyChannel, noop);
    request.on('alreadyCalled', function onAlreadyCalled() {
        assert.pass('callback already called');
    });
    request.send();
    request.cancel();
    request.cancel();
    assert.end();
});
