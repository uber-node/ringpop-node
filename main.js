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

var program = require('commander');
var RingPop = require('./index');
var TChannel = require('tchannel');

function main(args) {
    program
        .version(require('./package.json').version)
        .usage('[options]')
        .option('-l, --listen <listen>', 'Host and port on which server listens (also node\'s identity in cluster)')
        .option('-h, --hosts <hosts>', 'Seed file of list of hosts to join')
        .option('--suspect [suspect]', 'Suspect period in seconds')
        .option('--faulty [faulty]', 'Faulty period in seconds')
        .option('--tombstone [tombstone]', 'Tombstone period in seconds')
        .parse(args);

    var listen = program.listen;
    if (!listen) {
        console.error('Error: listen arg is required');
        program.outputHelp();
        process.exit(1);
    }

    program.suspect = parseInt(program.suspect, 10) || 5;
    program.faulty = parseInt(program.faulty, 10) || 24*60*60;
    program.tombstone = parseInt(program.tombstone, 10) || 5;

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
            suspect: program.suspect * 1000,
            faulty: program.faulty * 1000,
            tombstone: program.tombstone * 1000,
        }
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
