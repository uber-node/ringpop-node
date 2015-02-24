# Overview
ringpop is an embeddable module (and optional server) that allows applications to operate within a distributed, consistent hash ring. Ringpop automatically detects failure of nodes within the ring and disseminates information about the state of the ring over a gossip protocol (see SWIM).

# Running ringpop
To run ringpop as a standalone server, run `main.js`. Its usage is as follows:

```
Usage: main [options]

  Options:

    -h, --help             output usage information
    -V, --version          output the version number
    -l, --listen <listen>  Host and port on which server listens (also node's identity in cluster)
    -h, --hosts <hosts>    Seed file of list of hosts to join
```

# Developing with ringpop
Instantiate ringpop by providing it the title and listening address of your application. It's important to note that the listening address of your ringpop instance is also used as a globally unique identifier for the instance within the ring. Therefore, make sure `hostPort` is unique.

```javascript
var ringpop = new RingPop({
    app: 'myapp',
    hostPort: 'myhost:30000'
});
```

Then bootstrap ringpop. ringpop will look for a hosts file (see 'Generate hosts file' section) in `/etc/uber/ringpop/hosts/<app>.json` or `./hosts.json` to seed the ring and attempt to join a number of the nodes listed therein.

```javascript
ringpop.bootstrap();
```

When ringpop has joined enough nodes, it will be ready for use and emit a `ready` event. Applications should refuse requests until ringpop is ready.

```javascript
ringpop.on('ready', function() {
    // do something
});
```

Applications can call ringpop's `lookup` function to discover which node a key hashes to. If the key hashes to the same node performing the lookup, then that node is free to process the incoming request. Otherwise, applications must forward the request to the resulting node.

```javascript
var node = ringpop.lookup('cba8e0bf-412f-4edd-b842-882a361a5a7f');

if (node === ringpop.whoami()) {
    // process request
} else {
    // forward request
}
```

The state of the hash ring will change when nodes join, leave, fail or are revived. When ringpop detects a change, it will emit a `changed` event. A change in the ring may cause keys to rebalance. If your application is affected to rebalanced keys, then it is left up to your application to respond accordingly.

```javascript
ringpop.on('changed', function() {
    // do something
});
```

# Forwarding a request
Ringpop will typically be used by handing over request routing to it. As described earlier, the "process or forward" pattern is used to decide whether a request should be processed by the node that received the request or by another node. As an alternative, `handleOrForward` can be used to encapsulate that repetitive pattern. Here's an example of its use:

```javascript
// Let's say this is an endpoint handler in your web application
function endpoint(incoming, opts, cb) {
    function handle() {
        // process request
    }

    function forwarded(err, resp, body) {
        cb(err, {
            statusCode: resp && resp.statusCode
        });
    }

    var requestToForward = {
        method: 'POST',
        path: '/supply/1',
        headers: { 'Content-Type: application/json' },
        body: JSON.stringify({ /* fill body here */ }),
        timeout: 1000
    };

    ringpop.handleOrForward(incoming.params.uuid, handle, requestToForward, forwarded);
}
```

# Generate hosts file
Ringpop uses a hosts file to seed its ring. To generate a hosts file use the `generate-hosts` script:

```
./scripts/generate-hosts.js --hosts=myhost --base-port=30000 --num-ports=5 --output-file=/etc/ringpop/hosts/project.json
```

# Gossip
TODO

## SWIM

### Extensions

# Dependencies
* `logger`
* `statsd`

# Stats
ringpop emits stats using the `statsd` client provided to its constructor. All stats listed below are relative to a `ringpop.<hostPort>` prefix.

## Counts
These counts are emitted when:

* `full-sync` - the full membership state is disseminated during gossip
* `join.recv` - a join request is received
* `membership-update.alive` - a member becomes alive
* `membership-update.faulty` - a member becomes faulty
* `membership-update.new` - a new member is added
* `membership-update.suspect` - a member becomes suspect
* `ping.recv` - a ping is received
* `ping.send` - a ping is sent
* `ping-req.recv` - a ping-req is received
* `ping-req.send` - a ping is sent

## Gauges
These gauges represent:

* `changes.apply` - number of changes applied when disseminated during gossip
* `changes.disseminate` - number of changes to disseminate during gossip
* `checksum` - the membership checksum (recomputed after membership change)
* `max-piggyback` - max number of times a change is disseminated during gossip
* `num-members` - number of members in membership (emitted when membership is updated)

## Timers
These timers measure:

* `compute-checksum` - time it takes to compute checksum
* `ping` - response times of a ping
* `ping-req` - response times of a ping-req
* `ping-req-ping` - response times of a ping sent in response to a ping-req received
* `protocol-delay` - the expected delay of the protocol period
* `protocol-frequency` - the actual delay of the protocol period taking into account gossip response times

# API

## Properties

* `isReady` - A boolean flag used to indicate whether ringpop is ready. This property should be considered read-only.
* `joinSize` - The number of nodes that must be joined during bootstrap before ringpop is ready. This should be modified before calling bootstrap in order for the mutation to be of any use. Default is `3`.

All other properties should be considered private. Any mutation of properties not listed above will result in undefined behavior.

## Functions

* `bootstrap()` - Seeds the hash ring, joins nodes in the seed list and starts the gossip protocol
* `handleOrForward(key, handle, requestToForward, forwarded)` - Invokes the handle function if the provided key hashes to the same destination, otherwise forwards the request to that destination
* `lookup(key)` - Returns the node to which the key hashes
* `whoami()` - Returns the address of the running node

## Events

* `ready` - Ringpop is ready
* `changed` - Ring state has changed (DEPRECATED)
* `membershipChanged` - Membership state has changed for one or more members, either their status or incarnation number. A membership change may result in a ring change.
* `ringChanged` - Ring state has changed for one or more nodes: a node has been added to or removed from the cluster. All ring changes are also member changes, but not vice versa.

## Installation

`npm install ringpop`

## Tests

`npm test`

# License
ringpop is available under the MIT license. See the LICENSE file for more info.
