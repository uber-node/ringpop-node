# Migration
Some changes to Ringpop require an additional note about how developer's
should upgrade. Below is where you'll find instructions on how to upgrade
gracefully from one version of Ringpop to another.

## Upgrading from v10.9.6 to v10.9.7
v10.9.7 includes an `event` arg as part of the `ringChanged` event that it
emits. The event is of type `RingChangedEvent` and carries with it 3 properties:
`name`, `added` and `removed`. The `name` property is equivalent to the name
of the constructor function. The `added` and `removed` properties are Arrays
that include the addresses of the servers that were either added to or removed
from the hash ring.

## Upgrading from v10.4.0 to v10.5.0
v10.5.0 requires the use of TChannel v2.7.1 and above due to TChannel API
requirements of the ringpop-handler.js module. If one does not use this
module, versions of TChannel < v2.7.1 may still work. Use at your own
risk.
