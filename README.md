# Conscience64

> **Public page:** https://redogit.github.io/conscience64-platform/ · **Main / About:** https://redogit.github.io/redogit/

Platform, recovery, navigation, analytics, and local model tooling.

This standalone export preserves original source paths and bytes. Necessary cross-project dependencies are copied with explicit provenance; ownership and historical evidence remain with their source projects.

## Start here

- [Event Horizon interface and full search backend](server/README.md)
- [Live search interface](https://redogit.github.io/conscience64-platform/)
- [Platform browser entry](<conscience64/index.html>)
- [Platform API](<conscience64/API.md>)

## Validate locally

Preparation used Python 3.12.14 and Node.js 24.19.0 for the included Python/Node checks. Coordinate-space checks additionally use the pinned NumPy requirement in their source directory. RMAL builds require CMake 3.25 or later and a C23/C++23 compiler; Clang 19 was tested. No package downloads or remote mutations are performed by the validation runner.

```sh
python validate.py --integrity-only
python validate.py
```

Individual checks can be selected with `--check NAME`; names and exact commands are in `VALIDATE.json`. For RMAL, select a suitable compiler with `CC` and `CXX`; `CMAKE` and `CTEST` may specify executable paths.

For local static navigation, serve the `conscience64` directory on loopback, for example `python -m http.server 8000 --bind 127.0.0.1 --directory conscience64`. This does not enable GitHub Pages or a public service. See each project README for application-specific servers.

## Provenance and limits

- `EXPORT_PROVENANCE.json` is the unchanged historical scope snapshot and original file inventory. Its initial candidate status is historical, not a fresh readiness result.
- `EXPORT_DEPENDENCIES.json` records every additional source file and explicit compatibility/validation repair.
- `EXPORT_EXCLUSIONS.json` keeps all fifteen original withheld paths absent. No private-origin publication approval is inferred.
- `VALIDATION_STATUS.json` records the latest export checks and remaining limitations.
- Original source history remains unchanged in the original repositories; this export does not import unrelated commit history.
- Existing commercial-access policy files and licenses remain in their original source paths. No new license grant is implied.

Source READMEs, workflows under source subdirectories, manifests, and evidence remain historical bytes. Their references to original repository layouts or prior deployments are not claims that a new deployment exists. Use this root validation runner for this export. Full browser, Windows/Android and native LLVM/MLIR validation is outside the tested scope.

The preserved original public-route test expects an intentionally excluded route. The root runner instead uses `conscience64/tools/export-public-routes.test.mjs`, whose separately recorded changes assert that route is absent and retain the remaining closure checks. The excluded projection verifier and three excluded tooling tests are not restored or claimed as passing.
