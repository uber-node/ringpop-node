# Architecture, Design and Implementation

## Concepts

### Membership Protocol
Ringpop implements a membership protocol that allows nodes to discover one another, disseminate information quickly, and maintain a consistent view across nodes within your application cluster. Ringpop uses a variation of the gossip protocol known as SWIM (Scalable Weakly-consistent Infection-style Process Group Membership Protocol) to disseminate membership updates across the many members of the membership list. Changes within the cluster are detected and disseminated over this protocol to all other nodes.

Ringpop uses SWIM gossip protocol mechanisms of “ping” and “ping-req”. Pings are used for disseminating information and fault detection. Members ping each other in random fashion until they get through the full membership list, rotate the list, then repeat the full round of pinging.

####SWIM Gossip Protocol for Information Dissemination
Let’s say you have a cluster with two nodes: A and B. A is pinging B and B is pinging A. Then a third node, C, joins the cluster after pinging B. At this point B knows about C, but A does not. The next time B pings A, it will disseminate the knowledge that C is now part of the cluster. This is the information dissemination aspect of the SWIM gossip protocol.
####SWIM Gossip Protocol for Fault Detection
Ringpop gossips over TCP for its forwarding mechanism. Nodes within the ring/membership list are gossiping and forwarding requests over the same channels. For fault detection, Ringpop computes membership and ring checksums.

A membership list contains instances’ addresses and statuses (alive, suspect, faulty, etc.). It also contains additional metadata like the incarnation number, which is the logical clock. All this information is combined and we compute a checksum from it. 

The checksums detect a divergence in the cluster in the event a request is forwarded, or a ping occurs and the source and destinations checksums differ. Then the divergence is detected that needs to be rectified.

Ringpop retains members that are “down” in its membership list. SWIM manages membership status by removing down members from the list, whereas Ringpop keeps down members in the list allowing the ability to merge a split-brain after a network partition. For example, let’s say two clusters form your application. If there isn’t a way to identify which nodes were previously faulty or down because the network partition happened during that time, there would be no way to merge them back together.

### Consistent Hashing
Ringpop leverages consistent hashing to minimize the number of keys to rebalance when your application cluster is resized. Consistent hashing in Ringpop allows the nodes to rebalance themselves, and traffic is evenly distributed. Ringpop uses FarmHash as its hashing function because it is fast and provides good distribution. Consistent hashing applies a hash function to not only the identity of your data, but also the nodes within your cluster that are operating on that data.

Ringpop maintains a consistent hash ring of its members. Once members are discovered to join or leave the cluster, that information is added into the consistent hash ring. Then the instances’ addresses along that ring are hashed, giving a particular part about of the key space over to that instance for the time it is alive and operating.

Ringpop uses a red-black tree to implement its underlying data structure for its ring which provides log n, lookups, inserts, and removals. 

Ringpop adds a uniform number of replica points per node. To spread the nodes around the ring for a more even distribution, replica points are added for every node within the ring. It also adds a uniform number of replica points so the nodes and the hosts running these nodes are treated as homogeneous.

### Forwarding

## How Ringpop Works

### Joining a Cluster

### Handle or Forward

### Node Statuses

### Flap Damping

### Full Syncing

### TChannel

## Extensions

### Sharding

### Actor Model

### Replication

### Reliable Background Operations

### Leader Election
