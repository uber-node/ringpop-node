ringpop-node release notes
==========================
10.17.0
-------
* Feature: Self eviction [#299](https://github.com/uber/ringpop-node/pull/299), [#300](https://github.com/uber/ringpop-node/pull/300), [#301](https://github.com/uber/ringpop-node/pull/301), [#302](https://github.com/uber/ringpop-node/pull/302), [#307](https://github.com/uber/ringpop-node/pull/307)
* Feature: Key consistent forwarding [#310](https://github.com/uber/ringpop-node/pull/310)

### Release notes

* **Self eviction**

    If a member disappears, it will become a suspect for a period (defaults to 5 seconds) before it's marked as faulty and removed from the ring.
    
    In the case of an expected shutdown, this causes a time window where a member is still considered part of the ring but not responding to (forwarded) requests anymore; causing unnecessary impact on SLA's.  
    
    By exposing a `selfEvict`-function, ringpop allows a member to update its own state to faulty and gossip this update around as part of a graceful shutdown.  
    
* **Key consistent forwarding**
   
    When receiving a forwarded request from another member, the full ring checksum of sender and receiver will be compared, to confirm consistency. This is the default behavior.     
   
    "Key consistent forwarding" adds support for a looser consistency check; instead of comparing the full ring checksum, ringpop only checks whether if the receiving member owns the key(s) of the forwarded request. 
   
    The idea behind this approach is that if both members agree that the receiving member is the owner, it doesn't really matter if other parts of the hash ring are not in sync. 
   
    Note: the default behaviour _did not_ change! Key consistent forwarding can be enabled by disabling `enforceConsistency` and enabling `enforceKeyConsistency` when initializing ringpop.
   
10.16.2
-------
* Fix a bug in the serialization of forwarded requests when data is a `Buffer` [#308](https://github.com/uber/ringpop-node/pull/308)

10.16.1
-------
* Performance improvements in forwarding path by upgrading hammock [#306](https://github.com/uber/ringpop-node/pull/306)

10.16.0
-------
* Support node4 [#304](https://github.com/uber/ringpop-node/pull/304)
* Emit stats for LookupN comparable to Lookup [#283](https://github.com/uber/ringpop-node/pull/283)
* Optimize reincarnation for faster convergence [#284](https://github.com/uber/ringpop-node/pull/284) [#282](https://github.com/uber/ringpop-node/pull/282)
* Refactored internal representation of member state for more flexible reincarnation and state change of a member [#291](https://github.com/uber/ringpop-node/pull/291) [#292](https://github.com/uber/ringpop-node/pull/292) [#293](https://github.com/uber/ringpop-node/pull/293) [#294](https://github.com/uber/ringpop-node/pull/294) [#296](https://github.com/uber/ringpop-node/pull/296)
* Remove tick-cluster.js, the version from ringpop-common should be used [#278](https://github.com/uber/ringpop-node/pull/278)
* Emit stats from testpop for test validation purposes [#271](https://github.com/uber/ringpop-node/pull/271)
* Make state transition timers configurable in testpop [#280](https://github.com/uber/ringpop-node/pull/280)
* Remove unused tests [#286](https://github.com/uber/ringpop-node/pull/286)

10.15.0
-------

* Feature: Automatic partition detection and recovery
 [#272](https://github.com/uber/ringpop-node/pull/272)
* Feature: Bidirectional full syncs for more robust gossip [#251](https://github.com/uber/ringpop-node/pull/251)
* Feature: Automatic cleanup of faulty nodes from membership [#257](https://github.com/uber/ringpop-node/pull/257)
* Deprecated: "admin/reload"-endpoint [#255](https://github.com/uber/ringpop-node/pull/255)
* Refactor: DiscoverProvider abstraction to discover bootstrap hosts [#253](https://github.com/uber/ringpop-node/pull/253)
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
