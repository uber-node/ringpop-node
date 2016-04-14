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

var ModuleLogger = require('./module_logger.js');

// TODO This mapping should eventually go away. It seems that log
// level names by convention (logger name + "LogLevel") is the way
// to go.
var loggerNamesToLevels = {
    client: 'clientLogLevel',
    damping: 'dampingLogLevel',
    dissemination: 'disseminationLogLevel',
    gossip: 'gossipLogLevel',
    join: 'joinLogLevel',
    membership: 'membershipLogLevel',
    ring: 'ringLogLevel',
    statetransitions: 'stateTransitionsLogLevel',
};

function LoggerFactory(opts) {
    this.ringpop = opts.ringpop;
    this.loggers = {}; // indexed by name
    this.defaultLogger = new ModuleLogger(this.ringpop, 'defaultLogLevel');
}

LoggerFactory.prototype.getLogger = function getLogger(name) {
    if (!name) {
        return this.defaultLogger;
    }

    if (this.loggers[name]) {
        return this.loggers[name];
    }

    return this._createLogger(name);
};

LoggerFactory.prototype._createLogger = function _createLogger(name) {
    var level = loggerNamesToLevels[name];
    if (!level) return this.defaultLogger;
    this.loggers[name] = new ModuleLogger(this.ringpop, level);
    return this.loggers[name];
};

module.exports = LoggerFactory;
