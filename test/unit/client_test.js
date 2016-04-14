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

var Client = require('../../client.js');
var ClientErrors = require('../../client_errors.js');
var EventEmitter = require('events').EventEmitter;
var makeTimersMock = require('../lib/timers-mock');
var RingpopErrors = require('../../ringpop_errors.js');
var test = require('tape');
var util = require('util');

var noop = function noop() {};

function DummyRingpop() {}
util.inherits(DummyRingpop, EventEmitter);

function createDummyRingpop() {
    var dummy = new DummyRingpop();
    dummy.config = {
        get: noop
    };
    dummy.loggerFactory = {
        getLogger: function getLogger() {
            return {
                canLogAt: function canLogAt() {
                    return false;
                },
                error: noop
            };
        }
    };
    dummy.whoami = function whoami() {
        return 'dummy';
    };
    return dummy;
}

// Stub client's subchannel. Let it stand in for the request made
// against TChannel and verify the retryLimit that is used.
function assertRetryLimitOnSubChannel(assert, retryLimit) {
    // This is a subchannel stub.
    return {
        waitForIdentified: function waitForIdentified(opts, callback) {
            callback();
        },
        request: function request(opts) {
            assert.equal(opts.retryLimit, retryLimit, 'retry limit is used');
            return {
                send: function noop() {}
            };
        }
    };
}

test('retryLimit for protocol calls', function t(assert) {
    var retryLimit = 99;
    var subChannel = assertRetryLimitOnSubChannel(assert, retryLimit);
    var client = new Client(createDummyRingpop(), subChannel);

    // Iterate over the Client's prototype looking for protocol*
    // functions. When found, call it and make sure the retry limit
    // is plumbed through correctly.
    var protocolFns = [];
    var clientPrototype = Client.prototype;
    for (var propertyName in clientPrototype) {
        if (clientPrototype.hasOwnProperty(propertyName)) {
            var property = client[propertyName];
            if (typeof property === 'function' &&
                    property.name.indexOf('protocol') === 0) {
                protocolFns.push(property);
            }
        }
    }

    // Assert that at least one protocol* function is called on
    // the Client object and that 1 assertion is made per protocol
    // function called.
    assert.plan(protocolFns.length + 1);
    assert.true(protocolFns.length > 0, 'at least one protocol function');

    // opts, body and callback are arguments to the procotol* functions
    var opts = {
        host: '127.0.0.1:3000',
        retryLimit: retryLimit
    };
    var body = {};
    var callback = function noop() {};
    protocolFns.forEach(function eachFn(fn) {
        fn.call(client, opts, body, callback);
    });

    client.destroy();
    assert.end();
});

test('retryLimit defaults to 0', function t(assert) {
    assert.plan(1);

    var subChannel = assertRetryLimitOnSubChannel(assert, 0);
    var client = new Client(createDummyRingpop(), subChannel);

    var nobody = {};
    var noop = function noop() {};
    client.protocolPing({
        host: '127.0.0.1:3000',
        retryLimit: null
    }, nobody, noop);
    client.destroy();
    assert.end();
});

test('number of inflight pings match number of tracked requests', function t(assert) {
    var client = new Client(createDummyRingpop());

    var numPings = 3;
    for (var i = 0; i < numPings; i++) {
        client.protocolPing({
            host: '192.0.2.1:1'
        }, null, noop);
    }
    assert.equals(Object.keys(client.requestsById).length, numPings,
        '3 inflight requests');
    client.destroy();
    assert.end();
});

test('empties completed requests', function t(assert) {
    var sender = {
        send: function (_, _2, _3, callback) {
            callback(null, {
                ok: true
            });
        }
    };
    var subChannel = {
        waitForIdentified: function waitForIdentified(_, callback) {
            callback();
        },
        request: function request() { return sender; }
    };
    var client = new Client(createDummyRingpop(), subChannel);

    for (var i = 0; i < 3; i++) {
        client.protocolPing({
            host: '192.0.2.1:1'
        }, null, noop);
    }
    assert.equals(0, Object.keys(client.requestsById).length,
        '0 inflight requests');
    client.destroy();
    assert.end();
});

