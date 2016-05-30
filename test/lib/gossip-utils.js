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

var GossipUtils = {
    startGossiping: function startGossiping(cluster) {
        cluster.forEach(function eachRingpop(ringpop) {
            ringpop.gossip.start();
        });
    },
    stopGossiping: function stopGossiping(cluster) {
        cluster.forEach(function eachRingpop(ringpop) {
            ringpop.gossip.stop();
        });
    },
    stopGossipingAndWait: function stopGossipingAndWait(cluster, callback) {
        GossipUtils.stopGossiping(cluster);
        GossipUtils.waitForNoGossip(cluster, callback);
    },
    waitForNoGossip: function waitForNoGossip(cluster, callback) {
        var stillPinging = false;

        for (var i = 0; i < cluster.length; i++) {
            var obj = cluster[i];
            if (obj.gossip.isPinging) {
                stillPinging = true;
                break;
            }
        }
        if (stillPinging) {
            setTimeout(function again() {
                waitForNoGossip(cluster, callback);
            }, 100);
        } else {
            callback();
        }
    },
    waitForConvergence: function waitForConvergence(cluster, speedup, callback) {
        var periods = null;
        if (speedup) {
            periods = GossipUtils.speedUpGossipProtocol(cluster);
        }

        var onOneExhausted = _.after(cluster.length, converged);
        cluster.forEach(function each(ringpop) {
            ringpop.gossip.start();
            ringpop.dissemination.once('changesExhausted', onOneExhausted);
        });

        function converged() {
            if (speedup) {
                GossipUtils.revertGossipProtocolSpeedUp(cluster, periods);
            }
            GossipUtils.stopGossipingAndWait(cluster, callback);
        }
    },
    speedUpGossipProtocol: function speedUpGossipProtocol(cluster) {
        var tmpMinProtocolPeriods = [];
        cluster.forEach(function each(ringpop, i) {
            tmpMinProtocolPeriods[i] = ringpop.gossip.minProtocolPeriod;
            ringpop.gossip.minProtocolPeriod = 1;
        });
        return tmpMinProtocolPeriods;
    },
    revertGossipProtocolSpeedUp: function revertGossipProtocolSpeedUp(cluster, periods) {
        cluster.forEach(function each(ringpop, i) {
            ringpop.gossip.minProtocolPeriod = periods[i];
        });
    }
};

module.exports = GossipUtils;
