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

var testRingpop = require('../lib/test-ringpop');

testRingpop('full sync includes all members', function t(deps, assert) {
    var membership = deps.membership;
    var dissemination = deps.dissemination;

    membership.makeAlive('127.0.0.1:3001', Date.now());
    membership.makeAlive('127.0.0.1:3002', Date.now());

    var fullSync = dissemination.fullSync();
    var addrs = fullSync.map(function mapMember(member) {
        return member.address;
    });

    assert.equals(fullSync.length, 3, 'all 3 members');
    assert.ok(addrs.indexOf('127.0.0.1:3000') !== -1, 'first member included');
    assert.ok(addrs.indexOf('127.0.0.1:3001') !== -1, 'second member included');
    assert.ok(addrs.indexOf('127.0.0.1:3002') !== -1, 'third member included');
    assert.ok(addrs.indexOf('127.0.0.1:3003') === -1, 'member not included');
});

testRingpop('avoids redundant dissemination by filtering changes from source', function t(deps, assert) {
    var ringpop = deps.ringpop;
    var membership = deps.membership;
    var dissemination = deps.dissemination;

    var localMember = membership.localMember;
    var addrAlive = '127.0.0.1:3001';
    var addrSuspect = '127.0.0.1:3002';
    var addrFaulty = '127.0.0.1:3003';
    var addrOrig = '127.0.0.1:3004';
    var incNo = Date.now();

    // Clear changes to start fresh, otherwise local member changes
    // recorded during bootstrap phase would have been issued.
    dissemination.clearChanges();

    membership.makeAlive(addrAlive, incNo);
    membership.makeSuspect(addrSuspect, incNo);
    membership.makeFaulty(addrFaulty, incNo);

    // 'sender' and source of updates (above) are same; issues no changes.
    var changes = dissemination.issueAsReceiver(localMember.address,
        localMember.incarnationNumber, membership.checksum);
    assert.equal(changes.length, 0, 'no changes issued');

    // 'sender' and source of updates are different; issues changes.
    changes = dissemination.issueAsReceiver(addrAlive, incNo,
        membership.checksum);
    assert.ok(changes.length > 0, 'changes issued');
});
