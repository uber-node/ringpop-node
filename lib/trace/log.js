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
var util = require('util');

var errors = require('../errors');

var core = require('./core');

//
// Log forwarder
//
// opts = {
//     sink: {
//         // REQUIRED
//         type: "log"
//
//         // OPTIONAL/HAS DEFAULTS
//         level: 'info', // from [error,warn,info,debug,trace]
//         message: 'trace'
//     }
// }
//

var logOptsDefaults = {
    sink: {
        type: 'log',
        level: 'info',
        message: 'trace'
    }
};

var logLevels = {
    error: true,
    warn: true,
    info: true,
    debug: true,
    trace: true
};

function LogTracer(ringpop, config, opts) {
    if (!(this instanceof LogTracer)) {
        return new LogTracer(opts);
    }

    opts.sink = _.defaults(
        {},
        opts.sink,
        config.sinkOptsDefaults.log,
        logOptsDefaults.sink
    );
    core.Tracer.call(this, ringpop, config, opts);

    this.level = this.opts.sink.level;
    this.message = opts.sink.message || null;
}
util.inherits(LogTracer, core.Tracer);


LogTracer.prototype.invalidate = function invalidate() {
    var sinkOpts = this.opts.sink;
    var err = core.Tracer.prototype.invalidate.call(this);

    if (err) {
        return err;
    }
    if (!logLevels[sinkOpts.level]) {
        return errors.InvalidOptionError({option: 'log.level', reason: 'is missing'});
    }
    return false;
};

LogTracer.prototype.connectSink = function connectSink(callback) {
    if (callback) {
        this.once('connectSink', callback);
    }
    process.nextTick(this.emit.bind(this, 'connectSink'));
};

LogTracer.prototype.disconnectSink = function disconnectSink(callback) {
    if (callback) {
        this.once('disconnectSink', callback);
    }

    this.disconnectSource();
    process.nextTick(this.emit.bind(this, 'disconnectSink'));
};

LogTracer.prototype.send = function send(blob, callback) {
    if (callback) {
        this.once('send', callback);
    }

    if (Buffer.isBuffer(blob)) {
        blob = blob.toString();
    } else if (typeof blob === 'object') {
        blob = JSON.stringify(blob);
    }

    this.ringpop.logger[this.level](this.message, blob);
    process.nextTick(this.emit.bind(this, 'send'));
};

LogTracer.prototype.matches = function matches(traceEvent, opts) {
    return (
        this.traceEvent === traceEvent &&
        opts.sink.type === 'log' &&
        opts.sink.message === this.opts.sink.message);
};


module.exports = LogTracer;
