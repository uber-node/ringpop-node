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

var TypedError = require('error/typed');

module.exports = {
    ArgumentRequiredError: TypedError({
        type: 'ringpop.argument-required',
        message: 'Expected `{argument}` to be passed',
        argument: null
    }),
    AppRequiredError: TypedError({
        type: 'ringpop.options-app.required',
        message: 'Expected `options.app` to be a non-empty string.\n' +
            'Must specify an app for ringpop to work.\n'
    }),
    ConfigError: TypedError({
        type: 'ringpop.config',
        message: 'Expected `config` option to implement a `{name}` function.',
        name: null
    }),
    DuplicateHookError: TypedError({
        type: 'ringpop.duplicate-hook',
        message: 'Expected hook name `{name}` to be unique',
        name: null
    }),
    FieldRequiredError: TypedError({
        type: 'ringpop.field-required',
        message: 'Expected `{field}` to be defined on `{argument}`',
        argument: null,
        field: null
    }),
    HostPortRequiredError: TypedError({
        type: 'ringpop.options-host-port.required',
        message: 'Expected `options.hostPort` to be valid.\n' +
            'Got {hostPort} which is not {reason}.\n' +
            'Must specify a HOST:PORT string.\n',
        hostPort: null,
        reason: null
    }),
    InvalidJoinAppError: TypedError({
        type: 'ringpop.invalid-join.app',
        message: 'A node tried joining a different app cluster. The expected app' +
            ' ({expected}) did not match the actual app ({actual}).',
        expected: null,
        actual: null
    }),
    InvalidJoinSourceError: TypedError({
        type: 'ringpop.invalid-join.source',
        message:  'A node tried joining a cluster by attempting to join itself.' +
            ' The joiner ({actual}) must join someone else.',
        actual: null
    }),
    InvalidLocalMemberError: TypedError({
        type: 'ringpop.invalid-local-member',
        message: 'Operation could not be performed because local member has not been added to membership'
    }),
    MethodRequiredError: TypedError({
        type: 'ringpop.method-required',
        message: 'Expected `{method}` to be implemented by `{argument}`',
        argument: null,
        method: null
    }),
    OptionsRequiredError: TypedError({
        type: 'ringpop.options.required',
        message: 'Expected `options` argument to be passed.\n' +
            'Must specify options for `{method}`.\n',
        method: null
    }),
    PropertyRequiredError: TypedError({
        type: 'ringpop.options.property-required',
        message: 'Expected `{property}` to be defined within options argument.',
        property: null
    }),
    RedundantLeaveError: TypedError({
        type: 'ringpop.invalid-leave.redundant',
        message: 'A node cannot leave its cluster when it has already left.'
    })
};
