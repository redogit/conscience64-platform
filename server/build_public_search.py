#!/usr/bin/env python3
"""Rebuild only the existing public browser projection and route catalogue."""
import json
from pathlib import Path
from search_server import load_corpus, route_catalogue

def restricted(value):
    if not isinstance(value, (dict, list)):
        return False
    if isinstance(value, list):
        return any(restricted(item) for item in value)
    if value.get('derived_from_private_history') is True:
        return True
    for key in ('privacy_origin', 'privacyOrigin'):
        origin = value.get(key)
        if isinstance(origin, dict) and origin.get('classification') == 'private-history-method-only':
            return True
    if value.get('publication_allowed') is False and value.get('requires_independent_regrounding') is True:
        return True
    return any(restricted(item) for item in value.values())

def main():
    target = Path(__file__).resolve().parents[1] / 'docs' / 'workspace'
    for filename, payload in [('public-corpus.json', load_corpus()), ('public-routes.json', route_catalogue())]:
        if restricted(payload):
            raise ValueError('Restricted source cannot enter a public search carrier.')
        payload['engine'] = 'public-projection'
        (target / filename).write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        print(filename)

if __name__ == '__main__':
    main()
