ringpop-node release notes
==========================

10.15.0
-------

**Feature: Parition Healing**
* Partition healing implementation [#272](https://github.com/uber/ringpop-node/pull/272) [#273](https://github.com/uber/ringpop-node/pull/273)
* Refactor in preperation for partition healing [#260](https://github.com/uber/ringpop-node/pull/260) [#259](https://github.com/uber/ringpop-node/pull/259) [#258](https://github.com/uber/ringpop-node/pull/258) [#266](https://github.com/uber/ringpop-node/pull/266)
* Use a DiscoverProvider-function to discover the bootstrap hosts [#253](https://github.com/uber/ringpop-node/pull/253)
* Deprecate "admin/reload"-endpoint [#255](https://github.com/uber/ringpop-node/pull/255)

**Feature: Bi-directional full syncs [#251](https://github.com/uber/ringpop-node/pull/251)**

**Feature: Reaping Faulty Nodes after 24 hours by default**
* Reaping faulty nodes implementation [#257](https://github.com/uber/ringpop-node/pull/257)
* Add server/client middleware to patch tombstone state [#256](https://github.com/uber/ringpop-node/pull/256)
* Refactor the suspicion protocol to a generic timebased state transition. [#248](https://github.com/uber/ringpop-node/pull/248)


**Miscelanious:**
* Fix: Run tests in sub-directories of unit and integration as well [#263](https://github.com/uber/ringpop-node/pull/263)
* Fix some timers in gossip unittests [#262](https://github.com/uber/ringpop-node/pull/262)
* Run jshint on travis [#254](https://github.com/uber/ringpop-node/pull/254)
* Update licence headers [#252](https://github.com/uber/ringpop-node/pull/252)
* Run shared integration tests on Travis [#245](https://github.com/uber/ringpop-node/pull/245)

10.14.0
-------

**Feature: Partition Detection:**
* Add ring and membership checksums at stat path {membership,ring}-checksum{,-periodic} [#247](https://github.com/uber/ringpop-node/pull/247)

**Miscelanious:**
* Add travis badge to README.md [#246](https://github.com/uber/ringpop-node/pull/246)
* Update tchan to 3.6.13 [#243](https://github.com/uber/ringpop-node/pull/243)
* Update README for newbies [#240](https://github.com/uber/ringpop-node/pull/240)
