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

var partitionHealingHandlers = require('../../../../server/admin/partition-healing');
var Ringpop = require('../../../../index.js');
var test = require('tape');

test('healing via discovery provider', function t(assert) {
    assert.plan(2);

    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000'
    });

    ringpop.healer.heal = function heal(cb) {
        assert.pass('endpoint calls heal');
        cb(null);
    };

    var handleHeal = partitionHealingHandlers.healViaDiscoverProvider.handler(ringpop);
    handleHeal(null, null, null, function onHandle(err) {
        assert.notok(err, 'no error occurred');
    });

    ringpop.destroy();
});

test('healing via discovery provider - error path', function t(assert) {
    assert.plan(2);

    var ringpop = new Ringpop({
        app: 'ringpop',
        hostPort: '127.0.0.1:3000'
    });

    ringpop.healer.heal = function heal(cb) {
        assert.pass('endpoint calls heal');
        cb('error');
    };

    var handleHeal = partitionHealingHandlers.healViaDiscoverProvider.handler(ringpop);
    handleHeal(null, null, null, function onHandle(err) {
        assert.ok(err, 'error occurred');
    });

    ringpop.destroy();
});
