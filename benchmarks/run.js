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

var async = require('async');
var exec = require('child_process').exec;
var program = require('commander');

program
    .option('-f, --file <file>', 'Run this benchmark file')
    .option('-r, --refs <refs>', 'Run benchmark between ref range')
    .parse(process.argv);

if (!program.file) {
    console.log('file argument is required');
    process.exit(1);
}

if (!program.refs) {
    console.log('refs argument is required');
    process.exit(1);
}

function checkoutCommit(commit, callback) {
    exec('git checkout ' + commit.sha, function onCheckout(err) {
        callback(err);
    });
}

function chomp(str) {
    return str.replace(/(\n|\r)+$/, '');
}

function createCommit(commitLog) {
    var match = /^([a-z0-9]*)\s(.*)/g.exec(commitLog);

    return {
        sha: match[1],
        msg: match[2]
    };
}

function getCurrentCommit(callback) {
    exec('git rev-parse --abbrev-ref HEAD', function onExec(err, stdout) {
        if (err) {
            callback(err);
            return;
        }

        var abbrev = chomp(stdout);

        exec('git log --oneline ' + abbrev + ' | head -n 1', function onExec(err, stdout) {
            if (err) {
                callback(err);
                return;
            }

            var commit = createCommit(chomp(stdout));
            commit.sha = abbrev;

            callback(null, commit);
        });
    });
}

function runBenchmark(commit, benchmarkFile, callback) {
    checkoutCommit(commit, function onCheckout(err) {
        if (err) {
            console.log('Checkout failed: ' + err.message);
            return callback();
        }

        exec('node ' + benchmarkFile, function onExec(err, stdout, stderr) {
            stdout = chomp(stdout);

            var match = /x (.*) ops\/sec/g.exec(stdout);

            if (match && match[1]) {
                console.log(commit.sha + ' ' + commit.msg + ' ' + match[1] + ' ops/sec');
            }

            callback();
        });
    });
}

getCurrentCommit(function onGet(err, commit) {
    if (err) {
        console.log('Error: Could not get current commit');
        process.exit(1);
    }

    var currentCommit = commit;

    exec('git log --pretty=\'%H %B\' --oneline -- ' + program.file + ' | tail -n 1', function onExec(err, stdout, stderr) {
        stdout = chomp(stdout);

        var baseCommit = createCommit(stdout);

        exec('git log --pretty=\'%H %B\' --oneline ' + program.refs, function onExec(err, stdout, stderr) {
            stdout = chomp(stdout);

            var history = stdout.split('\n');

            history.pop();
            history.reverse();

            history = history.map(function mapCommit(commitLog) {
                return createCommit(commitLog);
            });

            var commitsToBenchmark = [baseCommit].concat(history);

            console.log('Running ' + commitsToBenchmark.length + ' benchmark(s) for ' + program.file);

            async.eachSeries(commitsToBenchmark, function eachCommit(commit, next) {
                runBenchmark(commit, program.file, next);
            }, function onDone() {
                checkoutCommit(currentCommit, function onCheckout() {
                    console.log('Benchmark complete!');
                });
            });
        });
    });
});
