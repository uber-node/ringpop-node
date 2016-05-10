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

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var GossipEvents = require('./events');

var LOG_10 = Math.log(10);

function Dissemination(ringpop) {
    this.ringpop = ringpop;
    this.ringpop.on('ringChanged', this.onRingChanged.bind(this));
    this.logger = this.ringpop.loggerFactory.getLogger('dissemination');

    this.changes = {};
    this.reverseFullSyncJobs = 0;
    this.maxPiggybackCount = Dissemination.Defaults.maxPiggybackCount;
    this.piggybackFactor = Dissemination.Defaults.piggybackFactor;
}

util.inherits(Dissemination, EventEmitter);

Dissemination.prototype.adjustMaxPiggybackCount = function adjustMaxPiggybackCount() {
    var serverCount = this.ringpop.ring.getServerCount();
    var prevPiggybackCount = this.maxPiggybackCount;
    var newPiggybackCount = this.piggybackFactor * Math.ceil(Math.log(serverCount + 1) / LOG_10);

    if (this.maxPiggybackCount !== newPiggybackCount) {
        this.maxPiggybackCount = newPiggybackCount;
        this.ringpop.stat('gauge', 'max-piggyback', this.maxPiggybackCount);
        this.logger.debug('ringpop dissemination adjusted max piggyback count', {
            newPiggybackCount: this.maxPiggybackCount,
            oldPiggybackCount: prevPiggybackCount,
            piggybackFactor: this.piggybackFactor,
            serverCount: serverCount
        });

        this.emit('maxPiggybackCountAdjusted');
    }
};

Dissemination.prototype.clearChanges = function clearChanges() {
    this.changes = {};
};

