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
/* jshint maxparams: 5 */


var Member = require('../membership/member.js');


function faultyAsTombstone(change) {
    if (change.status === Member.Status.faulty && change.tombstone) {
        change.status = Member.Status.tombstone;
        delete change.tombstone;
        return true;
    }
    return false;
}

function tombstoneAsFaulty(change) {
    if (change.status === Member.Status.tombstone) {
        change.status = Member.Status.faulty;
        change.tombstone = true;
        return true;
    }
    return false;
}

function requestPatcher(endpoint, msg, patcher) {
        var toPatch = [];
        if (endpoint === '/protocol/ping' || endpoint === '/protocol/ping-req') {
            toPatch = msg && msg.changes;
        }
        if (toPatch && toPatch.length) {
            toPatch.forEach(patcher);
        }
}

function responsePatcher(endpoint, msg, patcher) {
        var toPatch = [];
        if (endpoint === '/protocol/ping' || endpoint === '/protocol/ping-req') {
            toPatch = msg && msg.changes;
        } else if (endpoint === '/protocol/join') {
            toPatch = msg && msg.membership;
        }
        if (toPatch && toPatch.length) {
            toPatch.forEach(patcher);
        }
}


var tombstonePatchServerMiddleware = {
    'request': function(req, arg2, arg3, callback) {
        requestPatcher(req.endpoint, arg3, faultyAsTombstone);
        callback(arg2, arg3);
    },
    'response': function(req, err, res1, res2, callback) {
        responsePatcher(req.endpoint, res2, tombstoneAsFaulty);
        callback(err, res1, res2);
    }
};

// The client middleware is like the server middleware but reversed: everytime
// we make a request, change any  tombstone to a flagged faulty; on response
// patch replace any flagged faulty with a tombstone.
var tombstonePatchClientMiddleware = {
    'request': function(req, arg2, arg3, callback) {
        requestPatcher(req.endpoint, arg3, tombstoneAsFaulty);
        callback(arg2, arg3);
    },
    'response': function(req, err, res1, res2, callback) {
        // contrary to the server, res1 carries the result for clients
        responsePatcher(req.endpoint, res1, faultyAsTombstone);
        callback(err, res1, res2);
    }
};


module.exports = {
    'tombstonePatchServerMiddleware': tombstonePatchServerMiddleware,
    'tombstonePatchClientMiddleware': tombstonePatchClientMiddleware,
};
