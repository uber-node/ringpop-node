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

var _ = require('underscore');
var util = require('util');

var errors = require('../errors');

var core = require('./core');

//
// TChannel forwarder
//
// opts = {
//     sink: {
//         // REQUIRED
//         "type": "tchannel"
//         "host-port": '1.2.3.4:5000',
//
//         // OPTIONAL/HAS DEFAULTS
//         "service-name": 'ringpop',
//         endpoint: 'trace-<event>'
//     }
// }
//

var tchannelOptsDefaults = {
    sink: {
        type: 'tchannel',
        serviceName: 'ringpop',
        endpoint: 'trace'
    }
};

function TChannelTracer(ringpop, config, opts) {
    opts.sink = _.defaults(
        {},
        opts.sink,
        config.sinkOptsDefaults.tchannel,
        tchannelOptsDefaults.sink
    );
    core.Tracer.call(this, ringpop, config, opts);
}
util.inherits(TChannelTracer, core.Tracer);


TChannelTracer.prototype.invalidate = function invalidate() {
    var sinkOpts = this.opts.sink;
    var err = core.Tracer.prototype.invalidate.call(this);

    if (err) {
        return err;
    }
    if (!sinkOpts.serviceName) {
        return errors.InvalidOptionError({option: 'tchannel.serviceName', reason: 'is missing'});
    }
    if (!sinkOpts.endpoint) {
        return errors.InvalidOptionError({option: 'tchannel.endpoint', reason: 'is missing'});
    }
    return false;
};

TChannelTracer.prototype.connectSink = function connectSink(callback) {
    if (callback) {
        this.once('connectSink', callback);
    }

    var sinkOpts = this.opts.sink;
    this.reqOpts = _.extend(
        {
            host: sinkOpts.hostPort,
            timeout: 1000,
            serviceName: 'ringpop',
            hasNoParent: true,
            trace: false,
            retryLimit: 3,
            headers: {
                'as': 'raw',
                'cn': 'ringpop'
            }
        },
        _.omit(sinkOpts, 'type', 'hostPort')
    );

    this.ringpop.logger.info('ringpop TChannelTracer.connectSink', {
        local: this.ringpop.whoami(),
        reqOpts: this.reqOpts,
    });

    // trigger early identification, minimize latency
    this.ringpop.channel.waitForIdentified(
        _.pick(this.reqOpts, 'host'),
        this._remoteCallback.bind(this, 'connectSink'));
};

TChannelTracer.prototype.disconnectSink = function disconnectSink(callback) {
    var self = this;
    if (callback) {
        this.once('disconnectSink', callback);
    }

    process.nextTick(function() {
        self.disconnectSource();
        self.emit('disconnectSink');   
    });
};

TChannelTracer.prototype.send = function send(blob, callback) {
    if (callback) {
        this.once('send', callback);
    }

    if (Buffer.isBuffer(blob)) {
        blob = blob.toString();
    } else if (typeof blob === 'object') {
        blob = JSON.stringify(blob);
    }

    this.ringpop.channel
        .request(this.reqOpts)
        .send(this.reqOpts.endpoint, null, blob, this._remoteCallback.bind(this, 'send'));
};

TChannelTracer.prototype._remoteCallback = function _remoteCallback(event, err, resp) {
    // May have to split this to handle tchannel network type errors to
    // allow self removal. What's the right thing?
    if (!err && resp && !resp.ok) {
        err = new Error('ringpop TChannelTracer.' + event + ' received "notOk"');
    }
    if (err) {
        if (typeof err !== 'object') {
            err = new Error(err); // fallback for string
        }
        err.message = 'ringpop TChannelTracer.' + event + ': ' + err.message;
        err.context = {
            err: err,
            message: err.message,
            local: this.ringpop.whoami(),
            reqOpts: this.reqOpts,
        };
        this.ringpop.logger.warn(err.message, err.context);
        this.emit(event, err);
        return;
    }
    this.emit(event, null, resp);
};

TChannelTracer.prototype.matches = function matches(traceEvent, opts) {
    return (
        this.traceEvent === traceEvent &&
        opts.sink.type === 'tchannel' &&
        _.isEqual(
            _.pick(this.opts.sink, 'type', 'hostPort', 'endpoint'),
            _.pick(opts.sink, 'type', 'hostPort', 'endpoint'))
    );
};

module.exports = TChannelTracer;
