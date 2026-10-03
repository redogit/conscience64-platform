#!/usr/bin/env python3
"""Bounded, stdlib-only localhost search and verified public-corpus carrier.

Run explicitly with ``python platform/server/search_server.py --port 8765``.
Only platform/docs is a static root. Corpus access uses the manifest and exact
public registry path; archives and other research files are never served.
Provider results remain external candidates and do not gain corpus identities.
"""
from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import gzip
from functools import lru_cache
import hashlib
from html import unescape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import ipaddress
import json
import mimetypes
from pathlib import Path
import re
import threading
import unicodedata
import zlib
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

PLATFORM_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DOCS_ROOT = PLATFORM_ROOT / 'docs'
DEFAULT_CORPUS_ROOT = PLATFORM_ROOT / 'conscience64'
REGISTRY_PATH = 'research/projects/projects.json'
LEGACY_PLAN_PATH = 'research/cross-carrier/2026-09-13/internal-update/global_search/search.py'
MAX_MANIFEST_BYTES = 128_000
MAX_TRANSPORT_BYTES = 2_000_000
MAX_DECODED_BYTES = 8_000_000
MAX_REGISTRY_BYTES = 2_000_000
MAX_PROVIDER_BYTES = 2_000_000
MAX_RESPONSE_BYTES = 12_000_000
MAX_STATIC_BYTES = 5_000_000
PROVIDER_TIMEOUT = 12
CANDIDATES_PER_PROVIDER = 30
MAX_QUERY_LENGTH = 2048
MAX_REQUEST_TARGET = 16_384
PROVIDERS = {
    'wikipedia': {'id': 'wikipedia', 'name': 'Wikipedia', 'endpoint': 'https://en.wikipedia.org/w/api.php'},
    'openalex': {'id': 'openalex', 'name': 'OpenAlex', 'endpoint': 'https://api.openalex.org/works'},
    'crossref': {'id': 'crossref', 'name': 'Crossref', 'endpoint': 'https://api.crossref.org/works'},
    'archive': {'id': 'archive', 'name': 'Internet Archive', 'endpoint': 'https://archive.org/advancedsearch.php'},
    'github': {'id': 'github', 'name': 'GitHub', 'endpoint': 'https://api.github.com/search/repositories'},
}


class CorpusError(ValueError):
    """Public corpus transport or registry failed bounded verification."""


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _read_bounded(path, maximum):
    with path.open('rb') as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError('File exceeds the configured byte limit.')
    return raw


def _inside(path, root):
    return path.resolve().is_relative_to(root.resolve())


def contains_restricted_origin(value, seen=None):
    """Match the preserved private-origin boundary across nested JSON carriers."""
    if not isinstance(value, (dict, list)):
        return False
    if seen is None:
        seen = set()
    identity = id(value)
    if identity in seen:
        return False
    seen.add(identity)
    if isinstance(value, dict):
        if value.get('derived_from_private_history') is True:
            return True
        for key in ('privacy_origin', 'privacyOrigin'):
            origin = value.get(key)
            if isinstance(origin, dict) and origin.get('classification') == 'private-history-method-only':
                return True
        if value.get('publication_allowed') is False and value.get('requires_independent_regrounding') is True:
            return True
        children = value.values()
    else:
        children = value
    return any(contains_restricted_origin(child, seen) for child in children)


