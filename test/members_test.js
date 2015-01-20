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
var Membership = require('../lib/members').Membership;
var test = require('tape');

var ringpop = {
    stat: function() {}
};

test('checksum is changed when membership is updated', function t(assert) {
    var membership = new Membership(ringpop);
    membership.update([{ address: '127.0.0.1:3000', status: 'alive' }])
    var prevChecksum = membership.checksum;
    membership.update([{ address: '127.0.0.1:3001', status: 'alive' }])

    assert.doesNotEqual(membership.checksum, prevChecksum, 'checksum is changed');
    assert.end();
});

test('change with higher incarnation number results in leave override', function t(assert) {
    var member = { status: 'alive', incarnationNumber: 1 };
    var change = { status: 'leave', incarnationNumber: 2 };

    var update = Membership.evalOverride(member, change);

    assert.equals(update.type, 'leave', 'results in leave');
    assert.end();
});

test('change with same incarnation number does not result in leave override', function t(assert) {
    var member = { status: 'alive', incarnationNumber: 1 };
    var change = { status: 'leave', incarnationNumber: 1 };

    var update = Membership.evalOverride(member, change);

    assert.notok(update, 'no override');
    assert.end();
});

test('change with lower incarnation number does not result in leave override', function t(assert) {
    var member = { status: 'alive', incarnationNumber: 1 };
    var change = { status: 'leave', incarnationNumber: 0 };

    var update = Membership.evalOverride(member, change);

    assert.notok(update, 'no override');
    assert.end();
});
