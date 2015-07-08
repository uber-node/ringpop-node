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

var fs = require('fs');
var path = require('path');

var HOST_CAPTURE = /(\d+\.\d+\.\d+\.\d+):\d+/;

function captureHost(hostPort) {
    var match = HOST_CAPTURE.exec(hostPort);
    return match && match[1];
}

function getTChannelVersion() {
    try {
        var modulePath = require.resolve('tchannel');
        var dirName = path.dirname(modulePath);
        var packageJsonPath = path.join(dirName, 'package.json');

        if (fs.existsSync(packageJsonPath)) {
            return require(packageJsonPath).version;
        }
    }
    catch (e) {
        return null;
    }
}

function isEmptyArray(array) {
    return !Array.isArray(array) || array.length === 0;
}

function mapUniq(list, iteratee) {
    return Object.keys(list.reduce(function(acc, val) {
        acc[iteratee(val)] = null;
        return acc;
    }, {}));
}

function numOrDefault(num, orDefault) {
    return typeof num === 'number' && !isNaN(num) ? num : orDefault;
}

function parseArg(opt) {
    var args = Array.prototype.slice.call(process.argv, 2);

    var matches = args.filter(function(arg) {
        return arg.indexOf(opt) > -1;
    });

    if (Array.isArray(matches) && matches.length) {
        return matches[0].split('=')[1];
    }
}

function safeParse(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

module.exports = {
    captureHost: captureHost,
    getTChannelVersion: getTChannelVersion,
    isEmptyArray: isEmptyArray,
    mapUniq: mapUniq,
    numOrDefault: numOrDefault,
    parseArg: parseArg,
    safeParse: safeParse
};
