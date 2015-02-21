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

var createJoiner = require('../lib/join_cluster.js').createJoiner;
var joinCluster = require('../lib/join_cluster.js').joinCluster;
var Ringpop = require('../index.js');
var test = require('tape');

function assertThrows(assert, thrower, assertions) {
    try {
        thrower();
        assert.fail();
    } catch (e) {
        assertions(e);
        assert.end();
    }
}

function createRingpop(opts) {
    opts = opts || {};

    var ringpop = new Ringpop({
        app: 'test',
        hostPort: '127.0.0.1:3000'
    });
    ringpop.bootstrapHosts = opts.bootstrapHosts || genNodes(3);
    return ringpop;
}

function genNodes(numNodes) {
    var hosts = [];

    for (var i = 0; i < numNodes; i++) {
        hosts.push('127.0.0.1:' + (3000 + i));
    }

    return hosts;
}

function genNodesOnDiffHosts(numNodes) {
    var hosts = [];

    for (var i = 0; i < numNodes; i++) {
        hosts.push('127.0.0.' + i + ':3000');
    }

    return hosts;

}

test('create a joiner', function t(assert) {
    createJoiner({
        ringpop: createRingpop()
    });
    assert.end();
});

test('create throws with no ringpop', function t(assert) {
    assertThrows(assert, function throwIt() {
        createJoiner();
    }, function assertOn(e) {
        assert.equal(e.type, 'ringpop.option-required', 'error is of the correct type');
        assert.equal(e.option, 'ringpop', 'error has the correct option');
    });
});

test('create throws with no bootstrap hosts', function t(assert) {
    var ringpop = createRingpop();
    ringpop.bootstrapHosts = null;

    assertThrows(assert, function throwIt() {
        createJoiner({
            ringpop: ringpop
        });
    }, function assertOn(e) {
        assert.equal(e.type, 'ringpop.invalid-option', 'error is of the correct type');
        assert.equal(e.option, 'ringpop', 'error has the correct option');
    });
});

test('inits all nodes on same host', function t(assert) {
    var joiner = createJoiner({
        ringpop: createRingpop()
    });
    joiner.init();

    assert.deepEqual(joiner.potentialNodes, ['127.0.0.1:3001', '127.0.0.1:3002'], 'filters self');
    assert.deepEqual(joiner.preferredNodes, [], 'no preferred nodes');
    assert.deepEqual(joiner.nonPreferredNodes, ['127.0.0.1:3001', '127.0.0.1:3002'], 'non-preferred nodes');
    assert.end();
});

test('inits single node cluster', function t(assert) {
    var joiner = createJoiner({
        ringpop: createRingpop({
            bootstrapHosts: genNodes(1)
        })
    });
    joiner.init();

    assert.deepEqual(joiner.potentialNodes, [], 'filters self');
    assert.deepEqual(joiner.preferredNodes, [], 'no preferred nodes');
    assert.deepEqual(joiner.nonPreferredNodes, [], 'no non-preferred nodes');
    assert.end();
});

test('inits multi-host cluster', function t(assert) {
    var joiner = createJoiner({
        ringpop: createRingpop({
            bootstrapHosts: ['127.0.0.1:3000', '127.0.0.1:3001', '127.0.0.2:3000']
        })
    });
    joiner.init();

    assert.deepEqual(joiner.potentialNodes, ['127.0.0.1:3001', '127.0.0.2:3000'], 'filters self');
    assert.deepEqual(joiner.preferredNodes, ['127.0.0.2:3000'], 'preferred nodes');
    assert.deepEqual(joiner.nonPreferredNodes, ['127.0.0.1:3001'], 'no non-preferred nodes');
    assert.end();
});

test('select group initializes node collections', function t(assert) {
    var joiner = createJoiner({
        ringpop: createRingpop()
    });

    var group = joiner.selectGroup();

    var potentialNodes = ['127.0.0.1:3001', '127.0.0.1:3002'];
    assert.deepEqual(joiner.potentialNodes, potentialNodes, 'potential nodes set');
    assert.deepEqual(joiner.preferredNodes, [], 'preferred nodes set');
    assert.deepEqual(joiner.nonPreferredNodes, potentialNodes, 'non-preferred nodes set');

    // Must sort. Group selection is random.
    assert.deepEqual(group.sort(), potentialNodes.sort(), 'group has only 2 nodes');
    assert.end();
});

test('select multiple rounds of groups', function t(assert) {
    var joiner = createJoiner({
        ringpop: createRingpop({
            bootstrapHosts: genNodes(4)
        })
    });

    var group1 = joiner.selectGroup();
    var group2 = joiner.selectGroup();

    assert.equal(group1.length, 3, 'group is of correct size');
    assert.equal(group2.length, 3, 'group is of correct size');
    assert.deepEqual(group1.sort(), group2.sort(), 'groups are equal');
    assert.end();
});

test('select group of preferred nodes', function t(assert) {
    var joiner = createJoiner({
        ringpop: createRingpop({
            bootstrapHosts: genNodesOnDiffHosts(4)
        })
    });

    var group = joiner.selectGroup();

    assert.equal(group.length, 3, 'group is of correct size');
    assert.deepEqual(group.sort(), joiner.preferredNodes, 'group is made up of preferred nodes');
    assert.end();
});

test('select group of mixes nodes', function t(assert) {
    var joiner = createJoiner({
        ringpop: createRingpop({
            bootstrapHosts: ['127.0.0.1:3000', '127.0.0.1:3001', '127.0.0.2:3000']
        })
    });

    var group = joiner.selectGroup();

    assert.equal(group.length, 2, 'group is of correct size');
    assert.deepEqual(group.sort(), joiner.preferredNodes.concat(joiner.nonPreferredNodes).sort(), 'group is a mixed bag');
    assert.end();
});
