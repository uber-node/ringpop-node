# Programming Ringpop
You may decide that Ringpop is right for your application and want to know how
to program against it. Below you'll find information about how to use Ringpop
within your application and the API Ringpop exposes to the application developer.

## Code Walkthrough
The first thing you'll want is a handle on a Ringpop instance. You'll first need
an instance of TChannel, the underlying transport for Ringpop:

**Node.js**
```
var TChannel = require('TChannel');

var tchannel = new TChannel();
var subChannel = tchannel.makeSubChannel({
    serviceName: 'ringpop
});
```

Then decide on a listening address for TChannel. We'll leave that exercise
for the reader. For the purposes of this exercise, let's assume we're using:

**Node.js**
```
var host = '172.18.27.228';
var port = 3000;
```

You're almost ready for Ringpop. Before we get to it, we'll need a list
of addresses that act as the seed for Ringpop to join a cluster of other
nodes. Let's assume that there are other Ringpop nodes that are or
will be available:

**Node.js**
```
var bootstrapNodes = ['172.18.27.228:3000', 172.18.27.228:3001',
    '172.18.27.228:3002'];
```

We're there! Instantiate Ringpop:

**Node.js**
```
var ringpop = new Ringpop({
    app: 'yourapp',
    hostPort: host + ':' + port,
    channel: subChannel
});
ringpop.setupChannel();
ringpop.channel.once('listening', onListening);
ringpop.channel.listen(port, host);

function onListening() {
    ringpop.bootstrap(bootstrapNodes, onBootstrap);
}

function onBootstrap(err) {
    if (err) {
        // Fatal error
        return;
    }

    // Start listening for application traffic
}
```

When TChannel starts listening for connections, Ringpop is ready to be
bootstrapped. Bootstrapping consists of having Ringpop send out a join request
to a number of random hosts selected from `bootstrapNodes`. Your application
is ready to serve traffic when Ringpop successfully joins a cluster.

As requests arrive, you'll want to lookup a request's key against the ring.
If the key hashes to the address of Ringpop (`hostPort`), your request
may be handled locally, otherwise it'll need to be forwarded to the correct Ringpop.
The typical pattern you'll see looks similar to:

**Node.js**
```
var destination = ringpop.lookup(key);

if (destination === ringpop.whoami()) {
    // Handle the request
} else {
    // Forward the request
}
```

This pattern has been codified in Ringpop's `handleOrProxy` function as a
convenience and can be used to forward HTTP traffic over TChannel. If the
request should not be handled locally, `handleOrProxy` will return `false`:

**Node.js**
```
if (ringpop.handleOrProxy(key, req, res, opts)) {
    // Handle the request
}
```

That's really all there is to using Ringpop within your application. For
a deeper dive into all of the other bells and whistles Ringpop has to offer
we refer you to the API section below and the Running Ringpop page.

## API

### `Ringpop(opts)`
Creates an instance of Ringpop.

* `app` - The title of your application. It is used to protect your
application's ring from cross-pollinating with another application's ring.
It is a required property.
* `channel` - An instance of TChannel. It is a required property.
* `hostPort` - The address of your Ringpop. This is used as the node's identity
in the membership protocol and the ring. It is a required property.

NOTE: There are many other options one can specify in the Ringpop constructor.
They are not yet documented.

### `bootstrap(bootstrapFileOrList, callback)`
Bootstraps Ringpop; joins the cluster.

* `bootstrapFileOrList` - The path of a bootstrap file on disk. Its contents
are expected to be a JSON array of Ringpop addresses. Ringpop will select
a number of random nodes from this list to which join requests will be sent.
Alternatively, this argument can be a Javascript array of the same addresses.
* `callback(err)` - A callback.

### `handleOrProxy(key, req, res, opts)`
Acts as a convenience for the "handle or forward" pattern.

