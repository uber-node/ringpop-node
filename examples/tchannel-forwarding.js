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

var TChannel = require('tchannel');
var Ringpop = require('../index.js');
var RingpopHandler = require('../ringpop-handler.js');

function App(options) {
    if (!(this instanceof App)) {
        return new App(options);
    }

    var self = this;

    self.name = options.name;
    self.port = options.port;
    self.ringpopHosts = options.ringpopHosts;

    self.channel = TChannel();
    self.ringpop = Ringpop({
        app: 'app',
        hostPort: '127.0.0.1:' + self.port,
        channel: self.channel.makeSubChannel({
            serviceName: 'ringpop',
            trace: false
        })
    });

    self.appChannel = self.channel.makeSubChannel({
        serviceName: 'app'
    });
    self.appChannel.handler = RingpopHandler({
        channel: self.appChannel,
        ringpop: self.ringpop,
        logger: self.channel.logger,
        realHandler: self.appChannel.handler
    });

    self.appChannel.register('hello', function hello(req, res, arg2, arg3) {
        res.headers.as = 'raw';
        res.sendOk('', 'hello from ' + self.name + ' for ' + req.headers.sk);
    });

    self.ringpop.setupChannel();
}

App.prototype.bootstrap = function bootstrap(cb) {
    var self = this;

    self.channel.listen(self.port, '127.0.0.1', onListen);

    function onListen() {
        self.ringpop.bootstrap(self.ringpopHosts, onBootstrap);
    }

    function onBootstrap() {
        console.log('app: ' + self.name + ' listening on ' +
            self.channel.address().port);
    }
};

if (require.main === module) {
    var app1 = App({
        name: 'app1',
        port: 4040,
        ringpopHosts: ['127.0.0.1:4040', '127.0.0.1:4041']
    });
    var app2 = App({
        name: 'app2',
        port: 4041,
        ringpopHosts: ['127.0.0.1:4040', '127.0.0.1:4041']
    });

    app1.bootstrap();
    app2.bootstrap();
}
