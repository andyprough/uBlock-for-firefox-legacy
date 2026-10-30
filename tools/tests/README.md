# Network-filtering regression tests

This integration branch combines two independently
developed improvements to uBlock Origin Legacy:

- Entity-style origin matching
- The denyallow network-filter option

Run both regression suites:

    node tools/tests/entity-origin-test.js
    node tools/tests/denyallow-test.js

The original per-feature testing notes follow.

---

## Entity-style origin matching tests

Regression tests for entity-style origin scopes in
uBlock Origin for Firefox Legacy (Pale Moon/Basilisk).

### Run

    node tools/tests/entity-origin-test.js

The test suite contains 69 assertions covering:

- Ordinary origin matching and parser compatibility
- Entity-style origins such as `example.*`
- Multi-label origins such as `admin.example.*`
- Positive, negative, and mixed origin scopes
- Different public suffixes and domain boundaries
- Blocking rules and exception rules
- Full filtering-engine compilation and matching
- Compiled-filter serialization and restoration
- Regression tests for ordinary hostname matching

The Node.js harness uses the production filtering engine,
URI utilities, and URL tokenizer, with a simplified Public
Suffix List for its normal test run.

### Additional validation

On October 29, 2026, all 69 tests also passed using the
bundled production publicsuffixlist.js implementation
loaded with the official Public Suffix List.

The uAssets compatibility audit found 339 entity-origin
rule occurrences:

- 198 compiled successfully
- 39 required separate redirect-engine validation
- 20 were rejected by the legacy parser
- 82 required the independently developed denyallow feature

These counts include historical filter files and are not
a count of active filtering rules.

### Pale Moon verification

An experimental XPI was installed in an isolated Pale Moon
profile on October 29, 2026.

Verified:

- Entity-scoped blocking across different suffixes
- Multi-label entity matching
- Exclusions overriding broader positive matches
- Exception rules allowing trusted resources
- Unrelated and sibling origins remaining unaffected
- Filtering behavior surviving browser restart

The two features were developed independently and are
combined on this integration branch.

---

## uBlock Origin Legacy - Network Filtering Tests

### Requirements

- Node.js
- No npm dependencies required

### Running the Tests

From the repository root:

    node tools/tests/denyallow-test.js

The test script can also be launched from other working directories.

### denyallow Tests

The denyallow regression suite contains 45 assertions covering:

- Filter option parsing
- Origin hostname restrictions
- Destination hostname exclusions
- Subdomain and lookalike hostname matching
- Compiled-filter serialization
- Filter-engine compilation and matching
- Cache restoration
- Independent blocking rules
- Malformed hostname rejection
- Unsupported option combinations
- Multiple originating domains
- Real-world uAssets exception rules

### Limitations

The Node.js test harness uses a simplified URL tokenizer
for wildcard-based network filters.

It does not replace browser-level testing of request
interception, filter-list loading, or the logger.

### Browser Verification

The experimental implementation was also tested in
Pale Moon using an isolated browser profile and a local
HTTP test page with three hostnames.

Verified behavior:

1. Without custom filters, both test scripts loaded.
2. With denyallow, the trusted script loaded and the
   untrusted script was blocked.
3. An independent blocking rule could still block the
   trusted script.
4. Removing the custom filters restored normal loading.
5. The denyallow behavior survived a browser restart.

The browser logger confirmed which filtering rules
blocked the requests.

This is a focused regression suite for the initial
denyallow backport, not a comprehensive engine test.

---

## Combined-feature integration verification

The integration branch combines entity-style origin matching
with the denyallow network-filter option.

### Automated regression tests

Run all three suites:

    node tools/tests/entity-origin-test.js
    node tools/tests/denyallow-test.js
    node tools/tests/integration-network-filter-test.js

The suites contain 138 distinct assertions:

- Entity-origin matching: 69
- Denyallow network filtering: 45
- Combined-feature integration: 24

The integration suite verifies:

- Entity-style origins combined with denyallow
- Multi-label entity origins
- Positive and negative origin scopes
- Destination exclusions and subdomains
- Exception-rule behavior
- Independent blocking-rule precedence
- Compiled-filter serialization and restoration

### Real-world uAssets compatibility

On October 30, 2026, the combined engine was tested against
82 uAssets rules requiring both entity-style origin matching
and denyallow support.

Results:

- Rules examined: 82
- Parser accepted: 82
- Successfully compiled: 82
- Parser rejections: 0
- Compiler failures: 0

These rules were found in a local uAssets snapshot that
includes historical filter files. Compilation success does
not guarantee correct runtime behavior for every rule.

### Cache compatibility

The combined engine uses compiledMagic version 6 to avoid
reusing compiled-filter caches from the independently
developed version 5 implementations.
