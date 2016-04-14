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

var TChannelProxyCluster = require('../lib/tchannel-proxy-cluster.js');

TChannelProxyCluster.test('RingpopHandler proxies', {
    size: 3
}, function t(cluster, assert) {
    cluster.client.request({
        serviceName: cluster.serviceName,
        headers: {
            sk: cluster.keys.one
        },
        host: cluster.hosts.one
    }).send('ping', '', '', onResponse);

    function onResponse(err, resp, arg2, arg3) {
        assert.ifError(err);

        assert.ok(resp.ok);
        assert.equal(arg3.toString(), 'ping from one');

        assert.end();
    }
});

TChannelProxyCluster.test('RingpopHandler to other node', {
    size: 3
}, function t(cluster, assert) {
    cluster.client.request({
        serviceName: cluster.serviceName,
        headers: {
            sk: cluster.keys.one
        },
        host: cluster.hosts.three
    }).send('ping', '', '', onResponse);

    function onResponse(err, resp, arg2, arg3) {
        assert.ifError(err);

        assert.ok(resp.ok);
        assert.equal(arg3.toString(), 'ping from one');

        assert.end();
    }
});

TChannelProxyCluster.test('RingpopHandler for two', {
    size: 3
}, function t(cluster, assert) {
    cluster.client.request({
        serviceName: cluster.serviceName,
        headers: {
            sk: cluster.keys.two
        },
        host: cluster.hosts.one
    }).send('ping', '', '', onResponse);

    function onResponse(err, resp, arg2, arg3) {
        assert.ifError(err);

        assert.ok(resp.ok);
        assert.equal(arg3.toString(), 'ping from two');

        assert.end();
    }
});

TChannelProxyCluster.test('RingpopHandler for two', {
    size: 3
}, function t(cluster, assert) {
    cluster.client.request({
        serviceName: cluster.serviceName,
        headers: {
            sk: cluster.keys.two
        },
        host: cluster.hosts.one
    }).send('ping', '', '', onResponse);

    function onResponse(err, resp, arg2, arg3) {
        assert.ifError(err);

        assert.ok(resp.ok);
        assert.equal(arg3.toString(), 'ping from two');

        assert.end();
    }
});

TChannelProxyCluster.test('RingpopHandler blacklist', {
    size: 3,
    blacklist: {
        'ping': true
    }
}, function t(cluster, assert) {
    cluster.client.request({
        serviceName: cluster.serviceName,
        headers: {
            sk: cluster.keys.two
        },
        host: cluster.hosts.one
    }).send('ping', '', '', onResponse);

    function onResponse(err, resp, arg2, arg3) {
        assert.ifError(err);

        assert.ok(resp.ok);
        assert.equal(arg3.toString(), 'ping from one');

        assert.end();
    }
});

TChannelProxyCluster.test('RingpopHandler bad request', {
    size: 3
}, function t(cluster, assert) {
    cluster.client.request({
        serviceName: cluster.serviceName,
        host: cluster.hosts.one
    }).send('ping', '', '', onResponse);

    function onResponse(err, resp, arg2, arg3) {
        assert.ok(err);

        assert.equal(err.codeName, 'BadRequest');
        assert.equal(err.message,
            '[ringpop] Request does not have sk header set');

        assert.end();
    }
});
