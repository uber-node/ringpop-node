# Running Ringpop
Before we get to programming against Ringpop, let's just run it by itself and see what happens. There are several ways to accomplish this and they are documented below. There's nothing too fancy going on when Ringpop runs by itself. To reap the full potential of it, you'll need to embed it into your application and start divvying incoming requests based on the sharding key of your choice. No matter, we're here, in this section, to get a look at what happens in Ringpop at steady-state, how its membership protocol behaves and how to launch a standalone version of it from the command-line. Let's get to it!

## Running with tick-cluster
`tick-cluster` is a utility located in the `scripts/` directory of the Ringpop repo that allows you to quickly spin up a Ringpop cluster of arbitrary size and test basic failure modes: suspending, killing and respawning nodes.

To use `tick-cluster`, first clone the repo and install Ringpop's dependencies:

```
$ git clone git@github.com:uber/ringpop.git
$ npm install
```

Then run `tick-cluster`:

```
$ ./scripts/tick-cluster.js [-n size-of-cluster] [-i interpreter-that-runs-program] <ringpop-program>
```

`tick-cluster` will spawn a child process for each node in the cluster. They will bootstrap themselves using an auto-generated `hosts.json` bootstrap file and converge on a single membership list within seconds. Commands can be issued against the cluster while `tick-cluster` runs. Press `h` or `?` to see which commands are available.

Whenever it is specified, the program is run by an interpreter, otherwise the program should be a binary. The cluster size defaults to 5.

Here's a sample of the output you may see after launching a 7-node cluster with `tick-cluster`:

```
$ ./scripts/tick-cluster.js -n 7 -i node ./main.js
[init] 11:11:52.805 tick-cluster started d: debug flags, g: gossip, j: join, k: kill, K: revive all, l: sleep, p: protocol stats, q: quit, s: cluster stats, t: tick
[cluster] 11:11:52.807 using 10.80.135.224 to listen
[init] 11:11:52.818 started 7 procs: 76365, 76366, 76367, 76368, 76369, 76370, 76371
```

## Running from the command-line
Content coming soon...

## Administration
Content coming soon...

## Configuration
Content coming soon...

## Deploying
Content coming soon...

## Monitoring
Ringpop emits stats by making use of the dependency it has on a Statsd-
compatible client. It emits all stats with a prefix that includes its
identity in the stat path, e.g. `ringpop.10_30_8_26_20600.*`; the dots
and colon are replaced by underscores. The table below lists all stats
that Ringpop emits:

|Node.js Path|Description|Type
|----|----|----
|changes.apply|Number of changes applied per membership update|gauge
|changes.disseminate|Number of changes disseminated per request/response|gauge
|checksum|Value of membership checksum|gauge
|compute-checksum|Time required to compute membership checksum|timer
|damp-req.recv|Damp-req request received|count
|damp-req.send|Damp-req request sent|count
|damper.damp-req.damped|Damp-req resulted in members being damped|count
|damper.damp-req.error|Damp-req resulted in an error|count
|damper.damp-req.inconclusive|Damp-req results were inconclusive|count
|damper.flapper.added|Flap damping detected a flappy node|count
|damper.flapper.removed|Flap damping removed a flappy node|count
|damper.flappers|Number of current flappers|gauge
|dissemination.bump-bypass|Number of times piggyback count is preserved after failed ping or ping-req|count
|filtered-change|A change to be disseminated was deduped|count
|full-sync|Number of full syncs transmitted|count
|join|Time required to complete join process successfully|timer
|join.complete|Join process completed successfully|count
|join.failed.destroyed|Join process failed because Ringpop had been destroyed|count
|join.failed.err|Join process failed because of an error|count
|join.recv|Join request received|count
|join.retries|Number of retries required by join process|gauge
|join.succeeded|Join process succeeded|count
|lookup|Time required to perform a ring lookup|timer
|make-alive|A member was declared alive|count
|make-damped|A member was declared damped|count
|make-faulty|A member was declared faulty|count
|make-leave|A member was declared leave|count
|make-suspect|A member was declared suspect|count
|max-piggyback|Value of the max piggyback factor|gauge
|membership-set.alive|A member was initialized in the alive state|count
|membership-set.faulty|A member was initialized in the faulty state|count
|membership-set.leave|A member was initialized in the leave state|count
|membership-set.suspect|A member was initialized in the suspect state|count
|membership-set.unknown|A member was initialized in an unknown state|count
|membership-update.alive|A member was updated to be alive|count
|membership-update.faulty|A member was updated to be faulty|count
|membership-update.leave|A member was updated in the leave state|count
|membership-update.suspect|A member was updated to be suspect|count
|membership-update.unknown|A member was updated in the unknown state|count
|membership.checksum-computed|Membership checksum was computed|count
|not-ready.ping|Ping received before Ringpop was ready|count
|not-ready.ping-req|Ping-req received before Ringpop was ready|count
|num-members|Number of members in the membership|gauge
|ping|Ping response time|timer
|ping-req|Ping-req response time|timer
|ping-req-ping|Indirect ping sent|timer
|ping-req.other-members|Number of members selected for ping-req fanout|timer
|ping-req.recv|Ping-req request received|count
|ping-req.send|Ping-req request sent|count
|ping.recv|Ping request received|count
|ping.send|Ping request sent|count
|protocol.damp-req|Damp-req response time|timer
|protocol.delay|How often gossip protocol is expected to tick|timer
|protocol.frequency|How often gossip protocol actually ticks|timer
|refuted-update|A member refuted an update for itself|count
|requestProxy.checksumsDiffer|Checksums differed when a forwarded request was received|count
|requestProxy.egress|Request was forwarded|count
|requestProxy.inflight|Number of inflight forwarded requests|gauge
|requestProxy.ingress|Forward request was received|count
|requestProxy.miscount.decrement|Number of inflight requests were miscounted after decrement|count
|requestProxy.miscount.increment|Number of inflight requests were miscounted after increment|count
|requestProxy.refused.eventloop|Request was refused due to event loop lag|count
|requestProxy.refused.inflight|Request was refused due to number of inflight requests|count
|requestProxy.retry.aborted|Forwarded request retry was aborted|count
|requestProxy.retry.attempted|Forwarded request retry was attempted|count
|requestProxy.retry.failed|Forwarded request failed after retries|count
|requestProxy.retry.reroute.local|Forwarded request retry was rerouted to local node|count
|requestProxy.retry.reroute.remote|Forwarded request retry was rerouted to remote node|count
|requestProxy.retry.succeeded|Forwarded request succeeded after retries|count
|requestProxy.send.error|Forwarded request failed|count
|requestProxy.send.success|Forwarded request was successful|count
|ring.change|Hash ring keyspace changed|gauge
|ring.checksum-computed|Hash ring checksum was computed|count
|ring.server-added|Node (and its points) added to hash ring|count
|ring.server-removed|Node (and its points) removed from hash ring|count
|updates|Number of membership updates applied|timer

## Benchmarks
Content coming soon...

## Troubleshooting
Content coming soon...
