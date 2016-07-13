# ringpop-node [![Build Status](https://travis-ci.org/uber/ringpop-node.svg?branch=master)](https://travis-ci.org/uber/ringpop-node)
Ringpop is a library that brings cooperation and coordination to distributed
applications. It maintains a consistent hash ring on top of a membership protocol
and provides request forwarding as a routing convenience. It can be used to
shard your application in a way that's scalable and fault tolerant.

# Requirements

* Node 0.10 (0.10.32 or higher)

# Installation
To install Ringpop for usage as a library:

```
npm install ringpop
```

Prepare the current directory for development:

```
npm install
```

To be able to run the tests, make sure you have your open file limit
restriction on at least 4K:

```
ulimit -n 4096
```

# Tick Cluster
An example application `tools/tick-cluster.js` is included in ringpop-common
repository. It just launches a ringpop cluster of a given size. Using this
application is the quickest way to start a ringpop cluster.

```
git clone https://github.com/uber/ringpop-common.git
./ringpop-common/tools/tick-cluster.js --interpreter node main.js
```

# Example
Run a 2-node Ringpop cluster from the command-line. Install Ringpop
and TChannel, copy/paste the below into your editor and run!

```js
var Ringpop = require('ringpop');
var TChannel = require('tchannel');

function Cluster(opts) {
    this.name = opts.name;
    this.size = opts.size;
    this.basePort = opts.basePort;
    this.bootstrapNodes = [];

    // Create the bootstrap list of nodes that'll
    // be used to seed Ringpop for its join request.
    for (var i = 0; i < this.size; i++) {
        this.bootstrapNodes.push('127.0.0.1:' + (this.basePort + i));
    }
}

Cluster.prototype.launch = function launch(callback) {
    var self = this;
    var done = after(self.size, callback);

    for (var i = 0; i < this.size; i++) {
        var addr = this.bootstrapNodes[i];
        var addrParts = addr.split(':');

        var tchannel = new TChannel();
        var ringpop = new Ringpop({
            app: this.name,
            hostPort: addr,
            channel: tchannel.makeSubChannel({
                serviceName: 'ringpop',
                trace: false
            })
        });
        ringpop.setupChannel();

        // First make sure TChannel is accepting connections.
        tchannel.listen(+addrParts[1], addrParts[0], listenCb(ringpop));
    }


    function listenCb(ringpop) {
        // When TChannel is listening, bootstrap Ringpop. It'll
        // try to join its friends in the bootstrap list.
        return function onListen() {
            ringpop.bootstrap(self.bootstrapNodes, done);
        };
    }
};

// IGNORE THIS! It's a little utility function that invokes
// a callback after a specified number of invocations
// of its shim.
function after(count, callback) {
    var countdown = count;

    return function shim(err) {
        if (typeof callback !== 'function') return;

        if (err) {
            callback(err);
            callback = null;
            return;
        }

        if (--countdown === 0) {
            callback();
            callback = null;
        }
    };
}

if (require.main === module) {
    // Launch a Ringpop cluster of arbitrary size.
    var cluster = new Cluster({
        name: 'mycluster',
        size: 2,
        basePort: 3000
    });

    // When all nodes have been bootstrapped, your
    // Ringpop cluster will be ready for use.
    cluster.launch(function onLaunch(err) {
        if (err) {
            console.error('Error: failed to launch cluster');
            process.exit(1);
        }

        console.log('Ringpop cluster is ready!');
    });
}
```

# Documentation
Interested in where to go from here? Read the docs at
[ringpop.readthedocs.org](https://ringpop.readthedocs.org).
