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

var Member = require('../../lib/membership/member.js');

var testRingpop = require('../lib/test-ringpop');
var mock = require('../mock');

testRingpop('member ship as changes includes all members', function t(deps, assert) {
    var membership = deps.membership;
    var dissemination = deps.dissemination;

    membership.makeChange('127.0.0.1:3001', Date.now(), Member.Status.alive);
    membership.makeChange('127.0.0.1:3002', Date.now(), Member.Status.alive);

    var membershipAsChanges = dissemination.membershipAsChanges();
    var addrs = membershipAsChanges.map(function mapMember(member) {
        return member.address;
    });

    assert.equals(membershipAsChanges.length, 3, 'all 3 members');
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

    membership.makeChange(addrAlive, incNo, Member.Status.alive);
    membership.makeSuspect(addrSuspect, incNo);
    membership.makeFaulty(addrFaulty, incNo);

    // 'sender' and source of updates (above) are same; issues no changes.
    var changes = dissemination.issueAsReceiver(localMember.address,
        localMember.incarnationNumber, membership.checksum).changes;
    assert.equal(changes.length, 0, 'no changes issued');

    // 'sender' and source of updates are different; issues changes.
    changes = dissemination.issueAsReceiver(addrAlive, incNo,
        membership.checksum).changes;
    assert.ok(changes.length > 0, 'changes issued');
});

testRingpop('raise piggyback counter on issueAsReceiver', function t(deps, assert) {
    var ringpop = deps.ringpop;
    var membership = deps.membership;
    var dissemination = deps.dissemination;

    var addrAlive = '127.0.0.1:3001';
    var addrSuspect = '127.0.0.1:3002';
    var addrFaulty = '127.0.0.1:3003';
    var incNo = Date.now();

    // Clear changes to start fresh, otherwise local member changes
    // recorded during bootstrap phase would have been issued.
    dissemination.clearChanges();

    membership.makeChange(addrAlive, incNo, Member.Status.alive);
    membership.makeSuspect(addrSuspect, incNo);
    membership.makeFaulty(addrFaulty, incNo);

    // 'sender' and source of updates are different; issues changes.
    var disChangeAlive = dissemination.changes[addrAlive];
    var disChangeSuspect = dissemination.changes[addrAlive];
    var disChangeFaulty = dissemination.changes[addrFaulty];

    assert.equal(disChangeAlive.piggybackCount, 0, 'piggyback counter starts at 0');
    assert.equal(disChangeSuspect.piggybackCount, 0, 'piggyback counter starts at 0');
    assert.equal(disChangeFaulty.piggybackCount, 0, 'piggyback counter starts at 0');

    dissemination.issueAsReceiver(addrAlive, incNo, membership.checksum);

    assert.equal(disChangeAlive.piggybackCount, 1, 'piggyback counter is raised');
    assert.equal(disChangeSuspect.piggybackCount, 1, 'piggyback counter is raised');
    assert.equal(disChangeFaulty.piggybackCount, 1, 'piggyback counter is raised');
});

testRingpop('raise piggyback counter on issueAsSender', function t(deps, assert) {
    var membership = deps.membership;
    var dissemination = deps.dissemination;

    var addrAlive = '127.0.0.1:3001';
    var addrSuspect = '127.0.0.1:3002';
    var addrFaulty = '127.0.0.1:3003';
    var incNo = Date.now();

    // Clear changes to start fresh, otherwise local member changes
    // recorded during bootstrap phase would have been issued.
    dissemination.clearChanges();

    membership.makeChange(addrAlive, incNo, Member.Status.alive);
    membership.makeSuspect(addrSuspect, incNo);
    membership.makeFaulty(addrFaulty, incNo);

    // Number of expected changes is number of nodes in membership exluding this node
    var expectedNumberOfChanges = membership.getMemberCount() - 1;

    // Don't raise piggyback counter if we callback onIssue with an error.
    dissemination.issueAsSender(function issue(changes, onIssue) {
        assert.equal(changes.length, expectedNumberOfChanges, 'expect ' + expectedNumberOfChanges + ' number of changes');
        onIssue(new Error('error so that piggyback counter isn\'t raised'));
    });

    // 'sender' and source of updates are different; issues changes.
    var disChangeAlive = dissemination.changes[addrAlive];
    var disChangeSuspect = dissemination.changes[addrAlive];
    var disChangeFaulty = dissemination.changes[addrFaulty];

    assert.equal(disChangeAlive.piggybackCount, 0, 'piggyback counter starts at 0');
    assert.equal(disChangeSuspect.piggybackCount, 0, 'piggyback counter starts at 0');
    assert.equal(disChangeFaulty.piggybackCount, 0, 'piggyback counter starts at 0');

    dissemination.issueAsSender(function issue(changes, onIssue) {
        assert.equal(changes.length, expectedNumberOfChanges, 'expect ' + expectedNumberOfChanges + ' number of changes');
        onIssue();
    });

    assert.equal(disChangeAlive.piggybackCount, 1, 'piggyback counter is raised');
    assert.equal(disChangeSuspect.piggybackCount, 1, 'piggyback counter is raised');
    assert.equal(disChangeFaulty.piggybackCount, 1, 'piggyback counter is raised');

});

