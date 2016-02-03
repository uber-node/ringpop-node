#!/usr/bin/env node

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

var childProc = require('child_process');
var color = require('cli-color');
var generateHosts = require('./generate-hosts');
var program = require('commander');
var TChannel = require('tchannel');
var fs = require('fs');

var programInterpreter, programPath, startingPort, bindInterface, procsToStart = 5;
var hosts, procs, ringPool, localIP, toSuspend, toKill, tchannel; // defined later

/* jshint maxparams: 6 */

function safeParse(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

function lpad(num, len) {
    var ret = String(num);
    while (ret.length < len) {
        ret = '0' + ret;
    }
    return ret;
}

function formatDate() {
    var now = new Date();
    return lpad(now.getHours(), 2) + ':' + lpad(now.getMinutes(), 2) + ':' + lpad(now.getSeconds(), 2) + '.' + lpad(now.getMilliseconds(), 3);
}

function logMsg(who, msg) {
    console.log(color.blue('[' + who + '] ') + color.yellow(formatDate()) + ' ' + msg);
}

function hostsUp() {
    return procs
        .filter(function (proc) { return !proc.killed && !proc.suspended; })
        .map(function (proc) { return proc.hostPort; });
}

// join all nodes to the first node
function joinAll() {
    var completed = [];
    logMsg('cluster', color.cyan('starting join of all nodes to random other nodes'));
    hosts.forEach(function (host, pos, list) {
        var postStr = JSON.stringify({});
        var start = Date.now();
        send(host, '/admin/join', null, postStr, function onSend(err) {
            if (err) {
                logMsg('host', color.red('err sending join to host: ' + err.message));
            }
            var durMs = Date.now() - start;
            completed.push(durMs);
            if (completed.length === list.length) {
                logMsg('cluster', color.cyan('join all completed: ') + color.green(completed.join(', ')));
            }
        });
    });
}

function tickAll() {
    var completed = [];
    var csums = {};

    hostsUp().forEach(function (host, pos, list) {
        var start = Date.now();
        send(host, '/admin/tick', function onSend(err, res, arg2, arg3) {
            var durMs = Date.now() - start;
            completed.push(durMs);
            if (err) {
                console.log(color.red('err: ' + err.message + ' [' + host + ']'));
            } else {
                var csum = safeParse(arg3.toString()).checksum;
                if (csums[csum] === undefined) {
                    csums[csum] = [];
                }
                var port = host.replace(localIP + ':', '');
                csums[csum].push(port);
            }

            if (completed.length === list.length) {
                console.log(Object.keys(csums).sort(function (a, b) { return csums[a].length - csums[b].length; }).map(function (csum) {
                    return color.blue('[' + csums[csum].join(', ') + '] ') + color.magenta(csum + ' (' + csums[csum].length + ')');
                }).join(' '));
            }
        });
    });
}

function statsAll() {
    var completed = [],
        csums = {},
        memberships = {};

    hostsUp().forEach(function (host, pos, list) {
        var start = Date.now();
        send(host, '/admin/stats', function onSend(err, res, arg2, arg3) {
            var durMs = Date.now() - start;
            completed.push(durMs);
            if (err) {
                console.log(color.red('err: ' + err.message + ' [' + host + ']'));
            } else {
                var membership = safeParse(arg3).membership;
                var csum = membership.checksum;

                if (csums[csum] === undefined) {
                    csums[csum] = [];
                    memberships[csum] = JSON.stringify(membership.members);
                }

                var port = host.replace(localIP + ':', '');
                csums[csum].push(port);
            }

            if (completed.length === list.length) {
                console.log(Object.keys(csums).sort(function (a, b) { return csums[a].length - csums[b].length; }).map(function (csum) {
                    return color.blue('[' + csums[csum].join(', ') + '] ') + color.magenta(memberships[csum]);
                }).join('\n'));
            }
        });
    });
}

function formatStats(obj) {
    return {
        protocolRate: obj.protocolRate,
        clientRate: obj.clientRate.toFixed(2),
        serverRate: obj.serverRate.toFixed(2),
        totalRate: obj.totalRate.toFixed(2),
        count: obj.timing.count,
        min: obj.timing.min,
        max: obj.timing.max,
        mean: obj.timing.mean && obj.timing.mean.toFixed(2),
        p50: obj.timing.median && obj.timing.median.toFixed(2),
        p95: obj.timing.p95 && obj.timing.p95.toFixed(2),
        p99: obj.timing.p99 && obj.timing.p99.toFixed(2)
    };
}

function protocolStatsAll() {
    var completed = [];
    var stats = {};

    hostsUp().forEach(function (host, pos, list) {
        var start = Date.now();
        send(host, '/admin/stats', function onSend(err, res, arg2, arg3) {
            var durMs = Date.now() - start;
            completed.push(durMs);
            var port = host.replace(localIP + ':', '');
            if (err) {
                console.log(color.red('err: ' + err.message + ' [' + port + ']'));
            } else {
                var bodyObj = safeParse(arg3.toString());
                stats[port] = formatStats(bodyObj.protocol);
            }
            if (completed.length === list.length) {
                console.log(Object.keys(stats).sort().map(function (port) {
                    return color.blue('[' + port + '] ') + color.magenta(JSON.stringify(stats[port]));
                }).join('\n'));
            }
        });
    });
}

function startGossip() {
    var completed = [];

    logMsg('cluster', color.cyan('starting gossip on all nodes'));
    hostsUp().forEach(function (host, pos, list) {
        var start = Date.now();
        send(host, '/admin/gossip', function onSend() {
            var durMs = Date.now() - start;
            completed.push(durMs);
            if (completed.length === list.length) {
                logMsg('cluster', color.cyan('gossip all completed: ') + color.green(completed.join(', ')));
            }
        });
    });
}

function debugSet(flag) {
    var completed = [];

    hostsUp().forEach(function (host, pos, list) {
        var start = Date.now();

        var body = JSON.stringify({
            debugFlag: flag
        });

        send(host, '/admin/debugSet', null, body, function onSend(err) {
            if (err) {
                logMsg('cluster', color.red('error setting debug flag: ') + err.message);
            }
            var durMs = Date.now() - start;
            completed.push(durMs);
            if (completed.length === list.length) {
                logMsg('cluster', color.cyan('debug flag set completed: ') + color.green(completed.join(', ')));
            }
        });
    });
}

function debugClear() {
    var completed = [];

    hostsUp().forEach(function (host, pos, list) {
        var start = Date.now();
        send(host, '/admin/debugClear', function onSend() {
            var durMs = Date.now() - start;
            completed.push(durMs);
            if (completed.length === list.length) {
                logMsg('cluster', color.cyan('debug flags clear completed: ') + color.green(completed.join(', ')));
            }
        });
    });
}

var state = 'top';
var func = null;
var numArgRe = /^[1-9]$/;
var debugRe = /^[ph]$/;
function onData(char) {
    if (state === 'top') {
        switch (char) {
            case '\u0003': // watch for control-c explicitly, because we are in raw-mode
            case 'q':
                killAllProcs();
                process.exit();
                break;
            case 't':
                tickAll();
                break;
            case 'j':
                joinAll();
                break;
            case 'g':
                startGossip();
                break;
            case 's':
                statsAll();
                break;
            case 'p':
                protocolStatsAll();
                break;
            case 'd':
                func = debugSet;
                state = 'readchar';
                process.stdout.write('set debug (ph): ');
                break;
            case 'D':
                debugClear();
                break;
            case 'l':
                func = suspendProc;
                state = 'readnum';
                process.stdout.write('suspend count (1-9): ');
                break;
            case 'k':
                func = killProc;
                state = 'readnum';
                process.stdout.write('kill count (1-9): ');
                break;
            case 'K':
                reviveProcs();
                break;
            case '\r':
                console.log('');
                break;
            case ' ':
                console.log('-------------------------------------------------------------------------');
                break;
            case 'h':
            case '?':
                displayMenu(logMsg.bind(null, '?'));
                break;
            default:
                console.log('Unknown key');
        }
    } else if (state === 'readnum') {
        if (char.match(numArgRe)) {
            console.log();
            func(char);
            state = 'top';
            func = null;
        } else {
            console.error('expecting: ' + numArgRe);
            state = 'top';
        }
    } else if (state === 'readchar') {
        if (char.match(debugRe)) {
            console.log();
            func(char);
            state = 'top';
            func = null;
        } else {
            console.error('expecting: ' + debugRe + ' got ' + char);
            state = 'top';
        }
    } else {
        console.error('unknown state: ' + state);
        state = 'top';
    }
}

function findLocalIP() {
    var addrs = require('os').networkInterfaces().en0;
    if (! addrs) {
        logMsg('cluster', color.red('could not determine local IP, defaulting to 127.0.0.1'));
        localIP = '127.0.0.1';
    } else {
        for (var i = 0; i < addrs.length; i++) {
            if (addrs[i].family === 'IPv4') {
                localIP = addrs[i].address;
                logMsg('cluster', color.cyan('using ') + color.green(localIP) + color.cyan(' to listen'));
                return;
            }
        }
    }
    logMsg('cluster', color.red('could not find local IP with IPv4 address, defaulting to 127.0.0.1'));
    localIP = '127.0.0.1';
}


function ClusterProc(port) {
    var newProc;

    this.port = port;
    this.hostPort = localIP + ':' + port;

    if (programInterpreter) {
        newProc = childProc.spawn(programInterpreter,
            [programPath, '--listen=' + this.hostPort, '--hosts=./hosts.json']);
    } else {
        newProc = childProc.spawn(programPath,
            ['--listen=' + this.hostPort, '--hosts=./hosts.json']);
    }

    var self = this;

    newProc.on('error', function(err) {
        console.log('Error: ' + err.message + ', failed to spawn ' +
            programPath + ' on ' + self.hostPort);
    });

    newProc.on('exit', function(code) {
        if (code !== null) {
            console.log('Program ' + programPath + ' ended with exit code ' + code);
        }
    });

    function logOutput(data) {
        var lines = data.toString('utf8').split('\n');

        var totalOpenBraces = 0;
        var totalCloseBraces = 0;
        var output = '';

        lines.forEach(function (line) {
            if (line.length === 0) {
                return;
            }

            var matchedOpenBraces = line.match(/{/g);
            var matchedCloseBraces = line.match(/}/g);

            totalOpenBraces += matchedOpenBraces && matchedOpenBraces.length || 0;
            totalCloseBraces += matchedCloseBraces && matchedCloseBraces.length || 0;

            output += line.replace(/^\s+/g, ' ');

            if (totalOpenBraces === totalCloseBraces) {
                logMsg(port, output);
                output = '';
                totalOpenBraces = 0;
                totalCloseBraces = 0;
            }
        });
    }

    newProc.stdout.on('data', logOutput);
    newProc.stderr.on('data', logOutput);

    this.proc = newProc;
    this.pid = newProc.pid;
    this.killed = null;
    this.suspended = null;
    this.debugflags = '';
}

function reviveProcs() {
    for (var i = 0; i < procs.length ; i++) {
        var proc = procs[i];
        if (proc.killed) {
            logMsg(proc.port, color.red('restarting after ') + color.green((Date.now() - proc.killed) + 'ms'));
            procs[i] = new ClusterProc(proc.port);
        } else if (proc.suspended) {
            logMsg(proc.port, color.green('pid ' + proc.pid) + color.red(' resuming after ') + color.green((Date.now() - proc.suspended) + 'ms'));
            process.kill(proc.pid, 'SIGCONT');
            proc.suspended = null;
        }
    }
}

function suspendProc(count) {
    toSuspend = +count;

    var suspended = [];
    while (suspended.length < toSuspend) {
        var rand = Math.floor(Math.random() * procs.length);
        var proc = procs[rand];
        if (proc.killed === null && proc.suspended === null) {
            logMsg(proc.port, color.green('pid ' + proc.pid) + color.red(' randomly selected for sleep'));
            process.kill(proc.proc.pid, 'SIGSTOP');
            proc.suspended = Date.now();
            suspended.push(proc);
        }
    }
}

function killProc(count) {
    toKill = +count;

    var killed = [];
    while (killed.length < toKill) {
        var rand = Math.floor(Math.random() * procs.length);
        var proc = procs[rand];
        if (proc.killed === null && proc.suspended === null) {
            logMsg(proc.port, color.green('pid ' + proc.pid) + color.red(' randomly selected for death'));
            process.kill(proc.proc.pid, 'SIGKILL');
            proc.killed = Date.now();
            killed.push(proc);
        }
    }
}

function killAllProcs() {
    console.log('Killing all ' + procsToStart + ' procs to exit...');
    for (var i = 0; i < procsToStart; i++) {
        if (! procs[i].killed) {
            process.kill(procs[i].pid, 'SIGKILL');
        }
    }
}

function startCluster() {
    procs = []; // note module scope
    for (var i = 0; i < procsToStart ; i++) {
        procs[i] = new ClusterProc(startingPort + i);
    }
    logMsg('init', color.cyan('started ' + procsToStart + ' procs: ') + color.green(procs.map(function (p) { return p.proc.pid; }).join(', ')));
}

function main() {
    logMsg('init', color.cyan('tick-cluster started '));

    if (bindInterface) {
        localIP = bindInterface;
    } else {
        findLocalIP();
    }
    hosts = generateHosts(localIP, startingPort, procsToStart, 'hosts.json');
    startCluster();

    tchannel = new TChannel({host: "127.0.0.1", port: startingPort + procsToStart + 1});
    ringPool = tchannel.makeSubChannel({
        serviceName: 'tick-cluster',
        trace: false
    });

    try {
        var stdin = process.stdin;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        stdin.on('data', onData);
        logMsg('init', color.red('d: debug flags, g: gossip, j: join, k: kill, K: revive all, l: sleep, p: protocol stats, q: quit, s: cluster stats, t: tick'));
    } catch (e) {
        logMsg('init', 'Unable to open stdin; interactive commands disabled');
    }
}

function displayMenu(logFn) {
    logFn('\td <flag>\tSet debug flag');
    logFn('\tD\t\tClear debug flags');
    logFn('\tg\t\tStart gossip');
    logFn('\th\t\tHelp menu');
    logFn('\tj\t\tJoin nodes');
    logFn('\tk <count>\tKill processes');
    logFn('\tK\t\tRevive suspended or killed processes');
    logFn('\tl <count>\tSuspend processes');
    logFn('\tp\t\tPrint out protocol stats');
    logFn('\tq\t\tQuit');
    logFn('\ts\t\tPrint out stats');
    logFn('\tt\t\tTick protocol period');
    logFn('\t<space>\t\tPrint out horizontal rule');
    logFn('\t?\t\tHelp menu');
}

function send(host, arg1, arg2, arg3, callback) {
    if (typeof arg2 === 'function') {
        callback = arg2;
        arg2 = null;
        arg3 = null;
    }

    if (typeof arg3 === 'function') {
        callback = arg3;
        arg3 = null;
    }

    ringPool.waitForIdentified({
        host: host
    }, function onID(err) {
        if (err) {
            callback(err);
            return;
        }

        var opts = {
            host: host,
            timeout: 4000,
            hasNoParent: true,
            headers: {
                'as': 'raw',
                'cn': 'tick-cluster'
            },
            serviceName: 'ringpop'
        };

        ringPool.request(opts).send(arg1, arg2, arg3, callback);
    });
}

program
    .version(require('../package.json').version)
    .option('-n <size>', 'Size of cluster. Default is ' + procsToStart + '.')
    .option('-i, --interpreter <interpreter>', 'Interpreter that runs program. Usually `node`.')
    .option('--interface <address>', 'Interface to bind ringpop instances to.')
    .option('--port <num>', 'Starting port for instances.')
    .arguments('<program>')
    .description('tick-cluster is a tool that launches a ringpop cluster of arbitrary size')
    .action(function onAction(path, options) {
        programPath = path;
        if (programPath[0] !== '/') {
            programPath = './' + programPath;
        }

        if (options.N) {
            procsToStart = parseInt(options.N);
        }
        programInterpreter = options.interpreter;
        bindInterface = options.interface;
        startingPort = parseInt(options.port);
    });

program.on('--help', function onHelp() {
    console.log('  Press h or ? while tick-cluster is running to display the menu below:');
    console.log();
    displayMenu(console.log);
});

program.parse(process.argv);

if (!programPath) {
    console.log('Error: program is required');
    process.exit(1);
}

if (!fs.existsSync(programPath)) {
    console.log('Error: program ' + programPath + ' does not exist. Check path');
    process.exit(1);
}

if (isNaN(procsToStart)) {
    console.log('Error: number of processes to start is not an integer');
    process.exit(1);
}

if (isNaN(startingPort)) {
    startingPort = 3000;
}

main();
