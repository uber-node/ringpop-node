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

var assert = require('assert');

var RelayRequest = require('tchannel/relay_handler').RelayRequest;

module.exports = RingpopHandler;

function RingpopHandler(options) {
    /*eslint max-statements: [2, 25]*/
    if (!(this instanceof RingpopHandler)) {
        return new RingpopHandler(options);
    }

    var self = this;

    self.realHandler = options.realHandler;
    assert(
        typeof self.realHandler === 'object',
        'expected options.realHandler'
    );

    self.ringpop = options.ringpop;
    assert(typeof self.ringpop === 'object', 'expected options.ringpop');

    self.channel = options.channel;
    assert(typeof self.channel === 'object', 'expected options.channel');

    self.logger = options.logger;
    assert(typeof self.logger === 'object', 'expected options.logger');

    // Blacklist of methods that will not be 'auto-sharded' but instead will
    // be passed thru to the handler. Object mapping names to boolean.
    self.blacklist = options.blacklist || null;
    if (self.blacklist) {
        assert(
            typeof self.blacklist === 'object',
            'expected options.blacklist to be an object'
        );

        var blackListKeys = Object.keys(self.blacklist);
        for (var i = 0; i < blackListKeys.length; i++) {
            var key = blackListKeys[i];
            assert(typeof self.blacklist[key] === 'boolean',
                'expected options.blacklist item to be boolean'
            );
        }
    }
}

RingpopHandler.prototype.type = 'tchannel.endpoint-handler';

RingpopHandler.prototype.handleRequest = function handleRequest(req, buildRes) {
    var self = this;

    if (self.blacklist && self.blacklist[req.endpoint]) {
        return self.realHandler.handleRequest(req, buildRes);
    }

    var shardKey = req.headers.sk;
    if (!shardKey) {
        self.logger.warn('Ringpop got request without a shardKey', {
            socketRemoteAddr: req.remoteAddr,
            serviceName: req.serviceName,
            endpoint: req.endpoint,
            callerName: req.headers.cn,
            headers: req.headers,
            local: self.ringpop.whoami()
        });
        return buildRes().sendError(
            'BadRequest',
            '[ringpop] Request does not have sk header set'
        );
    }

    var dest = self.resolveHost(shardKey);
    if (self.ringpop.whoami() === dest) {
        return self.realHandler.handleRequest(req, buildRes);
    }

    var peer = self.channel.peers.add(dest);
    var outreq = new RelayRequest(self.channel, peer, req, buildRes);
    outreq.createOutRequest();
};

RingpopHandler.prototype.resolveHost =
function resolveHost(shardKey) {
    var self = this;

    return self.ringpop.lookup(shardKey);
};

RingpopHandler.prototype.register = function register(arg1, fn) {
    var self = this;

    self.realHandler.register(arg1, fn);
};
