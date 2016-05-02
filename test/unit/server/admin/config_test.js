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

var configHandlers = require('../../../../server/admin/config.js');
var Ringpop = require('../../../../index.js');
var test = require('tape');

var createConfigGetHandler = configHandlers.configGet.handler;
var createConfigSetHandler = configHandlers.configSet.handler;

test('config set handler validation', function t(assert) {
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000'
    });
    var handleConfigSet = createConfigSetHandler(ringpop);
    // Missing body
    handleConfigSet(null, null, null, function onHandle(err) {
        assert.ok(err, 'an error occurred');
    });
    // Invalid body
    handleConfigSet(null, 1, null, function onHandle(err) {
        assert.ok(err, 'an error occurred');
    });
    assert.end();
    ringpop.destroy();
});

test('config get/set handlers', function t(assert) {
    var config = {};
    config['testconfig1'] = 1;
    config['testconfig2'] = 2;
    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000'
    });

    var handleConfigSet = createConfigSetHandler(ringpop);
    // Test set entire config
    handleConfigSet(null, config, null, function onHandle(err) {
        assert.notok(err, 'an error did not occur');
        assert.equals(ringpop.config.get('testconfig1'), 1,
            'config was set');
        assert.equals(ringpop.config.get('testconfig2'), 2,
            'config was set');
    });

    var handleConfigGet = createConfigGetHandler(ringpop);
    // Test single config get
    handleConfigGet(null, ['testconfig1'], null,
            function onHandle(err, res1, res2) {
        assert.notok(err, 'an error did not occur');
        assert.deepEquals(res2, {
            'testconfig1': 1
        }, 'config was gotten');
    });

    // Test get all config
    handleConfigGet(null, null, null, function onHandle(err, res1, res2) {
        assert.notok(err, 'an error did not occur');
        assert.deepEquals(res2, ringpop.config.getAll(),
            'config was gotten');
    });
    assert.end();
    ringpop.destroy();
});
