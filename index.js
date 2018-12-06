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

// WARNING! This file is big and bloated. We are trying to make every attempt
// at carving out a really nice, trim public interface for Ringpop. Make
// every effort to refrain from adding more code to this file and every effort
// to extract code out of it.
//
// Ideally, the only functions that should hang off the Ringpop prototype are:
//   - bootstrap()
//   - lookup()
//   - whoami()
//
// Everything else has been a mere convenience, entirely separate concern or leaky
// abstraction.

var _ = require('underscore');
var EventEmitter = require('events').EventEmitter;
var farmhash = require('farmhash');
var timers = require('timers');
var micromock = require('@esatterwhite/micromock');
var metrics = require('metrics');
var packageJSON = require('./package.json');

var Gossip = require('./lib/gossip');
var StateTransitions = require('./lib/gossip/state_transitions');

var Config = require('./config.js');
var Damper = require('./lib/gossip/damper.js');
var Dissemination = require('./lib/gossip/dissemination.js');
var discoverProviderFactory = require('./discover-providers.js');
var errors = require('./lib/errors.js');
var getTChannelVersion = require('./lib/util.js').getTChannelVersion;
var HashRing = require('./lib/ring');
var initMembership = require('./lib/membership/index.js');
var LoggerFactory = require('./lib/logging/logger_factory.js');
var LagSampler = require('./lib/lag_sampler.js');
var MembershipIterator = require('./lib/membership/iterator.js');
var MembershipUpdateRollup = require('./lib/membership/rollup.js');
var nulls = require('./lib/nulls');
var PeriodicStats = require('./lib/stats-periodic');
var rawHead = require('./lib/request-proxy/util.js').rawHead;
var RequestProxy = require('./lib/request-proxy/index.js');
var registerConfigListeners = require('./lib/on_config_event.js').register;
var registerMembershipListeners = require('./lib/on_membership_event.js').register;
var registerRingListeners = require('./lib/on_ring_event.js').register;
var registerRingpopListeners = require('./lib/on_ringpop_event.js').register;
var RingpopClient = require('./client.js');
var RingpopServer = require('./server');
var validateHostPort = require('./lib/util').validateHostPort;
var sendJoin = require('./lib/gossip/joiner.js').joinCluster;
var SelfEvict = require('./lib/self-evict');
var TracerStore = require('./lib/trace/store.js');
var middleware = require('./lib/middleware');
var DiscoverProviderHealer = require('./lib/partition_healing').DiscoverProviderHealer;

var HOST_PORT_PATTERN = /^(\d+.\d+.\d+.\d+):\d+$/;
var MEMBERSHIP_UPDATE_FLUSH_INTERVAL = 5000;
var MAX_REVERSE_FULL_SYNC_JOBS = 5;

