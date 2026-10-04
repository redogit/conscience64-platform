# Event Horizon workspace

New Platform implementation, October 3, 2026. Does not alter exported historical source files.

`orbit-core.mjs` derives from `conscience64/play/assets/core.mjs` at platform source revision 3433a2719d6261a0f470f9551a2de61610f0d92e (upstream Conscience64 Play tools, MIT). The two implicit voice/music imports were removed so initialization is controlled by the renderer-first bootstrap. The validation and Orbit import/export format are retained. Original source ownership and evidence remain upstream. Local storage key is compatible with Orbit Shelf on the same origin; different GitHub Pages repository paths share the github.io origin.

The interface includes local Orbit notes, merged import with conflict rejection, export, undo, goal-aware BM25 retrieval, remembered source preferences and aliases, recent queries and browser dictation. Whole-query context proposals run after typing pauses; only accepted proposals refine explicit provider requests. Private notes and local learned answers cannot supply record-derived web-context proposals. Restricted private-origin markers are excluded recursively from search carriers.

`public-corpus.json` contains only the existing public browser projection from verified `conscience64/data-00.txt` through `data-05.txt`, its original transport manifest, and the separate public `research/projects/projects.json` registry. All 734 source UOIDs remain unchanged; the projected byte hash is distinct from original archive identity. It includes seven projects and fourteen lessons. `public-routes.json` preserves the existing catalogue, policy, 65 routes and 248 country profiles, with source file hashes. `server/build_public_search.py` regenerates both carriers; no private memory, withheld paths or archives are included.

The service preserves the Conscience64API simple/advanced search, relations, traversal, microdata, I/R/P/O and project/lesson contracts. External search integrates Wikipedia, OpenAlex, Crossref, Internet Archive and GitHub. The route adapter also preserves the separate original global-search planner; the local backend supplies its Crossref/Europe PMC retrieval. Public Pages is static and depends on browser-accessible APIs for direct retrieval; use the local interface for server retrieval. Provider fixtures test behavior rather than current network availability.

The horizon is an artistic visual metaphor. WebGPU, WebGL2 and Canvas2D renderers use one bounded animation loop. S′ model inference is not connected; Tools states this explicitly. `previous.html` preserves the former public entry. Historical source bytes and ownership remain intact.

Run `node --test docs/workspace/*.test.mjs`, `python -m unittest discover -s server -p 'test_*.py'` and `python validate.py --integrity-only`. Real browser verification and preview artifacts run in the workspace GitHub Actions workflow.

## Adaptive Space Lens interface — 2026-10-04

The interface reuses the original Conscience64 `index.html` Space Lens arrangement: a rendered operational field, compact search console, selectable results and secondary tools. The archived source remains unchanged. The platform surface uses white, red, black and grey and a fixed adaptive viewport. Results, menus and long source text use explicit paging rather than page/menu scrolling. The original record API, five retrieval providers, 65 routes, separate project registry, local memory and notes retain their existing identities and claim boundaries.

`word-predictor.mjs` is a local order-3 character Markov model constrained to observed vocabulary, with a preceding-word bigram prior. Its initial everyday vocabulary is hand-authored; additional training comes from unrestricted public record labels and this browser's note titles. Ranking scores are relative scores, not calibrated probabilities, semantic understanding or a connected S′ model. Only an explicitly selected completion changes the query. Free typing and paste remain available. Provider retrieval occurs only through explicit search actions.

Descriptors use the existing whole-query rules and public record evidence. Missing values open an inline input and are accepted only after the user supplies a value. Accepted context can be removed; chosen words can be edited in place. Each search passes the full chosen prefix and typed suffix through the existing query planner. Menus preserve their actual form controls across pages, including validation, and source text paging retains every character.

The legacy `orbit-core.mjs` supports saved notes. It is not the user's separately requested Orbital/OrbitLab Library dependency; that integration remains paused at the user's request to focus on the interface.
