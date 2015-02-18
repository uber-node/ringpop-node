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

var Ringpop = require('../index.js');
var createConfigurables = require('../lib/configurables.js');
var test = require('tape');

function createRingpop(opts) {
    opts = opts || {};

    return Ringpop({
        app: 'test',
        hostPort: '127.0.0.1:3000',
        config: opts.configGet && {
            get: opts.configGet
        }
    });
}

test('uses default values with no config', function t(assert) {
    var ringpop = createRingpop();
    var configurables = createConfigurables(ringpop);

    Object.keys(configurables).forEach(function eachKey(key) {
        assert.equal(configurables[key](), ringpop[key], 'configurable + ringpop val is same');
    });

    assert.end();
});

test('uses default values with config returning undefined', function t(assert) {
    var ringpop = createRingpop({
        configGet: function get() {
            return;
        }
    });
    var configurables = createConfigurables(ringpop);

    Object.keys(configurables).forEach(function eachKey(key) {
        assert.equal(configurables[key](), ringpop[key], 'configurable + ringpop val is same');
    });

    assert.end();
});

test('uses config values', function t(assert) {
    var configCount = 0;
    var ringpop = createRingpop({
        configGet: function get() {
            return configCount;
        }
    });
    var configurables = createConfigurables(ringpop);

    Object.keys(configurables).forEach(function eachKey(key) {
        assert.equal(configurables[key](), configCount, 'configurable val is same');
        configCount++;
    });

    assert.end();
});
