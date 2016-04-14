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

var gossipHandlers = require('../../../../server/admin/gossip.js');
var Ringpop = require('../../../../index.js');
var test = require('tape');

var createGossipStartHandler = gossipHandlers.gossipStart.handler;
var createGossipStopHandler= gossipHandlers.gossipStop.handler;

test('start/stop gossip', function t(assert) {
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000',
        autoGossip: false
    });
    var handleGossipStart = createGossipStartHandler(ringpop);
    handleGossipStart(null, null, null, function onHandle(err) {
        assert.notok(err, 'no error occurred');
        assert.false(ringpop.gossip.isStopped, 'gossip is started');
    });
    var handleGossipStop = createGossipStopHandler(ringpop);
    handleGossipStop(null, null, null, function onHandle(err) {
        assert.notok(err, 'no error occurred');
        assert.true(ringpop.gossip.isStopped, 'gossip is started');
    });
    assert.end();
    ringpop.destroy();
});
