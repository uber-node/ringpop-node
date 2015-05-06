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

var _ = require('underscore');
var UserData = require('./disseminated-user-data.js');

var LOG_10 = Math.log(10);

function collectPiggybackData(collection, maxPiggybackCount) {
    var piggybackData = [];

    var keys = Object.keys(collection);

    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];

        var data = collection[key];

        // NOTE We're bumping the piggyback count even though
        // we don't know whether the change successfully made
        // it over to the other side. This can result in undesired
        // full-syncs.
        if (typeof data.piggybackCount === 'undefined') {
            data.piggybackCount = 0;
        }

        data.piggybackCount += 1;

        if (data.piggybackCount > maxPiggybackCount) {
            delete collection[key];
            continue;
        }

        piggybackData.push(_.omit(data, 'piggybackCount'));
    }

    return piggybackData;
}

function issueChanges(dissemination, checksum, source) {
    var ringpop = dissemination.ringpop;

    var changesToDisseminate = collectPiggybackData(
        dissemination.recordedChanges, dissemination.maxPiggybackCount);

    ringpop.stat('gauge', 'changes.disseminate', changesToDisseminate.length);

    if (changesToDisseminate.length) {
        return changesToDisseminate;
    } else if (checksum && ringpop.membership.checksum !== checksum) {
        ringpop.stat('increment', 'full-sync');
        ringpop.logger.info('full sync', {
            localChecksum: ringpop.membership.checksum,
            remoteChecksum: checksum,
            remoteNode: source
        });

        // TODO Somehow send back indication of isFullSync
        return dissemination.fullSync();
    } else {
        return [];
    }
}

function issueUserData(dissemination) {
    var piggybackData = [];

    var recordedUserData = dissemination.recordedUserData;

    for (var i = 0; i < recordedUserData.length; i++) {
        var data = recordedUserData[i];

        // NOTE We're bumping the piggyback count even though
        // we don't know whether the change successfully made
        // it over to the other side. This can result in undesired
        // full-syncs.
        if (typeof data.piggybackCount === 'undefined') {
            data.piggybackCount = 0;
        }

        data.piggybackCount += 1;

        if (data.piggybackCount > dissemination.maxPiggybackCount) {
            // TODO track for splicing
            continue;
        }

        piggybackData.push(_.omit(data, 'piggybackCount'));
    }

    // TODO Splice

    return piggybackData;
}

function Dissemination(ringpop) {
    this.ringpop = ringpop;
    this.ringpop.on('changed', this.onRingChanged.bind(this));

    this.recordedChanges = {};
    this.recordedUserData = [];

    this.maxPiggybackCount = 1;
    this.piggybackFactor = 15; // A lower piggyback factor leads to more full-syncs

    this.userDataStore = new UserData();
}

Dissemination.prototype.adjustMaxPiggybackCount = function adjustMaxPiggybackCount() {
    var serverCount = this.ringpop.ring.getServerCount();
    var prevPiggybackCount = this.maxPiggybackCount;
    var newPiggybackCount = this.piggybackFactor * Math.ceil(Math.log(serverCount + 1) / LOG_10);

    if (this.maxPiggybackCount !== newPiggybackCount) {
        this.maxPiggybackCount = newPiggybackCount;
        this.ringpop.stat('gauge', 'max-piggyback', this.maxPiggybackCount);
        this.ringpop.logger.debug('adjusted max piggyback count', {
            newPiggybackCount: this.maxPiggybackCount,
            oldPiggybackCount: prevPiggybackCount,
            piggybackFactor: this.piggybackFactor,
            serverCount: serverCount
        });
    }
};

Dissemination.prototype.apply = function apply(piggyback) {
    if (!piggyback) {
        return;
    }

    if (piggyback.changes) {
        this.ringpop.membership.update(piggyback.changes);
    }

    if (piggyback.userData) {
        this.userDataStore.add(piggyback.userData);
    }
};

Dissemination.prototype.fullSync = function fullSync() {
    var changes = [];

    for (var i = 0; i < this.ringpop.membership.members.length; i++) {
        var member = this.ringpop.membership.members[i];

        changes.push({
            source: this.ringpop.whoami(),
            address: member.address,
            status: member.status,
            incarnationNumber: member.incarnationNumber
        });
    }

    return changes;
};

Dissemination.prototype.issue = function issue(checksum, source) {
    return {
        changes: issueChanges(this, checksum, source),
        userData: issueUserData(this)
    };
};

Dissemination.prototype.onRingChanged = function onRingChanged() {
    this.adjustMaxPiggybackCount();
};

Dissemination.prototype.recordChange = function recordChange(change) {
    this.recordedChanges[change.address] = change;
};

Dissemination.prototype.recordUserData = function recordUserData(userData) {
    this.recordedUserData.push(userData);
};

module.exports = Dissemination;
