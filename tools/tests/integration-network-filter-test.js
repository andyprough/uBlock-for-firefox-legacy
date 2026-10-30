'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const testDir = __dirname;
const testFile = path.join(testDir, 'entity-origin-test.js');

// Load the existing 69-test harness in isolation.
// Reuse its production engine, URI helpers and URL tokenizer.
const context = vm.createContext({
    require,
    __dirname: testDir,
    console: { log() {}, error: console.error }
});

vm.runInContext(
    fs.readFileSync(testFile, 'utf8'),
    context,
    { filename: testFile }
);

const previous = vm.runInContext(
    'passed + multiPassed', context
);

if (previous !== 69) {
    throw new Error('Entity-origin baseline did not pass');
}

console.log('Existing entity-origin tests:', previous);

function load(rules) {
    vm.runInContext(
        'loadRules(' + JSON.stringify(rules) + ')',
        context
    );
}

function match(page, destination) {
    return vm.runInContext(
        'matchRequest(' +
        JSON.stringify(page) + ',' +
        JSON.stringify(destination) + ')',
        context
    );
}

let passed = 0;

function check(name, page, destination, expected) {
    const actual = match(page, destination);

    if (actual !== expected) {
        throw new Error(
            name + ': expected ' + expected +
            ', got ' + actual
        );
    }

    console.log('PASS:', name);
    passed++;
}

// 0 = no matching rule
// 1 = blocked
// 2 = allowed by exception

console.log('\nCombined entity + denyallow blocking:');

load([
    '*$script,3p,domain=sitealpha.*,' +
    'denyallow=trusted.entitylab.test'
]);

check('Entity .test blocks',
    'sitealpha.test', 'control.entitylab.test', 1);

check('Entity .example blocks',
    'sitealpha.example', 'control.entitylab.test', 1);

check('Entity subdomain blocks',
    'sub.sitealpha.test', 'control.entitylab.test', 1);

check('Trusted destination excluded',
    'sitealpha.test', 'trusted.entitylab.test', 0);

check('Trusted subdomain excluded',
    'sitealpha.test', 'cdn.trusted.entitylab.test', 0);

check('Unrelated origin unaffected',
    'other.example', 'control.entitylab.test', 0);

check('Lookalike origin unaffected',
    'notsitealpha.test', 'control.entitylab.test', 0);

check('Unrelated nested domain unaffected',
    'sitealpha.evil.com', 'control.entitylab.test', 0);

console.log('\nMulti-label entity + denyallow:');

load([
    '*$script,3p,domain=admin.sitealpha.*,' +
    'denyallow=trusted.entitylab.test'
]);

check('Multi-label entity blocks',
    'admin.sitealpha.test', 'control.entitylab.test', 1);

check('Multi-label descendant blocks',
    'child.admin.sitealpha.example',
    'control.entitylab.test', 1);

check('Sibling origin unaffected',
    'sibling.sitealpha.test',
    'control.entitylab.test', 0);

check('Parent origin unaffected',
    'sitealpha.test', 'control.entitylab.test', 0);

check('Multi-label trusted destination excluded',
    'admin.sitealpha.test',
    'trusted.entitylab.test', 0);

console.log('\nNegative entity scopes + denyallow:');

load([
    '*$script,3p,domain=sitealpha.*|~admin.sitealpha.*,' +
    'denyallow=trusted.entitylab.test'
]);

check('General entity still blocks',
    'sitealpha.test', 'control.entitylab.test', 1);

check('Sibling still blocks',
    'sibling.sitealpha.test',
    'control.entitylab.test', 1);

check('Excluded admin entity unaffected',
    'admin.sitealpha.test',
    'control.entitylab.test', 0);

check('Trusted destination remains excluded',
    'sitealpha.test', 'trusted.entitylab.test', 0);

console.log('\nCombined exception semantics:');

load([
    '*$script,3p',
    '@@*$script,3p,domain=sitealpha.*,' +
    'denyallow=tracker.entitylab.test'
]);

check('Exception allows ordinary destination',
    'sitealpha.test', 'control.entitylab.test', 2);

check('Excluded tracker remains blocked',
    'sitealpha.test', 'tracker.entitylab.test', 1);

check('Exception does not affect other origins',
    'other.example', 'control.entitylab.test', 1);

console.log('\nCache restoration:');

load([
    '*$script,3p,domain=sitealpha.*|~admin.sitealpha.*,' +
    'denyallow=trusted.entitylab.test'
]);

vm.runInContext(
    '(function() {' +
    'const selfie = engine.toSelfie();' +
    'engine.reset();' +
    'engine.fromSelfie(selfie);' +
    '})()',
    context
);

check('Restored combination blocks',
    'sitealpha.test', 'control.entitylab.test', 1);

check('Restored combination excludes trusted',
    'sitealpha.test', 'trusted.entitylab.test', 0);

check('Restored combination respects origin exclusion',
    'admin.sitealpha.test', 'control.entitylab.test', 0);

console.log('\nIndependent blocking still applies:');

load([
    '*$script,3p,domain=sitealpha.*,' +
    'denyallow=trusted.entitylab.test',
    '||trusted.entitylab.test^$script,domain=sitealpha.*'
]);

check('Independent rule blocks trusted destination',
    'sitealpha.test', 'trusted.entitylab.test', 1);

console.log('\nINTEGRATION TOTAL:', passed,
            'tests passed.');
