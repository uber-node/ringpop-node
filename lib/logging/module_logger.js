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

var Levels = require('./levels.js');

function ModuleLogger(ringpop, configName) {
    this.ringpop = ringpop;
    this.configName = configName;
    this.offInt = Levels.convertStrToInt(Levels.off);
}

ModuleLogger.prototype.debug = function debug(msg, meta) {
    // Logging at info level for "debug" logs is intentional.
    // The level is controlled by config, not the logger itself.
    this._log('debug', msg, meta, 'info');
};

ModuleLogger.prototype.info = function info(msg, meta) {
    this._log('info', msg, meta);
};

ModuleLogger.prototype.warn = function warn(msg, meta) {
    this._log('warn', msg, meta);
};

ModuleLogger.prototype.error = function error(msg, meta) {
    this._log('error', msg, meta);
};

ModuleLogger.prototype.trace = function trace(msg, meta) {
    this._log('trace', msg, meta);
};

// This function answers the question, "can I log at the desired log level
// given the level configured for this logger?"
ModuleLogger.prototype.canLogAt = function canLogAt(desiredLevel) {
    var configLevel = this.ringpop.config.get(this.configName);
    var configInt = Levels.convertStrToInt(configLevel);
    var desiredInt = Levels.convertStrToInt(desiredLevel);
    return configLevel !== Levels.off && configInt <= desiredInt;
};

ModuleLogger.prototype._log = function _log(msgLevel, msg, meta, loggerMethod) {
    loggerMethod = loggerMethod || msgLevel;
    var configLevel = this.ringpop.config.get(this.configName);
    var configInt = Levels.convertStrToInt(configLevel);
    var msgInt = Levels.convertStrToInt(msgLevel);
    if (typeof configInt === 'number' &&
            !isNaN(configInt) &&
            typeof msgInt === 'number' &&
            !isNaN(msgInt) &&
            msgInt >= configInt &&
            msgInt < this.offInt) {
        this.ringpop.logger[loggerMethod](msg, meta);
    }
};

module.exports = ModuleLogger;