def load_corpus(corpus_root=DEFAULT_CORPUS_ROOT):
    """Verify ordered transport and return unchanged source records plus registry.

    Source UOIDs describe original semantic objects; decodedSha256 describes the
    projected browser bytes. No UOID is recomputed from this projection.
    """
    root = Path(corpus_root).resolve()
    try:
        manifest_path = root / 'data-manifest.json'
        if not _inside(manifest_path, root):
            raise ValueError('Manifest must stay within the corpus root.')
        manifest = json.loads(_read_bounded(manifest_path, MAX_MANIFEST_BYTES))
        if (manifest.get('schema') != 'conscience64.transport-manifest/v1'
                or manifest.get('transportEncoding') != 'base64(gzip(utf8(json)))'):
            raise ValueError('Unsupported corpus transport manifest.')
        shards = manifest.get('shards')
        if not isinstance(shards, list):
            raise ValueError('Missing ordered shard declarations.')
        transport = bytearray()
        seen, payload_count = set(), 0
        for shard in shards:
            name = shard.get('path', '')
            if not isinstance(name, str) or not re.fullmatch(r'data-\d+\.txt', name) or name in seen:
                raise ValueError('Invalid or duplicate transport shard path.')
            seen.add(name)
            path = root / name
            if not _inside(path, root):
                raise ValueError('Shard must stay within corpus root.')
            expected = shard.get('bytes')
            if type(expected) is not int or not 0 <= expected <= MAX_TRANSPORT_BYTES:
                raise ValueError('Invalid shard byte declaration.')
            raw = _read_bounded(path, expected)
            if len(raw) != expected or _sha(raw) != shard.get('sha256'):
                raise ValueError('Transport shard hash or length mismatch.')
            state = shard.get('state')
            if state == 'PAYLOAD':
                if not raw:
                    raise ValueError('Payload shard is empty.')
                payload_count += 1
                transport.extend(raw)
                if len(transport) > MAX_TRANSPORT_BYTES:
                    raise ValueError('Corpus transport exceeds byte limit.')
            elif state == 'RESERVED_CONTINUATION':
                if raw:
                    raise ValueError('Reserved continuation is not recovered knowledge.')
            else:
                raise ValueError('Unknown shard state.')
        if payload_count != 6:
            raise ValueError('Expected six verified source payload shards.')
        expected_decoded = manifest.get('decodedBytes')
        if type(expected_decoded) is not int or not 0 < expected_decoded <= MAX_DECODED_BYTES:
            raise ValueError('Invalid decoded byte declaration.')
        compressed = base64.b64decode(bytes(transport), validate=True)
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            decoded = stream.read(expected_decoded + 1)
        if len(decoded) != expected_decoded or _sha(decoded) != manifest.get('decodedSha256'):
            raise ValueError('Decoded corpus hash or length mismatch.')
        records = json.loads(decoded.decode('utf-8'))
        if (not isinstance(records, list) or len(records) != manifest.get('recordCount')
                or not all(isinstance(row, dict) and isinstance(row.get('uoid'), str) for row in records)):
            raise ValueError('Decoded corpus record count or source identities mismatch.')
        registry_path = root / REGISTRY_PATH
        if not _inside(registry_path, root):
            raise ValueError('Registry must stay within corpus root.')
        registry_raw = _read_bounded(registry_path, MAX_REGISTRY_BYTES)
        registry = json.loads(registry_raw)
        if (not isinstance(registry, dict)
                or registry.get('schema') != 'conscience64/research-project-registry/v1'
                or not isinstance(registry.get('projects'), list)):
            raise ValueError('Invalid separate public project registry.')
        if contains_restricted_origin([records, registry, manifest]):
            raise ValueError('Restricted-origin material cannot enter the searchable corpus carrier.')
        return {
            'schema': 'orbit.local-corpus/v1', 'engine': 'localhost',
            'corpusUoid': manifest.get('corpusUoid'), 'records': records,
            'manifest': manifest,
            'verification': {'verified': True, 'payloadShardCount': payload_count,
                             'recordCount': len(records), 'decodedBytes': len(decoded),
                             'decodedSha256': _sha(decoded)},
            'registry': registry,
            'registrySource': {'path': REGISTRY_PATH, 'sha256': _sha(registry_raw),
                               'separateFromCorpus': True, 'identity': 'registry-source-bytes'},
        }
    except (OSError, ValueError, TypeError, AttributeError, EOFError, OverflowError, RecursionError, zlib.error) as exc:
        raise CorpusError('Corpus verification failed: ' + str(exc)) from exc


