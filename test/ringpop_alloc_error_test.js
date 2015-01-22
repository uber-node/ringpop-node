'use strict';

var test = require('tape');

var Ringpop = require('../index.js');

test('ringpop without app throws', function t(assert) {
    assert.throws(function throwIt() {
        Ringpop({});
    }, /Expected `options.app` to be a non-empty string/);

    assert.throws(function throwIt() {
        Ringpop({
            app: ''
        });
    }, /Expected `options.app` to be a non-empty string/);

    assert.end();
});
