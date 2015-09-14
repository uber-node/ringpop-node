# Migration
Some changes to Ringpop require an additional note about how developer's
should upgrade. Below is where you'll find instructions on how to upgrade
gracefully from one version of Ringpop to another.

## Upgrading from v10.4.0 to v10.5.0
v10.5.0 requires the use of TChannel v2.7.1 and above due to TChannel API
requirements of the ringpop-handler.js module. If one does not use this
module, versions of TChannel < v2.7.1 may still work. Use at your own
risk.
