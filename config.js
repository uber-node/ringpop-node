// Copyright (c) 2015 Uber Technologies, Inc.
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
var EventEmitter = require('events').EventEmitter;
var util = require('util');

// This Config class is meant to be a central store
// for configurable parameters in Ringpop. Parameters
// are meant to be initialized in the constructor.
function Config(ringpop, seedConfig) {
    seedConfig = seedConfig || {};
    this.ringpop = ringpop;
    this.store = {};
    this._seed(seedConfig);
}

util.inherits(Config, EventEmitter);

Config.prototype.get = function get(key) {
    return this.store[key];
};

Config.prototype.getAll = function getAll() {
    return this.store;
};

Config.prototype.set = function set(key, value) {
    // TODO Use same validation in _seed() here.
    var oldValue = this.store[key];
    this.store[key] = value;
    this.emit('set', key, value, oldValue);
    this.emit('set.' + key, value, oldValue);
};

Config.prototype._seed = function _seed(seed) {
    var self = this;

    // All config names should be camel-cased.
    seedOrDefault('TEST_KEY', 100); // never remove, tests and lives depend on it
    seedOrDefault('autoGossip', true);
    seedOrDefault('dampScoringEnabled', true);
    seedOrDefault('dampScoringDecayEnabled', true);
    seedOrDefault('dampScoringDecayInterval', 1000);
    seedOrDefault('dampScoringHalfLife', 60);
    // TODO Initial should never be below min nor above max
    seedOrDefault('dampScoringInitial', 0);
    seedOrDefault('dampScoringMax', 10000);
    seedOrDefault('dampScoringMin', 0);
    seedOrDefault('dampScoringPenalty', 500);
    seedOrDefault('dampScoringReuseLimit', 2500);
    seedOrDefault('dampScoringSuppressDuration', 60 * 60 * 1000); // 1 hr in ms
    seedOrDefault('dampScoringSuppressLimit', 5000);
    seedOrDefault('memberBlacklist', [], function validator(vals) {
        return _.all(vals, function all(val) {
            return val instanceof RegExp;
        });
    }, 'expected to be array of RegExp objects');
    seedOrDefault('maxJoinAttempts', 50, numValidator);

    function seedOrDefault(name, defaultVal, validator, reason) {
        var seedVal = seed[name];
        if (typeof seedVal === 'undefined') {
            self.set(name, defaultVal);
        } else if (typeof validator === 'function' && !validator(seedVal)) {
            if (self.ringpop) {
                self.ringpop.logger.warn('ringpop using default value for config after' +
                        ' being passed invalid seed value', {
                    config: name,
                    seedVal: seedVal,
                    defaultVal: defaultVal,
                    reason: reason
                });
            }
            self.set(name, defaultVal);
        } else {
            self.set(name, seedVal);
        }
    }
};

function numValidator(maybeNum) {
    return typeof maybeNum === 'number' && !isNaN(maybeNum);
}

module.exports = Config;
