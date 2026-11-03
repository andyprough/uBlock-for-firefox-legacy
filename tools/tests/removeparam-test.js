'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const testFile = path.join(__dirname, 'entity-origin-test.js');

const context = vm.createContext({
    require,
    process,
    __dirname,
    console: {
        log() {},
        error: console.error
    }
});

// Reuse the existing production-engine test harness.
vm.runInContext(
    fs.readFileSync(testFile, 'utf8'),
    context,
    { filename: testFile }
);

const baseline = vm.runInContext(
    'passed + multiPassed',
    context
);

if (baseline !== 69) {
    throw new Error(
        'Existing entity-origin regression baseline failed'
    );
}

console.log('Existing entity-origin tests: 69 passed');
console.log();
console.log('=== REMOVE PARAMETER PARSER TESTS ===');

const cases = [
    [
        'Global literal parameter',
        '*$removeparam=utm_source'
    ],
    [
        'Hostname-scoped literal parameter',
        '||example.com^$removeparam=utm_source'
    ],
    [
        'Origin-scoped literal parameter',
        '||example.com^$removeparam=utm_source,domain=sitealpha.*'
    ],
    [
        'Literal parameter exception',
        '@@||example.com^$removeparam=utm_source'
    ]
];

let passed = 0;
let failed = 0;

for (const [name, rule] of cases) {
    const unsupported = vm.runInContext(
        'parser.parse(' + JSON.stringify(rule) +
        '); parser.unsupported',
        context
    );

    if (unsupported) {
        console.log('FAIL (expected before implementation): ' + name);
        failed++;
    } else {
        console.log('PASS: ' + name);
        passed++;
    }
}

console.log();
console.log('Removeparam parser tests passed:', passed);
console.log('Removeparam parser tests failed:', failed);

if (failed !== 0) {
    process.exitCode = 1;
}

// ------------------------------------------------------------
// Production compiler acceptance tests.
// These should fail until removeparam support is implemented.
// ------------------------------------------------------------

console.log();
console.log('=== REMOVE PARAMETER COMPILER TESTS ===');

// The production compiler logs unsupported filters.
// Supply a logger for this isolated test environment.
vm.runInContext(
    'sandbox.µBlock.logger = sandbox.µBlock.logger || ' +
    '{ writeOne: function() {} };',
    context
);

const engine = vm.runInContext(
    'sandbox.µBlock.staticNetFilteringEngine',
    context
);

function canCompile(rule) {
    const writer = {
        properties: new Map([
            ['assetKey', 'removeparam-test']
        ]),
        section: 0,
        rows: [],
        select(section) {
            this.section = section;
        },
        push(data) {
            this.rows.push({
                section: this.section,
                data
            });
        }
    };

    return engine.compile(rule, writer) === true;
}

// First confirm that the compiler itself is functional.
if (!canCompile('||example.com^$script')) {
    throw new Error(
        'Existing ordinary network-filter compilation failed'
    );
}

console.log('PASS: Existing network filter compiles');

let compilerPassed = 0;
let compilerFailed = 0;

for (const [name, rule] of cases) {
    if (canCompile(rule)) {
        console.log('PASS:', name);
        compilerPassed++;
    } else {
        console.log(
            'FAIL (expected before implementation):',
            name
        );
        compilerFailed++;
    }
}

console.log();
console.log(
    'Removeparam compiler tests passed:',
    compilerPassed
);
console.log(
    'Removeparam compiler tests failed:',
    compilerFailed
);

if (compilerFailed !== 0) {
    process.exitCode = 1;
}

// ------------------------------------------------------------
// URL transformation contract tests.
// Expected to fail until the implementation exists.
// ------------------------------------------------------------

console.log();
console.log('=== REMOVE PARAMETER RUNTIME TESTS ===');

