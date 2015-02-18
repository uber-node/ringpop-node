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

function defineConfig(ringpop, property) {
    return function getConfig() {
        return getConfigValue(ringpop.config, property, ringpop[property]);
    }
}

function getConfigValue(config, property, defaultValue) {
    if (!config) {
        return defaultValue;
    }

    var value = config.get('ringpop.' + property);

    if (typeof value === 'undefined') {
        return defaultValue;
    }

    return value;
}

module.exports = function createConfigurables(ringpop) {
    return {
        joinSize: defineConfig(ringpop, 'joinSize'),
        maxJoinDuration: defineConfig(ringpop, 'maxJoinDuration'),
        pingReqSize: defineConfig(ringpop, 'pingReqSize'),
        pingReqTimeout: defineConfig(ringpop, 'pingReqTimeout'),
        pingTimeout: defineConfig(ringpop, 'pingTimeout'),
        proxyReqTimeout: defineConfig(ringpop, 'proxyReqTimeout')
    };
};
