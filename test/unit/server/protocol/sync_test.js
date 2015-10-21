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

var createSyncHandler = require('../../../../server/protocol/sync.js');
var RequestResponse = require('../../../../request_response.js');
var testRingpop = require('../../../lib/test-ringpop.js');
var zlib = require('zlib');

testRingpop('no checksum fail', function t(deps, assert) {
    var handleSync = createSyncHandler(deps.ringpop);
    handleSync(null, null, null, function onSync(err) {
        assert.true(err, 'an error occurred');
    });
    var body = JSON.stringify(new RequestResponse.SyncRequestBody());
    handleSync(null, body, null, function onSync(err) {
        assert.true(err, 'an error occurred');
    });
});

testRingpop({
    async: true
}, 'gzip response', function t(deps, assert, done) {
    assert.plan(3);

    var ringpop = deps.ringpop;

    var headers = JSON.stringify(new RequestResponse.SyncRequestHeaders(true));
    var checksum = ringpop.membership.checksum;
    var body = JSON.stringify(new RequestResponse.SyncRequestBody(checksum));

    var handleSync = createSyncHandler(ringpop);
    handleSync(headers, body, null, function onSync(err, res1, res2) {
        zlib.gunzip(res2, function onGunzip(err, data) {
            var response = JSON.parse(data);
            assert.false(err, 'no err occurred');
            assert.equals(checksum, response.membershipChecksum, 'checksums match');
            assert.deepEquals([], response.membershipChanges, 'empty changeset');
            done();
        });
    });
});

testRingpop('non-gzip response', function t(deps, assert) {
    assert.plan(3);

    var ringpop = deps.ringpop;

    var headers = JSON.stringify(new RequestResponse.SyncRequestHeaders(false));
    var checksum = ringpop.membership.checksum;
    var body = JSON.stringify(new RequestResponse.SyncRequestBody(checksum));

    var handleSync = createSyncHandler(ringpop);
    handleSync(headers, body, null, function onSync(err, res1, res2) {
        assert.false(err, 'no err occurred');

        var response = JSON.parse(res2);
        assert.equals(checksum, response.membershipChecksum, 'checksums match');
        assert.deepEquals([], response.membershipChanges, 'empty changeset');
    });
});
