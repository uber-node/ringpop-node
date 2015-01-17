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

var TChannel = require('tchannel');
var color = require('cli-color');
var farmhash = require('farmhash').hash32;
var generateHosts = require('./generate-hosts');

var hosts, procs, procsToStart, ringPool, localIP; // defined later

function safe_parse(str) {
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
        var options = {
            host: host,
            timeout: 4000
        };
        var postStr = JSON.stringify({});
        var self = this;
        var start = Date.now();
        ringPool.send(options, '/admin/join', null, postStr, function(err, res1, res2) {
            if (err) {
                logMsg('host', color.red('err sending join to host: ' + err.message));
            }
            var dur_ms = Date.now() - start;
            completed.push(dur_ms);
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
    	var options = {
            host: host,
            timeout: 15000
        };
        var self = this;
        var start = Date.now();
        ringPool.send(options, '/admin/tick', null, null, function(err, res1, res2) {
            if (err) {
                console.log(color.red('err: ' + err.message + ' [' + host + ']'));
                body = JSON.stringify({checksum: 'error'});
            }
            var dur_ms = Date.now() - start;
            completed.push(dur_ms);
            var csum = safe_parse(res2.toString()).checksum;
            if (csums[csum] === undefined) {
                csums[csum] = [];
            }
            var port = host.replace(localIP + ':', '');
            csums[csum].push(port);
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
        var options = {
            host: host,
            timeout: 4000
        };
        var self = this;
        var start = Date.now();
        ringPool.send(options, '/admin/stats', null, null, function(err, res1, res2) {
            var dur_ms = Date.now() - start;
            completed.push(dur_ms);
            if (err) {
                console.log(color.red('err: ' + err.message + ' [' + host + ']'));
                body = JSON.stringify({checksum: 'error', membership: 'error'});
            }

            var membership = JSON.stringify(safe_parse(res2).membership.members);

            var csum = farmhash(membership);
            if (csums[csum] === undefined) {
                csums[csum] = [];
                memberships[csum] = membership;
            }

            var port = host.replace(localIP + ':', '');
            csums[csum].push(port);
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
        var options = {
            host: host,
            timeout: 4000
        };
        var self = this;
        var start = Date.now();
        ringPool.send(options, '/admin/stats', null, null, function(err, res1, res2) {
            var dur_ms = Date.now() - start;
            completed.push(dur_ms);
            var port = host.replace(localIP + ':', '');
            if (err) {
                console.log(color.red('err: ' + err.message + ' [' + port + ']'));
            } else {
                var bodyObj = safe_parse(res2.toString());
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
        var options = {
            host: host,
            timeout: 4000
        };
        var self = this;
        var start = Date.now();
        ringPool.send(options, '/admin/gossip', null, null, function(err, res1, res2) {
            var dur_ms = Date.now() - start;
            completed.push(dur_ms);
            if (completed.length === list.length) {
                logMsg('cluster', color.cyan('gossip all completed: ') + color.green(completed.join(', ')));
            }
        });
    });
}

function debugSet(flag) {
    var completed = [];

    hostsUp().forEach(function (host, pos, list) {
        var options = {
            host: host,
            timeout: 4000
        };
        var self = this;
        var start = Date.now();
        ringPool.send(options, '/admin/debugSet', null, { debugFlag: flag }, function(err, res1, res2) {
            if (err) {
                logMsg('cluster', color.red('error setting debug flag: ') + err.message);
            }
            var dur_ms = Date.now() - start;
            completed.push(dur_ms);
            if (completed.length === list.length) {
                logMsg('cluster', color.cyan('debug flag set completed: ') + color.green(completed.join(', ')));
            }
        });
    });
}

function debugClear() {
    var completed = [];

    hostsUp().forEach(function (host, pos, list) {
        var options = {
            host: host,
            timeout: 4000
        };
        var self = this;
        var start = Date.now();
        ringPool.send(options, '/admin/debugClear', null, null, function(err, res1, res2) {
            var dur_ms = Date.now() - start;
            completed.push(dur_ms);
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
    var newProc = require('child_process').spawn('node', ['main.js', '--listen=' + localIP + ':' + port, '--hosts=./hosts.json']);

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

    this.port = port;
    this.hostPort = localIP + ':' + port;
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
            process.kill(proc.proc.pid, 'SIGTERM');
            proc.killed = Date.now();
            killed.push(proc);
        }
    }
}

function killAllProcs() {
    console.log('Killing all ' + procsToStart + ' procs to exit...');
    for (var i = 0; i < procsToStart ; i++) {
        if (! procs[i].killed) {
            process.kill(procs[i].pid, 'SIGKILL');
        }
    }
}

function startCluster() {
    var port = 3000;
    procs = []; // note module scope

    for (var i = 0; i < procsToStart ; i++) {
        procs[i] = new ClusterProc(port + i);
    }
    logMsg('init', color.cyan('started ' + procsToStart + ' procs: ') + color.green(procs.map(function (p) { return p.proc.pid; }).join(', ')));
}

function main() {
    procsToStart = +process.argv[2];
    if (isNaN(procsToStart) || (procsToStart < 2)) {
        console.error('usage: cluster-manager nodes\nNodes must be 2 or more.');
        process.exit(1);
    }

    logMsg('init', color.cyan('tick-cluster started ') + color.red('d: debug flags, g: gossip, j: join, k: kill, K: revive all, l: sleep, p: protocol stats, q: quit, s: cluster stats, t: tick'));

    findLocalIP();
    hosts = generateHosts(localIP, 3000, procsToStart, 'hosts.json');
    startCluster();

    ringPool = new TChannel({host: "127.0.0.1", port: 2999});

    ringPool.on('health', function (msg) {
        logMsg('cluster', 'health event: ' + msg);
    });
    ringPool.on('timeout', function (req) {
        logMsg('cluster', 'timeout event: ' + req.options.endpoint + ':' + req.options.path);
    });

    var stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
}

main();