function RingPop(options) {
    if (!(this instanceof RingPop)) {
        return new RingPop(options);
    }

    if (!options) {
        throw errors.OptionsRequiredError({ method: 'RingPop' });
    }

    if (typeof options.app !== 'string' ||
        options.app.length === 0
    ) {
        throw errors.AppRequiredError();
    }

    if (!validateHostPort(options.hostPort)) {
        throw errors.HostPortRequiredError({
            hostPort: options.hostPort
        });
    }

    this.app = options.app;
    this.hostPort = options.hostPort;
    this.channel = options.channel;
    this.setLogger(options.logger || nulls.logger);
    this.statsd = options.statsd || nulls.statsd;
    if (options.bootstrapFile) {
        this.logger.warn('Specifying a bootstrapFile when creating a new ringpop is deprecated; specify it in bootstrap!');
        this.bootstrapFile = options.bootstrapFile;
    }
    this.timers = options.timers || timers;
    this.setTimeout = options.setTimeout || timers.setTimeout;
    this.Ring = options.Ring || HashRing;

    this.isReady = false;

    this.joinSize = options.joinSize;
    this.pingReqSize = 3;           // ping-req fanout
    this.pingReqTimeout = options.pingReqTimeout || 5000;
    this.pingTimeout = options.pingTimeout || 1500;
    this.joinTimeout = options.joinTimeout || 1000;
    this.proxyReqTimeout = options.proxyReqTimeout || 30000;
    this.membershipUpdateFlushInterval = options.membershipUpdateFlushInterval ||
        MEMBERSHIP_UPDATE_FLUSH_INTERVAL;
    this.maxReverseFullSyncJobs = options.maxReverseFullSyncJobs ||
        MAX_REVERSE_FULL_SYNC_JOBS;
    // If set to true, ping requests without identical app name return error
    this.requiresAppInPing = options.requiresAppInPing || false;

    // Initialize Config before all other gossip, membership, forwarding,
    // and hash ring dependencies.
    this.config = new Config(this, options);
    this.loggerFactory = new LoggerFactory({
        ringpop: this
    });

    // use fingerprint if ringpop needs to function cross different platforms
    if (this.config.get('isCrossPlatform')) {
        this.hashFunc = farmhash.fingerprint32;
    } else {
        this.hashFunc = farmhash.hash32;
    }

    this.lagSampler = new LagSampler({
        ringpop: this
    });

    this.requestProxy = new RequestProxy({
        ringpop: this,
        maxRetries: options.requestProxyMaxRetries,
        retrySchedule: options.requestProxyRetrySchedule,
        enforceConsistency: options.enforceConsistency,
        enforceKeyConsistency: options.enforceKeyConsistency
    });

    this.ring = new this.Ring({
        hashFunc: this.hashFunc
    });

    this.dissemination = new Dissemination(this);

    this.membership = initMembership(this);
    this.memberIterator = new MembershipIterator(this);
    this.gossip = new Gossip({
        ringpop: this,
        minProtocolPeriod: options.minProtocolPeriod
    });
    this.damper = new Damper({
        ringpop: this
    });
    var periods = options.stateTimeouts;
    if (!periods) {
        // backward compatibility
        periods = {suspect: options.suspicionTimeout};
    }
    this.stateTransitions = new StateTransitions({
        ringpop: this,
        periods: periods
    });
    this.membershipUpdateRollup = new MembershipUpdateRollup({
        ringpop: this,
        flushInterval: this.membershipUpdateFlushInterval
    });

    this.tracers = new TracerStore(this);

    registerConfigListeners(this);
    registerMembershipListeners(this);
    registerRingListeners(this);
    registerRingpopListeners(this);

    this.periodicStats = new PeriodicStats(this, {timers: timers});
    this.periodicStats.start();

    this.clientRate = new metrics.Meter();
    this.serverRate = new metrics.Meter();
    this.totalRate = new metrics.Meter();

    if (options.statPrefix) {
        this.statPrefix = options.statPrefix;
    } else {
        // 10.30.8.26:20600 -> 10_30_8_26_20600
        this.statHostPort = this.hostPort.replace(/\.|:/g, '_');
        this.statPrefix = 'ringpop.' + this.statHostPort;
    }
    this.statKeys = {};
    this.statsHooks = {};

    this.destroyed = false;
    this.joiner = null;

    this.startTime = Date.now(); //used for calculating uptime

    this.tchannelVersion = getTChannelVersion();
    this.ringpopVersion = packageJSON.version;

    this.healer = new DiscoverProviderHealer(this);

    this.selfEvicter = new SelfEvict(this);
}

require('util').inherits(RingPop, EventEmitter);

RingPop.prototype.destroy = function destroy() {
    if (this.destroyed) {
        return;
    }

    this.emit('destroying');

    this.gossip.stop();
    this.stateTransitions.disable();
    this.membershipUpdateRollup.destroy();
    this.periodicStats.stop();
    this.requestProxy.destroy();
    this.tracers.destroy();

    this.clientRate.m1Rate.stop();
    this.clientRate.m5Rate.stop();
    this.clientRate.m15Rate.stop();
    this.serverRate.m1Rate.stop();
    this.serverRate.m5Rate.stop();
    this.serverRate.m15Rate.stop();
    this.totalRate.m1Rate.stop();
    this.totalRate.m5Rate.stop();
    this.totalRate.m15Rate.stop();

    if (this.joiner) {
        this.joiner.destroy();
    }

    // HACK remove double destroy gaurd.
    if (this.channel && !this.channel.topChannel && !this.channel.destroyed) {
        this.channel.close();
    }
    if (this.channel && this.channel.topChannel &&
        !this.channel.topChannel.destroyed
    ) {
        this.channel.topChannel.close();
    }

    if (this.client) {
        this.client.destroy();
    }

    this.destroyed = true;
    this.emit('destroyed');
};

