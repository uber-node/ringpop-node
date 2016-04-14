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

var events = require('events');
var util = require('util');

var _ = require('underscore');

var errors = require('../errors');

var tracerConfigMap = require('./config');

// resolves and returns a tracer config object, with
// traceEvent, sourceEmitter, and sourceEvent bound
function resolveEventConfig(ringpop, traceEvent) {
    var tracerConfig = tracerConfigMap[traceEvent];
    if (!tracerConfig) {
        return null;
    }
    var sourcePath = tracerConfig.sourcePath;

    // subtle but important -- if we resolve here, then the underlying object
    // can never change. if we do latent resolution, there may be a resource
    // leak when we try to remove listener from something that is out of our
    // reachable scope.
    var emitter = getIn(ringpop, sourcePath.slice(0, -1));
    var event = _.last(sourcePath);

    return emitter && _.defaults(
        {},
        {
            sourceEmitter: emitter,
            sourceEvent: event,
            traceEvent: traceEvent
        },
        tracerConfig
    );
}

function getIn(obj, path) {
    for (var i = 0;
         (typeof obj === 'object' || Array.isArray(obj)) && i < path.length;
         ++i) {
        obj = obj[path[i]];
    }
    return obj;
}

var tracerOptsDefaults = {
    expiresIn: 60000, // ms
    // expiresAt: Date.now() + 60000,
    sink: {type: 'log'}
};

// base for sink-specific tracers:
// A Tracer conjoins an internal node event and a user-defined sink,
// automatically forwarding data.
function Tracer(ringpop, config, opts) {
    if (!(this instanceof Tracer)) {
        return new Tracer(opts);
    }

    this.ringpop = ringpop;
    _.extend(this, config);
    this.opts = _.defaults({}, opts, tracerOptsDefaults);
    this.listener = null;
}
util.inherits(Tracer, events.EventEmitter);

Tracer.invalidateOptions = function invalidateOptions(opts) {
    if (!opts) {
        return errors.InvalidOptionError({option: 'opts', reason: 'is missing'});
    }
    if ((opts.expiresIn && opts.expiresAt) ||
        !(opts.expiresIn || opts.expiresAt)) {
        return errors.InvalidOptionError({
            option: 'expires',
            reason: 'must specify exactly one of expiresAt, expiresIn'});
    }
    if (!opts.sink) {
        return errors.InvalidOptionError({option: 'sink', reason: 'is missing'});
    }
    return false;
};

Tracer.prototype.invalidate = function invalidate() {
    return Tracer.invalidateOptions(this.opts);
};

Tracer.prototype.connectSource = function connectSource() {
    if (!this.listener) {
        this.listener = this.send.bind(this);
        this.sourceEmitter.on(this.sourceEvent, this.listener);
    }
    process.nextTick(this.emit.bind(this, 'connectSource'));
};

Tracer.prototype.disconnectSource = function disconnectSource() {
    if (this.listener) {
        this.sourceEmitter.removeListener(this.sourceEvent, this.listener);
    }
    this.listener = null;
    process.nextTick(this.emit.bind(this, 'disconnectSource'));
};

module.exports = {
    resolveEventConfig: resolveEventConfig,
    Tracer: Tracer
};

