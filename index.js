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
var fs = require('fs');
var globalSetTimeout = require('timers').setTimeout;
var hammock = require('uber-hammock');
var metrics = require('metrics');
var packageJSON = require('./package.json');

var Gossip = require('./lib/gossip');
var Suspicion = require('./lib/gossip/suspicion');

var Config = require('./config.js');
var Dissemination = require('./lib/gossip/dissemination.js');
var errors = require('./lib/errors.js');
var getTChannelVersion = require('./lib/util.js').getTChannelVersion;
var HashRing = require('./lib/ring');
var initMembership = require('./lib/membership/index.js');
var MembershipIterator = require('./lib/membership/iterator.js');
var MembershipUpdateRollup = require('./lib/membership/rollup.js');
var nulls = require('./lib/nulls');
var rawHead = require('./lib/request-proxy/util.js').rawHead;
var RequestProxy = require('./lib/request-proxy/index.js');
var registerMembershipListeners = require('./lib/on_membership_event.js').register;
var registerRingListeners = require('./lib/on_ring_event.js').register;
var registerRingpopListeners = require('./lib/on_ringpop_event.js').register;
var RingpopClient = require('./client.js');
var RingpopServer = require('./server');
var safeParse = require('./lib/util').safeParse;
var sendJoin = require('./lib/gossip/join-sender.js').joinCluster;
var TracerStore = require('./lib/trace/store.js');

var HOST_PORT_PATTERN = /^(\d+.\d+.\d+.\d+):\d+$/;
var MAX_JOIN_DURATION = 300000;
var MEMBERSHIP_UPDATE_FLUSH_INTERVAL = 5000;

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

    var isString = typeof options.hostPort === 'string';
    var parts = options.hostPort && options.hostPort.split(':');
    var isColonSeparated = parts && parts.length === 2;
    var isPort = parts && parts[1] &&
        !isNaN(parseInt(parts[1], 10));

    if (!isString || !isColonSeparated || !isPort) {
        throw errors.HostPortRequiredError({
            hostPort: options.hostPort,
            reason: !isString ? 'a string' :
                !isColonSeparated ? 'a valid hostPort pattern' :
                !isPort ? 'a valid port' : 'correct'
        });
    }

    this.app = options.app;
    this.hostPort = options.hostPort;
    this.channel = options.channel;
    this.setLogger(options.logger || nulls.logger);
    this.statsd = options.statsd || nulls.statsd;
    this.bootstrapFile = options.bootstrapFile;
    this.setTimeout = options.setTimeout || globalSetTimeout;
    this.Ring = options.Ring || HashRing;

    this.isReady = false;

    this.debugFlags = {};
    this.joinSize = options.joinSize;
    this.pingReqSize = 3;           // ping-req fanout
    this.pingReqTimeout = options.pingReqTimeout || 5000;
    this.pingTimeout = options.pingTimeout || 1500;
    this.joinTimeout = options.joinTimeout || 1000;
    this.proxyReqTimeout = options.proxyReqTimeout || 30000;
    this.maxJoinDuration = options.maxJoinDuration || MAX_JOIN_DURATION;
    this.membershipUpdateFlushInterval = options.membershipUpdateFlushInterval ||
        MEMBERSHIP_UPDATE_FLUSH_INTERVAL;

    // Initialize Config before all other gossip, membership, forwarding,
    // and hash ring dependencies.
    this.config = new Config(this, options);

    this.requestProxy = new RequestProxy({
        ringpop: this,
        maxRetries: options.requestProxyMaxRetries,
        retrySchedule: options.requestProxyRetrySchedule,
        enforceConsistency: options.enforceConsistency
    });

    this.ring = new this.Ring();

    this.dissemination = new Dissemination(this);

    this.membership = initMembership(this);
    this.memberIterator = new MembershipIterator(this);
    this.gossip = new Gossip({
        ringpop: this,
        minProtocolPeriod: options.minProtocolPeriod
    });
    this.suspicion = new Suspicion({
        ringpop: this,
        suspicionTimeout: options.suspicionTimeout
    });
    this.membershipUpdateRollup = new MembershipUpdateRollup({
        ringpop: this,
        flushInterval: this.membershipUpdateFlushInterval
    });

    this.tracers = new TracerStore(this);

    registerMembershipListeners(this);
    registerRingListeners(this);
    registerRingpopListeners(this);

    this.clientRate = new metrics.Meter();
    this.serverRate = new metrics.Meter();
    this.totalRate = new metrics.Meter();

    // 10.30.8.26:20600 -> 10_30_8_26_20600
    this.statHostPort = this.hostPort.replace(/\.|:/g, '_');
    this.statPrefix = 'ringpop.' + this.statHostPort;
    this.statKeys = {};
    this.statsHooks = {};

    this.destroyed = false;
    this.joiner = null;

    this.startTime = Date.now(); //used for calculating uptime

    this.tchannelVersion = getTChannelVersion();
    this.ringpopVersion = packageJSON.version;
}

