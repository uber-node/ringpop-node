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

var Ringpop = require('../../index.js');
var tape = require('tape');

/**
 * @callback testRingpopCallback
 * @param {object} deps top-level dependencies made available for convenience.
 * @param {tape.Test} assert The assert
 * @param {testRingpopCleanupCallback} [cleanup] The callback to call when done. Only available on async tests.
 */

/**
 * @callback testRingpopCleanupCallback
 */

/**
 * A util function to test ringpop.
 * @param {object} opts the options
 * @param {string} [opts.app=test] The app-name passed into ringpop.
 * @param {boolean} [opts.async] start a async test. An async test will not clean-up itself automatically. The callback should call the clean-up argument when done.
 * @param {string} [opts.hostPort=127.0.01:3000] the hostPort passed into ringpop
 * @param {boolean} [opts.makeAlive=true] configure if ringpop should be made alive and ready or not.
 * @param {tape.Test} [opts.test] when used as a sub-test, pass in the parent test. When not given, create a new root-level test.
 * @param {string} name the name of the (sub) test
 * @param cb
 */
function testRingpop(opts, name, cb) {
    if (typeof opts === 'string' && typeof name === 'function') {
        cb = name;
        name = opts;
        opts = {};
    }

    var test = opts.test || tape;
    test(name, function onTest(assert) {
        var ringpop = new Ringpop({
            app: opts.app || 'test',
            hostPort: opts.hostPort || '127.0.0.1:3000'
        });

        // default to true when not defined
        if (opts.makeAlive !== false) {
            ringpop.isReady = true;

            ringpop.membership.makeLocalAlive();
        }

        // These are made top-level dependencies as a mere
        // convenience to users of the test suite.
        var deps = {
            config: ringpop.config,
            damper: ringpop.damper,
            dissemination: ringpop.dissemination,
            gossip: ringpop.gossip,
            iterator: ringpop.memberIterator,
            localMember: ringpop.membership.localMember,
            loggerFactory: ringpop.loggerFactory,
            membership: ringpop.membership,
            requestProxy: ringpop.requestProxy,
            ringpop: ringpop,
            rollup: ringpop.membershipUpdateRollup,
            stateTransitions: ringpop.stateTransitions
        };

        if (opts.async) {
            cb(deps, assert, cleanup);
        } else {
            cb(deps, assert);
            cleanup();
        }

        function cleanup() {
            assert.end();
            ringpop.destroy();
        }
    });
}

module.exports = testRingpop;
