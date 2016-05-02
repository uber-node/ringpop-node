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

function createGossipStartHandler(ringpop) {
    return function handleGossipStart(arg1, arg2, hostInfo, callback) {
        ringpop.gossip.start();
        callback(null, null, 'ok');
    };
}

function createGossipStopHandler(ringpop) {
    return function handleGossipStop(arg1, arg2, hostInfo, callback) {
        ringpop.gossip.stop();
        callback(null, null, 'ok');
    };
}

function createGossipTickHandler(ringpop) {
    return function handleGossipTick(arg1, arg2, hostInfo, callback) {
        ringpop.gossip.tick(function onPing(err) {
            if (err) {
                callback(err);
                return;
            }

            callback(null, null, {
                checksum: ringpop.membership.checksum
            });
        });
    };
}

function createGossipStatusHandler(ringpop) {
    return function handleGossipStatus(arg1, arg2, hostInfo, callback) {
        callback(null, null, {
            status: ringpop.gossip.getStatus()
        });
    };
}

module.exports = {
    gossipStart: {
        endpoint: '/admin/gossip/start',
        handler: createGossipStartHandler
    },
    gossipStop: {
        endpoint: '/admin/gossip/stop',
        handler: createGossipStopHandler
    },
    gossipTick: {
        endpoint: '/admin/gossip/tick',
        handler: createGossipTickHandler
    },
    gossipStatus: {
        endpoint: '/admin/gossip/status',
        handler: createGossipStatusHandler
    }
};
