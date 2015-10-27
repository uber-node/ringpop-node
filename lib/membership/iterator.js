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

function MembershipIterator(ringpop) {
    this.ringpop = ringpop;
    this.currentIndex = -1;
    this.currentRound = 0;
    this.members = null;
}

MembershipIterator.prototype.next = function next() {
    if (this.members === null) {
        this._shuffleMembers();
    }

    var membersVisited = {};
    var maxMembersToVisit = this.ringpop.membership.getMemberCount();

    while (Object.keys(membersVisited).length < maxMembersToVisit) {
        this.currentIndex++;

        if (this.currentIndex >= this.members.length) {
            this.currentIndex = 0;
            this.currentRound++;
            this._shuffleMembers();
        }

        var member = this.members[this.currentIndex];
        membersVisited[member.address] = true;

        if (this.ringpop.membership.isPingable(member)) {
            return member;
        }
    }

    return null;
};

MembershipIterator.prototype._shuffleMembers = function _shuffleMembers() {
    this.members = _.shuffle(this.ringpop.membership.members);
};

module.exports = MembershipIterator;
