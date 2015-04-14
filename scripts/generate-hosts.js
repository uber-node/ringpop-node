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
var fs = require('fs');
var parseArg = require('../lib/util').parseArg;

function main(hosts, basePort, numPorts, outputFile) {
    var usageDie = function(msg) {
        console.error("error: " + msg);
        console.error();
        console.error("usage: " + process.argv[0] + " --hosts=addresses --base-port=port --num-ports=count --output-file=filename");
        console.error();
        console.error("    --hosts=addresses\t- Comma-separated list of hostnames or IPs of hosts in cluster");
        console.error("    --base-port=port\t- Starting port of node on host");
        console.error("    --num-ports=count\t- Number of ports on which nodes will listen");
        console.error("    --output-file=filename.json\t- Filename of hosts file");
        process.exit(1);
    };

    hosts = hosts || parseArg('--hosts');
    if (!hosts) usageDie('invalid hosts');
    basePort = basePort || parseInt(parseArg('--base-port'), 10);
    if (!basePort) usageDie('invalid base port');
    numPorts = numPorts || parseInt(parseArg('--num-ports'), 10);
    if (!numPorts) usageDie('invalid num ports');
    outputFile = outputFile || parseArg('--output-file') || './hosts.json';
    if (!outputFile.match(/\.json$/)) usageDie('output file must have .json extension');

    var nodes = [];

    hosts.split(',').forEach(function(host) {
        for (var nextPort = basePort; nextPort < basePort + numPorts; nextPort++) {
            nodes.push(host + ':' + nextPort);
        }
    });

    fs.writeFileSync(outputFile, JSON.stringify(nodes));

    return nodes;
}

if (require.main === module) {
    main();
}

module.exports = main;
