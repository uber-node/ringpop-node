# Getting Started
If you're looking for more information about what Ringpop is all about and how it might be able to help, you've come to the right place. Let's begin by digging deeper into Ringpop and why you'd want to use it.

## What is Ringpop?
As we've stated in the introduction, Ringpop is a library that maintains a consistent hash ring and can be used to arbitrarily shard the data in your application in a way that's adaptable to capacity changes and resilient to failure.

Ringpop is best described by introducing its 3 core features: a membership protocol, a consistent hash ring and request forwarding. You can find more information about each of these in the Architecture and Design section. For the impatient, its membership protocol provides a distributed application, whose instances were once completely unaware of one another, with discovery capabilities and the ability to self-organize and cooperate. They communicate and share information with one another and come to an agreement, or converge, on whom the participating instances, or members, are of the distributed application.

With a consistent view, Ringpop arranges the members along a hash ring, divides up the integer keyspace into partitions and assigns ownership of the partitions to the individual instances of your application. It then projects a keyspace of your choosing, say the ID range of the objects in your application, onto that same ring and resolves an owner to each ID. The underlying membership protocol is resilient to the failures of your application by automatically reassigning ownership, also know as rebalancing, to the surviving instances.

Requests that your application serves, be it ones that create new objects, update or read or delete existing ones, may be sent to any instance. Ringpop intelligently routes the request to its owner based upon a lookup of the sharding key, for example the object's ID, against the hash ring. If the key resolves to the instance that received the original request, then Ringpop delegates request handling to it, otherwise it will forward the request to the owner.

What you as an application developer choose to do with these building blocks is entirely up to you. It may lead you to build an ultra scalable and highly available database, an actor model system, systems that are capable of electing a leader and delegating work to it, a request coalescing proxy, general purpose application-layer caches and much more. If you find some cool new ways to leverage Ringpop, let us know!

## Why use Ringpop?
Ringpop is a library that brings application-layer sharding to your services, partitioning data in a way that is fault-tolerant and scalable. Ringpop offers availability over consistency, and massive scaling capability for architectures with realtime, highly transactional and volatile data.

Ringpop delivers resiliency to your services for complex and scaling architectures while keeping operational overhead low. Traditional environments have a number of stateless servers connected to a database that stores state information. With Ringpop, state is not stored in the database; servers hold the state in memory.

Typically, sharding is client aware. With Ringpop, sharding is client agnostic, and done under the covers by providing a simple hash ring abstraction. Ringpop introduces sharding into the application layer rather than the data store, allowing for a highly available, high performant and scalable infrastructure with systems that are self-healing. Ringpop allows applications to distribute state, maintaining a hash ring of each service instance in an application cluster. It automatically detects failures and other changes to the state of the ring through the SWIM gossip protocol. Any added capacity is easily integrated into an existing Ringpop cluster, and traffic gets evenly distributed over the new capacity, helping to avoid downtime.

## Installation
`npm install ringpop`
