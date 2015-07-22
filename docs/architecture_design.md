# Architecture, Design, and Implementation

## Concepts

### Membership Protocol
Ringpop implements a membership protocol that allows nodes to discover one another, disseminate information quickly, and maintain a consistent view across nodes within your application cluster. Ringpop uses a variation of the gossip protocol known as SWIM (Scalable Weakly-consistent [Infection-style](http://www.cs.cornell.edu/~asdas/research/dsn02-swim.pdf) Process Group Membership Protocol) to disseminate membership updates across the many members of the membership list. Changes within the cluster are detected and disseminated over this protocol to all other nodes.

Ringpop uses the SWIM gossip protocol mechanisms of “ping” and “ping-req”. Pings are used for disseminating information and fault detection. Members ping each other in random fashion until they get through the full membership list, rotate the list, then repeat the full round of pinging.

####SWIM Gossip Protocol for Information Dissemination
Let’s say you have a cluster with two nodes: A and B. A is pinging B and B is pinging A. Then a third node, C, joins the cluster after pinging B. At this point B knows about C, but A does not. The next time B pings A, it will disseminate the knowledge that C is now part of the cluster. This is the information dissemination aspect of the SWIM gossip protocol.
####SWIM Gossip Protocol for Fault Detection
Ringpop gossips over TCP for its forwarding mechanism. Nodes within the ring/membership list are gossiping and forwarding requests over the same channels. For fault detection, Ringpop computes membership and ring checksums.

A membership list contains the addresses and statuses (alive, suspect, faulty, etc.) of the instances. It also contains additional metadata like the incarnation number, which is the logical clock. All this information is combined and we compute a checksum from it. 

The checksums detect a divergence in the cluster in the event a request is forwarded, or a ping occurs, and the source and destinations checksums differ.

Ringpop retains members that are “down” in its membership list. SWIM manages membership status by removing down members from the list, whereas Ringpop keeps down members in the list allowing the ability to merge a split-brain after a network partition. For example, let’s say two clusters form your application. If there isn’t a way to identify which nodes were previously faulty or down because the network partition happened during that time, there would be no way to merge them back together.

### Consistent Hashing
Ringpop leverages consistent hashing to minimize the number of keys to rebalance when your application cluster is resized. Consistent hashing in Ringpop allows the nodes to rebalance themselves with traffic evenly distributed. Ringpop uses [FarmHash](https://code.google.com/p/farmhash/) as its hashing function because it's fast and provides good distribution. Consistent hashing applies a hash function to not only the identity of your data, but also the nodes within your cluster that are operating on that data. Ringpop uses a red-black tree to implement its underlying data structure for its ring which provides log n, lookups, inserts, and removals. 

Ringpop maintains a consistent hash ring of its members. Once members are discovered to join or leave the cluster, that information is added into the consistent hash ring. Then the addresses of the instances in the ring are hashed.

Ringpop adds a uniform number of replica points per node. To spread the nodes around the ring for a more even distribution, replica points are added for every node within the ring. It also adds a uniform number of replica points so the nodes and the hosts running these nodes are treated as homogeneous.

### Forwarding

Ringpop offers proxying as a convenience and can be used to route your application's requests. Traffic through your application is probably directed toward a particular entity in your system like an object with an id. That id belongs somewhere in your cluster on a particular instance, depending on how it hashes. If the key hashes to an instance that did not receive the request, then that request is simply forwarded and everything is taken care of under the hood. This acts like a middleware layer for applications. Before the request even gets to your business logic, it is already routed to the appropriate node.

Ringpop has codified a handle or forward pattern. If a key arriving at instance A hashes to the node, it can process it, otherwise, it forwards it. This information is forwarded using a protocol called [TChannel](https://github.com/uber/tchannel). TChannel is a networking framing protocol developed by Uber, used for general RPC. Ringpop uses TChannel as its proxying channel and transport of choice. It supports out-of-order responses at extremely high performance with benchmarks ranging from 20,000 to 40,000 operations per second.

Ringpop packs forwarded requests as HTTP over TChannel. HTTP is packed into the message that's transported over TChannel when it's forwarded, and then reconstructed on the other side.

#### Forwarding Requests

As an example, let's say node C joins a ring and now all of the addresses and replica points are evenly distributed around the ring. A, B, and C are pinging one another. The handle or forward pattern peforms a `ringpop.lookup`, gives it the sharding key and gets a destination back. If the destination resolves to A, then A can handle the request; otherwise it forwards it over TChannel transport to its destination.

**Note**: Eventually, this process will be moved to a Thrift model instead of HTTP.

## How Ringpop Works

### Joining a Cluster

1. The first node, A, checks a bootstrap list and finds that no other nodes are running.
2. Next, B starts up and has A to join. B reads the file from disk, then selects a random number of members. It will find A and start to form a consistent hash ring in the background, running within memory in Ringpop.
3. The nodes are positioned along the ring and exchange information with one another, forming a two-node cluster and pinging each other back and forth.

### Handle or Forward
Upon arrival of a proxied request at its destination, membership checksums of the sender and receiver will be compared. The request will be refused if checksums differ. Mismatches are expected when nodes are entering or exiting the cluster due to deploys, added/removed capacity, or failures. The cluster will eventually converge on one membership checksum, therefore refused requests are best handled by retrying them.

Ringpop's request proxy has retries built in and can be tuned using two parameters provided at the time Ringpop is instantiated: `requestProxyMaxRetries` and `requestProxyRetrySchedule` or per-request with: `maxRetries` and `retrySchedule`. The first parameter is an integer representing the number of times a particular request is retried. The second parameter is an array of integer or floating point values representing the delay in-between consecutive retries.

Ringpop has codified the aforementioned routing pattern in the `handleOrProxy` function:
- returns `true` when key hashes to the "current" node and `false` otherwise.
- returns `false` and results in the request being proxied to the correct destination. Its usage looks like this:

```javascript
var opts = {
    maxRetries: 3,
    retrySchedule: [0, 0.5, 2]
};

if (ringpop.handleOrProxy(key, req, res, opts)) {
    // handle request
}
```

### Node Statuses

### Flap Damping
Flap damping is a technique used to identify and evict bad nodes from a cluster. We detect flaps by storing membership update history and penalize nodes when flap is detected. When the penalty exceeds a specified suppress limit, the node is damped. When things go wrong and nodes are removed from the hash ring, you may see a lot of shaky lookups.

As an example, let's say A pings B, and B responds. Then, in the next round of the protocol, A pings B again but this time B is down. Then in the next round, A pings B, but this time B is up again. If there's a bad actor (a slow node that's overwhelmed by traffic), it's going to act erratically. So we want to evict it from the cluster as quickly as possible. The pattern of deviations between alive and suspect/faulty are known as flaps.

We detect flaps by storing the disseminated membership updates as part of the SWIM gossip protocol. When we detect a flap, we penalize the bad actor. Every node stores a penalty for every other node in the cluster. For example, A's view of B is different than C's view of B. When the penalty exceeds a certain suppression limit, that node is damped. That damped status is disseminated throughout the cluster and removed from the ring. It is evicted and penalized so that it cannot join the ring for a specified period of time.

If the damp score goes down and then decays, the problem is fixed and it will not be penalized and evicted from that ring. But if excessive flap exceeds the red line (damping threshold), then a damping sub-protocol is enacted similar to the indirect pinging sub-protocol defined by SWIM.

Say the damp score for B exceeds the red line. A fans out a damp-req request to _k_ random members and asks for their damp score of B. If they also communicate that B is flapping, then B is considered damped due to excessive flapping. A marks B as damped, and disseminates that information using the gossip protocol.

### Full Syncing

### TChannel

TChannel is a network multiplexing and framing protocol for RPC. Some of the characteristics of TChannel:
- Easy to implement in multiple languages, especially JavaScript and Python.
- High performance forwarding path. Intermediaries can make a forwarding decision quickly.
- Request/response model with out-of-order responses. Slow request will not block subsequent faster requests at head of line.
- Large requests/responses may/must be broken into fragments to be sent progressively.
- Optional checksums.
- Can be used to transport multiple protocols between endpoints, e.g., HTTP + JSON and Thrift

#### Components
- [tchannel-node](https://github.com/uber/tchannel/tree/master/node): TChannel peer library for Node.js.
- [tchannel-python](https://github.com/uber/tchannel/tree/master/python): TChannel peer library for Python.
- [tchannel-golang](https://github.com/uber/tchannel/tree/master/golang): TChannel peer library for Go.
- [tcap](https://github.com/uber/tcap/): TChannel packet capture tool, for eavesdropping and inspecting TChannel traffic.
- [bufrw](https://github.com/uber/bufrw/): Node.js buffer structured reading and writing library, used for TChannel and [Thrift](https://thrift.apache.org/).
- [thriftrw](https://github.com/uber/thriftrw): Node.js [Thrift](https://thrift.apache.org/) buffer reader and writer.
- [thriftify](https://github.com/uber/thriftify): Node.js [Thrift](https://thrift.apache.org/) object serializer and deserializer with run-time Thrift IDL compiler.

## Extensions

Ringpop is highly extensible and makes possible for a multitude of extensions and tooling built around it. Here are the libraries that extend Ringpop.

### Sharding

### Actor Model

Every actor in the system has a home (a node in the cluster). That node receives concurrent requests for every actor. For every actor, there is a mailbox. Requests get pulled off the mailbox one by one. Processing a request may result in new requests being sent or new actors being created. Each request that's processed one by one may result in some other request to another service, or a request for more actors to be spun up. 

### Replication

Building Redundancy with Ringpop.

#### Reliable Background Operations

#### Leader Election