testRingpop('tombstone has priority vs other states', function t(deps, assert) {
    var membership = deps.membership;
    var dissemination = deps.dissemination;

    var addrAlive = '127.0.0.1:3001';
    var addrSuspect = '127.0.0.1:3002';
    var addrFaulty = '127.0.0.1:3003';
    var incNo = Date.now();

    // Clear changes to start fresh, otherwise local member changes
    // recorded during bootstrap phase would have been issued.
    dissemination.clearChanges();

    membership.makeChange(addrAlive, incNo, Member.Status.alive);
    membership.makeSuspect(addrSuspect, incNo);
    membership.makeFaulty(addrFaulty, incNo);
    membership.makeTombstone(addrAlive, incNo);
    membership.makeTombstone(addrSuspect, incNo);
    membership.makeTombstone(addrFaulty, incNo);

    assert.plan(3);
    dissemination.issueAsSender(function issue(changes, onIssue) {
        changes.forEach(function(change) {
            assert.equal('tombstone', change.status, 'state should be tombstone');
        });
    });
});


testRingpop('issueAsReceiver returns whether a full sync is made', function t(deps, assert) {
    var membership = deps.membership;
    var dissemination = deps.dissemination;

    var addrAlive = '127.0.0.1:3001';
    var incNo = Date.now();

    // Clear changes to start fresh, otherwise local member changes
    // recorded during bootstrap phase would have been issued.
    dissemination.clearChanges();

    var res = dissemination.issueAsReceiver(addrAlive, incNo,
        membership.checksum);

    assert.notOk(res.fullSync, 'full sync is false when checksums match');

    res = dissemination.issueAsReceiver(addrAlive, incNo,
        membership.checksum-1);
    assert.ok(res.fullSync, 'full sync is true when checksums differ');
});

testRingpop('tryStartReverseFullSync keeps track of running jobs', function t(deps, assert) {
    var dissemination = deps.dissemination;
    var ringpop = deps.ringpop;
    var membership = deps.membership;

    var target = '127.0.0.1:3001';

    var client = {
        protocolJoin: function(opts, body, callback) {
            assert.equal(dissemination.reverseFullSyncJobs, 1, 'reverse full sync jobs increased');
            assert.equal(opts.host, target, 'send join to remote');

            callback(null, {
                membership: dissemination.membershipAsChanges(),
                membershipChecksum: membership.checksum
            });
        },
        destroy: mock.noop
    };
    ringpop.client = client;

    assert.plan(4);
    assert.equal(dissemination.reverseFullSyncJobs, 0, 'running reverse full sync jobs is 0');

    dissemination.tryStartReverseFullSync(target, 100);

    // reverseFullSyncJobs should be 0 again.
    assert.equal(dissemination.reverseFullSyncJobs, 0, 'running reverse full sync jobs is 0');
});

