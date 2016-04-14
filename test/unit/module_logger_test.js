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

var LoggingLevels = require('../../lib/logging/levels.js');
var testRingpop = require('../lib/test-ringpop.js');

function stubLogger(ringpop, logIt) {
    var oldLogger = ringpop.logger;
    var newLogger = {};
    Object.keys(LoggingLevels.all).forEach(function each(level) {
        if (level === LoggingLevels.off) return;
        newLogger[level] = logIt;
    });
    ringpop.logger = newLogger;
    return oldLogger;
}

testRingpop('caches loggers', function t(deps, assert) {
    var loggerFactory = deps.loggerFactory;
    assertSameLogger('gossip');
    assertSameLogger('joiner');
    assertSameLogger('whatever');

    function assertSameLogger(loggerName) {
        var namedLogger = loggerFactory.getLogger(loggerName);
        assert.equals(loggerFactory.getLogger(loggerName), namedLogger,
            'same logger');
    }
});

testRingpop('logs at correct level', function t(deps, assert) {
    var ringpop = deps.ringpop;
    var logItCount = 0;
    var oldLogger = stubLogger(ringpop, function logIt() {
        logItCount++;
    });
    var config = deps.config;
    var loggerFactory = deps.loggerFactory;
    var gossipLogger = loggerFactory.getLogger('gossip');

    // Set gossip log level to each level and count how
    // many times we've actually written to Ringpop's
    // logger through the gossip logger.
    var minLevel = LoggingLevels.minLevelInt;
    var maxLevel = LoggingLevels.maxLevelInt;
    for (var i = minLevel; i <= maxLevel; i++) {
        var levelStr = LoggingLevels.convertIntToStr(i);
        config.set('gossipLogLevel', levelStr);

        // Attempt to log at each level. The levels at which
        // we _actually_ write to Ringpop's logger is governed
        // by the log level that we've set above.
        Object.keys(LoggingLevels.all).forEach(logAtLevel);

        // Expected number of times logged is all levels in between + the
        // level that it is currently set at. That's the reason for the + 1.
        assert.equal(logItCount, (maxLevel - i) + 1,
            'logged correct # of times');

        // Reset counter for the next run at the next log level
        logItCount = 0;
    }

    ringpop.logger = oldLogger;

    function logAtLevel(level) {
        if (level === LoggingLevels.off) return;
        gossipLogger[level]();
    }
});

testRingpop('turn off gossip logging', function t(deps, assert) {
    // Turn off gossip logger
    var config = deps.config;
    config.set('gossipLogLevel', LoggingLevels.off);

    var ringpop = deps.ringpop;
    var oldLogger = stubLogger(ringpop, function logIt() {
        assert.fail('logged a message');
    });

    // Try to log things to gossip logger.
    var loggerFactory = deps.loggerFactory;
    var gossipLogger = loggerFactory.getLogger('gossip');
    Object.keys(LoggingLevels.all).forEach(function each(level) {
        if (level === LoggingLevels.off) return;
        gossipLogger[level]();
    });

    // The teardown of Ringpop triggers some logging.
    // Replace with old logger after we're done.
    ringpop.logger = oldLogger;
});

testRingpop('can log at', function t(deps, assert) {
    var config = deps.config;
    config.set('defaultLogLevel', LoggingLevels.error);

    var loggerFactory = deps.loggerFactory;
    var logger = loggerFactory.getLogger('default');
    assert.true(logger.canLogAt(LoggingLevels.error), 'can log at');
    assert.false(logger.canLogAt(LoggingLevels.warn), 'cannot log at');
    assert.false(logger.canLogAt(LoggingLevels.info), 'cannot log at');
    assert.false(logger.canLogAt(LoggingLevels.debug), 'cannot log at');
    assert.false(logger.canLogAt(LoggingLevels.warn), 'cannot log at');

    config.set('defaultLogLevel', LoggingLevels.debug);
    assert.true(logger.canLogAt(LoggingLevels.error), 'can log at');
    assert.true(logger.canLogAt(LoggingLevels.warn), 'can log at');
    assert.true(logger.canLogAt(LoggingLevels.info), 'can log at');
    assert.true(logger.canLogAt(LoggingLevels.debug), 'can log at');
    assert.true(logger.canLogAt(LoggingLevels.warn), 'can log at');

    config.set('defaultLogLevel', LoggingLevels.off);
    assert.false(logger.canLogAt(LoggingLevels.error), 'cannot log at');
    assert.false(logger.canLogAt(LoggingLevels.warn), 'cannot log at');
    assert.false(logger.canLogAt(LoggingLevels.info), 'cannot log at');
    assert.false(logger.canLogAt(LoggingLevels.debug), 'cannot log at');
    assert.false(logger.canLogAt(LoggingLevels.warn), 'cannot log at');
});
