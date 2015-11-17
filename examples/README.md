# Examples
* `leader_election.js` - Use Ringpop to choose a (sloppy) leader and then
do something interesting.
* `key_value.js` - Use Ringpop to build an in-memory key-value store.

# Installation
Though each example may have its own dependencies it's safest to run the
below from the root directory:

`npm install`

# General Usage
Running any of the examples is the same. Replace `example.js` with any of the
example source files mentioned above:

```sh
  Usage: example [options]

  Run an example

  Options:

    -h, --help                   output usage information
    -n, --clusterName <name>     Name of cluster
    -s, --size <size>            Size of cluster
    -b, --bootstrap <bootstrap>  JSON compatible array of hosts
    -p, --port <port>            Base port for cluster
    -h, --host <host>            Address of host
    [options] example.js
```

# Leader Election
Here is a sample of how to start a 5-node cluster and get them to elect a
leader:

```sh
node leader_election.js -n le -s 5
```

And here is how you get 5 more nodes to join that cluster and get them to
elect a new leader:

```sh
node leader_election.js -n le -s 5 -p 3005 -b '["127.0.0.1:3000"]'
```

# Key Value
Start your Ringpop cluster:

```
node key_value.js -n kv
```

Put a value into the store:

```sh
tcurl -p 127.0.0.1:3000 kv put -3 '{"key":"foo","value":"bar"}'
```

And read it back (from a different node):

```sh
tcurl -p 127.0.0.1:3002 kv get -3 '{"key":"foo"}'
```