def provider_endpoint(provider, query, limit=CANDIDATES_PER_PROVIDER):
    if provider not in PROVIDERS:
        raise ValueError('Unknown provider; choose an explicitly configured provider.')
    limit = int(limit)
    if not 1 <= limit <= CANDIDATES_PER_PROVIDER:
        raise ValueError('Provider result bound is 1–30.')
    if provider == 'wikipedia':
        params = {'action': 'query', 'list': 'search', 'srsearch': query,
                  'srlimit': limit, 'srprop': 'snippet', 'format': 'json', 'utf8': 1}
    elif provider == 'openalex':
        params = {'search': query, 'per_page': limit, 'page': 1}
    elif provider == 'crossref':
        params = {'query': query, 'rows': limit, 'offset': 0}
    elif provider == 'archive':
        params = {'q': query, 'rows': limit, 'page': 1, 'output': 'json',
                  'fl[]': ['identifier', 'title', 'description', 'mediatype', 'creator', 'date']}
    else:
        params = {'q': query, 'per_page': limit, 'page': 1}
    return PROVIDERS[provider]['endpoint'] + '?' + urlencode(params, doseq=True)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Provider redirects are not followed.')


def fetch_json(endpoint):
    """Transport for fixed public endpoints only; no arbitrary URL proxy."""
    parsed = urlsplit(endpoint)
    base = parsed.scheme + '://' + parsed.netloc + parsed.path
    if (base not in {p['endpoint'] for p in PROVIDERS.values()}
            or parsed.username or parsed.password or parsed.fragment):
        raise ValueError('Only fixed provider endpoints may be fetched.')
    request = Request(endpoint, headers={'Accept': 'application/json',
        'User-Agent': 'OrbitLocalSearch/1.0 (bounded public metadata retrieval)'})
    with build_opener(NoRedirect()).open(request, timeout=PROVIDER_TIMEOUT) as response:
        raw = response.read(MAX_PROVIDER_BYTES + 1)
        if len(raw) > MAX_PROVIDER_BYTES:
            raise ValueError('Provider response exceeded the byte limit.')
    data = json.loads(raw)
    if not isinstance(data, dict) or data.get('error') or data.get('errors'):
        raise ValueError('Provider returned an invalid response.')
    return data, _sha(raw)


def _plain(value, limit=6000):
    if isinstance(value, list):
        value = ' '.join(str(v) for v in value[:30] if isinstance(v, (str, int, float)))
    if not isinstance(value, (str, int, float)):
        return ''
    return ' '.join(re.sub(r'<[^>]*>', ' ', unescape(str(value))).split())[:limit]


def _safe_link(value):
    if not isinstance(value, str) or len(value) > 4096:
        return ''
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or '').rstrip('.').lower()
        if (parsed.scheme != 'https' or not host or parsed.username or parsed.password
                or parsed.port not in (None, 443) or host in {'localhost', 'localhost.localdomain'}
                or host.endswith(('.localhost', '.local', '.internal'))):
            return ''
        try:
            if not ipaddress.ip_address(host).is_global:
                return ''
        except ValueError:
            if '.' not in host:
                return ''
        return value
    except ValueError:
        return ''


def _abstract(index):
    if not isinstance(index, dict):
        return ''
    words = {}
    for word, positions in list(index.items())[:2000]:
        if isinstance(word, str) and isinstance(positions, list):
            for position in positions[:1000]:
                if type(position) is int and 0 <= position < 1000:
                    words[position] = word
    return _plain(' '.join(words[p] for p in sorted(words)))


