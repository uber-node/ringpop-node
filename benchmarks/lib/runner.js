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
var async = require('async');
var events = require('events');
var util = require('util');

function Runner(opts) {
    this.cycles = opts.cycles || 0;
    this.setup = opts.setup || noop;
    this.teardown = opts.teardown || noop;
    this.before = opts.suite.before || noop;
    this.fn = opts.suite.fn || noop;
    this.after = opts.suite.after || noop;
}

util.inherits(Runner, events.EventEmitter);

Runner.prototype.run = function run(callback) {
    var self = this;

    async.series([
        function setup(callback) {
            self.emit(Runner.EventType.Setup);
            self.setup(callback);
        },
        function run(callback) {
            async.timesSeries(self.cycles, function wrappedRun(i, callback) {
                async.series([
                    function before(callback) {
                        self.emit(Runner.EventType.Before);
                        self.before(callback);
                    },
                    function fn(callback) {
                        self.emit(Runner.EventType.Fn);
                        self.fn(callback);
                    },
                    function after(callback) {
                        self.emit(Runner.EventType.After);
                        self.after(callback);
                    }
                ], callback);
            }, callback);
        },
        function teardown(callback) {
            self.emit(Runner.EventType.Teardown);
            self.teardown(callback);
        }
    ], callback);
};

Runner.EventType = {
    After: 'after',
    Before: 'before',
    Fn: 'fn',
    Setup: 'setup',
    Teardown: 'teardown'
};

module.exports = Runner;

function noop(callback) {
    if (typeof callback === 'function') {
        process.nextTick(callback);
    }
}
