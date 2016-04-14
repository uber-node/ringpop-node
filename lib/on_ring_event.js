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

function createChecksumComputedHandler(ringpop) {
    var ringLogger = ringpop.loggerFactory.getLogger('ring');

    return function onRingChecksumComputed(event) {
        ringpop.stat('increment', 'ring.checksum-computed');
        ringpop.stat('gauge', 'ring.checksum', event.checksum);
        ringpop.emit('ringChecksumComputed');

        if (event.oldChecksum !== event.checksum) {
            ringLogger.debug('ringpop ring computed new checksum', {
                local: ringpop.whoami(),
                checksum: event.checksum,
                oldChecksum: event.oldChecksum,
                timestamp: event.timestamp
            });
        }
    };
}

function createRingChangedHandler(ringpop) {
    return function onRingChanged(event) {
        ringpop.stat('increment', 'ring.changed');
        ringpop.emit('ringChanged', event);
    };
}

function createServerAddedHandler(ringpop) {
    return function onRingServerAdded() {
        ringpop.stat('increment', 'ring.server-added');
        ringpop.emit('ringServerAdded');
    };
}

function createServerRemovedHandler(ringpop) {
    return function onRingServerRemoved() {
        ringpop.stat('increment', 'ring.server-removed');
        ringpop.emit('ringServerRemoved');
    };
}

function register(ringpop) {
    var ring = ringpop.ring;
    ring.on('added', createServerAddedHandler(ringpop));
    ring.on('checksumComputed', createChecksumComputedHandler(ringpop));
    ring.on('ringChanged', createRingChangedHandler(ringpop));
    ring.on('removed', createServerRemovedHandler(ringpop));
}

module.exports = {
    createChecksumComputedHandler: createChecksumComputedHandler,
    createRingChangedHandler: createRingChangedHandler,
    createServerAddedHandler: createServerAddedHandler,
    createServerRemovedHandler: createServerRemovedHandler,
    register: register
};
