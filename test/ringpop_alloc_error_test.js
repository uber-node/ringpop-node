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

test('ringpop without options throws', function t(assert) {
    assert.throws(function throwIt() {
        Ringpop();
    }, /Expected `options` argument to be passed/);

    assert.end();
});

test('ringpop with invalid hostPort', function t(assert) {
    assert.throws(function throwIt() {
        Ringpop({
            app: 'foo'
        });
    }, /Got\s\swhich is not a string/);

    assert.throws(function throwIt() {
        Ringpop({
            app: 'oh lol silly me',
            hostPort: 'silly me'
        });
    }, /Got silly me which is not a valid hostPort pattern/);

    assert.throws(function throwIt() {
        Ringpop({
            app: 'foo',
            hostPort: 'localhost:4000'
        });
    }, /Got localhost:4000 which is not a valid ip/);

    assert.throws(function throwIt() {
        Ringpop({
            app: 'foo',
            hostPort: 'localhost:not_a_port'
        });
    }, /Got localhost:not_a_port which is not a valid ip/);

    assert.end();
});
