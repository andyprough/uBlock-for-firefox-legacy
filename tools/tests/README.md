# Entity-style origin matching tests

Regression tests for entity-style origin scopes in
uBlock Origin for Firefox Legacy (Pale Moon/Basilisk).

## Run

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

## Additional validation

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

## Pale Moon verification

An experimental XPI was installed in an isolated Pale Moon
profile on October 29, 2026.

Verified:

- Entity-scoped blocking across different suffixes
- Multi-label entity matching
- Exclusions overriding broader positive matches
- Exception rules allowing trusted resources
- Unrelated and sibling origins remaining unaffected
- Filtering behavior surviving browser restart

The entity-origin implementation is maintained independently
from the denyallow feature branch.
