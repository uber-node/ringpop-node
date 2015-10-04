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

var Member = require('./member.js');
var uuid = require('node-uuid');
var util = require('util');

function BaseUpdate(address, incarnationNumber, status) {
    this.address = address;
    this.incarnationNumber = incarnationNumber;
    this.status = status;
}

function Update(address, incarnationNumber, status, localMember) {
    Update.super_.call(this, address, incarnationNumber, status);

    localMember = localMember || {};
    this.id = uuid.v4();
    this.source = localMember.address;
    this.sourceIncarnationNumber = localMember.incarnationNumber;
    this.timestamp = Date.now();
}

util.inherits(Update, BaseUpdate);

function LeaveUpdate(address, incarnationNumber, localMember, opts) {
    LeaveUpdate.super_.call(this, address, incarnationNumber, Member.Status.leave,
        localMember);

    this.membershipOnly = opts.membershipOnly;
    this.ttl = opts.ttl;
}

util.inherits(LeaveUpdate, Update);

module.exports = {
    LeaveUpdate: LeaveUpdate,
    Update: Update
};
