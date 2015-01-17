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
var RingPop = require('../index.js');
var test = require('tape');

test('does not throw when calling lookup with 0 servers', function t(assert) {
    var ringpop = new RingPop({
        app: 'ringpop-test',
        hostPort: '127.0.0.1:3000'
    });
    ringpop.lookup('deadbeef');
    ringpop.destroy();
    assert.end();
});

test('does not throw when calling lookup with an integer', function t(assert) {
    var ringpop = new RingPop({
        app: 'ringpop-test',
        hostPort: '127.0.0.1:3000'
    });
    ringpop.ring.addServer('127.0.0.1:3000');
    ringpop.lookup(12345);
    ringpop.destroy();
    assert.end();
});

test('key hashes to only server', function t(assert) {
    var onlyServer = '127.0.0.1:3000';
    var ringpop = new RingPop({
        app: 'ringpop-test',
        hostPort: onlyServer
    });
    ringpop.ring.addServer(onlyServer);
    assert.equals(ringpop.lookup(12345), onlyServer, 'hashes to only server');
    ringpop.destroy();
    assert.end();
});
