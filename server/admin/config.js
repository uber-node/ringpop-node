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

function createConfigGetHandler(ringpop) {
    return function handleConfigGet(arg2, arg3, hostInfo, callback) {
        var body = arg3;

        if (!body || !Array.isArray(body)) {
            callback(null, null, ringpop.config.getAll());
            return;
        }

        var configs = body.reduce(function each(memo, key) {
            memo[key] = ringpop.config.get(key);
            return memo;
        }, {});

        callback(null, null, configs);
    };
}

function createConfigSetHandler(ringpop) {
    return function handleConfigSet(arg2, arg3, hostInfo, callback) {
        var body = arg3;

        if (!body) {
            callback(new Error('body is required'));
            return;
        }

        if (typeof body !== 'object' || body === null) {
            callback(new Error('body must be an object'));
            return;
        }

        // Set all configs
        Object.keys(body).forEach(function each(key) {
            ringpop.config.set(key, body[key]);
        });

        callback();
    };
}

module.exports = {
    configGet: {
        endpoint: '/admin/config/get',
        handler: createConfigGetHandler
    },
    configSet: {
        endpoint: '/admin/config/set',
        handler: createConfigSetHandler
    }
};
