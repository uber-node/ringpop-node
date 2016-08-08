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

var _ = require('underscore');
var TypedError = require('error/typed');

var errors = require('./errors');
var Member = require('./membership/member');


/**
 * @typedef {Object} Phase
 * @property {SelfEvict.PhaseNames} phase the phase
 * @property {number} ts the timestamp when the phase started
 * @property {number} [duration] the duration of a phase
 */

/**
 * A pre or post self eviction hook.
 * @callback SelfEvict~Hook
 * @param {SelfEvict~HookCallback} cb the callback to be called when the hook completes
 */

/**
 * A callback used when calling Hooks
 * @callback SelfEvict~HookCallback
 */

/**
 * Self eviction provides a way to graceful shut down a ringpop service.
 * A self eviction  consists of the following phases:
 * 1. PreEvict: the preEvict hooks are invoked;
 * 2. Evict: The node will mark  itself as faulty causing an eviction out of the membership;
 * 3. PostEvict: the postEvict hooks are invoke;
 * 4. Done: self eviction is done and ringpop is ready to be shut down.
 *
 * @param {RingPop} ringpop
 * @return {SelfEvict}
 * @constructor
 */
function SelfEvict(ringpop) {
    /* istanbul ignore if */
    if (!(this instanceof SelfEvict)) {
        return new SelfEvict(ringpop);
    }

    /**
     * The ringpop instance
     * @type {RingPop}
     * @private
     */
    this.ringpop = ringpop;

    /**
     *
     * @type {Object.<string, SelfEvict~Hook>}
     */
    this.preEvictHooks = {};
    this.postEvictHooks = {};

    /**
     * The callback to be called after self eviction is complete.
     * @type {SelfEvict~callback}
     * @private
     */
    this.callback = null;

    /**
     * The history of phases
     * @type {[Phase]}
     */
    this.phases = [];
}

/**
 * Get the current  phase or null when self eviction isn't initiated
 * @return {?Phase}
 */
SelfEvict.prototype.currentPhase = function currentPhase() {
    if (this.phases && this.phases.length > 0) {
        return this.phases[this.phases.length - 1];
    }
    return null;
};

/**
 * Register hooks in the eviction sequence. At least one of hook-methods should
 * be defined.
 *
 * @param {Object} hooks The hooks to register
 * @param {string} hooks.name The name of the registered hooks
 * @param {SelfEvict~Hook} [hooks.preEvict] The preEvict hook to register.
 * @param {SelfEvict~Hook} [hooks.postEvict] The postEvict hook to register.
 */
SelfEvict.prototype.registerHooks = function registerHooks(hooks) {
    if (!hooks) {
        throw errors.ArgumentRequiredError({argument: 'hooks'});
    }

    if (!hooks.name) {
        throw errors.FieldRequiredError({argument: 'hooks', field: 'name'});
    }
    var name = hooks.name;

    if (this.preEvictHooks[name] || this.postEvictHooks[name]) {
        throw errors.DuplicateHookError({name: name});
    }

    if (!hooks.preEvict && !hooks.postEvict) {
        throw errors.MethodRequiredError({
            argument: 'hooks',
            method: 'preEvict and/or postEvict'
        });
    }

    if (hooks.preEvict) {
        this.preEvictHooks[name] = hooks.preEvict;
    }

    if (hooks.postEvict) {
        this.postEvictHooks[name] = hooks.postEvict;
    }
};

/**
 * This callback is called after self eviction is complete. When the callback is
 * invoked, it's safe to shut down the ringpop service or destroy ringpop.
 *
 * @callback SelfEvict~callback
 * @param {Error} [err] The error if one occurred
 * @see Ringpop#destroy
 */

/**
 * Initiate the self eviction sequence.
 * @param {SelfEvict~callback} callback called when self eviction is complete.
 */
SelfEvict.prototype.initiate = function initiate(callback) {
    if (this.currentPhase() !== null) {
        var error = RingpopIsAlreadyShuttingDownError({phase: this.currentPhase()});
        this.ringpop.logger.warn('ringpop is already shutting down', {
            local: this.ringpop.whoami(),
            error: error
        });
        callback(error);
        return;
    }
    this.ringpop.logger.info('ringpop is initiating self eviction sequence', {
        local: this.ringpop.whoami()
    });
    this.callback = callback;

    this._preEvict();
};

SelfEvict.prototype._preEvict = function _preEvict() {
    this._transitionTo(PhaseNames.PreEvict);

    var self = this;
    this._runHooks(this.preEvictHooks, function hooksDone() {
        process.nextTick(self._evict.bind(self));
    });
};

