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

'use strict';
var assert = require('assert');
var cp = require('child_process');
var metrics = require('metrics');
var path = require('path');
var program = require('commander');

var Runner = require('../lib/runner');

var PORT_BASE = 20000;

if (require.main === module) {
    parseArgs();
    main();
}

function parseArgs() {
    program
    .option('--scenario <value>', 'path to scenario relative to scenario runner')
    .option('--cycles [value]', 'number of cycles', parseInt, 10)
    .option('--workers [value]', 'number of workers', parseInt, 10)
    .parse(process.argv);

    assert(program.scenario, 'path to scenario should be provided');

    console.log('configuration:');
    console.log('- scenario', program.scenario);
    console.log('- cycles', program.cycles);
    console.log('- workers', program.workers);
}

function main() {
    var scenario = require(path.join(__dirname, program.scenario));
    var histogram = new metrics.Histogram();
    var context = {
        hostToAliveWorker: Object.create(null),
        hostToFaultyWorker: Object.create(null),
        hostToChecksum: Object.create(null),
        numberOfWorkers: program.workers
    };
    var runner = new Runner({
        cycles: program.cycles,
        setup: setup.bind(undefined, context),
        teardown: teardown.bind(undefined, context),
        suite: {
            before: scenario.fn.bind(undefined, context),
            fn: waitForConvergence.bind(undefined, context),
            after: recover.bind(undefined, context)
        }
    });
    var time;

    runner.on(Runner.EventType.Fn, function onCycleStart() {
        time = Date.now();
    });
    runner.on(Runner.EventType.After, function onCycleComplete() {
        histogram.update(Date.now() - time);
    });

    console.log('convergence time under ' + scenario.name);

    runner.run(function report() {
        var result = histogram.printObj();

        console.log('histogram data:');
        console.log('- count', result.count);
        console.log('- min', result.min);
        console.log('- max', result.max);
        console.log('- mean', result.mean);
        console.log('- median', result.median);
        console.log('- variance', result.variance);
        /* jshint camelcase: false */
        console.log('- std dev', result.std_dev);
        /* jshint camelcase: true */
        console.log('- p75', result.p75);
        console.log('- p95', result.p95);
        console.log('- p99', result.p99);
    });
}

function setup(context, callback) {
    var readyCount = 0;

    fork(context, function onMessage(message) {
        switch (message.type) {
            case 'ready':
                readyCount += 1;
                if (readyCount === context.numberOfWorkers) {
                    Object.keys(context.hostToAliveWorker).forEach(function join(host) {
                        context.hostToAliveWorker[host].send({
                            cmd: 'bootstrap',
                            hosts: getHostsToJoin(Math.ceil(context.numberOfWorkers / 3))
                        });
                    });
                    waitForConvergence(context, callback);
                }
                break;
            case 'checksum':
                context.hostToChecksum[message.host] = message.value;
                break;
        }
    });
}

function fork(context, onMessage) {
    var args;
    var host;
    var worker;
    var i;

    for (i = 0; i < context.numberOfWorkers; i++) {
        host = '127.0.0.1:' + (PORT_BASE + i);
        args = [];
        args.push('--host', host);
        worker = cp.fork(__dirname + '/worker.js', args);
        worker.on('message', onMessage);
        context.hostToAliveWorker[host] = worker;
    }
}

function getHostsToJoin(n) {
    var hostToJoin = [];
    var i;

    for (i = 0; i < n; i++) {
        hostToJoin.push('127.0.0.1:' + (PORT_BASE + i));
    }

    return hostToJoin;
}

function waitForConvergence(context, callback) {
    var handle = setInterval(function check() {
        var hosts = Object.keys(context.hostToAliveWorker);
        var i;

        for (i = 1; i < hosts.length; i++) {
            if (!context.hostToChecksum[hosts[i]] ||
                context.hostToChecksum[hosts[i - 1]] !== context.hostToChecksum[hosts[i]]) {
                return;
            }
        }

        if (Object.keys(context.hostToChecksum).length >= Object.keys(context.hostToAliveWorker).length) {
            context.hostToChecksum = Object.create(null);
            clearInterval(handle);
            callback();
        }
    }, 5);
}

function teardown(context, callback) {
    Object.keys(context.hostToAliveWorker).forEach(function shutdown(host) {
        context.hostToAliveWorker[host].send({
            cmd: 'shutdown'
        });
    });
    process.nextTick(callback);
}

function recover(context, callback) {
    Object.keys(context.hostToFaultyWorker).forEach(function join(host) {
        context.hostToAliveWorker[host] = context.hostToFaultyWorker[host];
        delete context.hostToFaultyWorker[host];
        context.hostToAliveWorker[host].send({
            cmd: 'join',
            hosts: getHostsToJoin(Math.ceil(context.numberOfWorkers / 3))
        });
    });
    waitForConvergence(context, callback);
}