test('exceeds max inflight limit', function t(assert) {
    assert.plan(1);

    var opts = {
        host: '192.0.2.1:1'
    };

    // Set limit of outstanding client requests to 1. Below,
    // two client pings will be sent. 1 will be stuck. The other
    // will error out.
    var dummyRingpop = createDummyRingpop();
    dummyRingpop.config = {
        get: function get(key) {
            if (key === 'inflightClientRequestsLimit') {
                return 1;
            }
        }
    };

    var wedgedChannel = {
        waitForIdentified: function noop() {}
    };
    var client = new Client(dummyRingpop, wedgedChannel);
    client.protocolPing(opts, null, function onPing() {
        assert.fail('first ping should wedge');
    });

    // Second ping should error out with immediate error
    client.protocolPing(opts, null, function onPing(err) {
        assert.equal(ClientErrors.ClientRequestsLimitError().type, err.type,
            'client requests limit error');
        client.destroy();
        assert.end();
    });
});

test('cancels correct number of requests', function t(assert) {
    var opts = {
        host: '192.0.2.1:1'
    };
    var timeout = 15000;
    var timers = makeTimersMock();

    // Create a Ringpop that is configured with a 15s
    // wedgedRequestTimeout.
    var dummyRingpop = createDummyRingpop();
    dummyRingpop.config = {
        get : function get(key) {
            if (key === 'wedgedRequestTimeout') {
                return timeout;
            }
        }
    };

    // Create a wedged channel that does not respond
    // to the ping requests sent below.
    var wedgedChannel = {
        waitForIdentified: function noop() {}
    };

    var client = new Client(dummyRingpop, wedgedChannel, null, timers);

    // Send 3 pings. Each of the pings create a single ClientRequest object
    // marked with a timestamp equal to the present.
    client.protocolPing(opts, null, noop);
    client.protocolPing(opts, null, noop);
    client.protocolPing(opts, null, noop);

    // Advance time by twice the timeout value causing each of the 3
    // previous sent pings to be marked for expiry when scanned below.
    timers.advance(timeout * 2);

    // The last and final ping happens after the clock has been advanced
    // and all 4 pending requests will be evaluated to see if they have
    // timed-out immediately below. Only the first 3 should time-out.
    client.protocolPing(opts, null, noop);

    var wedgedRequests = client.scanForWedgedRequests();
    assert.equals(3, wedgedRequests.length,
        'correct number of wedged requests');

    // Scanning for wedged requests above will also cancel them.
    // Cancelling requests will not longer be pending and thus
    // not appear in requestsById.
    assert.equals(1, Object.keys(client.requestsById).length,
        '1 inflight request');
    client.destroy();
    assert.end();
});

test('emits ringpop error on canceled request', function t(assert) {
    assert.plan(1);

    var opts = {
        host: '192.0.2.1:1'
    };
    var timeout = 15000;
    var timers = makeTimersMock();

    // Create a Ringpop that is configured with a 15s
    // wedgedRequestTimeout.
    var dummyRingpop = createDummyRingpop();
    dummyRingpop.config = {
        get: function get(key) {
            if (key === 'wedgedRequestTimeout') {
                return timeout;
            }
        }
    };

    // Create a wedged channel that does not respond
    // to the ping requests sent below.
    var wedgedChannel = {
        waitForIdentified: function noop() {}
    };

    var client = new Client(dummyRingpop, wedgedChannel, null, timers);
    // Send 1 ping on wedged channel.
    client.protocolPing(opts, null, noop);
    // Advance time to trigger cancellation of previous ping request.
    timers.advance(timeout * 2);

    // Register for error just prior to it being raised by call to
    // scanForWedgedRequests() below.
    dummyRingpop.on('error', function onError(err) {
        assert.equals(RingpopErrors.PotentiallyWedgedRequestsError().type,
            err.type, 'wedged requests error');
    });

    client.scanForWedgedRequests();
    client.destroy();
    assert.end();
});
