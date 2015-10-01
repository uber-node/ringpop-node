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
Content coming soon...

## Benchmarks
Content coming soon...

## Troubleshooting
Content coming soon...
