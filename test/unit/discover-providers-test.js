// Copyright (c) 2017 Uber Technologies, Inc.
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

var path = require('path');

var test = require('tape');

var discoverProviderFactory = require('../../discover-providers');

var exampleHosts = ['127.0.0.1:3000'];

function assertDiscoverProvider(assert, discoverProvider, expectedHosts) {
    assert.equal(typeof discoverProvider, 'function');
    discoverProvider(function onHosts(err, hosts) {
        assert.equal(err, null);
        assert.deepEqual(hosts, expectedHosts);
        assert.end();
    });
}

function assertDiscoverProviderError(assert, discoverProvider) {
    assert.equal(typeof discoverProvider, 'function');
    discoverProvider(function onHosts(err, hosts) {
        assert.notEqual(err, null, 'err is not null');
        assert.notOk(hosts, 'hosts is null');
        assert.end();
    });
}

test('static host list discover provider', function t(assert) {
    var discoverProvider = discoverProviderFactory.createStaticHostsProvider(exampleHosts);

    assertDiscoverProvider(assert, discoverProvider, exampleHosts);
});

test('json file discover provider - success', function t(assert) {
    var filePath = path.join(__dirname, 'discover-providers-example.json');
    var json = require(filePath);
    var discoverProvider = discoverProviderFactory.createJsonFileDiscoverProvider(filePath);

    assertDiscoverProvider(assert, discoverProvider, json);
});

test('json file discover provider - error: non existing file', function t(assert) {
    var filePath = path.join(__dirname, './non-existing-file.json');
    var discoverProvider = discoverProviderFactory.createJsonFileDiscoverProvider(filePath);

    assertDiscoverProviderError(assert, discoverProvider);
});

test('json file discover provider - error: non json file', function t(assert) {
    var filePath = path.join(__dirname, 'discover-providers-example-invalid.json');
    var discoverProvider = discoverProviderFactory.createJsonFileDiscoverProvider(filePath);

    assertDiscoverProviderError(assert, discoverProvider);
});


test('retrying discover provider - does not wrap when retry is false', function t(assert) {
    var innerDiscoverProvider = discoverProviderFactory.createStaticHostsProvider(exampleHosts);
    var discoverProvider = discoverProviderFactory.retryDiscoverProvider(
        false,
        innerDiscoverProvider);

    assert.equal(discoverProvider, innerDiscoverProvider);
    assert.end();
});

test('retrying discover provider - does not retry on success', function t(assert) {
    var innerDiscoverProvider = discoverProviderFactory.createStaticHostsProvider(exampleHosts);
    var discoverProvider = discoverProviderFactory.retryDiscoverProvider(
        {backoff: {
            retry: function(){
                assert.fail('should not retry on success!');
            }
        }},
        innerDiscoverProvider);

    assertDiscoverProvider(assert, discoverProvider, exampleHosts);
});

test('retrying discover provider - retries when host list is empty', function t(assert) {
    assert.plan(1);
    var innerDiscoverProvider = discoverProviderFactory.createStaticHostsProvider([]);
    var discoverProvider = discoverProviderFactory.retryDiscoverProvider(
        {backoff: {
            retry: function(){
                assert.pass('should retry on empty hosts!');
                assert.end();
            }
        }},
        innerDiscoverProvider);

    discoverProvider();
});

test('retrying discover provider - retries when hosts is null', function t(assert) {
    assert.plan(1);
    var innerDiscoverProvider = discoverProviderFactory.createStaticHostsProvider(null);
    var discoverProvider = discoverProviderFactory.retryDiscoverProvider(
        {backoff: {
            retry: function(){
                assert.pass('should retry on null hosts!');
                assert.end();
            }
        }},
        innerDiscoverProvider);

    discoverProvider();
});

test('retrying discover provider - retries on error', function t(assert) {
    var innerDiscoverProvider = function(cb){
        cb('error');
    };
    var discoverProvider = discoverProviderFactory.retryDiscoverProvider(
        {backoff: {
            retry: function(){
                assert.pass('should retry on error!');
                assert.end();
            }
        }},
        innerDiscoverProvider);

    discoverProvider();
});

test('retrying discover provider - returns last error after retries', function t(assert) {
    assert.plan(4);

    var count = 0;
    var innerDiscoverProvider = function(cb){
        count++;
        assert.pass('discover provider called: '+ count);
        cb(new Error('error ' + count));
    };
    var discoverProvider = discoverProviderFactory.retryDiscoverProvider(
        {backoff: {
            retry: function(cb){
                if (count === 1) {
                    cb(null); //retry first time;
                } else {
                    cb(new Error('out of retries'));
                }
            }
        }},
        innerDiscoverProvider);

    discoverProvider(function(err, hosts) {
        assert.equals(err.lastError.message, 'error 2');
        assert.notok(hosts);
        assert.end();
    });
});

/**
 * Create a sub-test suite for create from opts.
 */
test('discoverProvider createFromOpts', function t(assert) {
    assert.test('with string-argument - uses hostsFile', function t(assert) {
        var filePath = path.join(__dirname, 'discover-providers-example.json');
        var json = require(filePath);
        var discoverProvider = discoverProviderFactory.createFromOpts(filePath);

        assertDiscoverProvider(assert, discoverProvider, json);
    });

    assert.test('opts with bootstrapFile - uses hostsFile', function t(assert){
        var filePath = path.join(__dirname, 'discover-providers-example.json');
        var json = require(filePath);
        var discoverProvider = discoverProviderFactory.createFromOpts({bootstrapFile: filePath});

        assertDiscoverProvider(assert, discoverProvider, json);
    });

    assert.test('with array-argument - uses static hosts', function t(assert) {
        var discoverProvider = discoverProviderFactory.createFromOpts(exampleHosts);

        assertDiscoverProvider(assert, discoverProvider, exampleHosts);
    });

    assert.test('opts with hosts - uses static hosts', function t(assert) {
        var discoverProvider = discoverProviderFactory.createFromOpts({hosts: exampleHosts});

        assertDiscoverProvider(assert, discoverProvider, exampleHosts);
    });

    assert.test('with function - uses function', function t(assert) {
        var fn = function exampleDiscoverProvider(cb) {};
        var discoverProvider = discoverProviderFactory.createFromOpts(fn);
        assert.equal(discoverProvider, fn);
        assert.end();
    });

    assert.test('opts with discoverProvider - uses function', function t(assert) {
        var fn = function exampleDiscoverProvider(cb) {};
        var discoverProvider = discoverProviderFactory.createFromOpts({discoverProvider: fn});
        assert.equal(discoverProvider, fn);
        assert.end();
    });

    assert.test('without arguments - returns null', function t(assert) {
        var discoverProvider = discoverProviderFactory.createFromOpts();
        assert.equal(discoverProvider, null);
        assert.end();
    });

    assert.test('opts with retry - returns retrying discover provider', function t(assert) {
        assert.plan(6);

        var count = 0;
        var fn = function exampleDiscoverProvider(cb) {
            if (count === 0) {
                count++;
                assert.pass('inner provider called once');
                cb(null, null);
            } else if (count === 1) {
                count++;
                assert.pass('inner provider called again');
                cb(null, []);
            } else {
                assert.pass('inner provider retried');
                cb(null, exampleHosts);
            }
        };
        var discoverProvider = discoverProviderFactory.createFromOpts({discoverProvider: fn, retry: true});
        assert.notEqual(discoverProvider, fn);

        discoverProvider(function onHosts(err, hosts) {
            assert.equal(err, null);
            assert.deepEqual(hosts, exampleHosts);
            assert.end();
        });
    });
});
