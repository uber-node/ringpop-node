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

var globalTimers = require('timers');

function LagSampler(opts) {
    this.ringpop = opts.ringpop;
    this.timers = opts.timers || globalTimers;
    this.lagTimer = null;
    this.currentLag = 0;

    // toobusy auto-starts sampling. lazily-require until started.
    this.toobusy = null;
}

LagSampler.prototype.start = function start() {
    var self = this;

    if (this.lagTimer) {
        this.ringpop.logger.debug('ringpop lag sampler lag timer already started', {
            local: this.ringpop.whoami()
        });
        return;
    }

    if (!this.toobusy) {
        this.toobusy = require('toobusy-js');
    }

    schedule();
    this.ringpop.logger.debug('ringpop lag sampler started', {
        local: this.ringpop.whoami()
    });

    function schedule() {
        self.lagTimer = self.timers.setTimeout(function onTimeout() {
            self.currentLag = self.toobusy.lag();
            schedule();
        }, self.ringpop.config.get('lagSamplerInterval'));
    }
};

LagSampler.prototype.stop = function stop() {
    if (!this.lagTimer) {
        this.ringpop.logger.debug('ringpop lag sampler lag timer already stopped', {
            local: this.ringpop.whoami()
        });
        return;
    }

    this.timers.clearTimeout(this.lagTimer);
    this.lagTimer = null;
    this.ringpop.logger.debug('ringpop lag sampler stopped', {
        local: this.ringpop.whoami()
    });

    if (this.toobusy) {
        this.toobusy.shutdown();
        this.toobusy = null;
    }
};

module.exports = LagSampler;
