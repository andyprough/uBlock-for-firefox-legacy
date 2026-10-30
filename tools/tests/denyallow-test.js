const fs = require('fs');
const path = require('path');
const sourceDir = path.resolve(__dirname, '../../src/js');
const vm = require('vm');
const assert = require('assert').strict;

const sandbox = {
    console,
    vAPI: { cantWebsocket: false },
    punycode: require('punycode'),
    µBlock: {
        CompiledLineIO: {
            serialize: JSON.stringify,
            unserialize: JSON.parse
        },
        urlTokenizer: {
            tokenHashFromString(s) { return s; }
        }
    }
};

vm.createContext(sandbox);

vm.runInContext(
    fs.readFileSync(path.join(sourceDir, 'hntrie.js'), 'utf8'),
    sandbox
);

let source = fs.readFileSync(
    path.join(sourceDir, 'static-net-filtering.js'), 'utf8'
);

const marker = 'return new FilterContainer();';

assert.equal(source.split(marker).length, 2);

source = source.replace(marker, `
    globalThis.testHooks = {
        FilterParser,
        FilterDenyAllow,
        FilterOrigin,
        FilterTrue,
        setHostnames(page, request) {
            pageHostnameRegister = page;
            requestHostnameRegister = request;
        }
    };
    ${marker}
`);

vm.runInContext(source, sandbox);

const h = sandbox.testHooks;
let passed = 0;

function test(name, actual, expected) {
    assert.equal(actual, expected, name);
    console.log('PASS:', name);
    passed++;
}

const p = new h.FilterParser();

p.parse(
    '*$script,3p,domain=site.example,' +
    'denyallow=trusted.example|cdn.example'
);

test('Valid filter accepted', p.unsupported, false);
test('Origin parsed', p.domainOpt, 'site.example');
test(
    'Destination exclusions parsed',
    p.denyallowOpt,
    'trusted.example|cdn.example'
);

const deny = h.FilterDenyAllow.load([
    h.FilterDenyAllow.fid,
    p.denyallowOpt,
    [h.FilterTrue.fid]
]);

const origin = h.FilterOrigin.load([
    h.FilterOrigin.fid,
    p.domainOpt,
    deny.compile()
]);

function matches(page, request) {
    h.setHostnames(page, request);
    return origin.match('http://' + request + '/test.js', 0);
}

test('Untrusted destination blocked',
    matches('site.example', 'tracker.example'), true);

test('Trusted destination excluded',
    matches('site.example', 'trusted.example'), false);

test('Trusted subdomain excluded',
    matches('site.example', 'sub.trusted.example'), false);

test('Second trusted destination excluded',
    matches('site.example', 'cdn.example'), false);

test('Similar-looking domain blocked',
    matches('site.example', 'nottrusted.example'), true);

test('False suffix blocked',
    matches('site.example', 'trusted.example.evil'), true);

test('Origin scope respected',
    matches('other.example', 'tracker.example'), false);

const restored = h.FilterOrigin.load(origin.compile());

h.setHostnames('site.example', 'tracker.example');

test('Serialized filter still blocks',
    restored.match('http://tracker.example/test.js', 0), true);

h.setHostnames('site.example', 'trusted.example');

test('Serialized filter retains exclusion',
    restored.match('http://trusted.example/test.js', 0), false);

p.parse('*$script,denyallow=trusted.example');

test('Missing origin rejected', p.unsupported, true);

p.parse(
    '*$script,domain=site.example,denyallow='
);

test('Empty denyallow rejected', p.unsupported, true);

p.parse(
    '*$script,domain=site.example,' +
    'denyallow=trusted.example|'
);

test('Empty hostname entry rejected', p.unsupported, true);

console.log('\nAll', passed, 'tests passed.');

// Full filtering-engine integration tests.
// Use a minimal tokenizer for wildcard-based filter rules.
const tokenizer = sandbox.µBlock.urlTokenizer;
tokenizer.setURL = url => url;
tokenizer.getTokens = () => [0];

const engine = sandbox.µBlock.staticNetFilteringEngine;

function loadRules(rules) {
    engine.reset();

    const rows = [];
    const writer = {
        properties: new Map([['assetKey', 'unit-test']]),
        section: 0,
        select(n) { this.section = n; },
        push(data) {
            rows.push({
                section: this.section,
                line: JSON.stringify(data)
            });
        }
    };

    for (const rule of rules) {
        assert.equal(engine.compile(rule, writer), true, rule);
    }

    const reader = {
        select(n) {
            this.lines = rows.filter(row => row.section === n);
            this.index = -1;
        },
        next() {
            this.index++;
            if (this.index >= this.lines.length) return false;
            this.line = this.lines[this.index].line;
            return true;
        }
    };

    engine.fromCompiledContent(reader);
    engine.freeze();

    return rows;
}

