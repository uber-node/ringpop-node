// Copyright (c) 2017 Uber Technologies, Inc.
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

var Member = require('../../lib/membership/member');
var Ringpop = require('../..');

function createRingpop() {
    var ringpop = new Ringpop({
        app: 'test',
        hostPort: '127.0.0.1:3000'
    });
    return ringpop;
}

handleUpdateSchedulesTimer(Member.Status.alive, false);
handleUpdateSchedulesTimer(Member.Status.leave, false);
handleUpdateSchedulesTimer(Member.Status.faulty, true);
handleUpdateSchedulesTimer(Member.Status.suspect,true);
handleUpdateSchedulesTimer(Member.Status.tombstone,true);

function handleUpdateSchedulesTimer(state, shouldSchedule) {
    test('handleUpdate schedules timers for state: ' + state, function t(assert) {
        var ringpop = createRingpop();
        var stateTransitions = ringpop.stateTransitions;
        var address = '127.0.0.1:3001';

        if (!shouldSchedule) {
            // register fake timer to test if it's cancelled correctly
            stateTransitions.timers[address] = {state: 'fake'}
        }

        stateTransitions.handleUpdate({
            status: state,
            address: address
        });
        if (shouldSchedule) {
            assert.ok(stateTransitions.timers[address], 'timer scheduled');
            assert.equal(stateTransitions.timers[address].state, state, 'timer scheduled');
        } else {
            assert.notok(stateTransitions.timers[address], 'timer not scheduled');
        }

        assert.end();
        ringpop.destroy();
    });
}
