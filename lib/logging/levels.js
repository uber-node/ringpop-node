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

var levels = ['trace', 'debug', 'info', 'warn', 'error', 'off'];

// e.g. trace => 'trace', debug => 'debug', etc.
var namedLevels = levels.reduce(function each(res, level) {
    res[level] = level;
    return res;
}, {});

// e.g. trace => 0, debug => 1, etc.
var levelToInt = {};
for (var i = 0; i < levels.length; i++) {
    levelToInt[levels[i]] = i;
}

function convertIntToStr(intVal) {
    return levels[intVal];
}

function convertStrToInt(str) {
    return levelToInt[str];
}

module.exports = {
    all: namedLevels,
    trace: namedLevels.trace,
    debug: namedLevels.debug,
    info: namedLevels.info,
    warn: namedLevels.warn,
    error: namedLevels.error,
    off: namedLevels.off,
    convertIntToStr: convertIntToStr,
    convertStrToInt: convertStrToInt,
    minLevelInt: levelToInt[namedLevels.trace],
    maxLevelInt: levelToInt[namedLevels.error]
};
