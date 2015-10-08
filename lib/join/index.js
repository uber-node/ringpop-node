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
var EventEmitter = require('events').EventEmitter;

var sendJoin = require('../gossip/join-sender').sendJoin;

var JoinList = require('./list');

function Joiner(opts, members) {
    this.ringpop = opts.ringpop;
    this.channel = opts.ringpop.channel;
    this.logger = opts.logger || opts.ringpop.logger;
    this.list = new JoinList(members);
    // XXX
    this.parallelismFactor = opts.ringpop.config.get('joinRequestParallelismFactor');
    this.period = opts.ringpop.config.get('joinRequestPeriodInitial');
    this.periodMax = opts.ringpop.config.get('joinRequestPeriodMax');
    this.timeout = opts.ringpop.config.get('joinRequestTimeout');

    // nextJoin also functions as flag for whether we're active; if there's a
    // nextJoin, then we're running. could wrap with a func.
    this.nextJoin = null;
    if (opts.ringpop.config.get('joinAutoStart')) {
        this.start();
    }
}
require('util').inherits(Joiner, EventEmitter);

Joiner.prototype.destroy = function destroy() {
    if (this.nextJoin) {
        clearTimeout(this.nextJoin);
        this.nextJoin = null;
    }
    delete this.list;
};

Joiner.prototype.start = function start(callback) {
    var topChannel = this.channel.topChannel;

    if (this.nextJoin) {
        callback(); // XXX error for re-call ? or idempotent? if idempotent, what is callback situation?
        return;
    }
    if (topChannel.listened) {
        this.join(callback);
    } else {
        topChannel.listeningEvent.on(this.join.bind(this, callback));
    }
};

Joiner.prototype._setupNextJoin = function _setupNextJoin() {
    var self = this;
    
    if (!self.nextJoin) {
        self.nextJoin = setTimeout(nextJoin, self.period);
    }

    function nextJoin() {
        self.join();
        self.period = Math.min(self.period * 1.5, self.periodMax);
    }
};

// XXX need to re-add preferred splitting
Joiner.prototype.addTargets = function addTargets(targets) {
    this.list.add(_.without(targets, this.ringpop.whoami()));
};

Joiner.prototype.join = function join(callback) {
    var self = this;
    var start = Date.now();
    // XXX need to filter out targets that are already members
    var targets = this.list.sample(self.parallelismFactor);
    //var results = [];

    callback = callback || function() {};
    if (!targets || targets.length === 0) {
        callback();
        return;
    }

    for (var i = 0; i < targets.length; ++i) {
        sendJoin(targets[i], {
            ringpop: self.ringpop,
            timeout: self.timeout
        }, onJoin);
    }

    // XXX move out callbacks, use a parallel here?
    function onJoin(err, target, joinResponse) {
        var duration = Date.now() - start;

        if (err) {
            self.logger.error('ringpop join failed', {
                error: err,
                address: self.hostPort
            });
            callback(err);
            return;
        }

        if (self.destroyed) {
            callback();
            return;
        }

        // should move up as passed in callback
        // XXX unwrap membership callback?
        self.ringpop.membership.update(joinResponse.members, function onUpdate() {
            self.ringpop.logger.debug('ringpop join response', {
                local: self.ringpop.whoami(),
                duration: duration,
            });
        });
    }
};

module.exports = Joiner; 