RingPop.prototype.setupChannel = function setupChannel() {
    this.client = new RingpopClient(this, this.channel, timers, Date, [
        middleware.tombstonePatchClientMiddleware]);
    this.server = new RingpopServer(this, this.channel, [
        // We want the transportMiddleware to be close to the top because it
        // does encoding/decoding of arguments/results. Any middleware that
        // needs to access those values must be below it.
        middleware.transportServerMiddleware,
        middleware.tombstonePatchServerMiddleware]);
};

/*
 * opts are:
 *   - joinParallelismFactor: Number of nodes in which join request
 *   will be sent
 *   - configuration for a discover provider (@see discover-providers#createFromOpts for details).
 */
RingPop.prototype.bootstrap = function bootstrap(opts, callback) {
    if (typeof opts === 'function' && !callback) {
        callback = opts;
        opts = null;
    }

    opts = opts || {};

    var self = this;

    if (this.isReady) {
        var alreadyReadyMsg = 'ringpop is already ready';
        this.logger.warn(alreadyReadyMsg, { address: this.hostPort });
        if (callback) callback(new Error(alreadyReadyMsg));
        return;
    }

    var discoverProvider = discoverProviderFactory.createFromOpts(opts);
    if (!discoverProvider) {
        var bootstrapFile = this.bootstrapFile || './hosts.json';
        discoverProvider = discoverProviderFactory.createJsonFileDiscoverProvider(bootstrapFile);
    }
    this.discoverProvider = discoverProvider;

    var bootstrapTime = Date.now();

    discoverProvider(onHostsDiscovered);

    function onHostsDiscovered(err, hosts) {
        if (err) {
            var discoverProviderMsg = 'failed to discover hosts using bootstrap provider';
            self.logger.warn(discoverProviderMsg, {discoverProviderError: err});
            if (callback) callback(new Error(discoverProviderMsg, {discoverProviderError: err}));
            return;
        }
        self.bootstrapHosts = hosts;

        if (!Array.isArray(self.bootstrapHosts) || self.bootstrapHosts.length === 0) {
            var noBootstrapMsg = 'ringpop cannot be bootstrapped without bootstrap hosts.' +
                ' make sure you specify a valid bootstrap hosts file to the ringpop' +
                ' constructor or have a valid hosts.json file in the current working' +
                ' directory.';
            self.logger.warn(noBootstrapMsg);
            if (callback) callback(new Error(noBootstrapMsg));
            return;
        }

        checkForMissingBootstrapHost();
        checkForHostnameIpMismatch();

        // Add local member to membership.
        self.membership.makeLocalAlive();

        var joinTime = Date.now();

        sendJoin({
            ringpop: self,
            joinSize: self.joinSize,
            parallelismFactor: opts.joinParallelismFactor,
            joinTimeout: self.joinTimeout
        }, function onJoin(err, nodesJoined) {
            joinTime = Date.now() - joinTime;

            if (err) {
                self.stat('increment', 'join.failed.err');
                self.logger.error('ringpop bootstrap failed', {
                    error: err,
                    address: self.hostPort
                });
                if (callback) callback(err);
                return;
            }

            if (self.destroyed) {
                self.stat('increment', 'join.failed.destroyed');
                var destroyedMsg = 'ringpop was destroyed ' +
                    'during bootstrap';
                self.logger.error(destroyedMsg, {
                    address: self.hostPort
                });
                if (callback) callback(new Error(destroyedMsg));
                return;
            }

            // Membership stashes all changes that have been applied since the
            // beginning of the bootstrap process. It will then efficiently apply
            // all changes as an 'atomic' update to membership. set() must be
            // called before `isReady` is set to true.
            var setTime = Date.now();
            self.membership.set();
            setTime = Date.now() - setTime;

            self.isReady = true;

            bootstrapTime = Date.now() - bootstrapTime;

            self.stat('increment', 'join.succeeded');
            self.logger.debug('ringpop is ready', {
                address: self.hostPort,
                memberCount: self.membership.getMemberCount(),
                bootstrapTime: bootstrapTime,
                joinTime: joinTime,
                membershipSetTime: setTime
            });

            self.emit('ready');

            if (callback) callback(null, nodesJoined);
        });

        function checkForMissingBootstrapHost() {
            if (self.bootstrapHosts.indexOf(self.hostPort) === -1) {
                self.logger.warn('bootstrap hosts does not include the host/port of' +
                    ' the local node. this may be fine because your hosts file may' +
                    ' just be slightly out of date, but it may also be an indication' +
                    ' that your node is identifying itself incorrectly.', {
                    address: self.hostPort
                });

                return false;
            }

            return true;
        }

        function checkForHostnameIpMismatch() {
            function testMismatch(msg, filter) {
                var filteredHosts = self.bootstrapHosts.filter(filter);

                if (filteredHosts.length > 0) {
                    self.logger.warn(msg, {
                        address: self.hostPort,
                        mismatchedBootstrapHosts: filteredHosts
                    });

                    return false;
                }

                return true;
            }

            if (HOST_PORT_PATTERN.test(self.hostPort)) {
                var ipMsg = 'your ringpop host identifier looks like an IP address and there are' +
                    ' bootstrap hosts that appear to be specified with hostnames. these inconsistencies' +
                    ' may lead to subtle node communication issues';

                return testMismatch(ipMsg, function(host) {
                    return !HOST_PORT_PATTERN.test(host);
                });
            } else {
                var hostMsg = 'your ringpop host identifier looks like a hostname and there are' +
                    ' bootstrap hosts that appear to be specified with IP addresses. these inconsistencies' +
                    ' may lead to subtle node communication issues';

                return testMismatch(hostMsg, function(host) {
                    return HOST_PORT_PATTERN.test(host);
                });
            }

            return true;
        }
    }
};