def normalize_results(provider, payload, endpoint, retrieved_at, response_sha256):
    """Extract provider metadata; identity/authority never transfer to candidates."""
    if provider not in PROVIDERS or not isinstance(payload, dict):
        raise ValueError('Invalid provider response.')
    if provider == 'wikipedia':
        block = payload.get('query', {})
        items = block.get('search', []) if isinstance(block, dict) else []
    elif provider == 'openalex':
        items = payload.get('results', [])
    elif provider == 'crossref':
        block = payload.get('message', {})
        items = block.get('items', []) if isinstance(block, dict) else []
    elif provider == 'archive':
        block = payload.get('response', {})
        items = block.get('docs', []) if isinstance(block, dict) else []
    else:
        items = payload.get('items', [])
    if not isinstance(items, list):
        raise ValueError('Invalid provider result list.')
    result = []
    for row in items[:CANDIDATES_PER_PROVIDER]:
        if not isinstance(row, dict):
            continue
        details = {}
        if provider == 'wikipedia':
            title, text, source_id = row.get('title'), row.get('snippet'), row.get('pageid')
            if source_id is None or not title:
                continue
            url = 'https://en.wikipedia.org/?curid=' + quote(str(source_id), safe='')
            details = {'pageId': source_id}
        elif provider == 'openalex':
            title, text, source_id = row.get('display_name') or row.get('title'), _abstract(row.get('abstract_inverted_index')), row.get('id')
            url = _safe_link(row.get('doi')) or _safe_link(row.get('id'))
            details = {'openAlexId': row.get('id'), 'doi': row.get('doi'), 'publicationYear': row.get('publication_year')}
        elif provider == 'crossref':
            titles = row.get('title')
            title = titles[0] if isinstance(titles, list) and titles else titles
            text, source_id = row.get('abstract') or row.get('publisher'), row.get('DOI') or row.get('URL')
            url = 'https://doi.org/' + quote(str(row['DOI']), safe='/') if row.get('DOI') else row.get('URL')
            details = {'doi': row.get('DOI'), 'publisher': _plain(row.get('publisher'))}
        elif provider == 'archive':
            title, text, source_id = row.get('title'), row.get('description'), row.get('identifier')
            if not source_id:
                continue
            url = 'https://archive.org/details/' + quote(str(source_id), safe='')
            details = {'identifier': source_id, 'mediaType': row.get('mediatype'), 'date': _plain(row.get('date'))}
        else:
            title, text, source_id = row.get('full_name') or row.get('name'), row.get('description'), row.get('id') or row.get('full_name')
            url = row.get('html_url')
            details = {'repositoryId': row.get('id'), 'stars': row.get('stargazers_count')}
        url = _safe_link(url)
        title = _plain(title, 600)
        if not url or not title:
            continue
        text = _plain(text)
        identity = 'external:' + provider + ':' + _sha(url.encode('utf-8'))[:24]
        result.append({'id': identity, 'refId': identity, 'title': title,
            'text': text, 'snippet': text[:600], 'source': url,
            'url': url, 'kind': 'web', 'provider': PROVIDERS[provider]['name'],
            'providerId': provider, 'providerName': PROVIDERS[provider]['name'],
            'authority': 'EXTERNAL_CANDIDATE', 'score': 0,
            'reason': 'Retrieved provider candidate; source verification remains separate.',
            'metadata': {**details, 'sourceId': source_id, 'relation': 'CANDIDATE_ONLY',
                         'corroborated': False, 'authorityTransfer': False},
            'provenance': [{'provider': provider, 'endpoint': endpoint,
                            'retrievedAt': retrieved_at, 'responseSha256': response_sha256,
                            'relation': 'CANDIDATE_ONLY'}]})
    return result


def _terms(value):
    return re.findall(r'\w+', unicodedata.normalize('NFKC', value).casefold())


def _constraints(value):
    if isinstance(value, (list, tuple)):
        value = ','.join(str(v) for v in value)
    if not isinstance(value, str) or len(value) > MAX_QUERY_LENGTH:
        raise ValueError('Search constraints must be at most 2048 characters.')
    return [v.strip().casefold() for v in value.split(',') if v.strip()]


