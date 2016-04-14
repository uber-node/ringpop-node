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

var Cluster = require('./cluster.js');
var logger = require('winston');
var handleOrForward = require('./handle_or_forward');
var parseArgs = require('./parse_args.js');

function App(ringpop) {
    var self = this;
    self.ringpop = ringpop;
    self.appChannel = self.ringpop.appChannel;
    self.appChannel.register('health', self.healthCheck.bind(self));
    self.appChannel.register('get', self.get.bind(self));
    self.appChannel.register('put', self.put.bind(self));
    self.data = Object.create(null);
}

App.prototype.healthCheck = function healthCheck(req, res/*, arg2, arg3*/) {
    logger.info('health check');
    res.headers.as = 'raw';
    res.sendOk('', '"OK"');
};

App.prototype.get = function get(req, res, arg2, arg3) {
    var self = this;
    var key = JSON.parse(arg3).key;

    handleOrForward(self.ringpop, key, req, res, arg2, arg3, function handleGet() {
        logger.info(self.ringpop.whoami() + ' get:', arg3.toString());
        res.headers.as = 'raw';

        res.sendOk('', '"' + self.data[key] + '"');
    });
};

App.prototype.put = function put(req, res, arg2, arg3) {
    var self = this;
    var requestBody = JSON.parse(arg3);

    handleOrForward(self.ringpop, requestBody.key, req, res, arg2, arg3, function handlePut() {
        logger.info(self.ringpop.whoami() + ' put:', arg3.toString());

        self.data[requestBody.key] = requestBody.value;
        res.headers.as = 'raw';
        res.sendOk('', '"OK"');
    });
};

if (require.main === module) {
    var cluster = new Cluster(parseArgs());
    cluster.launch(function onLaunch(err, ringpops) {
        if (err) {
            logger.error('error: ' + err.message);
            process.exit(1);
        }

        ringpops.forEach(function each(ringpop) {
            /* jshint nonew: false */
            new App(ringpop);
        });
    });
}