RingPop.prototype.getStatsHooksStats = function getStatsHooksStats() {
    if (Object.keys(this.statsHooks).length === 0) {
        return null;
    }

    var self = this;
    function reduceToStats(stats, name) {
        stats[name] = self.statsHooks[name].getStats();
        return stats;
    }

    return Object.keys(this.statsHooks).reduce(reduceToStats, {});
};

RingPop.prototype.getStats = function getStats() {
    var timestamp = Date.now();
    var uptime = timestamp - this.startTime;


    var stats = {
        hooks: this.getStatsHooksStats(),
        membership: this.membership.getStats(),
        process: {
            memory: process.memoryUsage(),
            pid: process.pid
        },
        protocol: {
            timing: this.gossip.protocolTiming.printObj(),
            protocolRate: this.gossip.computeProtocolRate(),
            clientRate: this.clientRate.printObj().m1,
            serverRate: this.serverRate.printObj().m1,
            totalRate: this.totalRate.printObj().m1
        },
        ring: this.ring.getStats(),
        version: this.ringpopVersion,
        timestamp: timestamp,
        uptime: uptime
    };

    if (this.tchannelVersion !== null) {
        stats.tchannelVersion = this.tchannelVersion;
    }

    return stats;
};

RingPop.prototype.isStatsHookRegistered = function isStatsHookRegistered(name) {
    return !!this.statsHooks[name];
};

RingPop.prototype.lookup = function lookup(key) {
    var startTime = Date.now();

    var dest = this.ring.lookup(key + '');

    var timing = Date.now() - startTime;
    this.stat('timing', 'lookup', timing);
    this.emit('lookup', {
        timing: timing
    });

    if (!dest) {
        this.logger.debug('could not find destination for a key', {
            key: key
        });
        return this.whoami();
    }

    return dest;
};

// find (up to) N unique successor nodes (aka the 'preference list') for the given key
RingPop.prototype.lookupN = function lookupN(key, n) {
    var startTime = Date.now();

    var dests = this.ring.lookupN(key + '', n);

    var timing = Date.now() - startTime;
    this.stat('timing', 'lookupn.' + n, timing);
    this.emit('lookupN', {
        timing: timing
    });

    if (!dests || dests.length === 0) {
        this.logger.debug('could not find destinations for a key', {
            key: key
        });
        return [this.whoami()];
    }

    return dests;
};

RingPop.prototype.reload = function reload(file, callback) {
    var self = this;

    this.discoverProvider = discoverProviderFactory.createJsonFileDiscoverProvider(file);
    this.discoverProvider(function hostsDiscovered(err, hosts) {
        if (err) {
            callback(err);
            return;
        }

        self.bootstrapHosts = hosts;
        callback();
    });
};

RingPop.prototype.whoami = function whoami() {
    return this.hostPort;
};

RingPop.prototype.setLogger = function setLogger(logger) {
    this.logger = logger;
};

