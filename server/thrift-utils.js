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

var ThriftError = require('./thrift-error.js');
var ThriftResponse = require('./thrift-response.js');
var TypedError = require('error/typed');

var BadRequestError = TypedError({
    type: 'ringpop.bad-request',
    message: 'Request is invalid: {reason}',
    reason: null,
    nameAsThrift: 'badRequest'
});

function respondWithBadRequest(callback, reason) {
    callback(null, new ThriftError(
        BadRequestError({
            reason: reason
        })));
}

function validateBodyParams(body, params, callback) {
    for (var i = 0; i < params.length; i++) {
        var param = params[i];

        if (!body[param]) {
            respondWithBadRequest(callback, param + ' is required');
            return false;
        }
    }

    return true;
}

function wrapCallbackAsThrift(callback) {
    return function onCallback(err, res) {
        if (err) {
            if (err.nameAsThrift) {
                callback(null, new ThriftError(err));
                return;
            }

            callback(err);
            return;
        }

        callback(null, new ThriftResponse(res));
    };
}

module.exports = {
    respondWithBadRequest: respondWithBadRequest,
    wrapCallbackAsThrift: wrapCallbackAsThrift,
    validateBodyParams: validateBodyParams
};
