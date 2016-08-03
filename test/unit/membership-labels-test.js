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

var test = require('tape');
var testRingpop = require('../lib/test-ringpop.js');


function labelTests(subTest, shouldValidateIncarnationBump) {

    /**
     * Create a validator for the incarnation number.
     * @param membership the membership
     * @param assert the assert of the current test harness
     * @return {newIncarnationAssert~incarnationAssert}
     */
    function newIncarnationAssert(membership, assert) {
        var preIncarnationNumber = shouldValidateIncarnationBump && membership.localMember.incarnationNumber;

        /**
         * Assert the incarnation number is bumped or unchanged
         * @param {boolean} shouldBeBumped a boolean indicating if the incarnation number should be bumped (true) or unchanged (false)
         * @param {string} [msg] an optional message for the assertion.
         */
        function incarnationAssert(shouldBeBumped, msg) {
            if (!shouldValidateIncarnationBump) {
                assert.skip(msg);
                return;
            }

            var postIncarnationNumber = membership.localMember.incarnationNumber;

            if (shouldBeBumped) {
                assert.ok(postIncarnationNumber > preIncarnationNumber, msg || 'incarnation is bumped', {
                    pre: preIncarnationNumber,
                    post: postIncarnationNumber
                });
            } else {
                assert.equals(postIncarnationNumber, preIncarnationNumber, msg || 'incarnation is not bumped');
            }
        }

        return incarnationAssert;
    }


    subTest('get/set local label', function(membership, assert) {
        var assertBumped = newIncarnationAssert(membership, assert);

        var result = membership.setLocalLabel('hello', 'world');
        assertBumped(true);

        assert.equal(result, true, 'set local label returns true');

        assertBumped = newIncarnationAssert(membership, assert);
        assert.equal(membership.getLocalLabel('hello'), 'world', 'getLocalLabel returns the value');
        assertBumped(false, 'incarnation number does not change on getLocalLabel');
    });

    subTest('set existing label with different value', function(membership, assert) {
        membership.setLocalLabel('key', 'value');

        var assertBumped = newIncarnationAssert(membership, assert);
        var result = membership.setLocalLabel('key', 'new');
        assertBumped(true, 'overwriting a label with a different value bumps incarnation number');

        assert.equal(result, true, 'overwrite returns true');
        assert.equal(membership.getLocalLabel('key'), 'new', 'label contains new value');
    });

    subTest('set existing label with same value', function(membership, assert) {
        membership.setLocalLabel('key', 'value');

        var assertBumped = newIncarnationAssert(membership, assert);
        var result = membership.setLocalLabel('key', 'value');
        assertBumped(false, 'setLocalLabel with same value should not bump incarnation number');
        assert.equal(result, false, 'overwrite returns false');
        assert.equal(membership.getLocalLabel('key'), 'value', 'label contains old value');
    });

    subTest('get local labels', function(membership, assert) {
        membership.setLocalLabel('hello', 'world');

        var assertBumped = newIncarnationAssert(membership, assert);
        var localLabels = membership.getLocalLabels();
        assertBumped(false, 'getLocalLabels does not bump incarnation number');

        assert.notEqual(localLabels, membership._localLabels, 'getLocalLabels returns a clone copy');
        assert.deepEqual(localLabels, {'hello': 'world'}, 'getLocalLabels returns the hash');

        localLabels['hello'] = 'world2';
        assert.equal(membership.getLocalLabel('hello'), 'world', 'value in local label didn\'t change');
    });

    subTest('remove single label', function(membership, assert) {
        membership.setLocalLabels({'key1': 'value1', 'key2': 'value2'});

        var assertBumped = newIncarnationAssert(membership, assert);
        var result = membership.removeLocalLabels('key1');

        assertBumped(true, 'remove an existing label bumps incarnation');
        assert.equal(result, true, 'remove existing label returns true');
        assert.deepEqual(membership.getLocalLabels(), {'key2': 'value2'});

        assertBumped = newIncarnationAssert(membership, assert);
        result = membership.removeLocalLabels('hello');

        assertBumped(false, 'remove non-existing label does not bump incarnation number');
        assert.equal(result, false, 'remove non-existing label returns false');
        assert.deepEqual(membership.getLocalLabels(), {'key2': 'value2'});
    });

    subTest('remove multiple labels', function(membership, assert) {
        var fixture = {'key1': 'value1', 'key2': 'value2', 'key3': 'value3'};
        membership.setLocalLabels(fixture);

        var assertBumped = newIncarnationAssert(membership, assert);
        var result = membership.removeLocalLabels(['key1', 'key2']);

        assertBumped(true, 'remove existing labels bumps incarnation number');
        assert.equal(result, true, 'remove existing labels returns true');
        assert.deepEqual(membership.getLocalLabels(), {'key3': 'value3'});

        assertBumped = newIncarnationAssert(membership, assert);
        result = membership.removeLocalLabels(['hello', 'hi']);

        assertBumped(false, 'remove non-existing labels does not bump incarnation number');
        assert.equal(result, false, 'remove non-existing labels returns false');
        assert.deepEqual(membership.getLocalLabels(), {'key3': 'value3'});

        // reset
        membership.setLocalLabels(fixture);

        var assertBumped = newIncarnationAssert(membership, assert);
        result = membership.removeLocalLabels(['key1', 'hello']);

        assertBumped(true, 'remove an existing and non-existing label bumps incarnation number');
        assert.equal(result, true, 'remove an existing and non-existing key returns true.');
        assert.deepEqual(membership.getLocalLabels(), {
            'key2': 'value2',
            'key3': 'value3'
        });
    });
}

test('labels before bootstrap', function t(t) {
    function subTest(name, callback) {
        testRingpop({
            makeAlive: false,
            test: t.test
        }, name, function(deps, assert) {
            var membership = deps.membership;

            callback(membership, assert);
        });
    }

    labelTests(subTest, false);

    t.end();
});

test('labels after bootstrap', function t(t) {
    function subTest(name, callback) {
        testRingpop({test: t.test}, name, function(deps, assert) {
            var membership = deps.membership;

            // force incarnation bump
            var incarnationNumber = membership.localMember.incarnationNumber;
            membership._newIncarnationNumber = function() {
                return ++incarnationNumber;
            };

            callback(membership, assert);
        });
    }

    labelTests(subTest, true);

    t.end();
});