RingPop.prototype.stat = function stat(type, key, value) {
    if (!this.statKeys[key]) {
        this.statKeys[key] = this.statPrefix + '.' + key;
    }

    var fqKey = this.statKeys[key];

    if (type === 'increment') {
        this.statsd.increment(fqKey, value);
    } else if (type === 'gauge') {
        this.statsd.gauge(fqKey, value);
    } else if (type === 'timing') {
        this.statsd.timing(fqKey, value);
    }
};

RingPop.prototype.proxyReq = function proxyReq(opts) {
    if (!opts) {
        throw errors.OptionsRequiredError({ method: 'proxyReq' });
    }

    var props = ['keys', 'dest', 'req', 'res'];
    for (var i = 0; i < props.length; i++) {
        var prop = props[i];

        if (!opts[prop]) {
            throw errors.PropertyRequiredError({ property: prop });
        }
    }

    this.requestProxy.proxyReq(opts);
};

RingPop.prototype.registerStatsHook = function registerStatsHook(hook) {
    if (!hook) {
        throw errors.ArgumentRequiredError({ argument: 'hook' });
    }

    if (!hook.name) {
        throw errors.FieldRequiredError({ argument: 'hook', field: 'name' });
    }

    if (typeof hook.getStats !== 'function') {
        throw errors.MethodRequiredError({ argument: 'hook', method: 'getStats' });
    }

    if (this.isStatsHookRegistered(hook.name)) {
        throw errors.DuplicateHookError({ name: hook.name });
    }

    this.statsHooks[hook.name] = hook;
};

RingPop.prototype.handleOrProxy =
    function handleOrProxy(key, req, res, opts) {
        this.logger.trace('handleOrProxy for a key', {
            key: key,
            url: req && req.url
        });

        var dest = this.lookup(key);

        if (this.whoami() === dest) {
            this.logger.trace('handleOrProxy was handled', {
                key: key,
                url: req && req.url
            });
            return true;
        } else {
            this.logger.trace('handleOrProxy was proxied', {
                key: key,
                url: req && req.url
            });
            this.proxyReq(_.defaults({
                keys: [key],
                dest: dest,
                req: req,
                res: res,
            }, opts));
        }
    };

RingPop.prototype.handleOrProxyAll =
    function handleOrProxyAll(opts, cb) {
        var self = this;
        var keys = opts.keys;
        var req = opts.req;

        var whoami = this.whoami();
        var keysByDest = _.groupBy(keys, this.lookup, this);
        var dests = Object.keys(keysByDest);
        var pending = dests.length;
        var responses = [];

        if (pending === 0 && cb) {
            return cb(null, responses);
        }

        dests.forEach(function(dest) {
            var destKeys = keysByDest[dest];
            var res = new micromock.Response(function(err, resp) {
                onResponse(err, resp, dest);
            });
            if (whoami === dest) {
                self.logger.trace('handleOrProxyAll was handled', {
                    keys: destKeys,
                    url: req && req.url,
                    dest: dest
                });
                var head = rawHead(req, {
                    checksum: self.membership.checksum,
                    keys: destKeys
                });
                self.emit('request', req, res, head);
            } else {
                self.logger.trace('handleOrProxyAll was proxied', {
                    keys: destKeys,
                    url: req && req.url,
                    dest: dest
                });
                self.proxyReq(_.defaults({
                    keys: destKeys,
                    req: req,
                    res: res,
                    dest: dest
                }, opts));
            }
        });

        function onResponse(err, resp, dest) {
            responses.push({
                res: resp,
                dest: dest,
                keys: keysByDest[dest]
            });
            if ((--pending === 0 || err) && cb) {
                for (var i = 0; i < responses.length; i++) {
                    var r = responses[i];
                    if (Buffer.isBuffer(r.body)) {
                        r.body = r.body.toString('utf8');
                    }
                }

                cb(err, responses);
                cb = null;
            }
        }
    };

RingPop.prototype.registerSelfEvictHook = function registerSelfEvictHook(hook) {
    this.selfEvicter.registerHooks(hook);
};

RingPop.prototype.selfEvict = function selfEvict(cb) {
    this.selfEvicter.initiate(cb);
};

// This function is defined for testing purposes only.
RingPop.prototype.allowJoins = function allowJoins() {
    this.isDenyingJoins = false;
};

// This function is defined for testing purposes only.
RingPop.prototype.denyJoins = function denyJoins() {
    this.isDenyingJoins = true;
};

module.exports = RingPop;