def _query_data(value):
    # Context fields are data, even when a provider supports query operators.
    value = unicodedata.normalize('NFKC', value)
    value = re.sub(r'[\x00-\x1f\x7f:"\\]', ' ', value)
    value = re.sub(r'\b(?:AND|OR|NOT)\b', lambda match: match.group().lower(), value)
    value = ' '.join(value.split())
    return ('"' + value + '"') if ' ' in value else value


def search(query, providers=None, goal='', must='', prefer='', avoid='', offset=0, limit=12, prepared_query=False):
    if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY_LENGTH:
        raise ValueError('Enter a query of 1–2048 characters.')
    if not isinstance(goal, str) or len(goal) > MAX_QUERY_LENGTH:
        raise ValueError('Goal must be at most 2048 characters.')
    if type(offset) is not int or not 0 <= offset <= 150 or type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError('Offset must be 0–150 and limit 1–50.')
    if providers is None:
        selected = list(PROVIDERS)
    elif isinstance(providers, str):
        selected = [p.strip() for p in providers.split(',') if p.strip()]
    elif isinstance(providers, (list, tuple)):
        selected = list(providers)
    else:
        raise ValueError('Providers must be an explicit list of configured IDs.')
    if not selected or any(not isinstance(p, str) or p not in PROVIDERS for p in selected):
        raise ValueError('Choose one or more explicitly configured providers.')
    selected = list(dict.fromkeys(selected))
    required, preferred, excluded = _constraints(must), _constraints(prefer), _constraints(avoid)
    query = query.strip()
    if type(prepared_query) is not bool:
        raise ValueError('prepared_query must be a boolean.')
    additions = [_query_data(value) for value in [goal, *required, *preferred] if value.strip()]
    provider_query = query if prepared_query else ' '.join([query, *additions])
    if len(provider_query) > MAX_QUERY_LENGTH:
        raise ValueError('Composed provider query exceeds 2048 characters.')
    runs, candidates = {}, []

    def retrieve(provider):
        endpoint = provider_endpoint(provider, provider_query)
        payload, digest = fetch_json(endpoint)
        stamp = datetime.now(timezone.utc).isoformat()
        rows = normalize_results(provider, payload, endpoint, stamp, digest)
        return rows, {'provider': provider, 'status': 'ok', 'count': len(rows),
                      'endpoint': endpoint, 'retrievedAt': stamp, 'responseSha256': digest}

    with ThreadPoolExecutor(max_workers=len(selected)) as executor:
        futures = {executor.submit(retrieve, provider): provider for provider in selected}
        for future in as_completed(futures):
            provider = futures[future]
            try:
                rows, run = future.result()
                candidates.extend(rows)
                runs[provider] = run
            except Exception as exc:
                runs[provider] = {'provider': provider, 'status': 'unavailable', 'count': 0,
                    'error': type(exc).__name__,
                    'message': PROVIDERS[provider]['name'] + ' unavailable; this is not evidence of absence.',
                    'endpoint': provider_endpoint(provider, provider_query)}
    merged = {}
    for row in sorted(candidates, key=lambda r: (selected.index(r['providerId']), r['id'])):
        if row['url'] in merged:
            merged[row['url']]['provenance'].extend(row['provenance'])
        else:
            merged[row['url']] = row
    q, g, ranked = _terms(query), _terms(goal), []
    for row in merged.values():
        title = row['title'].casefold()
        hay = ' '.join([row['title'], row['text'], row['source']]).casefold()
        if any(term not in hay for term in required) or any(term in hay for term in excluded):
            continue
        words = set(_terms(hay))
        matches, goal_matches = [t for t in q if t in words], [t for t in g if t in words]
        preference_matches = [t for t in preferred if t in hay]
        score = sum(8 if t in title else 2 for t in matches) + 2 * len(goal_matches) + 3 * len(preference_matches)
        reason = ('Matched ' + ', '.join(matches)) if matches else 'Provider candidate for this query'
        if goal_matches:
            reason += '; goal: ' + ', '.join(goal_matches)
        if preference_matches:
            reason += '; preferred: ' + ', '.join(preference_matches)
        if required:
            reason += '; all required terms present'
        ranked.append({**row, 'score': score, 'reason': reason, 'goalMatches': goal_matches, 'required': required})
    ranked.sort(key=lambda row: (-row['score'], row['title'].casefold(), row['id']))
    ordered_runs = [runs[p] for p in selected]
    errors = [run for run in ordered_runs if run['status'] != 'ok']
    return {'schema': 'orbit.web-search/v1', 'mode': 'web', 'engine': 'localhost',
            'query': query, 'providerQuery': provider_query, 'preparedQuery': prepared_query,
            'providers': selected, 'goal': goal, 'results': ranked[offset:offset + limit],
            'candidateResults': list(merged.values()), 'totalRaw': len(merged),
            'total': len(ranked), 'totalIsExact': False, 'bounded': True,
            'candidateLimitPerProvider': CANDIDATES_PER_PROVIDER, 'offset': offset, 'limit': limit,
            'hasPrevious': offset > 0, 'hasNext': offset + limit < len(ranked),
            'providerRuns': ordered_runs, 'providerErrors': errors, 'errors': errors,
            'authorityTransfer': False, 'corroborated': False,
            'unresolved': ['External candidates require source-specific verification.'] + [e['message'] for e in errors]}


