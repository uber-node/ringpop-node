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
var program = require('commander');
var TChannel = require('tchannel');

var Swim = require('../../');
var leaveHandler = require('../../server/admin-leave-handler');
var joinHandler = require('../../server/admin-join-handler');

if (require.main === module) {
    parseArgs();
    bootstrap(function onBootstrap(err, swim) {
        if (err) {
            console.error(err);
            process.exit(1);
        }

        handleMessage(swim);

        process.send({
            type: 'ready'
        });
    });
}

function parseArgs() {
    program
    .option('--host <value>', 'host')
    .parse(process.argv);

    assert(/^(\d+\.\d+\.\d+\.\d+):(\d+)$/.test(program.host));
}

function handleMessage(swim) {
    var onMessage = function onMessage(message) {
        switch (message.cmd) {
            case 'bootstrap':
                swim.bootstrap(message.hosts, function onBootstrap(err) {
                    if (err) {
                        console.error(err);
                        process.exit(1);
                    }

                    process.send({
                        type: 'checksum',
                        host: swim.whoami(),
                        value: swim.membership.computeChecksum()
                    });
                });
                break;
            case 'join':
                join(swim, function onJoin(err) {
                    if (err) {
                        console.error(err);
                        process.exit(1);
                    }

                    process.send({
                        type: 'checksum',
                        host: swim.whoami(),
                        value: swim.membership.computeChecksum()
                    });
                });
                break;
            case 'leave':
                leave(swim, function onLeave() {});
                break;
            case 'shutdown':
                leave(swim, function onLeave() {});
                process.removeListener('message', onMessage);
                process.exit();
                break;
        }
    };

    process.on('message', onMessage);
}

function bootstrap(callback) {
    var host = program.host.split(':')[0];
    var port = program.host.split(':')[1];
    var tchannel = new TChannel({
        host: host,
        port: port
    });
    var opts = {
        app: 'bench',
        hostPort: program.host,
        channel: tchannel.makeSubChannel({
            serviceName: 'ringpop'
        })
    };
    var swim = new Swim(opts);

    swim.on('membershipChanged', function onUpdate() {
        process.send({
            type: 'checksum',
            host: swim.whoami(),
            value: swim.membership.computeChecksum()
        });
    });

    swim.setupChannel();

    swim.channel.on('listening', function onListening() {
        callback(null, swim);
    });

    swim.channel.on('error', function onListening(err) {
        console.error(err);
        process.exit(1);
    });

    swim.channel.listen(Number(port), host);
}

function join(swim, callback) {
    joinHandler({
        ringpop: swim
    }, callback);
}

function leave(swim, callback) {
    leaveHandler({
        ringpop: swim
    }, callback);
}
