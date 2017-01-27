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

var Backoff = require('../../lib/backoff');
var makeTimersMock = require('../lib/timers-mock');

var test = require('tape');

function noRandom(){
    return 0.0;
}

test('backoff uses correct defaults', function t(assert) {
    var backoff = new Backoff({});
    assert.equal(backoff.minDelay, 500);
    assert.equal(backoff.maxDelay, 15000);
    assert.equal(backoff._timers, require('timers'));
    assert.equal(backoff._random, Math.random);
    assert.equal(backoff._now, Date.now);
    assert.end();
});

test('backoff initially waits', function t(assert) {
    var timers = makeTimersMock();

    var opts = {
        timers: timers,
        random: noRandom,

        minDelay: 500,
        maxDelay: 15000,
        timeout: 60000
    };
    var backoff = new Backoff(opts);

    assert.plan(2);
    backoff.retry(function onRetry(err){
        assert.equal(timers.now(), 500, 'callback called after time advance');
        assert.notok(err, 'no error');
    });

    timers.advance(300);
    timers.advance(200);
});

test('backoff increases delay up to maxDelay', function t(assert) {
    var opts = {
        random: noRandom, // disable fuzz

        minDelay: 500,
        maxDelay: 15000
    };
    var backoff = new Backoff(opts);

    assert.equals(backoff._delay(), opts.minDelay);

    backoff.attempt = 1;
    assert.equals(backoff._delay(), opts.minDelay * 2);

    backoff.attempt = 2;
    assert.equals(backoff._delay(), opts.minDelay * 4, 'increased exponentially');

    backoff.attempt = 100;
    assert.equals(backoff._delay(), opts.maxDelay, 'does not exceed maxDelay');

    assert.end();
});

test('backoff errors when max retries is exceeded', function t(assert) {
    var opts = {
        timers: makeTimersMock(),
        random: noRandom, // disable fuzz

        minDelay: 500,
        maxDelay: 500,
        retries: 2
    };
    var backoff = new Backoff(opts);

    var count = 0;

    function onRetry(err) {
        if (count === opts.retries) {
            assert.ok(err, 'too many retries');
            assert.equal(err.type, Backoff.Errors.MaxRetriesReached.type);
            backoff.retry(function(err){
                assert.ok(err, 'subsequent retry returns error');
                assert.equal(err.type, Backoff.Errors.MaxRetriesReached.type);
                assert.end();
            });
        } else {
            assert.error(err, 'no error');
            count++;
            backoff.retry(onRetry);
            opts.timers.advance(500);
        }
    }
    backoff.retry(onRetry);
    opts.timers.advance(500);
});

test('backoff errors when max duration is exceeded', function t(assert) {
    var opts = {
        timers: makeTimersMock(),
        random: noRandom, // disable fuzz

        minDelay: 100,
        maxDelay: 100,
        timeout: 450 //allow for up to 5 retries
    };
    var backoff = new Backoff(opts);

    var count = 0;

    function onRetry(err) {
        if (count === 6) {
            assert.ok(err, 'too many retries');
            assert.equal(err.type, Backoff.Errors.RetryTimedOut.type);
            backoff.retry(function(err){
                assert.ok(err, 'subsequent retry returns error');
                assert.equal(err.type, Backoff.Errors.RetryTimedOut.type);
                assert.end();
            });
        } else {
            assert.error(err, 'no error');
            count++;
            backoff.retry(onRetry);
            opts.timers.advance(100);
        }
    }
    backoff.retry(onRetry);
    opts.timers.advance(100);
});
