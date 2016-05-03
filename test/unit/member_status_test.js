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

test('is status pingable', function(assert) {
    var expectation = {
        'alive': true,
        'suspect': true,
        'faulty': false,
        'leave': false
    };

    for(var k in Member.Status) {
        var status = Member.Status[k];
        if (expectation[status] !== undefined) {
            assert.equal(Member.isStatusPingable(status), expectation[status], status + ' is ' + (expectation[status] ? '' : 'not ') + 'pingable');
        } else {
            assert.fail('missing expectation for '+ status);
        }
    }
    assert.end()
});
