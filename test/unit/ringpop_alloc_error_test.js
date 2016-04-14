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

var test = require('tape');

var Ringpop = require('../../index.js');

test('ringpop without app throws', function t(assert) {
    assert.throws(function throwIt() {
        Ringpop({});
    }, /Expected `options.app` to be a non-empty string/);

    assert.throws(function throwIt() {
        Ringpop({
            app: ''
        });
    }, /Expected `options.app` to be a non-empty string/);

    assert.end();
});

test('ringpop without options throws', function t(assert) {
    assert.throws(function throwIt() {
        Ringpop();
    }, /Expected `options` argument to be passed/);

    assert.end();
});

test('ringpop with invalid hostPort', function t(assert) {
    assert.throws(function throwIt() {
        Ringpop({
            app: 'foo'
        });
    }, /Got\s/);

    assert.throws(function throwIt() {
        Ringpop({
            app: 'oh lol silly me',
            hostPort: 'silly me'
        });
    }, /Got silly me/);

    assert.doesNotThrow(function throwIt() {
        Ringpop({
            app: 'foo',
            hostPort: 'localhost:4000'
        }).destroy();
    });

    assert.throws(function throwIt() {
        Ringpop({
            app: 'foo',
            hostPort: 'localhost:not_a_port'
        });
    }, /Got localhost:not_a_port/);

    assert.end();
});