SelfEvict.prototype._evict = function _evict() {
    var self = this;

    this._transitionTo(PhaseNames.Evicting);

    var pingEnabled = this.ringpop.config.get('selfEvictionPingEnabled');

    if (pingEnabled) {
        var restartGossip = false;
        // Stop gossip when currently gossiping and ping is enabled
        if (!this.ringpop.gossip.isStopped) {
            this.ringpop.gossip.stop();
            restartGossip = true;
        }
        waitUntilNotPinging();

        function waitUntilNotPinging() {
            if (self.ringpop.gossip.isPinging) {
                //Wait until isPinging is false...
                setTimeout(waitUntilNotPinging, 25);
            } else {
                self.ringpop.membership.setLocalStatus(Member.Status.faulty);
                gossipEviction();
            }
        }

        function gossipEviction() {
            var selfEvictionMaxPingRatio = self.ringpop.config.get('selfEvictionMaxPingRatio');
            var membership = self.ringpop.membership;

            var numberOfPingableMembers = _.filter(membership.members, membership.isPingable.bind(membership)).length;
            var maxNumberOfTicks = Math.ceil(numberOfPingableMembers * selfEvictionMaxPingRatio);

            // Never ping more than the maximum piggy back counter.
            var numberOfPings = Math.min(
                self.ringpop.dissemination.maxPiggybackCount,
                maxNumberOfTicks
            );

            tick();

            function tick() {
                if (numberOfPings > 0) {
                    numberOfPings--;
                    self.ringpop.gossip.tick(tick);
                } else {
                    if (restartGossip) {
                        self.ringpop.gossip.start();
                    }
                    evictDone();
                }
            }
        }
    } else {
        self.ringpop.membership.setLocalStatus(Member.Status.faulty);
        evictDone();
    }

    function evictDone() {
        process.nextTick(self._postEvict.bind(self));
    }
};

SelfEvict.prototype._postEvict = function _postEvict() {
    this._transitionTo(PhaseNames.PostEvict);

    var self = this;
    this._runHooks(this.postEvictHooks, function hooksDone() {
        process.nextTick(self._done.bind(self));
    });
};

SelfEvict.prototype._done = function _done() {
    this._transitionTo(PhaseNames.Done);

    this.callback();
};

/**
 * Transition to a new Phase.
 * @param {SelfEvict.PhaseNames} phaseName
 * @private
 */
SelfEvict.prototype._transitionTo = function _transitionTo(phaseName) {
    var phase = {
        phase: phaseName,
        ts: Date.now()
    };

    var previousPhase = this.currentPhase();
    this.phases.push(phase);

    if (previousPhase) {
        previousPhase.duration = phase.ts - previousPhase.ts;
    }

    this.ringpop.logger.debug('ringpop self eviction phase-transitioning', {
        local: this.ringpop.whoami(),
        phases: this.phases
    });
};

SelfEvict.prototype._runHooks = function _runHooks(hooks, done) {
    var names = Object.keys(hooks);

    if (names.length === 0) {
        done();
        return;
    }

    var logger = this.ringpop.logger;

    var start = Date.now();

    var self = this;
    var hookTimings = {};

    var afterHook = _.after(names.length, function afterHooks() {
        logger.debug('ringpop self eviction done running hooks', {
            local: self.ringpop.whoami(),
            totalDuration: Date.now() - start,
            hookDurations: hookTimings,
            phase: self.currentPhase()
        });
        done();
    });

    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var hook = hooks[name];

        runHook(name, hook);
    }

    function runHook(name, hook) {
        logger.debug('ringpop self eviction running hook', {
                local: self.ringpop.whoami(),
                hook: name
            }
        );

        var hookStart = Date.now();
        hook(function hookDone() {
            logger.debug('ringpop self eviction hook done', {
                    local: self.ringpop.whoami(),
                    hook: name,
                    duration: Date.now() - hookStart
                }
            );
            afterHook();
        });
    }
};


/**
 * Enum for SelfEvict phases
 * @readonly
 * @enum {string}
 */
SelfEvict.PhaseNames = {
    PreEvict: 'pre_evict',
    Evicting: 'evicting',
    PostEvict: 'post_evict',
    Done: 'done'
};
var PhaseNames = SelfEvict.PhaseNames;


/**
 * @returns {Error}
 */
var RingpopIsAlreadyShuttingDownError = TypedError({
    type: 'ringpop.self-evict.already-evicting',
    message: 'ringpop is already evicting itself. currentPhase={phase}',
    phase: null
});

module.exports = SelfEvict;
