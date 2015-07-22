# Getting Started
Start here to learn about Ringpop and how to install it.

## What is Ringpop?
Ringpop is a library that brings cooperation and coordination to applications that would otherwise run as a set of independent worker processes.

Ringpop implements a membership protocol that allows those workers to discover one another and use the communication channels established between them as a means of disseminating information, detecting failure, and ultimately converging on a consistent membership list. Consistent hashing is then applied on top of that list and gives an application the ability to define predictable behavior and data storage facilities within a custom keyspace. The keyspace is partitioned and evenly assigned to the individual instances of an application. Clients of the application remain simple and need not know of the underlying cooperation between workers nor chosen partitioning scheme. A Request can be sent to any instance, and Ringpop intelligently forwards the request to the “correct” instance as defined by a hash ring lookup.

Ringpop makes it possible to build extremely scalable and fault-tolerant distributed systems with 3 main capabilities: membership protocol, consistent hashing, and forwarding.

## Why use Ringpop?
Ringpop is a library that brings application-layer sharding to your services, partitioning data in a way that is fault-tolerant and scalable. Ringpop offers availability over consistency, and massive scaling capability for architectures with realtime, highly transactional and volatile data.

Ringpop delivers resiliency to your services for complex and scaling architectures while keeping operational overhead low. Traditional environments have a number of stateless servers connected to a database that stores state information. With Ringpop, state is not stored in the database; servers hold the state in memory.

Typically, sharding is client aware. With Ringpop, sharding is client agnostic, and done under the covers by providing a simple hash ring abstraction. Ringpop introduces sharding into the application layer rather than the data store, allowing for a highly available, high performant and scalable infrastructure with systems that are self-healing. Ringpop allows applications to distribute state, maintaining a hash ring of each service instance in an application cluster. It automatically detects failures and other changes to the state of the ring through the SWIM gossip protocol. Any added capacity is easily integrated into an existing Ringpop cluster, and traffic gets evenly distributed over the new capacity, helping to avoid downtime.

## Installation
`npm install ringpop`