@lru_cache(maxsize=4)
def legacy_module(corpus_root=DEFAULT_CORPUS_ROOT):
    """Load only the exact preserved public planner and catalogue."""
    root = Path(corpus_root).resolve()
    path = root / LEGACY_PLAN_PATH
    catalog_path = path.with_name('catalog.json')
    if not _inside(path, root) or not _inside(catalog_path, root) or not path.is_file():
        raise ValueError('Optional legacy route planner unavailable.')
    _read_bounded(path, MAX_MANIFEST_BYTES)
    _read_bounded(catalog_path, MAX_REGISTRY_BYTES)
    spec = importlib.util.spec_from_file_location('orbit_preserved_route_planner', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _legacy_source(corpus_root):
    root = Path(corpus_root).resolve()
    path = root / LEGACY_PLAN_PATH
    return {'searchPath': LEGACY_PLAN_PATH, 'searchSha256': _sha(_read_bounded(path, MAX_MANIFEST_BYTES)),
            'catalogPath': str(Path(LEGACY_PLAN_PATH).with_name('catalog.json')),
            'catalogSha256': _sha(_read_bounded(path.with_name('catalog.json'), MAX_REGISTRY_BYTES)),
            'carrier': 'preserved-global-search', 'separateFromCorpus': True}


def route_catalogue(corpus_root=DEFAULT_CORPUS_ROOT):
    module = legacy_module(corpus_root)
    return {'schema': 'orbit.legacy-route-catalogue/v1', 'mode': 'routes', 'engine': 'localhost',
            'providers': module.CATALOG['providers'], 'countries': module.CATALOG['countries'],
            'policy': module.CATALOG['policy'], 'source': _legacy_source(corpus_root),
            'capabilities': {'routeCount': len(module.plan('research')['routes']),
                             'directProviders': ['crossref', 'europepmc'],
                             'categories': ['all', 'web', 'research', 'code', 'archives'],
                             'countryScope': 'keyword hint, not geographic restriction'},
            'liveRequests': False, 'authorityTransfer': False, 'corroborated': False,
            'relation': 'CANDIDATE_ONLY'}


def route_plan(query='research', country='', category='all', corpus_root=DEFAULT_CORPUS_ROOT):
    """Invoke only the preserved route planner, without live provider requests."""
    module = legacy_module(corpus_root)
    return {**module.plan(query, country, category), 'mode': 'routes', 'engine': 'localhost',
            'source': _legacy_source(corpus_root), 'liveRequests': False, 'relation': 'CANDIDATE_ONLY'}


def legacy_search(query, country='', category='all', corpus_root=DEFAULT_CORPUS_ROOT):
    """Explicit legacy Crossref/EuropePMC retrieval, separate from /api/search.

    The preserved module keeps its exclusion policy, fixed API endpoints,
    no-redirect transport, 12-second timeout, 2 MB limit and result provenance.
    """
    module = legacy_module(corpus_root)
    return {**module.search(query, country, category), 'mode': 'legacy-web', 'engine': 'localhost',
            'source': _legacy_source(corpus_root), 'separateFromFiveProviderSearch': True,
            'relation': 'CANDIDATE_ONLY'}


def capabilities(corpus_root=DEFAULT_CORPUS_ROOT):
    try:
        corpus = load_corpus(corpus_root)
        info = {'available': True, **corpus['verification'], 'corpusUoid': corpus['corpusUoid'],
                'projectCount': len(corpus['registry']['projects']),
                'registrySeparate': True}
    except CorpusError:
        info = {'available': False, 'verified': False, 'error': 'Corpus verification unavailable.'}
    try:
        catalogue = route_catalogue(corpus_root)
        route_info = {'available': True, 'count': catalogue['capabilities']['routeCount'],
                      'countryCount': len(catalogue['countries']),
                      'directProviders': catalogue['capabilities']['directProviders'], 'liveRequests': False}
    except (OSError, ValueError, ImportError, AttributeError, KeyError):
        route_info = {'available': False, 'count': 0, 'liveRequests': False}
    return {'schema': 'orbit.local-capabilities/v1', 'engine': 'localhost', 'localOnly': True,
            'corpus': info, 'providers': [{**p, 'configured': True, 'status': 'unprobed',
                'relation': 'CANDIDATE_ONLY'} for p in PROVIDERS.values()],
            'providerCount': len(PROVIDERS), 'routes': route_info, 'staticRoot': 'platform/docs',
            'authorityTransfer': False, 'corroborated': False}


class SearchHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, docs_root, corpus_root):
        self.docs_root = Path(docs_root).resolve()
        self.corpus_root = Path(corpus_root).resolve()
        self.request_slots = threading.BoundedSemaphore(8)
        super().__init__(address, SearchHandler)

    def process_request(self, request, client_address):
        if not self.request_slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()


