#!/usr/bin/env node
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

var fs = require('fs');
var path = require('path');

var program = require('commander');
var RingPop = require('./index');
var TChannel = require('tchannel');

function main(args) {
    program
        .version(require('./package.json').version)
        .usage('[options]')
        .option('-l, --listen <listen>', 'Host and port on which server listens (also node\'s identity in cluster)')
        .option('-h, --hosts <hosts>', 'Seed file of list of hosts to join')
        .option('-s --stats <stats-destination>', 'Enable stats emitting. Destination can be a host-port (e.g. localhost:8125) or a file-name (e.g. ./stats.log). If unset, no stats are emitted. '+
            'Note: you need to manually install "uber-statsd-client" to be able to emit stats')
        .parse(args);

    var listen = program.listen;
    if (!listen) {
        console.error('Error: listen arg is required');
        program.outputHelp();
        process.exit(1);
    }

    var stats = null;
    if (program.stats) {
        stats = createStatsClient(program.stats);
    }

    var tchannel = new TChannel({
    });

    var ringpop = new RingPop({
        app: 'ringpop',
        hostPort: listen,
        logger: createLogger('ringpop'),
        channel: tchannel.makeSubChannel({
            serviceName: 'ringpop',
            trace: false
        }),
        isCrossPlatform: true,
        stateTimeouts: {
            faulty: 5 * 1000, // 5s
            tombstone: 5 * 1000 // 5s
        },
        statsd: stats
    });

    ringpop.setupChannel();

    var listenParts = listen.split(':');
    var port = Number(listenParts[1]);
    var host = listenParts[0];
    tchannel.listen(port, host, onListening);

    function onListening() {
        ringpop.bootstrap(program.hosts);
    }
}

function createStatsClient(val) {
    var opts = null;
    var matchesHostPort = val.match(/^(.+):(\d+)$/);
    if (matchesHostPort) {
        opts = {
            host: matchesHostPort[1],
            port: parseInt(matchesHostPort[2])
        };
    } else {
        var file = path.resolve(val);
        opts = {
            _ephemeralSocket: new FileStatsLogger(file)
        };
    }

    var createStatsdClient;

    // Wrap the require in a try/catch so we're don't have to add uber-statsd-client
    // as a dependency but fail gracefully when not available.
    try {
        createStatsdClient = require('uber-statsd-client');
    } catch (e) {
        if (e.code !== "MODULE_NOT_FOUND") {
            throw e;
        }

        console.error("To be able to emit stats you need to have uber-statsd-client installed.");
        console.error("Please run \"npm install uber-statsd-client\" and try again!");
        process.exit(1);
    }

    return createStatsdClient(opts);
}

function FileStatsLogger(file) {
    if (!(this instanceof FileStatsLogger)) {
        return new FileStatsLogger(file);
    }

    this.file = file;
    this.stream = null;
    this.ensureStream();
}

FileStatsLogger.prototype.ensureStream = function ensureStream() {
    if (this.stream) {
        return;
    }
    this.stream = fs.createWriteStream(this.file, {flags: 'a'});
};

FileStatsLogger.prototype.close = function close() {
    if (this.stream) {
        this.stream.end();
        this.stream = null;
    }
};

FileStatsLogger.prototype._writeToSocket = function _writeToSocket(data, cb) {
    this.ensureStream();
    this.stream.write(new Date().toISOString() + ': ' + data + '\n', cb);
};

FileStatsLogger.prototype.send = FileStatsLogger.prototype._writeToSocket;

function createLogger(name) {
    return {
        trace: function noop() {},
        debug: enrich('debug', 'log'),
        info: enrich('info', 'log'),
        warn: enrich('warn', 'error'),
        error: enrich('error', 'error')
    };

    function enrich(level, method) {
        return function log() {
            var args = [].slice.call(arguments);
            args[0] = name + ' ' + level + ' ' + args[0];
            console[method].apply(console, args);
        };
    }
}

if (require.main === module) {
    main(process.argv);
}
module.exports = main;
