// Copyright (c) 2017 Uber Technologies, Inc.
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

var TypedError = require('error/typed');

var errors = {
    MaxRetriesReached: TypedError({
        type: 'ringpop.backoff.max-retries-reached',
        message: 'backoff reached max number of retries. retries={retries}, attempt={attempt}.',
        retries: null,
        attempt: null
    }),
    RetryTimedOut: TypedError({
        type: 'ringpop.backoff.retry-timed-out',
        message: 'backoff timed out. timeout={timeout}, duration={duration}',
        timeout: null,
        duration: null
    })
};

/**
 * Backoff provides exponential backoff. Every time {Backoff.retry} is called,
 * the delay increases exponentially until it reaches maxDelay.
 *
 * @param {Object} opts The opts
 * @param {Number} [opts.minDelay=500] the minimum delay in ms
 * @param {Number} [opts.maxDelay=1500] the maximum delay in ms
 * @param {Number} [opts.retries] the number of retries
 * @param {Number} [opts.timeout] the timeout of retrying in ms
 * @param {Number} [opts.timers] mock timers-module during tests
 * @param {Number} [opts.random] mock Math.random during tests
 *
 * @constructor
 */
function Backoff(opts) {
    this.minDelay = opts.minDelay || 500;
    this.maxDelay = opts.maxDelay || 15000;
    this.retries = opts.retries;
    this.timeout = opts.timeout;

    /* Used for mocking */
    this._timers = opts.timers || require('timers');
    this._random = opts.random || Math.random;
    this._now = opts.timers && opts.timers.now || Date.now;

    this.attempt = 0;
    this.firstTry = null;
    this.timer = undefined;
}

Backoff.Errors = errors;

Backoff.prototype._delay = function _delay(){
    var minDelay = this.minDelay * Math.pow(2, this.attempt);
    var withFuzz = Math.floor(this._random() *
            (minDelay * 0.5)) + minDelay;
    var delay = Math.min(this.maxDelay, withFuzz);

    return delay;
};

/**
 * Retry will call callback after an exponentially increasing delay.
 * @param callback the callback to call after the delay with an optional error
 * argument. Error will be set if:
 * - If opts.timeout is set and retry is called after the timeout is passed;
 * - If opts.retries is set and retry is called after the number of attempts exceeds it;
 *
 * When both are unset, callback is always called without an error.
 */
Backoff.prototype.retry = function retry(callback) {
    var self = this;
    if (!self.firstTry) {
        self.firstTry = self._now();
    }

    if (self.retries !== undefined && self.attempt >= self.retries) {
        setImmediate(callback, errors.MaxRetriesReached({retries: self.retries, attempt:self.attempt}));
        return;
    }

    var duration = self._now() - self.firstTry;
    if (self.timeout !== undefined && duration > self.timeout) {
        setImmediate(callback, errors.RetryTimedOut({timeout: self.timeout, duration: duration}));
        return;
    }

    var delay = self._delay();
    self.timer = self._timers.setTimeout(function onTimeout() {
        self.attempt++;
        self._timers.clearTimeout(self.timer);
        self.timer = undefined;

        callback();
    }, delay);
    return;
};

module.exports = Backoff;
