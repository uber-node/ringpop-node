# ringpop
Ringpop is a library that brings cooperation and coordination to applications that would otherwise run as a set of independent worker processes.

Ringpop implements a membership protocol that allows those workers to discover one another and use the communication channels established between them as a means of disseminating information, detecting failure and ultimately, converging on a consistent membership list. Consistent hashing is then applied on top of that list and gives an application the ability to define predictable behavior and data storage facilities within a custom keyspace. The keyspace is partitioned and evenly assigned to the individual instances of an application. Clients of the application remain simple and need not know of the underlying cooperation between workers nor chosen partitioning scheme. A request can be sent to any instance and Ringpop intelligently forwards the request to the "correct" instance as defined by a hash ring lookup.

With these 3 capabilities: membership protocol, consistent hashing and forwarding, Ringpop makes it possible to build extremely scalable and fault-tolerant distributed systems.

For more documentation, go to the [wiki](https://github.com/uber/ringpop/wiki).

# Installation

`npm install ringpop`

## Tests

`npm test`

# License
ringpop is available under the MIT license. See the LICENSE file for more info.
