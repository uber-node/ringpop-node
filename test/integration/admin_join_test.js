var test = require('tape');

var allocRingpop = require('../lib/alloc-ringpop.js');

test('bootstrap with self', function t(assert) {
    var ringpop = allocRingpop();

    ringpop.bootstrap([ringpop.hostPort], onBootstrap);

    function onBootstrap(err) {
        assert.ok(err);
        assert.equal(err.type, 'ringpop.swim.no-hosts');

        ringpop.destroy();
        assert.end();
    }
});