Dissemination.prototype.membershipAsChanges = function membershipAsChanges() {
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

Dissemination.prototype.isEmpty = function isEmpty() {
    return Object.keys(this.changes).length === 0;
};

Dissemination.prototype.issueAsSender = function issueAsSender(issue) {
    var self = this;
    var membershipChanges = this._issueAs(null);

    issue(membershipChanges, function onIssue(err) {
        // Bump the piggyback count only when we get confirmation that
        // dissemination was successful.
        if (err) {
            self.ringpop.stat('increment', 'dissemination.bump-bypass');
            self.logger.info('ringpop dissemination not bumping piggyback count', {
                local: self.ringpop.whoami(),
                err: err,
                numMembershipChanges: membershipChanges.length
            });
            return;
        }

        for (var i = 0; i < membershipChanges.length; i++) {
            var issuedChange = membershipChanges[i];
            var localChange = self.changes[issuedChange.address];
            if (localChange && localChange.id === issuedChange.id) {
                localChange.piggybackCount++;
            }
        }
    });
};

Dissemination.prototype.issueAsReceiver = function issueAsReceiver(senderAddr, senderIncarnationNumber, senderChecksum) {
    var membershipChanges = this._issueAs(filterChange);
    var fullSync = false;

    if (membershipChanges.length === 0 && this.ringpop.membership.checksum !== senderChecksum) {
        this.ringpop.stat('increment', 'full-sync');
        this.logger.info('ringpop dissemination issued full sync', {
            local: this.ringpop.whoami(),
            localChecksum: this.ringpop.membership.checksum,
            dest: senderAddr,
            destChecksum: senderChecksum
        });

        fullSync = true;
        membershipChanges = this.membershipAsChanges();
    }

    // Note, we blindly raise the piggyback counter because the protocol does
    // not provide a way to confirm receipt of the message.
    for (var i = 0; i < membershipChanges.length; i++) {
        var issuedChange = membershipChanges[i];
        var localChange = this.changes[issuedChange.address];
        if (localChange && localChange.id === issuedChange.id) {
            localChange.piggybackCount++;
        }
    }

    return {changes: membershipChanges, fullSync: fullSync};

    function filterChange(change) {
        return !!(senderAddr &&
            senderIncarnationNumber &&
            change.source &&
            change.sourceIncarnationNumber &&
            senderAddr === change.source &&
            senderIncarnationNumber === change.sourceIncarnationNumber);
    }
};

Dissemination.prototype.onRingChanged = function onRingChanged() {
    this.adjustMaxPiggybackCount();
};

Dissemination.prototype.recordChange = function recordChange(change) {
    // TODO This should not mutate the input. But it does and will
    // until we can refactor.
    change.piggybackCount = 0;
    this.changes[change.address] = change;
};

Dissemination.prototype.resetMaxPiggybackCount = function resetMaxPiggybackCount() {
    this.maxPiggybackCount = Dissemination.Defaults.maxPiggybackCount;
};

Dissemination.prototype.getChangeByAddress = function getChangeByAddress(address) {
    return this.changes[address];
};

Dissemination.prototype.getChangesCount = function getChangesCount() {
    return Object.keys(this.changes).length;
};

Dissemination.prototype._issueAs = function _issueAs(filterChange) {
    var changesToDisseminate = [];

    var changedNodes = Object.keys(this.changes);

    for (var i = 0; i < changedNodes.length; i++) {
        var address = changedNodes[i];
        var change = this.changes[address];

        if (typeof filterChange === 'function' && filterChange(change)) {
            this.ringpop.stat('increment', 'filtered-change');
            continue;
        }

        if (change.piggybackCount >= this.maxPiggybackCount) {
            delete this.changes[address];
            if (Object.keys(this.changes).length === 0) {
                this.emit('changesExhausted', new GossipEvents.ChangesExhaustedEvent());
            }
            continue;
        }

        // TODO Include change timestamp
        changesToDisseminate.push({
            id: change.id,
            source: change.source,
            sourceIncarnationNumber: change.sourceIncarnationNumber,
            address: change.address,
            status: change.status,
            incarnationNumber: change.incarnationNumber
        });
    }

    this.ringpop.stat('gauge', 'changes.disseminate', changesToDisseminate.length);


    if (changesToDisseminate.length > 0) {
        this.logger.info('ringpop dissemination send', {
            local: this.ringpop.whoami(),
            changesCount: changesToDisseminate.length
        });
    }

    return changesToDisseminate;
};

Dissemination.prototype.tryStartReverseFullSync = function tryStartReverseFullSync(target, timeout) {
    var self = this;

    if (this.reverseFullSyncJobs >= this.ringpop.maxReverseFullSyncJobs) {
        this.logger.info('omit bidirectional full sync, too many already running', {
            'remote': target,
            'reverseFullSyncJobs': this.reverseFullSyncJobs,
            'maxReverseFullSyncJobs': this.ringpop.maxReverseFullSyncJobs
        });
        this.ringpop.stat('increment', 'full-sync.reverse-omitted');
        return;
    }

    this.reverseFullSyncJobs += 1;
    this.ringpop.stat('gauge', 'full-sync.reverse-jobs', this.reverseFullSyncJobs);

    var start = new Date();
    this._reverseFullSync(target, timeout, onReverseFullSync);

    function onReverseFullSync() {
        self.ringpop.stat('timing', 'full-sync.reverse', start);
        self.reverseFullSyncJobs -= 1;
        self.ringpop.stat('gauge', 'full-sync.reverse-jobs', self.reverseFullSyncJobs);
    }
};

Dissemination.prototype._reverseFullSync = function _reverseFullSync(target, timeout, callback) {
    var self = this;
    
    this.ringpop.stat('increment', 'full-sync.reverse');
    this.ringpop.client.protocolJoin({
        host: target,
        retryLimit: this.ringpop.config.get('tchannelRetryLimit'),
        timeout: timeout
    }, {
        app: this.ringpop.app,
        source: this.ringpop.whoami(),
        incarnationNumber: this.ringpop.membership.localMember.incarnationNumber
    }, onJoin);

    function onJoin(err, res) {
        if (err) {
            self.logger.warn('bidirectional full sync failed due to failed join request', {
                remote: target,
                error: err
            });
            self.ringpop.stat('increment', 'full-sync.reverse.failed');
            return callback();
        }

        process({
            checksum: res.membershipChecksum,
            members: res.membership
        });
        callback();
    }

    function process(joinResponse) {
        self.logger.info('bidirectional full sync', {remote: target});

        var updates = self.ringpop.membership.update(joinResponse.members);
        if (updates.length === 0) {
            self.ringpop.stat('increment', 'full-sync.redundant-reverse');
        }
    }
};

Dissemination.Defaults = {
    maxPiggybackCount: 1,
    piggybackFactor: 15 // A lower piggyback factor leads to more full-syncs
};

module.exports = Dissemination;
