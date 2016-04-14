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

//
// A lightweight store for managing tracers.
//

var EventEmitter = require('events').EventEmitter;

var _ = require('underscore');

var core = require('./core');
var types = require('./types');

function TracerStore(ringpop, opts) {
    opts = opts || {};
    opts.timers = opts.timers || {};

    if (!(this instanceof TracerStore)) {
        return new TracerStore(ringpop);
    }
    this.ringpop = ringpop;
    this.tracers = {};
    this.timers = {
        nextTick: opts.timers.nextTick || process.nextTick,
        setTimeout: opts.timers.setTimeout || ringpop.setTimeout || setTimeout,
        clearTimeout: opts.timers.clearTimeout || clearTimeout,
        now: opts.timers.now || Date.now
    };
}
require('util').inherits(TracerStore, EventEmitter);

TracerStore.prototype.add = function add(config, opts, callback) {
    var self = this;
    var tracerOptsStr = JSON.stringify(opts);

    if (callback) {
        self.once('add', callback);
    }

    var err = core.Tracer.invalidateOptions(opts);
    if (err) {
        process.nextTick(self.emit.bind(self, 'add', err));
        return null;
    }

    var tracer = self._get(config, opts);
    if (!tracer) {
        var TracerType = types[opts.sink.type];
        tracer = new TracerType(self.ringpop, config, opts);
        err = tracer.invalidate(opts);
        if (err) {
            process.nextTick(self.emit.bind(self, 'add', err));
            return null;
        }

        var eventTracers = self.tracers[config.traceEvent];
        if (!eventTracers) {
            eventTracers = [];
            self.tracers[config.traceEvent] = eventTracers;
        }
        eventTracers.push(tracer);

        tracer.connectSink(function onConnect(err) {
            if (err) {
                self.remove(config, opts, null);
                self.emit('add', err, null);
                return;
            }
            tracer.connectSource();
            self._updateExpiration(config, opts, tracer);
            process.nextTick(self.emit.bind(self, 'add', null, tracerOptsStr));
        });
    } else {
        self._updateExpiration(config, opts, tracer);
        process.nextTick(self.emit.bind(self, 'add', null, tracerOptsStr));
    }

    return tracer;
};

TracerStore.prototype.remove = function remove(config, opts, callback) {
    if (callback) {
        this.once('remove', callback);
    }

    var tracer = null;
    var i = this._indexOf(config, opts);
    if (i >= 0) {
        tracer = this.tracers[config.traceEvent][i];
    }
    if (tracer) {
        if (tracer._timer) {
            this.timers.clearTimeout(tracer._timer);
            tracer._timer = null;
        }
        this.tracers[config.traceEvent].splice(i, 1);
        tracer.disconnectSink();
        tracer.disconnectSource();
    }
    this.emit('remove', null, tracer);
    return tracer;
};

TracerStore.prototype._indexOf = function _indexOf(config, opts) {
    var traceEvent = config.traceEvent;
    var tracers = this.tracers[traceEvent] || [];
    for (var i = 0; i < tracers.length; ++i) {
        var tracer = tracers[i];
        if (tracer.matches(traceEvent, opts)) {
            return i;
        }
    }
    return -1;
};

TracerStore.prototype._get = function _get(config, opts) {
    var i = this._indexOf(config, opts);
    return i >= 0 ? this.tracers[config.traceEvent][i] : null;
};

TracerStore.prototype._updateExpiration = function _updateExpiration(config, opts, tracer) {
    var now = this.timers.now();
    var newOffset = Math.max(0, opts.expiresIn || (opts.expiresAt - now));
    var removeFn = this.remove.bind(this, config, opts);

    if (tracer._timer) {
        this.timers.clearTimeout(tracer._timer);
        tracer._timer = null;
    }

    // 0/null offset implies already expired, thus don't re-add
    if (newOffset) {
        tracer._timer = this.timers.setTimeout(removeFn, newOffset);
    }
};

TracerStore.prototype.destroy = function destroy() {
    var self = this;
    _.each(self.tracers, function removeTracer(tracer) {
        self.remove(tracer.config, tracer.opts);
    });
    self.emit('destroyed');
};

module.exports = TracerStore;
