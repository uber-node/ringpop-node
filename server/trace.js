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

var errors = require('../lib/errors');
var toCamelCase = require('../lib/util').toCamelCase;
var traceCore = require('../lib/trace/core');

module.exports = {
    addTrace: {
        endpoint: '/trace/add',
        handler: createAddTrace,
    },
    removeTrace: {
        endpoint: '/trace/remove',
        handler: createRemoveTrace,
    },
};

function createAddTrace(ringpop) {
    return function addTrace(head, body, peerInfo, cb) {
        _updateTracers(ringpop, 'add', body, cb);
    };
}

function createRemoveTrace(ringpop) {
    return function removeTrace(head, body, peerInfo, cb) {
        _updateTracers(ringpop, 'remove', body, cb);
    };
}

function _updateTracers(ringpop, fnStr, optsStr, cb) {
    var opts = toCamelCase(optsStr);
    var config = traceCore.resolveEventConfig(ringpop, opts.event);
    if (!config) {
        var err = errors.InvalidOptionError({ option: 'event', reason: 'it is unknown'});
        ringpop.logger.warn('ringpop: unknown Trace Event specified', {
            local: ringpop.whoami(),
            err: err
        });
        cb(err);
        return;
    } else {
        ringpop.tracers[fnStr](config, opts, cb);
        return;
    }
}