testRingpop('tryStartReverseFullSync keeps track of running jobs', function t(deps, assert) {
    var dissemination = deps.dissemination;
    var ringpop = deps.ringpop;
    var membership = deps.membership;

    var target = '127.0.0.1:3001';
    var maxWorkers = ringpop.maxReverseFullSyncJobs;

    var client = {
        protocolJoin: function(opts, body, callback) {
            if (dissemination.reverseFullSyncJobs > maxWorkers) {
                assert.fail('to many full sync workers!');
            }

            callback(null, {
                membership: dissemination.membershipAsChanges(),
                membershipChecksum: membership.checksum
            });
        },
        destroy: mock.noop
    };
    ringpop.client = client;

    assert.equal(dissemination.reverseFullSyncJobs, 0, 'running reverse full sync jobs is 0');

    for(var i=0; i<maxWorkers+2; i++) {
        dissemination.tryStartReverseFullSync(target, 100);
    }

    // reverseFullSyncJobs should be 0 again.
    assert.equal(dissemination.reverseFullSyncJobs, 0, 'running reverse full sync jobs is 0');
});

testRingpop('tryStartReverseFullSync keeps track of running jobs on error', function t(deps, assert) {
    var dissemination = deps.dissemination;
    var ringpop = deps.ringpop;
    var membership = deps.membership;

    var target = '127.0.0.1:3001';

    var client = {
        protocolJoin: function(opts, body, callback) {
            assert.equal(dissemination.reverseFullSyncJobs, 1, 'reverse full sync jobs increased');
            assert.equal(opts.host, target, 'send join to remote');

            callback('error', null);
        },
        destroy: mock.noop
    };
    ringpop.client = client;

    assert.plan(4);
    assert.equal(dissemination.reverseFullSyncJobs, 0, 'running reverse full sync jobs is 0');

    dissemination.tryStartReverseFullSync(target, 100);

    // reverseFullSyncJobs should be 0 again.
    assert.equal(dissemination.reverseFullSyncJobs, 0, 'running reverse full sync jobs is 0');
});

testRingpop('tryStartReverseFullSync doesn\'t start reverse full sync when max jobs is 0', function t(deps, assert) {
    var dissemination = deps.dissemination;
    var ringpop = deps.ringpop;

    ringpop.maxReverseFullSyncJobs = 0;

    dissemination._reverseFullSync = function() {
        assert.fail('too many full sync jobs');
    };
    
    assert.equal(dissemination.reverseFullSyncJobs, 0, 'running reverse full sync jobs is 0');
    var target = '127.0.0.1:3001';
    dissemination.tryStartReverseFullSync(target, 1000);
});

testRingpop('tryStartReverseFullSync doesn\'t start reverse full sync when out of workers', function t(deps, assert) {
    var dissemination = deps.dissemination;
    var ringpop = deps.ringpop;

    ringpop.maxReverseFullSyncJobs = 1;
    var target = '127.0.0.1:3001';

    var callbackOfFirstFullSync = null;
    dissemination._reverseFullSync = function(tar, timeout, callback) {
        callbackOfFirstFullSync = callback;
        assert.equal(tar, target);
        assert.equal(dissemination.reverseFullSyncJobs, 1, 'reverse full sync jobs increased');
    };

    assert.equal(dissemination.reverseFullSyncJobs, 0);
    dissemination.tryStartReverseFullSync(target, 1000);
    assert.equal(dissemination.reverseFullSyncJobs, 1);

    dissemination._reverseFullSync = function() {
        //Fail if second full sync is started
        assert.fail('too many full sync jobs');
    };

    dissemination.tryStartReverseFullSync(target, 1000);
    assert.equal(dissemination.reverseFullSyncJobs, 1);
    assert.notEqual(callbackOfFirstFullSync, null);
    callbackOfFirstFullSync();
    assert.equal(dissemination.reverseFullSyncJobs, 0);
});

testRingpop('tryStartReverseFullSync send join request to target node', function t(deps, assert) {
    var dissemination = deps.dissemination;
    var ringpop = deps.ringpop;
    var membership = deps.membership;

    var target = '127.0.0.1:3001';
    var timeout = 1000;

    var client = {
        protocolJoin: function(opts, body, callback) {
            assert.equal(opts.host, target, 'send join to remote');
            assert.equal(opts.timeout, timeout, 'send join with correct timeout');

            callback(null, {
                membership: dissemination.membershipAsChanges(),
                membershipChecksum: membership.checksum
            });
        },
        destroy: mock.noop
    };
    ringpop.client = client;

    membership.update = function() {
        assert.pass('membership updated');
        return [];
    };

    assert.plan(3);
    dissemination.tryStartReverseFullSync(target, timeout);
});
