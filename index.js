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

var _ = require('underscore');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var globalSetTimeout = require('timers').setTimeout;
var hammock = require('uber-hammock');
var metrics = require('metrics');

var Gossip = require('./lib/swim/gossip');
var sendPing = require('./lib/swim/ping-sender.js');
var sendPingReq = require('./lib/swim/ping-req-sender.js');
var Suspicion = require('./lib/swim/suspicion');

var createRingPopTChannel = require('./lib/tchannel.js').createRingPopTChannel;
var Dissemination = require('./lib/dissemination.js');
var errors = require('./lib/errors.js');
var HashRing = require('./lib/ring');
var Membership = require('./lib/membership.js');
var MembershipIterator = require('./lib/membership-iterator.js');
var MembershipUpdateRollup = require('./lib/membership-update-rollup.js');
var nulls = require('./lib/nulls');
var rawHead = require('./lib/request-proxy/util.js').rawHead;
var RequestProxy = require('./lib/request-proxy/index.js');
var safeParse = require('./lib/util').safeParse;
var sendJoin = require('./lib/swim/join-sender.js').joinCluster;

var HOST_PORT_PATTERN = /^(\d+.\d+.\d+.\d+):\d+$/;
var MAX_JOIN_DURATION = 300000;
var MEMBERSHIP_UPDATE_FLUSH_INTERVAL = 5000;
var PROXY_REQ_PROPS = ['keys', 'dest', 'req', 'res'];

function onRingChecksumComputed(ringpop) {
    ringpop.stat('increment', 'ring.checksum-computed');
    ringpop.emit('ringChecksumComputed');
}

function onRingServerAdded(ringpop) {
    ringpop.stat('increment', 'ring.server-added');
    ringpop.emit('ringServerAdded');
}

function onRingServerRemoved(ringpop) {
    ringpop.stat('increment', 'ring.server-removed');
    ringpop.emit('ringServerRemoved');
}

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

    this.isReady = false;

    this.debugFlags = {};
    this.joinSize = options.joinSize;
    this.pingReqSize = 3;           // ping-req fanout
    this.pingReqTimeout = 5000;
    this.pingTimeout = 1500;
    this.proxyReqTimeout = options.proxyReqTimeout || 30000;
    this.maxJoinDuration = options.maxJoinDuration || MAX_JOIN_DURATION;
    this.membershipUpdateFlushInterval = options.membershipUpdateFlushInterval ||
        MEMBERSHIP_UPDATE_FLUSH_INTERVAL;

    this.requestProxy = new RequestProxy({
        ringpop: this,
        maxRetries: options.requestProxyMaxRetries,
        retrySchedule: options.requestProxyRetrySchedule
    });

    this.ring = new HashRing();
    this.ring.on('added', onRingServerAdded.bind(null, this));
    this.ring.on('removed', onRingServerRemoved.bind(null, this));
    this.ring.on('checksumComputed', onRingChecksumComputed.bind(null, this));

    this.dissemination = new Dissemination(this);
    this.membership = new Membership(this);
    this.membership.on('updated', this.onMembershipUpdated.bind(this));
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
}

require('util').inherits(RingPop, EventEmitter);

RingPop.prototype.destroy = function destroy() {
    this.destroyed = true;
    this.gossip.stop();
    this.suspicion.stopAll();
    this.membershipUpdateRollup.destroy();
    this.requestProxy.destroy();

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

    if (this.channel) {
        this.channel.quit();
    }
};

RingPop.prototype.setupChannel = function setupChannel() {
    createRingPopTChannel(this, this.channel);
};

RingPop.prototype.adminJoin = function adminJoin(callback) {
    if (!this.membership.localMember) {
        process.nextTick(function() {
            callback(errors.InvalidLocalMemberError());
        });
        return;
    }

    if (this.membership.localMember.status === 'leave') {
        this.rejoin(function() {
            callback(null, null, 'rejoined');
        });
        return;
    }

    if (this.joiner) {
        this.joiner.destroy();
        this.joiner = null;
    }

    this.joiner = sendJoin({
        ringpop: this,
        maxJoinDuration: this.maxJoinDuration,
        joinSize: this.joinSize
    }, callback);
};

