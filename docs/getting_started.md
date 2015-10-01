# Getting Started
If you're looking for more information about what Ringpop is all about and how it might be able to help, you've come to the right place. Let's begin by digging deeper into Ringpop and why you'd want to use it.

## What is Ringpop?
As we've stated in the introduction, Ringpop is a library that maintains a consistent hash ring and can be used to arbitrarily shard the data in your application in a way that's adaptable to capacity changes and resilient to failure.

Ringpop is best described by introducing its 3 core features: a membership protocol, a consistent hash ring and request forwarding. You can find more information about each of these in the Architecture and Design section. For the eager reader, its membership protocol provides a distributed application, whose instances were once completely unaware of one another, with the ability to discover one another, self-organize and cooperate. The instances communicate over a TCP backchannel and pass information between them in an infection-style manner. Enough information is shared to allow these instances to come to an agreement, or converge, on whom the participating instances, or members, are of the distributed application.

With a consistent membership view, Ringpop arranges the members along a consistent hash ring, divides up the integer keyspace into partitions and assigns ownership of the partitions to the individual instances of your application. It then projects a keyspace of your choosing, say the ID range of the objects in your application, onto that same ring and resolves an owner for each ID. In the face of failure, the underlying membership protocol is resilient and automatically reassigns ownership, also known as rebalancing, to the surviving instances.

Requests that your application serves, be it ones that create new objects, update or read or delete existing ones, may be sent to any instance. Each Ringpop instance is equipped to route the request to the correct owner should the shard key, for example the object's ID, resolve to an instance that is not the one that received the original request.

By maintaining a consistent hash ring based upon the information that is collected by its membership protocol and offering request forwarding as a routing convenience, Ringpop provides some very powerful and cool building blocks. What you as an application developer choose to do with these building blocks is entirely up to you. It may lead you to build an ultra scalable and highly available database, an actor model system, systems that are capable of electing a leader and delegating work to it, a request coalescing proxy, general purpose application-layer caches and much more. If you find some cool new ways to leverage Ringpop, let us know!

## Why use Ringpop?
Ringpop is first and foremost an application developer's library. It is not an external system nor a shared infrastructure resource used by many applications. It allows your application to remain autonomous and not beholden to a dependency for its ability to scale and remain available. Ringpop promotes scalability and fault tolerance as an application layer concern while keeping complexity and operational overhead to a minimum. Application developers have to be aware how their data is distributed, what makes that data available and how their application degrades in the face of failure. When using Ringpop you are sacrificing consistency for higher availability and one must take into consideration how even higher degrees of availability are achieved through techniques like replication and application-side conflict resolution. We've found that taking ownership of your application to such a degree is not only empowering, but a very sustainable and scalable practice.

Clients of your application can remain completely unaware that Ringpop is being used. They neither have to understand the underlying partitioning scheme nor who the correct recipient is for a request. There is no special technology that need exist between client and server. You may use load balancers, proxies, overlay networks, etc without fear of Ringpop incompatibilities.

Ringpop offers a rich administration API to inspect and control your cooperative application and easy to use tooling to help you understand the behavior of Ringpop and your application.

Lastly, Ringpop's sharding capabilities are just one application of what we see as a collection of composable distributed systems programming building blocks. We typically want our applications to be more cooperative when something needs to be made more efficient at a large scale or a resource in your system has to have a particular home or rendezvous point. We discover new ways to use Ringpop all the time and you'll likely run into a few interesting ways too.

## Installation
`npm install ringpop`
