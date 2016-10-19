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
/* jshint maxparams: 5 */


var safeParse = require('../util.js').safeParse;

var transportServerMiddleware = {
    'request': function(req, arg2, arg3, callback) {
        // this endpoint is special, it treats arg2 as JSON and arg3 as bytes
        if (req.endpoint === '/proxy/req') {
            var parsedArg2 = safeParse(arg2 && arg2.toString());
            if (parsedArg2 !== null) {
                arg2 = parsedArg2;
            }
        } else {
            var parsedArg3 = safeParse(arg3 && arg3.toString());
            if (parsedArg3 !== null) {
                arg3 = parsedArg3;
            }
        }
        callback(arg2, arg3);
    },
    'response': function(req, err, res1, res2, callback) {
        if (res2 !== undefined && typeof res2 !== 'string' && !Buffer.isBuffer(res2)) {
            res2 = JSON.stringify(res2);
        }
        callback(err, res1, res2);
    }
};


module.exports = {
    'transportServerMiddleware': transportServerMiddleware
};
