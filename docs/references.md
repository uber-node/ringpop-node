# References

Learn more about key concepts related to Ringpop.

## FAQ

## Glossary

### A 
- **Actor model**: Concurrent computation model used by Ringpop that allows messages to arrive concurrently, then processed one by one. Messages are placed in a mailbox based on the sharding key, and then processed one by one. Each request that’s processed one by one may result in some other request to another service, or a request for more actors to be spun up.
Alive: A membership status signifying the node is healthy, and not suspect, faulty, or damped.

### B  

- **Bad actor**: A slow node that’s overwhelmed by traffic.

### C 

- **Cluster**:

### D 

- **Damped**: Flap damping is a technique used to identify and evict bad nodes from a cluster. Flaps are detected by storing membership update history and penalize nodes when flap is detected. When the penalty exceeds a specified suppress limit, the node is damped. The damped status is disseminated throughout the cluster and removed from the ring. 
- **Down list**:

### E 

### F 

- **Flap damping**: Flap damping is a technique used to identify and evict bad nodes from a cluster.
= **FarmHash**: Hashing function used by Ringpop. 
- **Faulty**: A state of the node that is reached after a defined “suspect” period, where a node is unstable or not responding to pings from other nodes. A suspect period will begin, and if it ends with the node not recovering, the node is considered faulty and is removed from the ring.

### G 

- **Gossip**: A type of protocol where nodes disseminate information about each other using pings.

### H 

- **Handle or forward**: This is Ringpop’s forwarding approach. If a key hashes to an instance that is not the one that received the request, then that request is simply forwarded to the proper instance and everything is taken care of under the hood. This acts like a middleware layer for applications that before the request even gets to your business logic, it is already routed to the appropriate node.
- **Hash ring**: Ringpop leverages consistent hashing to minimize the number of keys to rebalance when your application cluster is resized. Ringpop’s consistent hashing allows the nodes to rebalance themselves and evenly distribute traffic. Ringpop maintains a consistent hash ring of its members. Once members are discovered to join or leave the cluster, that information is added into the consistent hash ring. Then the instances’ addresses along that ring are hashed.

### I 

### J 

### K 

### L 

### M 

- **Membership list**: Ringpop uses a variation of SWIM to disseminate membership updates across the members of a membership list, which contains additional metadata like the incarnation number, instances’ addresses, and status (alive, suspect, faulty, etc.). Members ping each other in random fashion until they get through the full membership list, rotate the list, then repeat the full round of pinging.
- **Multi-cast**:

### N

- **Node**:

### O

### P

- **Ping**: Ringpop uses pings to disseminate information and for fault detection. Members ping each other in random fashion until they get through the full membership list, rotate the list, then repeat the full round of pinging.
- **Ping-req**:

### Q

### R

- **Replica points**: Ringpop adds a uniform number of replica points per node to spread the nodes around the ring for a more even distribution. Ringpop also adds a uniform number of replica points so the nodes and the hosts running these nodes are treated as homogeneous.
- **Ringpop**: Ringpop is a library that brings application-layer sharding to your services, partitioning data in a way that’s reliable, scalable and fault tolerant.
- **Ringpop forwarding**:

### S

- **SERF**: Gossip-based membership that exchanges messages to quickly and efficiently communicate with nodes.
- **Sharding**: A way of partitioning data, which Ringpop does at the application layer of your services in a way that’s reliable, scalable and fault tolerant.
- **Suspect**: A state of the node where it is unstable or not responding to pings from other nodes. If nodes stay suspect during the pre-defined suspect period without recovering, it will then be considered faulty and removed from the ring.
- **SWIM**: Scalable Weakly-consistent Infection-style Process Group Membership Protocol

### T 

- **TChannel**: TChannel is a network multiplexing and framing protocol for RPC. TChannel is the transport of choice for Ringpop’s proxying channel.

### V 

### W 

### X 

### Y 

### Z 

## Use Cases

## Papers

- [BGP Route Flap Damping](http://www2.ensc.sfu.ca/~ljilja/cnl/pdf/steve_thesis.pdf)
- [Dynamo: Amazon’s Highly Available Key-value Store](http://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)
- [Efficient Reconciliation and Flow Control for Anti-Entropy Protocols](http://www.cs.cornell.edu/home/rvr/papers/flowgossip.pdf)
- [Epidemic Broadcast Trees](http://www.gsd.inesc-id.pt/~jleitao/pdf/srds07-leitao.pdf)
- [FarmHash](https://code.google.com/p/farmhash/)
- [Riak](http://basho.com/riak/)
- [SWIM Presentation Slides by Armon Dadgar from Hashicorp](https://speakerd.s3.amazonaws.com/presentations/5d140b302fbf01327e4e42c106afd3ef/2014-SWIM.pdf)
- [SWIM: Scalable Weakly-consistent Infection-style Process Group Membership Protocol](http://www.cs.cornell.edu/~asdas/research/dsn02-swim.pdf)
- [TChannel](https://github.com/uber/tchannel)
- [The ϕ Accrual Failure Detector](http://ddg.jaist.ac.jp/pub/HDY+04.pdf)
- [Time, Clocks, and the Ordering of Events in a Distributed System](http://web.stanford.edu/class/cs240/readings/lamport.pdf)


## Presentations
