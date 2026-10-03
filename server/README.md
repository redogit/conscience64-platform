# Event Horizon search backend

From the repository root:

```sh
python server/search_server.py --port 8765
```

Open **http://127.0.0.1:8765**. This serves the complete interface and automatically connects its backend. No installation or API key is required. The server binds to loopback and accepts requests from its own origin. The public GitHub Pages interface cannot connect across origins to this local server; open the local interface to use server retrieval.

The public page includes the existing public browser projection: 734 original records, seven project records and fourteen lessons. It also includes the original catalogue of 65 search routes and 248 country profiles. These carriers preserve original identifiers and source metadata. They contain no browser memory, private notes, excluded files or restored archives. `python server/build_public_search.py` rebuilds them from verified original shards and the separate public registry/catalogue.

| Capability | Public page | Local backend |
| --- | --- | --- |
| Orbit notes, editing, import/export, local learning | On device | On device |
| BM25 local ranking and goal Must/Prefer/Avoid filters | Yes | Yes |
| Original record API, metadata filters, relations, traversal, microdata | Yes | Verified corpus endpoint |
| Projects, I/R/P/O records, invariants and lessons | Yes | Verified corpus endpoint |
| Wikipedia, OpenAlex, Crossref, Internet Archive, GitHub | Browser requests, subject to provider CORS/rate limits | Server requests with time and response bounds |
| 65 search routes, country hints and category filtering | Explicit source links | Original route planner |
| Crossref and Europe PMC legacy retrieval | Source links | Direct retrieval |
| Context proposals after typing pauses | Local rules and available public source titles | Same |
| S′ language model | Not connected | Not connected |

API routes:

- `GET /api/health` and `/api/capabilities`
- `GET /api/corpus`: manifest hash/length verification, original source UOIDs and separate registry.
- `GET /api/search?q=...&providers=wikipedia,openalex,crossref,archive,github&goal=...&must=...&prefer=...&avoid=...&offset=0&limit=12`: bounded five-provider retrieval and candidate ranking.
- `GET /api/routes`: catalogue. Add `q`, `country` and `category` to plan source links.
- `GET /api/legacy-search?q=...&country=...&category=research`: the preserved Crossref/Europe PMC search carrier.

External candidates retain retrieval provenance. Provider failures are reported separately and never treated as evidence that no results exist. Counts describe the returned candidate window, not the entire web. Query typing and context analysis do not call external search providers. Only the user's explicit web-search action or source-link click sends the composed query. Local notes and learned answers are excluded from record-derived web-context proposals.

The event horizon is a visual metaphor. It prefers WebGPU, then WebGL2, then Canvas2D; rendering initializes before the application and index. Motion honors reduced-motion settings and pauses in hidden tabs.

Checks:

```sh
node --test docs/workspace/*.test.mjs
python -m unittest discover -s server -p 'test_*.py'
python validate.py --integrity-only
```

Browser checks in GitHub Actions exercise desktop/mobile layouts, reduced-motion/fallback, Orbit persistence, contextual refinement, five-provider requests and real local-backend integration. Provider fixture tests validate integration; they are not evidence of current provider availability.
