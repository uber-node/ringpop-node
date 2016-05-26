ringpop-node release notes
==========================

10.15.0
-------

* Feature: Automatic partition detection and recovery
 [#272](https://github.com/uber/ringpop-node/pull/272)
* Feature: Bidirectional full syncs for more robust gossip [#251](https://github.com/uber/ringpop-node/pull/251)
* Feature: Automatic cleanup of faulty nodes from membership [#257](https://github.com/uber/ringpop-node/pull/257)
* Deprecated: "admin/reload"-endpoint [#255](https://github.com/uber/ringpop-node/pull/255)
* Various fixes and improvements for test suite [#263](https://github.com/uber/ringpop-node/pull/263) [#262](https://github.com/uber/ringpop-node/pull/262) [#254](https://github.com/uber/ringpop-node/pull/254) [#245](https://github.com/uber/ringpop-node/pull/245)


### Release notes

* **Automatic reaping of faulty nodes**

    Previously nodes marked as faulty would stay in the memberlist indefinitely. Since, 10.15.0 these nodes will be automatically removed after 24 hours by default.

    You can customize the reaping delay using the `stateTimeouts.faulty` (default 86400000ms = 24h) option.

    If you are upgrading please try to upgrade the entire cluster before the reaping kicks in (24 hours). When ran together with an older version for a prolonged period of time an increase in cpu and bandwidth utilization is expected.

* **Automatic partition healing**

    Ringpop now automatically heals partitions by querying the bootstrap provider (e.g. reading file from disk) and reaching out to the nodes that could live in another partition. This causes reads/queries to the bootstrap provider *after* the initial bootstrap.

    The algorithm attempts to heal 3 times per 30s on average, over the entire cluster. You can customize this using the `discoverProviderHealerBaseProbability` (default 3), `discoverProviderHealerPeriod` (default 30000ms = 30s) options.

Both Reaping faulty nodes and Partition healing can be triggered manually in as well with ringpop-admin v0.13.0 via `ringpop-admin heal ip:port` and `ringpop-admin reap ip:port`. This version is backwards compatible and therefore should be a drop in replacement.


10.14.0
-------

* Feature: Partition detection by adding ring and membership checksum stats [#247](https://github.com/uber/ringpop-node/pull/247)
* Update TChannel to latest [#243](https://github.com/uber/ringpop-node/pull/243)
* Improve README [#240](https://github.com/uber/ringpop-node/pull/240)