RingPop.prototype.bootstrap = function bootstrap(opts, callback) {
    var bootstrapFile = opts.bootstrapFile || opts;

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

    var start = new Date();

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

    this.checkForMissingBootstrapHost();
    this.checkForHostnameIpMismatch();

    // Add local member to membership.
    this.membership.makeAlive(this.whoami(), Date.now());

    this.adminJoin(function(err, nodesJoined) {
        if (err) {
            self.logger.error('ringpop bootstrap failed', {
                err: err.message,
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

        self.logger.info('ringpop is ready', {
            address: self.hostPort,
            bootstrapTime: new Date() - start,
            memberCount: self.membership.getMemberCount()
        });

        self.gossip.start();
        self.isReady = true;
        self.emit('ready');

        if (callback) callback(null, nodesJoined);
    });
};

RingPop.prototype.checkForMissingBootstrapHost = function checkForMissingBootstrapHost() {
    if (this.bootstrapHosts.indexOf(this.hostPort) === -1) {
        this.logger.warn('bootstrap hosts does not include the host/port of' +
            ' the local node. this may be fine because your hosts file may' +
            ' just be slightly out of date, but it may also be an indication' +
            ' that your node is identifying itself incorrectly.', {
            address: this.hostPort
        });

        return false;
    }

    return true;
};

RingPop.prototype.checkForHostnameIpMismatch = function checkForHostnameIpMismatch() {
    var self = this;

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

    if (HOST_PORT_PATTERN.test(this.hostPort)) {
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
    return {
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
        ring: Object.keys(this.ring.servers)
    };
};

RingPop.prototype.handleTick = function handleTick(cb) {
    var self = this;
    this.pingMemberNow(function () {
        cb(null, JSON.stringify({ checksum: self.membership.checksum }));
    });
};

RingPop.prototype.isStatsHookRegistered = function isStatsHookRegistered(name) {
    return !!this.statsHooks[name];
};

RingPop.prototype.protocolLeave = function protocolLeave(node, callback) {
    callback();
};

RingPop.prototype.protocolPing = function protocolPing(options, callback) {
    this.stat('increment', 'ping.recv');

    var source = options.source;
    var changes = options.changes;
    var checksum = options.checksum;

    this.serverRate.mark();
    this.totalRate.mark();

    this.membership.update(changes);

    callback(null, {
        changes: this.dissemination.issueChanges(checksum, source)
    });
};

RingPop.prototype.lookup = function lookup(key) {
    this.stat('increment', 'lookup');
    var dest = this.ring.lookup(key + '');

    if (!dest) {
        this.logger.debug('could not find destination for a key', {
            key: key
        });
        return this.whoami();
    }

    return dest;
};

RingPop.prototype.reload = function reload(file, callback) {
    this.seedBootstrapHosts(file);

    callback();
};

RingPop.prototype.whoami = function whoami() {
    return this.hostPort;
};

RingPop.prototype.onMemberAlive = function onMemberAlive(change) {
    this.stat('increment', 'membership-update.alive');
    this.logger.debug('member is alive', {
        local: this.membership.localMember.address,
        alive: change.address
    });

    this.dissemination.recordChange(change);
    this.ring.addServer(change.address);
    this.suspicion.stop(change);
};

RingPop.prototype.onMemberFaulty = function onMemberFaulty(change) {
    this.stat('increment', 'membership-update.faulty');
    this.logger.debug('member is faulty', {
        local: this.membership.localMember.address,
        faulty: change.address,
    });

    this.dissemination.recordChange(change);
    this.ring.removeServer(change.address);
    this.suspicion.stop(change);
};

RingPop.prototype.onMemberLeave = function onMemberLeave(change) {
    this.stat('increment', 'membership-update.leave');
    this.logger.debug('member has left', {
        local: this.membership.localMember.address,
        left: change.address
    });

    this.dissemination.recordChange(change);
    this.ring.removeServer(change.address);
    this.suspicion.stop(change);
};

RingPop.prototype.onMemberSuspect = function onMemberSuspect(change) {
    this.stat('increment', 'membership-update.suspect');
    this.logger.debug('member is suspect', {
        local: this.membership.localMember.address,
        suspect: change.address
    });

    this.suspicion.start(change);
    this.dissemination.recordChange(change);
};

RingPop.prototype.onMembershipUpdated = function onMembershipUpdated(updates) {
    var self = this;
    var membershipChanged = false;
    var ringChanged = false;

    updates.forEach(function(update) {
        if (update.status === 'alive') {
            self.onMemberAlive(update);
            ringChanged = membershipChanged = true;
        } else if (update.status === 'faulty') {
            self.onMemberFaulty(update);
            ringChanged = membershipChanged = true;
        } else if (update.status === 'leave') {
            self.onMemberLeave(update);
            ringChanged = membershipChanged = true;
        } else if (update.status === 'suspect') {
            self.onMemberSuspect(update);
            membershipChanged = true;
        }
    });

    if (!!membershipChanged) {
        this.emit('membershipChanged');
        this.emit('changed'); // Deprecated
    }

    if (!!ringChanged) {
        this.emit('ringChanged');
    }

    this.membershipUpdateRollup.trackUpdates(updates);

    this.stat('gauge', 'num-members', this.membership.members.length);
    this.stat('timing', 'updates', updates.length);
};

RingPop.prototype.pingMemberNow = function pingMemberNow(callback) {
    callback = callback || function() {};

    if (this.isPinging) {
        this.logger.warn('aborting ping because one is in progress');
        return callback();
    }

    if (!this.isReady) {
        this.logger.warn('ping started before ring initialized');
        return callback();
    }

    var member = this.memberIterator.next();

    if (! member) {
        this.logger.warn('no usable nodes at protocol period');
        return callback();
    }

    var self = this;
    this.isPinging = true;
    var start = new Date();
    sendPing({
        ringpop: self,
        target: member
    }, function(isOk, body) {
        self.stat('timing', 'ping', start);
        if (isOk) {
            self.isPinging = false;
            self.membership.update(body.changes);
            return callback();
        }

        if (self.destroyed) {
            return callback(new Error('destroyed whilst pinging'));
        }

        var pingReqStartTime = new Date();
        // TODO The pinged member's status could have changed to
        // faulty by the time we received and processed the ping
        // response. There are no ill effects to membership state
        // by sending a ping-req to the faulty member (and processing
        // the response), though it does delay the protocol period
        // unnecessarily. We may want to bypass the ping-req here
        // if the member's status is faulty.
        sendPingReq({
            ringpop: self,
            unreachableMember: member,
            pingReqSize: self.pingReqSize
        }, function onPingReq() {
            self.stat('timing', 'ping-req', pingReqStartTime);
            self.isPinging = false;

            callback.apply(null, Array.prototype.splice.call(arguments, 0));
        });
    });
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
            err: e.message,
            file: file
        });
    }
};

RingPop.prototype.rejoin = function rejoin(callback) {
    // Assert local member is alive.
    this.membership.makeAlive(this.whoami(), Date.now());
    this.gossip.start();
    this.suspicion.reenable();

    // TODO Rejoin may eventually necessitate fan-out thus
    // the need for the asynchronous-style callback.
    process.nextTick(function() {
        callback();
    });
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

RingPop.prototype.handleIncomingRequest =
    function handleIncomingRequest(header, body, cb) {
        this.requestProxy.handleRequest(header, body, cb);
    };

RingPop.prototype.proxyReq = function proxyReq(opts) {
    if (!opts) {
        throw errors.OptionsRequiredError({ method: 'proxyReq' });
    }

    this.validateProps(opts, PROXY_REQ_PROPS);

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

RingPop.prototype.validateProps = function validateProps(opts, props) {
    for (var i = 0; i < props.length; i++) {
        var prop = props[i];

        if (!opts[prop]) {
            throw errors.PropertyRequiredError({ property: prop });
        }
    }
};

module.exports = RingPop;