function matchRequest(page, host) {
    return engine.matchString({
        pageHostname: page,
        pageDomain: page,
        requestHostname: host,
        requestURL: 'https://' + host + '/test.js',
        requestType: 'script'
    });
}

console.log('\nFull engine integration tests:');

const rule =
    '*$script,3p,domain=site.example,' +
    'denyallow=trusted.example|cdn.example';

const rows = loadRules([rule]);

test('Compiler emitted one rule', rows.length, 1);

test('Full engine blocks tracker',
    matchRequest('site.example', 'tracker.example'), 1);

test('Full engine excludes trusted host',
    matchRequest('site.example', 'trusted.example'), 0);

test('Full engine excludes trusted subdomain',
    matchRequest('site.example', 'sub.trusted.example'), 0);

test('Full engine rejects lookalike',
    matchRequest('site.example', 'nottrusted.example'), 1);

test('Full engine respects origin scope',
    matchRequest('other.example', 'tracker.example'), 0);

// Save and restore the engine's cached compiled representation.
const selfie = engine.toSelfie();
engine.reset();
engine.fromSelfie(selfie);

test('Cache restoration retains blocking',
    matchRequest('site.example', 'tracker.example'), 1);

test('Cache restoration retains exclusions',
    matchRequest('site.example', 'trusted.example'), 0);

// A separate rule must still be able to block a trusted destination.
loadRules([
    rule,
    '*$script,3p,domain=site.example'
]);

test('Independent rule still blocks trusted host',
    matchRequest('site.example', 'trusted.example'), 1);

console.log('\nFull integration tests completed.');

// Additional hostname validation tests.
console.log('\nHostname validation tests:');

const malformed = [
    '-',
    '-bad.example',
    'bad-.example',
    'a'.repeat(64) + '.example',
    'a'.repeat(254)
];

for (const hostname of malformed) {
    p.parse(
        '*$script,domain=site.example,denyallow=' + hostname
    );
    test(
        'Reject invalid hostname: ' + hostname.slice(0, 30),
        p.unsupported,
        true
    );
}

console.log('\nAdditional validation tests completed.');

// Additional option compatibility tests.
console.log('\nOption compatibility tests:');

const optionCases = [
    [
        'from alias accepted',
        '*$script,from=site.example,denyallow=trusted.example',
        false
    ],
    [
        'duplicate denyallow rejected',
        '*$script,domain=site.example,denyallow=a.example,denyallow=b.example',
        true
    ],
    [
        'negated destination rejected',
        '*$script,domain=site.example,denyallow=~trusted.example',
        true
    ],
    [
        'entity wildcard rejected',
        '*$script,domain=site.example,denyallow=trusted.*',
        true
    ],
    [
        'negated denyallow option rejected',
        '*$script,domain=site.example,~denyallow=trusted.example',
        true
    ],
    [
        'redirect combination rejected',
        '*$script,domain=site.example,denyallow=trusted.example,redirect=noopjs',
        true
    ]
];

for (const [name, rule, unsupported] of optionCases) {
    p.parse(rule);
    test(name, p.unsupported, unsupported);
}

// Confirm that multiple origin domains work in the complete engine.
loadRules([
    '*$script,3p,domain=one.example|two.example,' +
    'denyallow=trusted.example'
]);

test('First origin blocks untrusted',
    matchRequest('one.example', 'tracker.example'), 1);

test('Second origin blocks untrusted',
    matchRequest('two.example', 'tracker.example'), 1);

test('Outside origin is unaffected',
    matchRequest('three.example', 'tracker.example'), 0);

test('Second origin excludes trusted',
    matchRequest('two.example', 'trusted.example'), 0);

console.log('\nOption compatibility tests completed.');


// Real-world uAssets exception-rule regression tests.
console.log('\nReal-world exception tests:');

const exception1 =
    '@@*.js|$script,3p,domain=sonixgvn.net,' +
    'denyallow=doubleclick.net|onesignal.com|vlitag.com|googletagmanager.com';

const exception2 =
    '@@*$script,domain=th.gl,' +
    'denyallow=amazon-adsystem.com|doubleclick.net|' +
    'googlesyndication.com|avplayer.com|aniview.com|id5-sync.com';

p.parse(exception1);
test('First uAssets exception parses', p.unsupported, false);

p.parse(exception2);
test('Second uAssets exception parses', p.unsupported, false);

loadRules([
    '*$script,3p,domain=th.gl',
    exception2
]);

test('Exception allows other destinations',
    matchRequest('th.gl', 'static.example'), 2);

test('Exception excludes doubleclick.net',
    matchRequest('th.gl', 'doubleclick.net'), 1);

test('Exception excludes doubleclick subdomains',
    matchRequest('th.gl', 'ads.doubleclick.net'), 1);

test('Exception does not apply outside its origin',
    matchRequest('outside.example', 'static.example'), 0);

console.log('\nTOTAL:', passed, 'tests passed.');
