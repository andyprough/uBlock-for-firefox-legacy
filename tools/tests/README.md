# uBlock Origin Legacy - Network Filtering Tests

## Requirements

- Node.js
- No npm dependencies required

## Running the Tests

From the repository root:

    node tools/tests/denyallow-test.js

The test script can also be launched from other working directories.

## denyallow Tests

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

## Limitations

The Node.js test harness uses a simplified URL tokenizer
for wildcard-based network filters.

It does not replace browser-level testing of request
interception, filter-list loading, or the logger.

## Browser Verification

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
