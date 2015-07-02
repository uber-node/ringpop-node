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
var createServer = require('./server');
var program = require('commander');
var RingPop = require('./index');
var TChannel = require('tchannel');

var HOST_PORT_PATTERN = /^(\d+\.\d+\.\d+\.\d+):(\d+)$/;

function validateHosts(arg) {
    if (!arg) {
        console.log('hosts arg is required');
        process.exit(1);
    }

    if (!arg.match(/\.json$/)) {
        console.log("hosts arg must have .json extension");
        process.exit(1);
    }

    var hosts = require(arg);

    hosts.forEach(function(host) {
        if (!host.match(HOST_PORT_PATTERN)) {
            console.log('host in file must be in `ip:port` format: ' + host);
            process.exit(1);
        }
    });

    return hosts;
}

function validateListen(arg) {
    if (!arg) {
        console.log('listen arg is required');
        process.exit(1);
    }

    if (!arg.match(HOST_PORT_PATTERN)) {
        console.log('listen arg must be in `ip:port` format');
        process.exit(1);
    }
}

function main() {
    program
        .version(require('./package.json').version)
        .usage('[options]')
        .option('-l, --listen <listen>', 'Host and port on which server listens (also node\'s identity in cluster)')
        .option('-h, --hosts <hosts>', 'Seed file of list of hosts to join')
        .parse(process.argv);

    var listen = program.listen;
    validateListen(listen);
    validateHosts(program.hosts);

    var parts = listen.match(HOST_PORT_PATTERN);
    var tchannel = new TChannel({
        host: parts[1],
        port: +parts[2],
        logger: createLogger('tchannel')
    });

    var ringpop = new RingPop({
        app: 'ringpop',
        hostPort: listen,
        logger: createLogger('ringpop'),
        channel: tchannel
    });

    createServer(ringpop, tchannel);
    ringpop.bootstrap(program.hosts);
}

if (require.main === module) {
    main();
}

function createLogger(name) {
    return {
        debug: function noop() {},
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
