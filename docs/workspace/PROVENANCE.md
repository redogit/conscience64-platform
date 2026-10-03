# Everyday workspace

New Platform implementation, October 3, 2026. Does not alter exported historical source files.

`orbit-core.mjs` derives from `conscience64/play/assets/core.mjs` at platform source revision 3433a2719d6261a0f470f9551a2de61610f0d92e (upstream Conscience64 Play tools, MIT). The two implicit voice/music imports were removed so initialization is controlled by the renderer-first bootstrap. The validation and Orbit import/export format are retained. Original source ownership and evidence remain upstream. Local storage key is compatible with Orbit Shelf on the same origin; different GitHub Pages repository paths share the github.io origin.

The first usable release includes local Orbit notes, merged import with conflict rejection, export, undo, goal-aware lexical retrieval, recent queries, optional explicit Wikipedia search and browser dictation. S′ model inference and the remaining advanced tools are not implemented in this release. Tools clearly states model unavailability. No research corpus is republished here. `previous.html` preserves the former public entry.

Run `node docs/workspace/search.test.mjs` and `python validate.py --integrity-only`. Browser verification is a separate check.
