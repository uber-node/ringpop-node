# Running Ringpop

Learning how to incorporate Ringpop into your application.

## Running with tick-cluster
`tick-cluster` is a utility located in the `scripts/` directory of the Ringpop repo that allows you to quickly spin up a Ringpop cluster of arbitrary size and test basic failure modes: suspending, killing and respawning nodes.

To use `tick-cluster`, first clone the repo and install Ringpop's dependencies:

```
$ git clone git@github.com:uber/ringpop.git
$ npm install
```

Then run `tick-cluster`:

```
$ ./scripts/tick-cluster.js <size-of-cluster>
```

`tick-cluster` will spawn a child process for each node in the cluster. They will bootstrap themselves using an auto-generated `hosts.json` bootstrap file and converge on a single membership list within seconds. Commands can be issued against the cluster while tick-cluster runs. Press `h` or `?` to see which commands are available.

Here's a sample of the output you may see after launching a 5-node cluster with `tick-cluster`:

```
$ ./scripts/tick-cluster.js 5
[init] 13:49:57.993 tick-cluster started d: debug flags, g: gossip, j: join, k: kill, K: revive all, l: sleep, p: protocol stats, q: quit, s: cluster stats, t: tick
[cluster] 13:49:58.001 using 10.80.135.15 to listen
[init] 13:49:58.036 started 5 procs: 561, 562, 563, 564, 565
```

## Running from the command-line

## Running from within your application

## Configuration

## Deploying

## Monitoring

## Benchmarks

## Tools

## Troubleshooting
