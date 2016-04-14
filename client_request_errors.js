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

var TypedError = require('error/typed');

module.exports = {
    ChannelDestroyedError: TypedError({
        type: 'ringpop.client.channel-destroyed',
        message: 'Channel is already destroyed',
        endpoint: null,
        channelType: null
    }),
    InvalidHostPortError: TypedError({
        type: 'ringpop.client.invalid-hostport',
        message: 'Request made with invalid host port combination ({hostPort})',
        hostPort: null
    }),
    RequestCanceledError: TypedError({
        type: 'ringpop.client.request-cancled',
        message: 'Request was canceled while waiting for TChannel response'
    }),
    SubChannelRequestAfterCancelError: TypedError({
        type: 'ringpop.client-request.sub-channel-request-after-cancel',
        message: 'TChannel sub-channel request completed after request was canceled'
    }),
    WaitForIdentifiedAfterCancelError: TypedError({
        type: 'ringpop.client-request.wait-for-identified-after-cancel',
        message: 'TChannel waitForIdentified completed after request was canceled'
    })
};
