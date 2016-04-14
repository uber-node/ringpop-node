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

var safeParse = require('./safe_parse.js');

module.exports = function parseArgs() {
    var program = require('commander');
    program.description('Run an example')
        .option('-n, --clusterName <name>', 'Name of cluster')
        .option('-s, --size <size>', 'Size of cluster')
        .option('-b, --bootstrap <bootstrap>', 'JSON compatible array of hosts')
        .option('-p, --port <port>', 'Base port for cluster')
        .option('-h, --host <host>', 'Address of host')
        .option('[options] example.js')
    program.parse(process.argv);
    return {
        name: program.clusterName,
        size: Number(program.size),
        bootstrapNodes: safeParse(program.bootstrap),
        basePort: Number(program.port),
        host: program.host
    };
};
