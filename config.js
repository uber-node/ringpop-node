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
var EventEmitter = require('events').EventEmitter;
var LoggingLevels = require('./lib/logging/levels.js');
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

Config.Defaults = {
    gossipLogLevel: 'debug',
    wedgedRequestTimeout: 30 * 1000,
    wedgedTimerInterval: 1000
};

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

Config.prototype.setDefault = function setDefault(key) {
    this.set(key, Config.Defaults[key]);
};

Config.prototype._seed = function _seed(seed) {
    var self = this;

    // All config names should be camel-cased.
    seedOrDefault('TEST_KEY', 100, numValidator); // never remove, tests and lives depend on it

    // Logger configs; should be at least error by default.
    seedOrDefault('defaultLogLevel', LoggingLevels.info);
    seedOrDefault('clientLogLevel', LoggingLevels.error);
    seedOrDefault('dampingLogLevel', LoggingLevels.error);
    seedOrDefault('disseminationLogLevel', LoggingLevels.error);
    seedOrDefault('gossipLogLevel', LoggingLevels.error);
    seedOrDefault('joinLogLevel', LoggingLevels.warn);
    seedOrDefault('membershipLogLevel', LoggingLevels.error);
    seedOrDefault('ringLogLevel', LoggingLevels.error);
    seedOrDefault('stateTransitionsLogLevel', LoggingLevels.error);

    // Gossip configs
    seedOrDefault('autoGossip', true);

    seedOrDefault('isCrossPlatform', false);
    seedOrDefault('useLatestHash32', false);
    seedOrDefault('dampedErrorLoggingEnabled', false);
    seedOrDefault('dampedMaxPercentage', 10);
    seedOrDefault('dampedMemberExpirationInterval', 60000);
    seedOrDefault('dampReqNVal', 6);
    seedOrDefault('dampReqRVal', 3);
    seedOrDefault('dampReqTimeout', 1000);
    seedOrDefault('dampScoringEnabled', true);
    seedOrDefault('dampScoringDecayEnabled', true);
    seedOrDefault('dampScoringDecayInterval', 1000);
    seedOrDefault('dampScoringHalfLife', 60 * 5); // 5 minutes in seconds
    // TODO Initial should never be below min nor above max
    seedOrDefault('dampScoringInitial', 0);
    seedOrDefault('dampScoringMax', 10000);
    seedOrDefault('dampScoringMin', 0);
    seedOrDefault('dampScoringPenalty', 500);
    seedOrDefault('dampScoringReuseLimit', 2500);
    seedOrDefault('dampScoringSuppressDuration', 60 * 60 * 1000); // 1 hr in ms
    seedOrDefault('dampScoringSuppressLimit', 5000);
    seedOrDefault('dampTimerInterval', 60 * 1000); // 1min in ms

    // Joiner config
    seedOrDefault('joinDelayMin', 100, numValidator); // ms
    seedOrDefault('joinDelayMax', 2 * 60 * 1000, numValidator); // 2 min in ms
    seedOrDefault('joinTroubleErrorEnabled', true);
    seedOrDefault('maxJoinDuration', 20 * 60 * 1000, numValidator); // 20 mins in ms

    // Forwarding config
    seedOrDefault('backpressureEnabled', false);
    seedOrDefault('lagSamplerInterval', 1000, numValidator);
    seedOrDefault('maxEventLoopLag', 1500, numValidator);
    seedOrDefault('maxInflightRequests', 5000, numValidator);

    seedOrDefault('memberBlacklist', [], function validator(vals) {
        return _.all(vals, function all(val) {
            return val instanceof RegExp;
        });
    }, 'expected to be array of RegExp objects');
    seedOrDefault('membershipUpdateRollupEnabled', false);
    seedOrDefault('tchannelRetryLimit', 0);
    // How long a request is outstanding until is it considered
    // wedged and then canceled.
    seedOrDefault('wedgedRequestTimeout', Config.Defaults.wedgedRequestTimeout);
    // How often the wedge timer ticks.
    seedOrDefault('wedgedTimerInterval', Config.Defaults.wedgedTimerInterval);
    // Number of allowable inflight requests sent by RingpopClient.
    seedOrDefault('inflightClientRequestsLimit', 100);

    // Healer config
    // Maximum number of heal failures in one period.
    seedOrDefault('discoverProviderHealerMaxFailures', 10);
    // The time of a period in ms.
    seedOrDefault('discoverProviderHealerPeriod', 30000);
    // The base probability of a node to run in a period: the average number
    // of nodes in each period that will perform the heal algorithm in a period.
    // E.g. if there are 100 nodes and the base probability is 3, there is a
    // chance of 3/100 that a node will run.
    seedOrDefault('discoverProviderHealerBaseProbability', 3);
    // Enable the period healer.
    seedOrDefault('discoverProviderHealerPeriodicEnabled', true);

    // Self Eviction config
    // Enable pinging
    seedOrDefault('selfEvictionPingEnabled', true);
    // Ping a maximum ratio of the pingable members on self eviction
    seedOrDefault('selfEvictionMaxPingRatio', 0.4);

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
