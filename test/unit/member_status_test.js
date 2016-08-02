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
var test = require('tape');

var Member = require('../../lib/membership/member');
var Ringpop = require('../../index');

var ALL_STATUSES = _.values(Member.Status);

test('is status pingable', function(assert) {
    var expectation = {
        'alive': true,
        'suspect': true,
        'faulty': false,
        'leave': false,
        'tombstone': false
    };

    for(var i=0; i<ALL_STATUSES.length; i++) {
        var status = ALL_STATUSES[i];
        
        if (expectation[status] !== undefined) {
            assert.equal(Member.isStatusPingable(status), expectation[status], status + ' is ' + (expectation[status] ? '' : 'not ') + 'pingable');
        } else {
            assert.fail('missing expectation for '+ status);
        }
    }

    // test some garbage values
    assert.equal(Member.isStatusPingable(null), false);
    assert.equal(Member.isStatusPingable(''), false);
    assert.equal(Member.isStatusPingable('fake'), false);

    assert.end()
});

test('status precedence is correct', function t(assert) {
    var precedenceOrder = [Member.Status.alive, Member.Status.suspect, Member.Status.faulty, Member.Status.leave, Member.Status.tombstone];

    for (var i = 0; i < precedenceOrder.length; i++) {
        var status = precedenceOrder[i];

        for (var j = 0; j < i; j++) {
            var otherStatus = precedenceOrder[j];

            assert.true(Member.statusPrecedence(status) > Member.statusPrecedence(otherStatus), status + ' takes precedence over ' + otherStatus);
        }
    }
    assert.end()
});

test('status precedence with unknown state never takes precedence', function t(assert) {
    var unknownStatusPriority = Member.statusPrecedence('fake');

    for(var k in Member.Status) {
        var status = Member.Status[k];
        assert.true(unknownStatusPriority < Member.statusPrecedence(status), 'unknown status does not take precedence over '+ status);
    }
    assert.end()
});

function testShouldProcessChange(currentState, expectedOverridingStatuses) {
    test('test other override (' + currentState + ')', function t(assert) {
        var ringpop = new Ringpop({app: 'test', hostPort: '127.0.0.1:3000'});

        var member = new Member(ringpop, {
            incarnationNumber: 1,
            status: currentState
        });

        var overridingStatuses = [];

        for (var i = 0; i < ALL_STATUSES.length; i++) {
            var status = ALL_STATUSES[i];
            if(Member.shouldProcessGossip(member, {incarnationNumber: 1, status: status})){
                overridingStatuses.push(status);
            }
            assert.true(Member.shouldProcessGossip(member, {incarnationNumber: 2, status: status}), 'newer incarnation should always be processed');
        }

        assert.deepEqual(overridingStatuses.sort(), expectedOverridingStatuses.sort());

        ringpop.destroy();
        assert.end();
    });
}

testShouldProcessChange('alive', ['suspect', 'faulty', 'leave', 'tombstone']);
testShouldProcessChange('suspect', ['faulty', 'leave', 'tombstone']);
testShouldProcessChange('faulty', ['leave', 'tombstone']);
testShouldProcessChange('leave', ['tombstone']);
testShouldProcessChange('tombstone', []);