const runtimeCases = [
    {
        name: 'Main document removes tracking parameter',
        rules: ['*$removeparam=utm_source'],
        url: 'https://example.com/article?id=42&utm_source=mail',
        page: 'example.com',
        type: 'main_frame',
        expected: 'https://example.com/article?id=42'
    },
    {
        name: 'Duplicate parameters are all removed',
        rules: ['*$removeparam=utm_source'],
        url: 'https://example.com/?utm_source=a&id=42&utm_source=b',
        page: 'example.com',
        type: 'main_frame',
        expected: 'https://example.com/?id=42'
    },
    {
        name: 'URL fragment is preserved',
        rules: ['*$removeparam=utm_source'],
        url: 'https://example.com/?id=42&utm_source=mail#section',
        page: 'example.com',
        type: 'main_frame',
        expected: 'https://example.com/?id=42#section'
    },
    {
        name: 'Unrelated parameter is untouched',
        rules: ['*$removeparam=utm_source'],
        url: 'https://example.com/?id=42',
        page: 'example.com',
        type: 'main_frame',
        expected: undefined
    },
    {
        name: 'Hostname-scoped rule matches',
        rules: ['||example.com^$removeparam=utm_source'],
        url: 'https://example.com/?utm_source=mail&id=42',
        page: 'example.com',
        type: 'main_frame',
        expected: 'https://example.com/?id=42'
    },
    {
        name: 'Hostname-scoped rule does not match elsewhere',
        rules: ['||example.com^$removeparam=utm_source'],
        url: 'https://another.test/?utm_source=mail',
        page: 'another.test',
        type: 'main_frame',
        expected: undefined
    },
    {
        name: 'Entity origin restriction on subresource',
        rules: [
            '||cdn.example.com^$removeparam=utm_source,' +
            'domain=sitealpha.*'
        ],
        url: 'https://cdn.example.com/script.js?utm_source=mail&id=42',
        page: 'sitealpha.test',
        type: 'script',
        expected: 'https://cdn.example.com/script.js?id=42'
    },
    {
        name: 'Entity origin restriction excludes other pages',
        rules: [
            '||cdn.example.com^$removeparam=utm_source,' +
            'domain=sitealpha.*'
        ],
        url: 'https://cdn.example.com/script.js?utm_source=mail',
        page: 'outsider.test',
        type: 'script',
        expected: undefined
    },
    {
        name: 'Matching exception prevents removal',
        rules: [
            '*$removeparam=utm_source',
            '@@*$removeparam=utm_source,domain=sitealpha.*'
        ],
        url: 'https://sitealpha.test/?utm_source=mail&id=42',
        page: 'sitealpha.test',
        type: 'main_frame',
        expected: undefined
    }
];

let runtimePassed = 0;
let runtimeFailed = 0;

for (const test of runtimeCases) {
    try {
        vm.runInContext(
            'loadRules(' + JSON.stringify(test.rules) + ')',
            context
        );

        if (typeof engine.removeParameters !== 'function') {
            throw new Error(
                'Filtering engine does not implement removeParameters'
            );
        }

        const hostname = new URL(test.url).hostname;
        const requestContext = {
            requestURL: test.url,
            requestHostname: hostname,
            requestType: test.type,
            pageHostname: test.page,
            pageDomain: test.page,
            rootHostname: test.page,
            rootDomain: test.page
        };

        const actual = engine.removeParameters(requestContext);

        if (actual !== test.expected) {
            throw new Error(
                'Expected ' + String(test.expected) +
                ', got ' + String(actual)
            );
        }

        console.log('PASS:', test.name);
        runtimePassed++;

    } catch (error) {
        console.log(
            'FAIL (expected before implementation):',
            test.name
        );
        console.log('  Reason:', error.message);
        runtimeFailed++;
    }
}

console.log();
console.log('Removeparam runtime tests passed:', runtimePassed);
console.log('Removeparam runtime tests failed:', runtimeFailed);

if (runtimeFailed !== 0) {
    process.exitCode = 1;
}
