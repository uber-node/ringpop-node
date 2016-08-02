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

var uuid = require('node-uuid');

/**
 * Create a new Update
 * @param {IMember} subject the subject of the update.
 * @param {IMember} [source] the source of the update.
 * @constructor
 */
function Update(subject, source) {
    if (!(this instanceof Update)) {
        return new Update(subject, source);
    }
    this.id = uuid.v4();
    this.timestamp = Date.now();

    // Populate subject
    subject = subject || {};
    this.address = subject.address;
    this.incarnationNumber = subject.incarnationNumber;
    this.status = subject.status;

    // Populate source
    source = source || {};
    this.source = source.address;
    this.sourceIncarnationNumber = source.incarnationNumber;
}

module.exports = Update;
