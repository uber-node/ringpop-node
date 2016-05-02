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

/**
 * A middleware is an object that implements any of the following methods:
 *
 * request(req, arg2, arg3, callback)
 * response(req, err, res1, res2, callback)
 *
 * A middleware is free to alter req and update/replace any of arg2, arg3, err,
 * res1 or res2. Multiple middlewares can be chained together forming a
 * middleware stack. The callback is used to pass the control to the next
 * middleware in chain. For example, a noop middleware can look like this:
 *
 * var noop = {
 *     'request': function(req, arg2, arg3, callback) {
 *         callback(arg2, arg3);
 *     },
 *     'response': function(req, err, res1, res2, callback) {
 *         callback(err, res1, res2);
 *     }
 * };
 *
 * Given two middlewares m1 and m2 and the middleware stack defined as:
 *
 * MiddlewareStack([m1, m2]).run(req, arg2, arg3, handler, handler_callback)
 *
 * The order in which the middlewares are applied in is: m1.request->
 * m2.request-> handler-> m2.response-> m1.response-> handler_callback.
 *
 * The difference between applying a middleware stack to the server and the
 * client is the logical direction a request and a response point to. For
 * example, for a server it looks like this: server<-request, server->response;
 * while for a client it's the reverse: client->request, client<-response.
 */

function MiddlewareStack(middlewares) {
    this.middlewares = middlewares || [];
}

// XXX: adding nextTick to avoid blowing the call stack, creates a race in
// tests using testRingpopCluster.
MiddlewareStack.prototype.run = function run(req, arg2, arg3, handler, callback) {
    var self = this;

    var i = -1;
    callRequestMiddleware(arg2, arg3);

    // This function calls the next request middleware in the stack or, if
    // there is none left, calls the first response middleware, in reverse.
    // It also skips any middlewares that don't implement the request method.
    function callRequestMiddleware(arg2, arg3) {
        i += 1;
        if (i < self.middlewares.length) {
            var next = self.middlewares[i].request;
            if (typeof next === 'function') {
                next(req, arg2, arg3, callRequestMiddleware);
            } else {
                // skip this middleware if it doesn't implement request
                callRequestMiddleware(arg2, arg3);
            }
        } else {
            handler(req, arg2, arg3, callResponseMiddleware);
        }
    }
    // This function call the next response middleware in the stack until there
    // are none left; in that case the callback is called instead, and the
    // middleware run is completed.
    function callResponseMiddleware(err, res1, res2) {
        i -= 1;
        if (i >= 0) {
            var next = self.middlewares[i].response;
            if (typeof next === 'function') {
                next(req, err, res1, res2, callResponseMiddleware);
            } else {
                // skip this middleware if it doesn't implement response
                callResponseMiddleware(err, res1, res2);
            }
        } else {
            callback(req, err, res1, res2);
        }
    }
};


module.exports = {
    'MiddlewareStack': MiddlewareStack
};
