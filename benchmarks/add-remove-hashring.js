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

var largeMembership = require('./large-membership.json');
var Ringpop = require('../index.js');
var Suite = require('benchmark').Suite;

var members = largeMembership.slice(0, 1000);
var servers = members.map(function mapMember(member) {
    return member.address;
});

function reportPerformance(event) {
    console.log(event.target.toString());
}

function addRemoveIndividual() {
    var ring;

    var suite = new Suite();
    suite.add('add/remove 1000 servers individually', benchThis);
    suite.on('start', init);
    suite.on('cycle', reportPerformance);
    suite.run();

    function benchThis() {
        for (var i = 0; i < 1000; i++) {
            ring.addServer(servers[i]);
        }

        for (var j = 0; j < 1000; j++) {
            ring.removeServer(servers[j]);
        }
    }

    function init() {
        var ringpop = new Ringpop({
            app: 'ringpop-bench',
            hostPort: '127.0.0.1:3000'
        });

        ring = ringpop.ring;
    }
}

function addRemoveBulk() {
    var ring;

    var suite = new Suite();
    suite.add('add/remove 1000 servers in bulk', benchThis);
    suite.on('start', init);
    suite.on('cycle', reportPerformance);
    suite.run();

    function benchThis() {
        ring.addRemoveServers(servers, servers);
    }

    function init() {
        var ringpop = new Ringpop({
            app: 'ringpop-bench',
            hostPort: '127.0.0.1:3000'
        });

        ring = ringpop.ring;
    }
}

addRemoveIndividual();
addRemoveBulk();
