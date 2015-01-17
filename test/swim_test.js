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

var AdminJoiner = require('../lib/swim.js').AdminJoiner;
var mock = require('./mock');
var test = require('tape');

test('join is aborted when max join duration is exceeded', function t(assert) {
    assert.plan(2);

    var joiner = new AdminJoiner({
        ringpop: {
            bootstrapHosts: ['127.0.0.1:3000', '127.0.0.1:3001', '127.0.0.1:3002'],
            channel: mock.channel,
            logger: mock.logger,
            membership: mock.membership
        },
        callback: function(err) {
            assert.ok(err, 'an error occurred');
            assert.equals(err.type, 'ringpop.join-duration-exceeded', 'join duration exceeded');
        },
        maxJoinDuration: 1
    });
    joiner.joinStart = new Date() - (86400 * 1000); // Started a day ago ;)
    joiner.sendJoin();

    assert.end();
});
