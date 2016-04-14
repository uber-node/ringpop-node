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
            'Got {hostPort}.\n' +
            'Must specify a HOST:PORT string.\n',
        hostPort: null
    }),
    InvalidLocalMemberError: TypedError({
        type: 'ringpop.invalid-local-member',
        message: 'Operation could not be performed because local member has not been added to membership'
    }),
    InvalidOptionError: TypedError({
        type: 'ringpop.invalid-option',
        message: '`{option}` option is invalid because {reason}',
        option: null,
        reason: null
    }),
    MethodRequiredError: TypedError({
        type: 'ringpop.method-required',
        message: 'Expected `{method}` to be implemented by `{argument}`',
        argument: null,
        method: null
    }),
    OptionRequiredError: TypedError({
        type: 'ringpop.option-required',
        message: '{context}: Expected `{option}` to be present',
        context: 'ringpop',
        option: null
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
    RingpopIsNotReadyError: TypedError({
        type: 'ringpop.not-ready',
        message: 'Ringpop is not ready'
    })
};
