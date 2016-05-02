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

var createProtocolJoinHandler = require('../../../../server/protocol/join.js');
var Ringpop = require('../../../../index.js');
var test = require('tape');

test('join fails with blacklist error', function t(assert) {
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000',
        memberBlacklist: [/127.0.0.1:*/]
    });
    var handleProtocolJoin = createProtocolJoinHandler(ringpop);
    handleProtocolJoin(null, {
        app: 'ringpop',
        source: '127.0.0.1:3001',
        incarnationNumber: 1
    }, null, function onHandled(err) {
        assert.ok(err, 'an error occurred');
        assert.equals(err.type, 'ringpop.invalid-join.blacklist',
            'blacklist error occurred');
        assert.end();
        ringpop.destroy();
    });
});

var badHostPorts = ['127.0.0.1.3000', '127.0.0.1:0:3000', '127.0.0.1.3000', '12.34.56.78:abc'];

badHostPorts.forEach(function each(hostPort) {
    test('join fails with bad hostPort as source', function t(assert) {
        var ringpop = new Ringpop({
            app: 'ringpop',
            hostPort: '127.0.0.1:3000'
        });
        var handleProtocolJoin = createProtocolJoinHandler(ringpop);
        handleProtocolJoin(null, {
            app: 'ringpop',
            source: hostPort,
            incarnationNumber: 1
        }, null, function onHandled(err) {
            assert.ok(err, 'an error occurred');
            assert.equals(err.type, 'ringpop.invalid-join.source');
            assert.end();
            ringpop.destroy();
        });
    });
});

var goodHostPorts = ['127.0.0.1:3001', '12.34.56.78:1234'];

goodHostPorts.forEach(function each(hostPort) {
    test('join succeeds with correctly formatted hostPort as source', function t(assert) {
        var ringpop = new Ringpop({
            app: 'ringpop',
            hostPort: '127.0.0.1:3000'
        });
        var handleProtocolJoin = createProtocolJoinHandler(ringpop);
        handleProtocolJoin(null, {
            app: 'ringpop',
            source: hostPort,
            incarnationNumber: 1
        }, null, function onHandled(err) {
            assert.ifError(err, 'an error occurred');
            assert.end();
            ringpop.destroy();
        });
    });
});
