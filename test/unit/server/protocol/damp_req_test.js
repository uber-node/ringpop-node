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

var _ = require('underscore');
var after = require('after');
var createDampReqHandler = require('../../../../server/protocol/damp_req.js');
var Member = require('../../../../lib/membership/member.js');
var fixtures = require('../../../fixtures.js');
var testRingpop = require('../../../lib/test-ringpop.js');

testRingpop({
    async: true
}, 'results in bad request', function t(deps, assert, done) {
    var incrementalDone = after(2, done);

    var handleDampReq = createDampReqHandler(deps.ringpop);
    handleDampReq(null, null, null, onHandle1);
    handleDampReq(null, { flappers: 1 }, null, onHandle2);

    function onHandle1(err) {
        assert.true(err, 'an error occurred');
        assert.equals(err.type,
            'ringpop.server.damp-req.bad-request.flappers-required',
            'flappers required error');
        incrementalDone();
    }

    function onHandle2(err) {
        assert.true(err, 'an error occurred');
        assert.equals(err.type,
            'ringpop.server.damp-req.bad-request.flappers-array',
            'flappers array error');
        incrementalDone();
    }
});

testRingpop('responds with damp scores', function t(deps, assert) {
    assert.plan(2);

    var ringpop = deps.ringpop;

    // Generate 4 members. Add each member to the Ringpop
    // membership list.
    var genMember = fixtures.memberGenerator(ringpop);
    var members = _.times(4, function eachTime() {
        return genMember();
    });
    members.forEach(function each(member) {
        ringpop.membership.makeChange(
            member.address,
            member.incarnationNumber,
            Member.Status.alive);
    });

    // Clear changes from the dissemination component to
    // pass through the final validation gate in the damp-req
    // handler.
    deps.dissemination.clearChanges();

    var handleDampReq = createDampReqHandler(ringpop);
    // Ask for the damp scores for only 3 of the 4 members
    var flappers = _.chain(members).head(3).pluck('address').value();
    handleDampReq(null, {
        flappers: flappers
    }, null, function onHandle(err, res1, res2) {
        assert.false(err, 'no error occurred');

        var expected = ringpop.membership.collectDampScores(flappers);
        var body = res2;
        assert.deepEquals(body.scores, expected, 'all damp scores returned');
    });
});
