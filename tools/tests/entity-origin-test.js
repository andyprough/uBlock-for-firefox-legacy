const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourceDir = path.resolve(__dirname, '../../src/js');

const sandbox = {
    console,
    self: { punycode: require('punycode') },
    window: { addEventListener() {} },
    publicSuffixList: {
        getDomain(hostname) {
            const labels = hostname.split('.');
            const suffix = labels.slice(-2).join('.');
            const suffixLength =
                suffix === 'co.uk' || suffix === 'com.br' ? 2 : 1;
            return labels.length > suffixLength
                ? labels.slice(-suffixLength - 1).join('.')
                : '';
        }
    },
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

// Load the production URL tokenizer from the legacy engine utilities.
const utilsSource = fs.readFileSync(
    path.join(sourceDir, 'utils.js'), 'utf8'
);
const tokenizerStart = utilsSource.indexOf('µBlock.urlTokenizer = {');
const tokenizerEnd = utilsSource.indexOf(String.fromCharCode(10) + '};', tokenizerStart);

if (tokenizerStart === -1 || tokenizerEnd === -1) {
    throw new Error('Could not locate production URL tokenizer');
}

vm.runInContext(
    utilsSource.slice(tokenizerStart, tokenizerEnd + 3),
    sandbox
);

vm.runInContext(
    fs.readFileSync(path.join(sourceDir, 'uritools.js'), 'utf8'),
    sandbox
);

vm.runInContext(
    fs.readFileSync(path.join(sourceDir, 'hntrie.js'), 'utf8'),
    sandbox
);

let source = fs.readFileSync(
    path.join(sourceDir, 'static-net-filtering.js'),
    'utf8'
);

const marker = 'return new FilterContainer();';

if (source.split(marker).length !== 2) {
    throw new Error('Cannot locate filtering engine test hook');
}

source = source.replace(
    marker,
    'globalThis.EntityTestParser = FilterParser;\n' +
    'globalThis.EntityTestOrigin = FilterOrigin;\n' +
    'globalThis.EntityTestSetPage = function(host) { pageHostnameRegister = host; };\n' +
    marker
);

vm.runInContext(source, sandbox);

const parser = new sandbox.EntityTestParser();

const cases = [
    ['Ordinary hostname accepted',
        '*$script,domain=example.com', false],
    ['Ordinary mixed origins accepted',
        '*$script,domain=example.com|~excluded.example', false],
    ['Entity origin accepted',
        '*$script,domain=uploadhub.*', false],
    ['Entity from= alias accepted',
        '*$script,from=uploadhub.*', false],
    ['Multiple entity origins accepted',
        '*$script,domain=uploadhub.*|link1s.*', false],
    ['Negated entity origin accepted',
        '*$script,domain=~uploadhub.*', false],
    ['Embedded wildcard rejected',
        '*$script,domain=upload*hub.com', true],
    ['Wildcard followed by suffix rejected',
        '*$script,domain=uploadhub.*.com', true],
    ['Bare wildcard rejected',
        '*$script,domain=*', true]
];

let passed = 0;
let gaps = 0;

for (const [name, rule, expectedUnsupported] of cases) {
    parser.parse(rule);

    if (parser.unsupported === expectedUnsupported) {
        console.log('PASS:', name);
        passed++;
    } else {
        console.log('GAP:', name);
        gaps++;
    }
}


// Exercise the actual origin-matcher factory.
// The public suffix service is mocked for known test suffixes.
console.log('\nOrigin matching tests:');

const matchingCases = [
    ['Entity .com root', 'uploadhub.*', 'uploadhub.com', true],
    ['Entity .net subdomain', 'uploadhub.*', 'www.uploadhub.net', true],
    ['Entity .co.uk', 'uploadhub.*', 'www.uploadhub.co.uk', true],
    ['Entity .com.br', 'uploadhub.*', 'cdn.uploadhub.com.br', true],
    ['Reject lookalike', 'uploadhub.*', 'notuploadhub.com', false],
    ['Reject nested unrelated domain', 'uploadhub.*', 'uploadhub.evil.com', false],
    ['Multiple entities', 'uploadhub.*|link1s.*', 'sub.link1s.com', true],
    ['Negated entity excludes root', '~uploadhub.*', 'uploadhub.com', false],
    ['Negated entity excludes subdomain', '~uploadhub.*', 'a.uploadhub.net', false],
    ['Negated entity permits unrelated', '~uploadhub.*', 'unrelated.com', true],
    ['Mixed scope excludes UK', 'uploadhub.*|~uploadhub.co.uk', 'www.uploadhub.co.uk', false],
    ['Mixed scope permits .net', 'uploadhub.*|~uploadhub.co.uk', 'uploadhub.net', true],
    ['Ordinary positive with entity exclusion', 'example.com|~uploadhub.*', 'www.example.com', true],
    ['Negative entity overrides positive', 'uploadhub.*|~uploadhub.*', 'uploadhub.net', false],
    ['Ordinary hostname regression', 'example.com', 'www.example.com', true]
];

for (const [name, scope, hostname, expected] of matchingCases) {
    const matcher = sandbox.EntityTestOrigin.matcherFactory(scope);
    sandbox.EntityTestSetPage(hostname);
    const actual = matcher.matchOrigin();

    if (actual === expected) {
        console.log('PASS:', name);
        passed++;
    } else {
        console.log('GAP:', name, `(expected ${expected}, got ${actual})`);
        gaps++;
    }
}

console.log('\nPassed:', passed);
console.log('Unimplemented cases:', gaps);

if (gaps !== 0 && !process.argv.includes('--baseline')) {
    process.exitCode = 1;
}

// Full static-network-filtering integration tests.
console.log('\nFull engine integration tests:');

const engine = sandbox.µBlock.staticNetFilteringEngine;

function loadRules(rules) {
    engine.reset();

    const rows = [];
    const writer = {
        properties: new Map([['assetKey', 'entity-test']]),
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
        if (engine.compile(rule, writer) !== true) {
            throw new Error('Compilation failed: ' + rule);
        }
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
}

function matchRequest(page, request) {
    return engine.matchString({
        pageHostname: page,
        pageDomain:
            sandbox.µBlock.URI.domainFromHostname(page) || page,
        requestHostname: request,
        requestURL: 'https://' + request + '/test.js',
        requestType: 'script'
    });
}

function checkEngine(name, actual, expected) {
    if (actual !== expected) {
        throw new Error(
            name + ': expected ' + expected + ', got ' + actual
        );
    }
    console.log('PASS:', name);
    passed++;
}

// Basic entity scoping.
loadRules(['*$script,domain=uploadhub.*']);

checkEngine('Block .com entity',
    matchRequest('uploadhub.com', 'tracker.example'), 1);

checkEngine('Block .net subdomain',
    matchRequest('www.uploadhub.net', 'tracker.example'), 1);

checkEngine('Block .co.uk entity',
    matchRequest('uploadhub.co.uk', 'tracker.example'), 1);

checkEngine('Block .com.br entity',
    matchRequest('cdn.uploadhub.com.br', 'tracker.example'), 1);

checkEngine('Ignore lookalike domain',
    matchRequest('notuploadhub.com', 'tracker.example'), 0);

checkEngine('Ignore nested unrelated domain',
    matchRequest('uploadhub.evil.com', 'tracker.example'), 0);

checkEngine('Ignore unrelated origin',
    matchRequest('other.example', 'tracker.example'), 0);

// Multiple entities.
loadRules(['*$script,domain=uploadhub.*|link1s.*']);

checkEngine('First entity matches',
    matchRequest('uploadhub.net', 'tracker.example'), 1);

checkEngine('Second entity matches',
    matchRequest('link1s.com', 'tracker.example'), 1);

// Negated entity.
loadRules(['*$script,domain=~uploadhub.*']);

checkEngine('Negated entity excludes',
    matchRequest('uploadhub.com', 'tracker.example'), 0);

checkEngine('Negated entity matches elsewhere',
    matchRequest('other.example', 'tracker.example'), 1);

// Mixed entity and hostname restrictions.
loadRules(['*$script,domain=uploadhub.*|~uploadhub.co.uk']);

checkEngine('Specific hostname exclusion',
    matchRequest('www.uploadhub.co.uk', 'tracker.example'), 0);

checkEngine('Other suffix still matches',
    matchRequest('uploadhub.net', 'tracker.example'), 1);

// Serialization and cache restoration.
loadRules(['*$script,domain=uploadhub.*']);

const selfie = engine.toSelfie();
engine.reset();
engine.fromSelfie(selfie);

checkEngine('Cache restoration retains entity rule',
    matchRequest('uploadhub.com', 'tracker.example'), 1);

checkEngine('Cache restoration retains restrictions',
    matchRequest('other.example', 'tracker.example'), 0);

// Exceptions must still override ordinary blocking.
loadRules([
    '*$script,domain=uploadhub.*',
    '@@||trusted.example^$script,domain=uploadhub.*'
]);

checkEngine('Entity-scoped exception works',
    matchRequest('uploadhub.com', 'trusted.example'), 2);

checkEngine('Independent tracker remains blocked',
    matchRequest('uploadhub.com', 'tracker.example'), 1);

checkEngine('Exception does not affect unrelated sites',
    matchRequest('other.example', 'trusted.example'), 0);

console.log('\nFINAL TOTAL:', passed, 'tests passed.');

// Multi-label entity-origin compatibility tests.
// These document behavior found in current uAssets rules.
console.log('\nMulti-label entity tests:');

let multiPassed = 0;
let multiGaps = 0;

const multiParserCases = [
    [
        'Multi-label entity accepted',
        '*$script,domain=autofaucet.dutchycorp.*',
        false
    ],
    [
        'Negated multi-label entity accepted',
        '*$script,domain=~autofaucet.dutchycorp.*',
        false
    ],
    [
        'Mixed multi-label entity accepted',
        '*$script,domain=autofaucet.dutchycorp.*|dutchycorp.*',
        false
    ],
    [
        'Invalid wildcard suffix remains rejected',
        '*$script,domain=autofaucet.dutchycorp.*.com',
        true
    ]
];

for (const [name, rule, expected] of multiParserCases) {
    parser.parse(rule);
    const actual = parser.unsupported;

    if (actual === expected) {
        console.log('PASS:', name);
        multiPassed++;
    } else {
        console.log('GAP:', name);
        multiGaps++;
    }
}

const multiMatchingCases = [
    [
        'Multi-label entity .com',
        'autofaucet.dutchycorp.*',
        'autofaucet.dutchycorp.com',
        true
    ],
    [
        'Multi-label entity subdomain',
        'autofaucet.dutchycorp.*',
        'child.autofaucet.dutchycorp.net',
        true
    ],
    [
        'Multi-label entity co.uk',
        'autofaucet.dutchycorp.*',
        'autofaucet.dutchycorp.co.uk',
        true
    ],
    [
        'Negated multi-label entity',
        '~autofaucet.dutchycorp.*',
        'autofaucet.dutchycorp.com',
        false
    ],
    [
        'Specific entity exclusion overrides general entity',
        'dutchycorp.*|~autofaucet.dutchycorp.*',
        'autofaucet.dutchycorp.com',
        false
    ],
    [
        'General entity still matches other subdomains',
        'dutchycorp.*|~autofaucet.dutchycorp.*',
        'other.dutchycorp.com',
        true
    ],
    [
        'Reject nested unrelated domain',
        'autofaucet.dutchycorp.*',
        'autofaucet.dutchycorp.evil.com',
        false
    ],
    [
        'Reject lookalike subdomain',
        'autofaucet.dutchycorp.*',
        'notautofaucet.dutchycorp.com',
        false
    ]
];

for (const [name, scope, hostname, expected] of multiMatchingCases) {
    const matcher = sandbox.EntityTestOrigin.matcherFactory(scope);
    sandbox.EntityTestSetPage(hostname);
    const actual = matcher.matchOrigin();

    if (actual === expected) {
        console.log('PASS:', name);
        multiPassed++;
    } else {
        console.log(
            'GAP:', name,
            `(expected ${expected}, got ${actual})`
        );
        multiGaps++;
    }
}

console.log('\nMulti-label tests passed:', multiPassed);
console.log('Multi-label gaps:', multiGaps);

if (multiGaps !== 0 && !process.argv.includes('--baseline')) {
    process.exitCode = 1;
}

// Multi-label entity integration tests.
console.log('\nMulti-label full-engine tests:');

// Basic multi-label blocking.
loadRules(['*$script,domain=autofaucet.dutchycorp.*']);

checkEngine('Multi-label .com blocking',
    matchRequest('autofaucet.dutchycorp.com', 'tracker.example'), 1);

checkEngine('Multi-label .net subdomain blocking',
    matchRequest('child.autofaucet.dutchycorp.net', 'tracker.example'), 1);

checkEngine('Multi-label .co.uk blocking',
    matchRequest('autofaucet.dutchycorp.co.uk', 'tracker.example'), 1);

checkEngine('Sibling subdomain unaffected',
    matchRequest('other.dutchycorp.com', 'tracker.example'), 0);

checkEngine('Unrelated nested domain unaffected',
    matchRequest('autofaucet.dutchycorp.evil.com',
                 'tracker.example'), 0);

// A narrow negative entity overrides a broader positive entity.
loadRules([
    '*$script,domain=dutchycorp.*|~autofaucet.dutchycorp.*'
]);

checkEngine('Specific entity exclusion',
    matchRequest('autofaucet.dutchycorp.com',
                 'tracker.example'), 0);

checkEngine('Specific entity descendant exclusion',
    matchRequest('child.autofaucet.dutchycorp.net',
                 'tracker.example'), 0);

checkEngine('General entity still blocks sibling',
    matchRequest('other.dutchycorp.com', 'tracker.example'), 1);

// Negative-only multi-label scopes.
loadRules(['*$script,domain=~autofaucet.dutchycorp.*']);

checkEngine('Negative-only scope excludes entity',
    matchRequest('autofaucet.dutchycorp.com',
                 'tracker.example'), 0);

checkEngine('Negative-only scope blocks elsewhere',
    matchRequest('other.dutchycorp.com', 'tracker.example'), 1);

// Entity-scoped exception behavior.
loadRules([
    '*$script,domain=autofaucet.dutchycorp.*',
    '@@||trusted.example^$script,domain=autofaucet.dutchycorp.*'
]);

checkEngine('Multi-label exception allows trusted resource',
    matchRequest('autofaucet.dutchycorp.com',
                 'trusted.example'), 2);

checkEngine('Multi-label exception leaves tracker blocked',
    matchRequest('autofaucet.dutchycorp.com',
                 'tracker.example'), 1);

checkEngine('Multi-label rules do not affect unrelated origin',
    matchRequest('other.example', 'trusted.example'), 0);

// Verify cache serialization and restoration.
loadRules(['*$script,domain=autofaucet.dutchycorp.*']);

const multiSelfie = engine.toSelfie();
engine.reset();
engine.fromSelfie(multiSelfie);

checkEngine('Multi-label rule survives cache restoration',
    matchRequest('autofaucet.dutchycorp.com',
                 'tracker.example'), 1);

checkEngine('Restored rule preserves entity boundary',
    matchRequest('other.dutchycorp.com',
                 'tracker.example'), 0);

console.log('\nCOMBINED TOTAL:', passed + multiPassed,
            'tests passed.');
