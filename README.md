# ringpop
Ringpop is a library that brings cooperation and coordination to an application.

Often applications are deployed and run as a cluster of discrete worker processes. Ringpop implements a membership protocol that allows those workers to discover one another and use the communication channels established between them as a means of disseminating information, detecting failure and ultimately, converging on a consistent membership view.

Ringpop adds consistent hashing to its membership protocol implementation. This allows an application to define predictable behavior and data storage facilities on top of a custom keyspace. The keyspace is divided into partitions each of which is evenly assigned to application instances.

Clients of applications that embed Ringpop remain simple and need not know of the underlying cooperative workers nor chosen sharding scheme. A request can be sent to any instance and Ringpop intelligently forwards the request to the “correct” instance as defined by a hash ring lookup.

With these 3 capabilities: membership protocol, consistent hashing and forwarding, Ringpop makes it possible to build extremely scalable and fault-tolerant distributed systems.

For more documentation, go to the [wiki](https://github.com/uber/ringpop/wiki).

# Installation

`npm install ringpop`

## Tests

`npm test`

# License
ringpop is available under the MIT license. See the LICENSE file for more info.
