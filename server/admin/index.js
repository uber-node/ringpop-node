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

var baseEndpointHandlers = {
    debugClear: {
        endpoint: '/admin/debugClear',
        handler: require('./debug-clear.js')
    },
    debugSet: {
        endpoint: '/admin/debugSet',
        handler: require('./debug-set.js')
    },
    // Deprecated! Use /admin/gossip/start
    gossip: {
        endpoint: '/admin/gossip',
        handler: require('./gossip.js').gossipStart.handler
    },
    // Deprecated! Use /admin/member/join
    join: {
        endpoint: '/admin/join',
        handler: require('./member.js').memberJoin.handler
    },
    // Deprecated! Use /admin/member/leave
    leave: {
        endpoint: '/admin/leave',
        handler: require('./member.js').memberLeave.handler
    },
    lookup: {
        endpoint: '/admin/lookup',
        handler: require('./lookup.js')
    },
    // Deprecated!
    reload: {
        endpoint: '/admin/reload',
        handler: require('./reload.js')
    },
    stats: {
        endpoint: '/admin/stats',
        handler: require('./stats.js')
    },
    // Deprecated! Use /admin/gossip/tick.
    tick: {
        endpoint: '/admin/tick',
        handler: require('./gossip.js').gossipTick.handler
    }
};

module.exports = _.extend({}, baseEndpointHandlers, require('./config.js'),
    require('./gossip.js'), require('./member.js'), require('./partition-healing.js'));
