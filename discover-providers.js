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

var _ = require('underscore');

var Backoff = require('./lib/backoff');

/**
 * A DiscoverProvider provides a list of peers for a ringpop.
 * @typedef {function} DiscoverProvider
 * @param {DiscoverProvider~callback} callback - the callback when peers are discover.
 */

/**
 * This callback is used from a DiscoverProvider to async provide the hosts.
 * @callback DiscoverProvider~callback
 * @param {object} err Indicates an error during discovery when not null
 * @param {string[]} hosts The list with hosts
 */

/**
 * Create a new DiscoverProvider using a static host list.
 * @param {string[]} hosts The array of hosts.
 * @returns {DiscoverProvider}
 */
function createStaticHostsProvider(hosts) {
    return function staticHostsProvider(callback) {
        callback(null, hosts);
    };
}

/**
 * Create a new DiscoverProvider using a host-file.
 * @param {string} hostsFile The path to a json file containing an array of strings.
 * @returns {DiscoverProvider}
 */
function createJsonFileDiscoverProvider(hostsFile) {
    var fs = require('fs');

    return function jsonFileProvider(callback) {
        fs.readFile(hostsFile, function onFileRead(err, data) {
            if (err) {
                callback(err);
                return;
            }

            var hosts;
            try {
                hosts = JSON.parse(data.toString());
            } catch (e) {
                callback(e);
                return;
            }
            callback(null, hosts);
            return;
        });
    };
}

/**
 * Wrap a innerDiscoverProvider with a retrying mechanism.
 *
 * @param {Object} opts the options used as a Backoff policy {@see Backoff}
 * @param {Object} [opts.backoff] a mocked backoff for testing
 * @param {DiscoverProvider} innerDiscoverProvider The discover provider to wrap
 *
 * @returns {DiscoverProvider} The retrying discover provider.
 */
function retryDiscoverProvider(opts, innerDiscoverProvider) {
    if (!opts) {
        return innerDiscoverProvider;
    }

    return function retryingDiscoverProvider(callback) {
        var policy;
        var defaultPolicy = {
            minDelay: 500,
            maxDelay: 15000,
            timeout: 60000
        };

        if (opts === true) {
            policy = defaultPolicy;
        } else {
            policy = _.defaults({}, opts, defaultPolicy);
        }
        var backoff = opts.backoff || new Backoff(policy);
        var lastError = null;

        attempt(null);

        function attempt(fail) {
            if (fail) {
                fail.lastError = lastError;
                return setImmediate(callback, fail);
            }

            innerDiscoverProvider(function onTry(err, hosts) {
                // We got results!
                if (!err && hosts !== null && hosts.length > 0) {
                    return setImmediate(callback, null, hosts);
                }

                lastError = err;
                backoff.retry(attempt);
            });
        }
    };
}

/**
 * Creates a DiscoverProvider from the provided options.
 *
 * @param opts: an object configuring the DiscoverProvider:
 *          - if opts or opts.discoverProvider is a function, it's returned as the {DiscoverProvider}.
 *          - if opts or opts.hosts is an array, a static hosts discover provider is returned (see {createStaticHostsProvider})
 *          - if opts or opts.bootstrapFile is a string, a json file discover provider is returned (see {createJsonFileDiscoverProvider})
 *          - if opts.retry is set, the discover provider is wrapped using retryDiscoverProvider (see {retryDiscoverProvider}).
 *
 * @returns {DiscoverProvider} The discover provider.
 */
function createFromOpts(opts) {
    opts = opts || {};

    if (typeof opts === 'function') {
        return opts;
    }
    if (typeof opts === 'string') {
        return createJsonFileDiscoverProvider(opts);
    }
    if (Array.isArray(opts)) {
        return createStaticHostsProvider(opts);
    }

    var discoverProvider;
    if (opts.discoverProvider) {
        discoverProvider = opts.discoverProvider;
    } else if (opts.hosts) {
        discoverProvider = createStaticHostsProvider(opts.hosts);
    } else if (opts.bootstrapFile && typeof opts.bootstrapFile === 'string') {
        discoverProvider = createJsonFileDiscoverProvider(opts.bootstrapFile);
    } else if (opts.bootstrapFile && Array.isArray(opts.bootstrapFile)) {
        /* This weird case is added for backwards compatibility :( */
        discoverProvider = createStaticHostsProvider(opts.bootstrapFile);
    } else {
        return null;
    }

    if (opts.retry) {
        discoverProvider = retryDiscoverProvider(opts.retry, discoverProvider);
    }
    return discoverProvider;
}

module.exports = {
    createFromOpts: createFromOpts,
    createStaticHostsProvider: createStaticHostsProvider,
    createJsonFileDiscoverProvider: createJsonFileDiscoverProvider,
    retryDiscoverProvider: retryDiscoverProvider
};
