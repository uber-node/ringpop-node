# ringpop
ringpop brings application-layer sharding to your services in a fault tolerant and scalable manner. It is an embeddable server that reliably partitions your data, detects node failures and easily integrates new nodes into your application cluster when they become available. For more information about the techniques applied within ringpop, see the Concepts section below.

# Table of Contents
* [Motivation](#motivation)
* [Concepts](#concepts)
* [Developer's Guide](#developers-guide)
* [Operator's Guide](#operators-guide)
* [Community](#community)
* [References](#references)
* [Installation](#installation)

# Motivation
As an organization's architecture grows in complexity engineers must find a way to make their services more resilient while keeping operational overhead low. ringpop is a step in that direction and an effort to generalize the sharding needs of various services by providing a simple hash ring abstraction. We've found that the use cases to which ringpop can be applied are numerous and that new ones are discovered often.

# Concepts
ringpop makes use of several techniques to provide applications with a seamless sharding story.

## Gossip
ringpop implements the SWIM gossip protocol (with minor variations) to maintain a consistent view across nodes within your application cluster. Changes within the cluster are detected and disseminated over this protocol to all other nodes.

## Consistent Hashing
ringpop leverages consistent hashing to minimize the number of keys that need to be rebalanced when your application cluster is resized. It uses farmhash as its hashing function because it is fast and provides good distribution.

## Proxying
ringpop offers proxying as a convenience. You may use ringpop to route your application's requests.

## tchannel
TChannel is the transport of choice for ringpop's gossip and proxying capabilities. For more information about tchannel, go here: https://github.com/uber/tchannel.

# Developer's Guide
As a developer, you'll want to know how to plug ringpop into your application. The sections below may make this easier for you:

## Table of Contents
* [API](#api)
* [Code Walkthrough](#code-walkthrough)

## API
ringpop provides a straight-forward and minimal API for application developers. The properties, functions and events part of its public interface are documented below. Anything not documented should be considered to result in undefined behavior.

**Properties**
* `isReady` - A boolean flag used to indicate whether ringpop is ready. This property should be considered read-only.
* `joinSize` - The number of nodes that must be joined during bootstrap before ringpop is ready. This should be modified before calling bootstrap in order for the mutation to be of any use. Default is `3`.
* `requestProxyMaxRetries` - Maximum number of retries attempted when ringpop proxies a request to an alternative destination
* `requestProxyRetrySchedule` - An array of numbers used as a multiple of the amount of milliseconds to delay before the next retry

All other properties should be considered private. Any mutation of properties not listed above will result in undefined behavior.

**Functions**
* `bootstrap(bootstrapFileOrHosts, callback)` - Seeds the hash ring, joins nodes in the seed list and starts the gossip protocol
* `handleOrProxy(key, req, res, opts)` - Returns `true` if the key hashes to the same instance of ringpop, otherwise, returns `false` and proxies `req` to the node to which the keys hashes
* `lookup(key)` - Returns the node to which the key hashes
* `whoami()` - Returns the address of the running node

**Events**
* `ready` - ringpop has been bootstrapped
* `changed` - ring or membership state is changed (DEPRECATED)
* `lookup` - A key has been looked up. A single argument is provided to the listener which takes the shape: `{ timing: Number }`
* `membershipChanged` - membership state has changed (status or incarnation number). A membership change may result in a ring change.
* `requestProxy.checksumsDiffer` - a proxied request arrives at its destination and source/destination checksums differ
* `requestProxy.requestProxied` - a request is sent over the proxy channel
* `requestProxy.retryAborted` - a retry is aborted before attempted
* `requestProxy.retryAttempted` - a scheduled retry expires and a retry is attempted
* `requestProxy.retryRerouted` - a retry is rerouted to another destination
* `requestProxy.retryScheduled` - a retry is scheduled, but not yet attempted
* `requestProxy.retrySucceeded` - a request that is retried succeeds
* `requestProxy.retryFailed` - a request is retried up to the maximum number of retries and fails
* `ringChanged` - ring state has changed for one or more nodes either having joined or left the cluster. All ring changes are member changes, but not vice versa.
* `ringChecksumComputed` - the hash ring's checksum was computed
* `ringServerAdded` - a server was added to the ring
* `ringServerRemoved` - a server was removed to the ring

## Code Walkthrough
Instantiate ringpop by providing it the title and listening address of your application. It's important to note that the listening address of your ringpop instance is also used as a globally unique identifier for the instance within the ring. Therefore, make sure `hostPort` is unique.

```javascript
var ringpop = new RingPop({
    app: 'myapp',
    hostPort: 'myhost:30000'
});
```

Then bootstrap ringpop. ringpop will use the bootstrap hosts array or file path you provide it as the seed list for joining an existing cluster:

```javascript
ringpop.bootstrap(bootstrapHostsOrFile, function onBootstrapped(err, nodesJoined) {
    // bootstrap completed, failed or timed-out
});
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

The state of the hash ring will change when nodes join, leave, fail or are revived. When ringpop detects a change, it will emit a `ringChanged` event, a `membershipChanged` event or both. A `ringChanged` event will be emitted when the number of nodes in the consistent hash ring changes. This type of change usually leads to some keys being rebalanced. A `membershipChanged` event is finer-grained and emitted whenever a member's status or incarnation number is updated. This may or not affect the underlying ring keyspace. You may be interested in one or all of these events depending upon your use case.

```javascript
ringpop.on('membershipChanged', function onMembershipChanged() {
    // do something interesting
});

ringpop.on('ringChanged', function onRingChanged() {
    // do something interesting
});
```

# Operator's Guide
As an operator, you'll want to know how to configure and monitor ringpop in production. Below are some of the ways to help you achieve unparalleled operational mastery:

## Stats
ringpop emits stats using the `statsd` client provided to its constructor. All stats listed below are relative to a `ringpop.<hostPort>` prefix.

**Counts**
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
* `requestProxy.retry.aborted` - a proxied request retry is aborted
* `requestProxy.retry.attempted` - a proxied request retry is attempted
* `requestProxy.retry.failed` - a proxied request is retried up to the maximum number of retries and fails
* `requestProxy.retry.reroute.local` - a proxied request is rerouted to a local handler
* `requestProxy.retry.reroute.remote` - a proxied request is rerouted to a remote node
* `requestProxy.retry.succeeded` - a proxied request is retried and succeeds

**Gauges**
* `changes.apply` - number of changes applied when disseminated during gossip
* `changes.disseminate` - number of changes to disseminate during gossip
* `checksum` - the membership checksum (recomputed after membership change)
* `max-piggyback` - max number of times a change is disseminated during gossip
* `num-members` - number of members in membership (emitted when membership is updated)

**Timers**
* `compute-checksum` - time it takes to compute checksum
* `ping` - response times of a ping
* `ping-req` - response times of a ping-req
* `ping-req-ping` - response times of a ping sent in response to a ping-req received
* `protocol-delay` - the expected delay of the protocol period
* `protocol-frequency` - the actual delay of the protocol period taking into account gossip response times

# Community
ringpop is highly extensible and may lead to a multitude of extensions and tooling built around it. The following is a list of libraries that extend ringpop:

* [sevnup](https://github.com/uber/sevnup) - A vnode abstraction built atop key lookups to help you reliably resume operations on nodes other than the ones that started them.

# Miscellaneous

## More about request proxying
ringpop provides request routing as a convenience. When a request arrives at your services' public endpoints, you'll want to use ringpop to decide whether request processing should take place on the node that received the request or elsewhere. If elsewhere, ringpop will proxy your request to the correct destination.

Upon arrival of a proxied request at its destination, membership checksums of the sender and receiver will be compared. The request will be refused if checksums differ. Mismatches are to be expected when nodes are entering or exiting the cluster due to deploys, added/removed capacity or failures. The cluster will eventually converge on one membership checksum, therefore, refused requests are best handled by retrying them.

ringpop's request proxy has retries built in and can be tuned using 2 parameters provided at the time ringpop is instantiated: `requestProxyMaxRetries` and `requestProxyRetrySchedule` or per-request with: `maxRetries` and `retrySchedule`. The first parameter is an integer representing the number of times a particular request is retried. The second parameter is an array of integer or floating point values representing the delay in between consecutive retries.

ringpop has codified the aforementioned routing pattern in the `handleOrProxy` function. It returns true when `key` hashes to the "current" node and false otherwise. `false` results in the request being proxied to the correct destination. Its usage looks like this:

```js
var opts = {
    maxRetries: 3,
    retrySchedule: [0, 0.5, 2]
};

if (ringpop.handleOrProxy(key, req, res, opts)) {
    // handle request
}
```

# References
There has been a variety of literature that have helped inform the implementation of and planned work for ringpop. We hope you find the below material helpful too:

* [Dynamo: Amazon’s Highly Available Key-value Store](http://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)
* [Efficient Reconciliation and Flow Control for Anti-Entropy Protocols](http://www.cs.cornell.edu/home/rvr/papers/flowgossip.pdf)
* [Epidemic Broadcast Trees](http://www.gsd.inesc-id.pt/~jleitao/pdf/srds07-leitao.pdf)
* [The ϕ Accrual Failure Detector](http://ddg.jaist.ac.jp/pub/HDY+04.pdf)
* [Time, Clocks, and the Ordering of Events in a Distributed System](http://web.stanford.edu/class/cs240/readings/lamport.pdf)
* [SWIM Presentation Slides by Armon Dadgar from Hashicorp](https://speakerd.s3.amazonaws.com/presentations/5d140b302fbf01327e4e42c106afd3ef/2014-SWIM.pdf)
* [SWIM: Scalable Weakly-consistent Infection-style Process Group Membership Protocol](https://www.cs.cornell.edu/~asdas/research/dsn02-swim.pdf)

# Installation

`npm install ringpop`

## Tests

`npm test`

# License
ringpop is available under the MIT license. See the LICENSE file for more info.
