# Everyday Orbit workspace design
Date: 2026-10-03
Status: written specification awaiting user review
Target: redogit/conscience64-platform
Baseline: 3433a2719d6261a0f470f9551a2de61610f0d92e
Source lineage: redogit/conscience64 e5a10ba2a7873684676bd13735cf4cba76adcd23

## Intent
Build an everyday human interface with an almost uncluttered viewport, menus at its edges, GPU rendering initialized first, professional goal-aware search, Orbit Library retrieval, and a small language model informed by S′. S′ and S Prime are aliases for the same intended name; implementation versions retain explicit identities. Preserve existing useful capabilities without showing every tool at once.

## Scope and delivery boundary
Develop in the standalone Platform repository. Its conscience64/ workspace is the initial integration target; preserve original source ownership and export provenance. Do not silently replace the separate public experimental projection or enable publication. Keep an accessible legacy workspace route and a documented rollback before replacing the platform entry. Updating exported files requires updating the export's dependency/integrity records rather than rewriting its historical provenance snapshot.

This specification covers the integrated shell, renderer, search, session and adapter interfaces. Training a new language model is a separate research task; an absent model must be reported as unavailable and must not be represented by rule-based output under an AI label.

## Everyday interaction
Initial view: “What would you like help with?”, a text/voice input, and four small labeled edge controls: Recent, Add, Refine, Tools. Center content follows the task: readable answer, results, comparison, document or images. Visual scene elements represent actual selected objects and relationships only; no permanent decorative particle field.

Recent restores previous work. Add attaches notes, files or links and offers explicit saving. Refine exposes intended outcome, Must/Prefer/Avoid, source scope and selected context. Tools opens existing capabilities on demand. Sources, Why this fits and What's missing are disclosures beneath the active result. Technical I/R/P/O remains available under Tools.

Only one drawer is open by default. Escape closes it and focus returns to its trigger. Keyboard and touch activation are first-class; hover is optional. On narrow screens drawers become a single sheet; controls respect safe areas, touch targets and the onscreen keyboard. Use WCAG AA contrast, visible focus, semantic headings, labeled inputs and textual status. Reduced motion produces a still usable interface.

## Runtime and rendering
Structural HTML and accessible status exist before JavaScript. A single bootstrap awaits renderer initialization before mounting feature modules. Try WebGPU, then WebGL2, then an explicit accessible fallback. Each backend owns its own canvas/context; failed context acquisition cannot poison another backend's canvas. Readiness includes backend, capabilities and failure reason.

One renderer owns scene scheduling, resize, picking and teardown. Device/context loss preserves application state and attempts recovery or fallback. Pause invisible work; render settled scenes on demand. Heavy search/inference work runs outside the render loop. GPU priority does not mean blocking input forever: initialization has a bounded timeout and settles into fallback before feature mounting.

One application state owns task, goal, context IDs, query, results, selection, active drawer, operation status and session history. Features dispatch actions; they do not append competing permanent panels or create independent animation loops. Accessible HTML results and renderer selection reflect the same stable object IDs.

## Unified search
A request carries query, intended outcome, Must/Prefer/Avoid, source scope, context IDs and request ID. Local adapters index public records, project records and permitted Orbit objects. Lexical retrieval and metadata filters are the initial implemented baseline; embeddings are optional and explicitly identified if later added.

Constraints apply consistently to local and external retrieval. A result carries stable identity, title, snippet, source locator, provenance, authority, lexical score and an explanation of goal matches. Hard constraints that cannot be checked remain unknown; do not claim semantic satisfaction from a word match. Goal alignment, context sufficiency and evidence support remain separate states.

Support cancellation, stale-response rejection, deduplication by source identity, pagination, retries, provider failures, empty results and scope changes. Preserve distinct occurrences/revisions when their identity differs. External search is explicit and reports which providers received the query. Avoid automatic query leakage from private local material.

## Orbit adapter
Existing anchors: conscience64/play/orbit/index.html, play/assets/app.mjs and research/projects/orbit-library.md. The shelf provides notes, source links, local search, undo, explicit persistence and JSON transfer. This is not proof of a complete remote Orbit Library API.

Define list/search/get/save/update/remove/import/export adapter operations, with capabilities and availability. Wrap verified source-native shelf logic and preserve its saved format through a versioned migration. Add provenance and typed relations through a sidecar where necessary. Broader Orbit recovery services require separately verified endpoints and capabilities.

Use original objects for Open source; distinguish UNKNOWN, UNASSIGNED and ABSENT. Recent sessions are separate from historical library records. Attachments remain session-local until the user saves. Restoring/importing must offer merge or replacement explicitly with undo. Browser storage failures are visible; export remains available. Relation does not transfer authority or ownership.

## S′ assistance
Source anchor: conscience64/research/federation/s1-models.json; owner references point to Other-Projects-/S1 Models Lab. Existing records include non-ML experience/suggestion mechanisms and candidate-state architecture. They do not establish deployable language-model weights.

Use a model adapter with capabilities, artifact identity, load/unload, cancellation and structured propose operations. Verified proposals may suggest task interpretation, query refinement, context selection or source-grounded wording. Validate output schemas and references before applying proposals. Keep original request and proposal traces recoverable. Model suggestions cannot silently change hard constraints, save objects or authorize external searches.

Load inference after renderer readiness, on demand, with resource limits and progress. Share GPU scheduling conservatively or select CPU/worker execution so inference does not starve rendering. Until a verified model artifact exists, search works and the model is marked unavailable. “S′” and “S Prime” resolve to one display identity, without conflating different retained implementations.

## Other capabilities
Voice, translation, Human Builder, lessons, image generation, corrections, memory management and optional music remain in Tools. Lazy-load them and bind them to shared state. Music is opt-in. Disable provider-backed actions with an actionable explanation when no provider exists. Workflow failure stops dependent steps unless the user chooses a documented continue policy. Validate message origins and source windows; do not keep wildcard image-generation bridges.

## Verification and acceptance
Retain meaningful retrieval fixtures: exact identity, ambiguous terms, exclusions, conflicting goals, no matches, missing context, private-memory boundaries, multilingual text, duplicate revisions and provider failure. Assess ranking usefulness separately from evidence correctness.

Browser checks must demonstrate renderer readiness before feature mount, one render owner, scene/result selection agreement, GPU loss recovery, fallback, stale query protection, session restoration, keyboard operation and mobile layout. Record browser/device and measured frame/input latency; do not claim universal performance from one machine.

Every visible action must either work or explain an unavailable dependency. No mock answers under model labels, no silent success after failed save, and no context/goal indicator without a disclosed reason.

## Rollback
Implement on an isolated branch. Preserve legacy files and their entry route, saved-data exports and migrations. Reverting the entry change restores the previous workspace without deleting notes or histories. Publication remains a separate deliberate operation.
