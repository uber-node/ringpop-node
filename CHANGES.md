ringpop-node release notes
==========================

10.15.0
-------

**Feature: Partition Healing**
* Partition healing implementation [#272](https://github.com/uber/ringpop-node/pull/272) [#273](https://github.com/uber/ringpop-node/pull/273)
* Refactor in preparation for partition healing [#260](https://github.com/uber/ringpop-node/pull/260) [#259](https://github.com/uber/ringpop-node/pull/259) [#258](https://github.com/uber/ringpop-node/pull/258) [#266](https://github.com/uber/ringpop-node/pull/266)
* Use a DiscoverProvider-function to discover the bootstrap hosts [#253](https://github.com/uber/ringpop-node/pull/253)
* Deprecate "admin/reload"-endpoint [#255](https://github.com/uber/ringpop-node/pull/255)

**Feature: Bi-directional full syncs [#251](https://github.com/uber/ringpop-node/pull/251)**

**Feature: Reaping Faulty Nodes after 24 hours by default**
* Reaping faulty nodes implementation [#257](https://github.com/uber/ringpop-node/pull/257)
* Add server/client middleware to patch tombstone state [#256](https://github.com/uber/ringpop-node/pull/256)
* Refactor the suspicion protocol to a generic time-based state transition. [#248](https://github.com/uber/ringpop-node/pull/248)


**Miscellaneous:**
* Fix: Run tests in sub-directories of unit and integration as well [#263](https://github.com/uber/ringpop-node/pull/263)
* Fix some timers in gossip unit tests [#262](https://github.com/uber/ringpop-node/pull/262)
* Run jshint on travis [#254](https://github.com/uber/ringpop-node/pull/254)
* Update license headers [#252](https://github.com/uber/ringpop-node/pull/252)
* Run shared integration tests on Travis [#245](https://github.com/uber/ringpop-node/pull/245)

### Release notes
**Reaping Faulty Nodes:**
We ran into a few situations where ringpop operators were alarmed by seeing a lot of faulty nodes in the membership of clusters that were actually healthy. Before this feature, faulty nodes were never removed from the membership. This means that whenever an instance of a ringpop cluster changes ip:port (e.g. by moving to another container), a new member with this ip:port is added while the member with the old ip:port becomes faulty and is never removed from the membership. This means that faulty members would accumulate over time and grow indefinitely. We introduce a feature that reaps these faulty nodes after 24 hours (by default).

**Automatic Partition Healing:**
After a long lived network partition in the order of 10 seconds, the ringpop cluster is split into two smaller cluster. When the network partition resolves, the ringpop cluster remains partitioned. Only after triggering a rolling restart we would be sure that the partitioned cluster would heal and merge again. Until now. In this version of ringpop we add automatic partition healing, this feature heals the cluster from long lived network partitions without the need of an operator/rolling restart.

**Bidirectional Full Syncs:**
Full syncs are Ringpop's anti-entropy mechanism, it guards nodes from ever being out of sync, guarantying an eventually consistent cluster. A full sync exchanges the full membership and is triggered when two nodes disagree on the membership after dissemination of all membership information. Before, only the node that discovers that the membership is out of sync, would receive the membership of the other node. With bidirectional full syncs, the membership is exchanged in both directions. This feature is important for safe automatic partition healing, preventing indefinite full syncs.

Reaping faulty nodes and Partition healing can both be triggered manually as well via `ringpop-admin heal ip:port` and `ringpop-admin reap ip:port`. This version is backwards compatible and therefore should be a drop in replacement. But don’t hesitate to reach out to us if you would like some help with upgrading. If you are upgrading please try to upgrade the entire cluster before the reaping kicks in (24 hours). When ran together with an older version for a prolonged period of time an increase in cpu and bandwidth utilization is expected.

10.14.0
-------

**Feature: Partition Detection:**
* Add ring and membership checksums at stat path {membership,ring}-checksum{,-periodic} [#247](https://github.com/uber/ringpop-node/pull/247)

**Miscelanious:**
* Add travis badge to README.md [#246](https://github.com/uber/ringpop-node/pull/246)
* Update tchan to 3.6.13 [#243](https://github.com/uber/ringpop-node/pull/243)
* Update README for newbies [#240](https://github.com/uber/ringpop-node/pull/240)


