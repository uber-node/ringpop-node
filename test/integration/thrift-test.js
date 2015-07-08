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

var async = require('async');
var createServer = require('../../server/index.js');
var TChannel = require('tchannel');
var testRingpopCluster = require('../lib/test-ringpop-cluster.js');

testRingpopCluster('sends join without required params, regrets it', function(bootRes, cluster, assert) {
    assert.plan(4);

    var host = '127.0.0.1';
    var port = 3004;

    var tchannel = new TChannel();
    var server = createServer({
        channel: tchannel.makeSubChannel({
            serviceName: 'ringpop'
        })
    });

    var bodies = [
        // A null body exposes a thriftify bug. Comment
        // out the below test case, for now.
        //null,
        { app: 'test' },
        { app: 'test', source: host + ':' + port }
    ];

    async.eachSeries(bodies, function each(body, callback) {
        server.join({
            host: cluster[0].hostPort,
            timeout: 1000,
            head: null,
            body: body
        }, function onJoin(err) {
            assert.ok(err, 'an error occurred');
            assert.equal(err.type, 'ringpop.bad-request', 'bad request error');
            callback();
        });
    }, onDone);

    function onDone() {
        tchannel.close();
        assert.end();
    }
});