class SearchHandler(BaseHTTPRequestHandler):
    server_version = 'OrbitLocalSearch/1.0'

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self, format, *args):
        # Do not record users' query strings or local corpus content in logs.
        pass

    def _respond(self, status, body, content_type='application/json; charset=utf-8'):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        if len(body) > MAX_RESPONSE_BYTES:
            status, body = 503, b'{"error":"Response exceeded configured byte limit."}'
            content_type = 'application/json; charset=utf-8'
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _local_request(self):
        try:
            host = urlsplit('http://' + self.headers.get('Host', ''))
            if host.hostname not in {'127.0.0.1', 'localhost'} or host.port != self.server.server_address[1] or host.username or host.password:
                return False
            origin = self.headers.get('Origin')
            if origin:
                parsed = urlsplit(origin)
                if (parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost'}
                        or parsed.port != self.server.server_address[1] or parsed.username or parsed.password
                        or parsed.path or parsed.query or parsed.fragment):
                    return False
            return ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            return False

    def do_GET(self):
        if not self._local_request():
            self._respond(403, {'error': 'Local host and origin required.'})
            return
        if len(self.path) > MAX_REQUEST_TARGET:
            self._respond(414, {'error': 'Request target exceeds configured limit.'})
            return
        try:
            parsed = urlsplit(self.path)
            if parsed.scheme or parsed.netloc or parsed.fragment:
                raise ValueError('Absolute or fragmented request targets are not supported.')
            path = unquote(parsed.path, errors='strict')
            if '\\' in path or '\x00' in path or '..' in path.split('/'):
                self._respond(403, {'error': 'Unsafe path.'})
                return
            params = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=20)
            if any(len(v) != 1 for v in params.values()):
                raise ValueError('Duplicate query parameters are not supported.')
            args = {k: v[0] for k, v in params.items()}
            if path in {'/api/health', '/api/capabilities', '/api/corpus'}:
                if args:
                    raise ValueError('This API route accepts no query parameters.')
                if path == '/api/health':
                    self._respond(200, {'ok': True, 'engine': 'localhost', 'localOnly': True})
                elif path == '/api/capabilities':
                    self._respond(200, capabilities(self.server.corpus_root))
                else:
                    self._respond(200, load_corpus(self.server.corpus_root))
            elif path == '/api/search':
                if set(args) - {'q', 'providers', 'goal', 'must', 'prefer', 'avoid', 'offset', 'limit', 'preparedQuery'}:
                    raise ValueError('Unknown search parameter.')
                if args.get('preparedQuery', '0') not in {'0', '1'}:
                    raise ValueError('preparedQuery must be 0 or 1.')
                self._respond(200, search(args.get('q', ''), providers=args.get('providers'),
                    goal=args.get('goal', ''), must=args.get('must', ''), prefer=args.get('prefer', ''),
                    avoid=args.get('avoid', ''), offset=int(args.get('offset', 0)), limit=int(args.get('limit', 12)),
                    prepared_query=args.get('preparedQuery', '0') == '1'))
            elif path in {'/api/routes', '/api/legacy-search'}:
                if set(args) - {'q', 'country', 'category'}:
                    raise ValueError('Unknown legacy-carrier parameter.')
                if path == '/api/routes' and 'q' not in args:
                    if args:
                        raise ValueError('Provide q when selecting route country or category.')
                    self._respond(200, route_catalogue(self.server.corpus_root))
                else:
                    action = route_plan if path == '/api/routes' else legacy_search
                    self._respond(200, action(args.get('q', ''), args.get('country', ''),
                        args.get('category', 'all'), self.server.corpus_root))
            elif path.startswith('/api/'):
                self._respond(404, {'error': 'Unknown API route.'})
            else:
                target = self.server.docs_root / path.lstrip('/')
                if target.is_dir():
                    target = target / 'index.html'
                if not _inside(target, self.server.docs_root):
                    self._respond(403, {'error': 'Static path must stay within docs.'})
                elif not target.is_file():
                    self._respond(404, {'error': 'Static file unavailable.'})
                else:
                    content_type = 'text/javascript' if target.suffix == '.mjs' else (mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
                    self._respond(200, _read_bounded(target, MAX_STATIC_BYTES), content_type)
        except CorpusError:
            self._respond(503, {'error': 'Corpus verification unavailable; no partial corpus is exposed.'})
        except (ValueError, UnicodeError) as exc:
            self._respond(400, {'error': str(exc)})
        except (OSError, ImportError, AttributeError, KeyError):
            self._respond(503, {'error': 'Requested local capability unavailable.'})

    def do_HEAD(self):
        self.do_GET()

    def _readonly(self):
        self._respond(405, {'error': 'Only GET and HEAD are supported.'})

    do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = _readonly


def make_server(port=8765, docs_root=DEFAULT_DOCS_ROOT, corpus_root=DEFAULT_CORPUS_ROOT):
    if type(port) is not int or not 0 <= port <= 65535:
        raise ValueError('Port must be 0–65535.')
    return SearchHTTPServer(('127.0.0.1', port), docs_root, corpus_root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765, help='Loopback port (default: 8765).')
    args = parser.parse_args()
    server = make_server(args.port)
    print(f'Orbit workspace: http://127.0.0.1:{server.server_address[1]}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
