# Adaptive Space Lens

The user approved implementation of the older Conscience64 interface with the changes developed in this conversation: white/red/black/grey, a fluid inline builder using local character Markov completion followed by selectable descriptors, integrated search in one device-adaptive view, and no horizontal or vertical page scrolling.

The original Space Lens field/console/result arrangement is the reference. Header and edge navigation remain compact. The renderer initializes before the controller and corpus; WebGPU, WebGL2 and Canvas2D fallback remain available. The previous large event-horizon headline and separated descriptor panel are replaced by the inline console.

Chosen words form an editable prefix beside the active input. Completing a word can expose whole-query context suggestions; no suggestion is mandatory. Keyboard Backspace revisits the last chosen word, caret editing preserves following words, and composition events do not submit or change chosen words. Missing descriptor values require explicit user input. Draft values survive viewport changes.

Grid capacity adapts to available width and height. All results remain reachable through Previous/Next. Long tools menus retain controls and values while paged, and source text is split into reversible character-preserving pages. Very short viewports move the explicit Web action to navigation and expose Reset through Tools. Input fields retain normal text editing; page and menu surfaces do not scroll.

Existing local/public/backend search, advanced filters, 65 route planning, notes, teachings, aliases, history, import/export, relation inspection and source provenance remain available. No S′ model or external Orbital library is claimed connected.

Verification includes the existing pure and Python suites, local note lifecycle, actual backend/corpus browser checks, five provider fixtures, and adaptive browser tests covering portrait/landscape/keyboard-sized viewports down to 320×240. Native device keyboards and full WCAG conformance require separate testing; no such certification is claimed.
