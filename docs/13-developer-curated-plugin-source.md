# Developer-curated plugin source

DeepSeek YukiRyou exposes a built-in market source named `YukiRyou · 实机验证`.
Its contents are not compiled into the desktop application. The Runtime reads a
versioned JSON document from the separately maintained public repository:

`https://raw.githubusercontent.com/yoshino-xiao7/deepseek-yukiryou-plugin-catalog/main/catalog-v1.json`

This split lets the repository owner add, update, or remove exact plugin
versions without publishing a new desktop build.

## Trust statement

An entry means only that YukiRyou installed and smoke-tested that exact package
version on every platform listed in `verification.platforms`. It is not a code
audit, endorsement of future versions, or guarantee of safety. Selecting an
entry still runs the normal managed-install inspection: npm identity,
repository backlink, deprecation state, lifecycle scripts, SHA-512 integrity,
tarball origin, platform and Node constraints, the complete dependency graph,
peer compatibility, artifact bytes, and the frozen install lock.

## Publishing an entry

1. Install the exact stable npm version through the desktop managed-install
   flow.
2. Restart and run a product smoke test on each declared platform.
3. Copy `catalog/yukiryou-curated-v1.example.json` into the catalog repository
   as `catalog-v1.json`, or add the new item to the existing document.
4. Use a new `revision` value and record the UTC test time, Harness version,
   tested platforms, and a short factual note.
5. Validate the JSON before committing it. Never publish credentials, install
   commands, arbitrary URLs, or untested version ranges.

The desktop parser accepts at most 500 entries. Every item must use a canonical
GitHub repository, an exact stable npm version, and one or both supported
platform identifiers: `darwin-arm64` and `win32-x64`.
