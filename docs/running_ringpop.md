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

|Node.js Path|Description|Type|Golang
|----|----|----|----
|changes.apply|Number of changes applied per membership update|gauge|Yes
|changes.disseminate|Number of changes disseminated per request/response|gauge|Yes
|checksum|Value of membership checksum|gauge|Yes
|compute-checksum|Time required to compute membership checksum|timer|Yes
|damp-req.recv|Damp-req request received|count|N/A
|damp-req.send|Damp-req request sent|count|N/A
|damper.damp-req.damped|Damp-req resulted in members being damped|count|N/A
|damper.damp-req.error|Damp-req resulted in an error|count|N/A
|damper.damp-req.inconclusive|Damp-req results were inconclusive|count|N/A
|damper.flapper.added|Flap damping detected a flappy node|count|N/A
|damper.flapper.removed|Flap damping removed a flappy node|count|N/A
|damper.flappers|Number of current flappers|gauge|N/A
|filtered-change|A change to be disseminated was deduped|count|Yes
|full-sync|Number of full syncs transmitted|count|Yes
|join.complete|Join process completed successfully|count|Yes
|join.failed.destroyed|Join process failed because Ringpop had been destroyed|count|Yes
|join.failed.err|Join process failed because of an error|count|Yes
|join.recv|Join request received|count|Yes
|join.retries|Number of retries required by join process|gauge|Yes
|join.succeeded|Join process succeeded|count|Yes
|join|Time required to complete join process successfully|timer|Yes
|lookup|Time required to perform a ring lookup|timer|Yes
|make-alive|A member was declared alive|count|Yes
|make-damped|A member was declared damped|count|N/A
|make-faulty|A member was declared faulty|count|Yes
|make-leave|A member was declared leave|count|Yes
|make-suspect|A member was declared suspect|count|Yes
|max-piggyback|Value of the max piggyback factor|gauge|Yes
|membership-set.alive|A member was initialized in the alive state|count|Yes
|membership-set.faulty|A member was initialized in the faulty state|count|Yes
|membership-set.leave|A member was initialized in the leave state|count|Yes
|membership-set.suspect|A member was initialized in the suspect state|count|Yes
|membership-set.unknown|A member was initialized in an unknown state|count|Yes
|membership-update.alive|A member was updated to be alive|count|Yes
|membership-update.faulty|A member was updated to be faulty|count|Yes
|membership-update.leave|A member was updated in the leave state|count|Yes
|membership-update.suspect|A member was updated to be suspect|count|Yes
|membership-update.unknown|A member was updated in the unknown state|count|Yes
|membership.checksum-computed|Membership checksum was computed|count|Yes
|not-ready.ping-req|Ping-req received before Ringpop was ready|count|Yes
|not-ready.ping|Ping received before Ringpop was ready|count|Yes
|num-members|Number of members in the membership|gauge|Yes
|ping-req-ping|Indirect ping sent|timer|Yes
|ping-req.other-members|Number of members selected for ping-req fanout| timer / count |Yes
|ping-req.recv|Ping-req request received|count|Yes
|ping-req.send|Ping-req request sent|count|Yes
|ping-req|Ping-req response time|timer|Yes
|ping.recv|Ping request received|count|Yes
|ping.send|Ping request sent|count|Yes
|ping|Ping response time|timer|Yes
|protocol.damp-req|Damp-req response time|timer|N/A
|protocol.delay|How often gossip protocol is expected to tick|timer|Yes
|protocol.frequency|How often gossip protocol actually ticks|timer|Yes
|refuted-update|A member refuted an update for itself|count|Yes
|requestProxy.checksumsDiffer|Checksums differed when a forwarded request was received|count|-
|requestProxy.egress|Request was forwarded|count|Yes
|requestProxy.inflight|Number of inflight forwarded requests|gauge|Yes
|requestProxy.ingress|Forward request was received|count|-
|requestProxy.miscount.decrement|Number of inflight requests were miscounted after decrement|count|Yes
|requestProxy.miscount.increment|Number of inflight requests were miscounted after increment|count|Yes
|requestProxy.refused.eventloop|Request was refused due to event loop lag|count|-
|requestProxy.refused.inflight|Request was refused due to number of inflight requests|count|-
|requestProxy.retry.aborted|Forwarded request retry was aborted|count|Yes
|requestProxy.retry.attempted|Forwarded request retry was attempted|count|Yes
|requestProxy.retry.failed|Forwarded request failed after retries|count|Yes
|requestProxy.retry.reroute.local|Forwarded request retry was rerouted to local node|count|Yes
|requestProxy.retry.reroute.remote|Forwarded request retry was rerouted to remote node|count|Yes
|requestProxy.retry.succeeded|Forwarded request succeeded after retries|count|Yes
|requestProxy.send.error|Forwarded request failed|count|Yes
|requestProxy.send.success|Forwarded request was successful|count|Yes
|ring.changed|Hash ring keyspace changed| gauge / count |Yes
|ring.checksum-computed|Hash ring checksum was computed|count|Yes
|ring.server-added|Node (and its points) added to hash ring|count|Yes
|ring.server-removed|Node (and its points) removed from hash ring|count|Yes
|updates|Number of membership updates applied| timer / count|Yes

## Benchmarks
Content coming soon...

## Troubleshooting
Content coming soon...
