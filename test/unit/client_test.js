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

var Client = require('../../client.js');
var test = require('tape');

test('retryLimit for protocol calls', function t(assert) {
    var retryLimit = 99;
    var noop = function noop() {};

    // Stub client's subchannel. Let it stand in for the request made
    // against TChannel and verify the retryLimit that is used.
    var subChannel = {
        waitForIdentified: function waitForIdentified(opts, callback) {
            callback();
        },
        request: function request(opts) {
            assert.equal(opts.retryLimit, retryLimit, 'retry limit is used');
            return {
                send: noop
            };
        }
    };
    var client = new Client(subChannel);

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
    var callback = noop;
    protocolFns.forEach(function eachFn(fn) {
        fn.call(client, opts, body, callback);
    });

    client.destroy();
    assert.end();
});

test('retryLimit defaults to 0', function t(assert) {
    assert.plan(1);

    // Stub client's subchannel. Let it stand in for the request made
    // against TChannel and verify the retryLimit that is used.
    var subChannel = {
        waitForIdentified: function waitForIdentified(opts, callback) {
            callback();
        },
        request: function request(opts) {
            assert.equal(opts.retryLimit, 0, 'retry limit defaults to 0');
            return {
                send: noop
            };
        }
    };
    var client = new Client(subChannel);

    var nobody = {};
    var noop = function noop() {};
    client.protocolPing({
        host: '127.0.0.1:3000',
        retryLimit: null
    }, nobody, noop);
    client.destroy();
    assert.end();
});