* `key` - An arbitrary key, typically a UUID. Its hash code
is computed and its position along the ring is found. Its owner
is the closest node whose hash code is closest (in a clock-wise
direction)
* `req` - Takes the shape of a Node.js [http.ClientRequest](https://nodejs.org/api/http.html#http_class_http_clientrequest)
* `res` - Takes the shape of a Node.js [http.ServerResponse](https://nodejs.org/api/http.html#http_class_http_serverresponse)
* `opts` - Valid options are listed below.

#### opts

* `bodyLimit` - The maximum size of the allowable request body. Default is 1MB.
* `endpoint` - The TChannel endpoint to which the request will be forwarded.
The default is /proxy/req. Typically, this should be left untouched.
* `maxRetries` - Maximum number of retries to attempt in the event that a
forwarded request fails.
* `retrySchedule` - An array of delay multiples applied in between each retry.
Default is `[0, 1, 3.5]`. These multiples are applied against a 1000ms delay.
* `skipLookupOnRetry` - A boolean flag to specify whether a request should be rerouted
if the ring changes in between retries.
* `timeout` - The amount of time, in milliseconds, to allow for the forwarded
request to complete.

### `lookup(key)`
Looks up a key against the ring; returns the address of the Ringpop
that owns the key.

* `key` - See the description of `key` above.

### `lookupN(key, n)`
Looks up a key against the ring; returns the addresses of `n` distinct
Ringpop's that own the key; useful for replication purposes. If `n` are
not found, fewer addresses may be returned.

* `key` - See the description of `key` above.
* `n` - The number of secondary owners aka a "preference list".

### `whoami()`
Returns the address of Ringpop

### Events
Content coming soon...

## An Example Express App
Let's see all of this come together in an example web application that you
can run and curl yourself. This is a 3-node Ringpop cluster each with its
own HTTP front-end capable of 'handling' and forwarding HTTP requests in
less than 100 lines of code.

To run:

1. Paste this code into a file named `example.js`
2. `npm install ringpop tchannel express`
3. `node example.js`
4. curl to your heart's content: `curl 127.0.0.1:6000/objects/abc`

**Node.js**
```
var express = require('express');
var Ringpop = require('ringpop');
var TChannel = require('TChannel');

var host = '127.0.0.1'; // not recommended for production
var ports = [3000, 3001, 3002];
var bootstrapNodes = ['127.0.0.1:3000', '127.0.0.1:3001',
    '127.0.0.1:3002'];

var cluster = [];

// Create Ringpop instances
ports.forEach(function each(port) {
    var tchannel = new TChannel();
    var subChannel = tchannel.makeSubChannel({
        serviceName: 'ringpop'
    });

    cluster.push(new Ringpop({
        app: 'yourapp',
        hostPort: host + ':' + port,
        channel: subChannel
    }));
});

// Bootstrap cluster
cluster.forEach(function each(ringpop, index) {
    ringpop.setupChannel();
    ringpop.channel.listen(ports[index], host, function onListen() {
        console.log('TChannel is listening on ' + ports[index]);
        ringpop.bootstrap(bootstrapNodes,
            bootstrapCallback(ringpop, index));

        // This is how you wire up a handler for forwarded requests
        ringpop.on('request', forwardedCallback());
    });
});

// After successfully bootstrapping, create the HTTP server.
var bootstrapsLeft = bootstrapNodes.length;
function bootstrapCallback(ringpop, i) {
    return function onBootstrap(err) {
        if (err) {
            console.log('Error: Could not bootstrap ' + ringpop.whoami());
            process.exit(1);
        }

        console.log('Ringpop ' + ringpop.whoami() + ' has bootstrapped!');
        bootstrapsLeft--;

        if (bootstrapsLeft === 0) {
            console.log('Ringpop cluster is ready!');
            createHttpServers();
        }
    };
}

// In this example, forwarded requests are immediately ended. Fill in with
// your own application logic.
function forwardedCallback() {
    return function onRequest(req, res) {
        res.end();
    }
}

// These HTTP servers will act as the front-end
// for the Ringpop cluster.
function createHttpServers() {
    cluster.forEach(function each(ringpop, index) {
        var http = express();

        // Define a single HTTP endpoint that 'handles' or forwards
        http.get('/objects/:id', function onReq(req, res) {
            var key = req.params.id;
            if (ringpop.handleOrProxy(key, req, res)) {
                console.log('Ringpop ' + ringpop.whoami() + ' handled ' + key);
                res.end();
            } else {
                console.log('Ringpop ' + ringpop.whoami() +
                    ' forwarded ' + key);
            }
        });

        var port = ports[index] * 2; // HTTP will need its own port
        http.listen(port, function onListen() {
            console.log('HTTP is listening on ' + port);
        });
    });
}
```