require('util').inherits(RingPop, EventEmitter);

RingPop.prototype.destroy = function destroy() {
    if (this.destroyed) {
        return;
    }

    this.emit('destroying');

    this.gossip.stop();
    this.suspicion.stopAll();
    this.membershipUpdateRollup.destroy();
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
    this.client = new RingpopClient(this.channel);
    this.server = new RingpopServer(this, this.channel);
};

/*
 * opts are:
 *   - bootstrapFile: File or array used to seed join process
 *   - joinParallelismFactor: Number of nodes in which join request
 *   will be sent
 */
RingPop.prototype.bootstrap = function bootstrap(opts, callback) {
    var bootstrapFile = opts && opts.bootstrapFile || opts || {};

    if (typeof bootstrapFile === 'function') {
        callback = bootstrapFile;
        bootstrapFile = null;
    }

    var self = this;

    if (this.isReady) {
        var alreadyReadyMsg = 'ringpop is already ready';
        this.logger.warn(alreadyReadyMsg, { address: this.hostPort });
        if (callback) callback(new Error(alreadyReadyMsg));
        return;
    }

    var bootstrapTime = Date.now();

    this.seedBootstrapHosts(bootstrapFile);

    if (!Array.isArray(this.bootstrapHosts) || this.bootstrapHosts.length === 0) {
        var noBootstrapMsg = 'ringpop cannot be bootstrapped without bootstrap hosts.' +
            ' make sure you specify a valid bootstrap hosts file to the ringpop' +
            ' constructor or have a valid hosts.json file in the current working' +
            ' directory.';
        this.logger.warn(noBootstrapMsg);
        if (callback) callback(new Error(noBootstrapMsg));
        return;
    }

    checkForMissingBootstrapHost();
    checkForHostnameIpMismatch();

    // Add local member to membership.
    this.membership.makeAlive(this.whoami(), Date.now());

    var joinTime = Date.now();

    sendJoin({
        ringpop: self,
        maxJoinDuration: self.maxJoinDuration,
        joinSize: self.joinSize,
        parallelismFactor: opts.joinParallelismFactor,
        joinTimeout: self.joinTimeout
    }, function onJoin(err, nodesJoined) {
        joinTime = Date.now() - joinTime;

        if (err) {
            self.logger.error('ringpop bootstrap failed', {
                error: err,
                address: self.hostPort
            });
            if (callback) callback(err);
            return;
        }

        if (self.destroyed) {
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
};

RingPop.prototype.clearDebugFlags = function clearDebugFlags() {
    this.debugFlags = {};
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

    this.emit('lookup', {
        timing: Date.now() - startTime
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

    this.emit('lookupN', {
        timing: Date.now() - startTime
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
    this.seedBootstrapHosts(file);

    callback();
};

RingPop.prototype.whoami = function whoami() {
    return this.hostPort;
};

RingPop.prototype.readHostsFile = function readHostsFile(file) {
    if (!file) {
        return false;
    }

    if (!fs.existsSync(file)) {
        this.logger.warn('bootstrap hosts file does not exist', { file: file });
        return false;
    }

    try {
        return safeParse(fs.readFileSync(file).toString());
    } catch (e) {
        this.logger.warn('failed to read bootstrap hosts file', {
            error: e,
            file: file
        });
    }
};

RingPop.prototype.seedBootstrapHosts = function seedBootstrapHosts(file) {
    if (Array.isArray(file)) {
        this.bootstrapHosts = file;
    } else {
        this.bootstrapHosts = this.readHostsFile(file) ||
            this.readHostsFile(this.bootstrapFile) ||
            this.readHostsFile('./hosts.json');
    }
};

RingPop.prototype.setDebugFlag = function setDebugFlag(flag) {
    this.debugFlags[flag] = true;
};

RingPop.prototype.debugLog = function debugLog(msg, flag) {
    if (this.debugFlags && this.debugFlags[flag]) {
        this.logger.info(msg);
    }
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
            var res = hammock.Response(function(err, resp) {
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
                cb(err, responses);
                cb = null;
            }
        }
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
