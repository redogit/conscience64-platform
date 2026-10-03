"""Offline localhost backend contract tests; only provider transport is mocked."""
from __future__ import annotations
import base64
import gzip
import hashlib
import http.client
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

SERVER_PATH = Path(__file__).with_name('search_server.py')
REPO_CORPUS = Path(__file__).resolve().parents[1] / 'conscience64'
if SERVER_PATH.exists():
    spec = importlib.util.spec_from_file_location('search_server', SERVER_PATH)
    backend = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backend)
else:
    backend = None


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fixture(root):
    records = [{'uoid': 'uoid:sha256:' + 'a' * 64, 'logicalId': 'original:one',
                'objectType': 'research-node', 'label': 'Original source',
                'authority': 'INHERITED', 'description': 'Recovered public graph'}]
    raw = json.dumps(records, separators=(',', ':')).encode()
    transport = base64.b64encode(gzip.compress(raw, mtime=0))
    shards = []
    for index in range(6):
        chunk = transport[index * len(transport) // 6:(index + 1) * len(transport) // 6]
        name = f'data-{index:02d}.txt'
        (root / name).write_bytes(chunk)
        shards.append({'path': name, 'bytes': len(chunk), 'sha256': sha(chunk), 'state': 'PAYLOAD'})
    (root / 'data-06.txt').write_bytes(b'')
    shards.append({'path': 'data-06.txt', 'bytes': 0, 'sha256': sha(b''), 'state': 'RESERVED_CONTINUATION'})
    manifest = {'schema': 'conscience64.transport-manifest/v1',
                'corpusUoid': records[0]['uoid'], 'transportEncoding': 'base64(gzip(utf8(json)))',
                'shards': shards, 'recordCount': 1, 'decodedBytes': len(raw),
                'decodedSha256': sha(raw), 'source': {'archive': 'never-open.zip', 'archiveSha256': 'b' * 64}}
    (root / 'data-manifest.json').write_text(json.dumps(manifest))
    registry = {'schema': 'conscience64/research-project-registry/v1',
                'projects': [{'id': 'newer:project', 'title': 'Separate registry'}],
                'lessons': [{'id': 'lesson:one'}], 'invariants': ['Authority stays distinct']}
    registry_dir = root / 'research' / 'projects'
    registry_dir.mkdir(parents=True)
    (registry_dir / 'projects.json').write_text(json.dumps(registry))
    return manifest, records, registry


def repack_records(root, manifest, records):
    """Build a genuine valid-hash transport around a test-only record mutation."""
    raw = json.dumps(records, separators=(',', ':')).encode()
    transport = base64.b64encode(gzip.compress(raw, mtime=0))
    for index, shard in enumerate(manifest['shards'][:6]):
        chunk = transport[index * len(transport) // 6:(index + 1) * len(transport) // 6]
        (root / shard['path']).write_bytes(chunk)
        shard.update(bytes=len(chunk), sha256=sha(chunk))
    manifest.update(decodedBytes=len(raw), decodedSha256=sha(raw), recordCount=len(records))
    (root / 'data-manifest.json').write_text(json.dumps(manifest))


SAMPLES = {
    'wikipedia': {'query': {'search': [{'pageid': 42, 'title': 'Orbit mechanics', 'snippet': '<span>Orbit</span> &amp; mechanics'}]}},
    'openalex': {'results': [{'id': 'https://openalex.org/W123', 'display_name': 'Orbit paper',
                             'doi': 'https://doi.org/10.1000/orbit', 'publication_year': 2024,
                             'abstract_inverted_index': {'Orbit': [0], 'mechanics': [1]}}]},
    'crossref': {'message': {'items': [{'DOI': '10.1000/orbit', 'title': ['Orbit methods'],
                                      'abstract': '<jats:p>Orbit mechanics</jats:p>', 'publisher': 'Example Press'}]}},
    'archive': {'response': {'docs': [{'identifier': 'orbit-book', 'title': 'Orbit book',
                                             'description': ['Orbit mechanics'], 'mediatype': 'texts'}]}},
    'github': {'items': [{'id': 123, 'full_name': 'example/orbit', 'description': 'Orbit mechanics',
                          'html_url': 'https://github.com/example/orbit', 'stargazers_count': 12}]},
}


class ContractTest(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(backend, 'The localhost search backend is not implemented yet')

    def test_real_corpus_verifies_six_payloads_and_preserves_original_records(self):
        corpus = backend.load_corpus(REPO_CORPUS)
        manifest = json.loads((REPO_CORPUS / 'data-manifest.json').read_text())
        raw = gzip.decompress(base64.b64decode(b''.join((REPO_CORPUS / row['path']).read_bytes()
                              for row in manifest['shards'] if row['state'] == 'PAYLOAD')))
        self.assertEqual(corpus['records'], json.loads(raw))
        self.assertEqual(len(corpus['records']), 734)
        self.assertEqual(corpus['verification']['payloadShardCount'], 6)
        self.assertEqual(corpus['manifest'], manifest)
        self.assertEqual(corpus['corpusUoid'], manifest['corpusUoid'])
        self.assertEqual(corpus['verification']['decodedSha256'], sha(raw))
        self.assertEqual(corpus['registry']['schema'], 'conscience64/research-project-registry/v1')
        self.assertEqual(len(corpus['registry']['projects']), 7)
        self.assertEqual(len(corpus['registry']['lessons']), 14)
        self.assertTrue(corpus['registrySource']['separateFromCorpus'])
        self.assertNotIn('newer:project', {r.get('logicalId') for r in corpus['records']})

    def test_fixture_keeps_registry_separate_without_opening_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, records, registry = fixture(root)
            corpus = backend.load_corpus(root)
            self.assertEqual(corpus['records'], records)
            self.assertEqual(corpus['registry'], registry)
            self.assertEqual(corpus['manifest']['source'], manifest['source'])
            self.assertFalse((root / 'never-open.zip').exists())

    def test_restricted_origin_is_rejected_even_with_valid_transport_hashes(self):
        markers = [
            {'privacy_origin': {'classification': 'private-history-method-only'}},
            {'privacyOrigin': {'classification': 'private-history-method-only'}},
            {'derived_from_private_history': True},
            {'publication_allowed': False, 'requires_independent_regrounding': True},
        ]
        for target in ('records', 'registry', 'manifest'):
            for marker in markers:
                with self.subTest(target=target, marker=marker), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    manifest, records, registry = fixture(root)
                    nested = {'wrapper': [{'nested': marker}]}
                    if target == 'records':
                        records[0]['data'] = nested
                        repack_records(root, manifest, records)
                    elif target == 'registry':
                        registry['lessons'][0]['data'] = nested
                        (root / 'research/projects/projects.json').write_text(json.dumps(registry))
                    else:
                        manifest['projection'] = nested
                        (root / 'data-manifest.json').write_text(json.dumps(manifest))
                    with self.assertRaises(backend.CorpusError): backend.load_corpus(root)

    def test_transport_tampering_and_manifest_length_are_rejected(self):
        for field in ('bytes', 'sha256', 'decodedBytes', 'decodedSha256', 'recordCount'):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                manifest, _, _ = fixture(root)
                if field == 'bytes': manifest['shards'][0][field] += 1
                elif field == 'sha256': manifest['shards'][0][field] = '0' * 64
                elif field == 'decodedSha256': manifest[field] = '0' * 64
                else: manifest[field] += 1
                (root / 'data-manifest.json').write_text(json.dumps(manifest))
                with self.assertRaises(backend.CorpusError): backend.load_corpus(root)

    def test_shard_paths_cannot_escape_corpus_and_reserved_bytes_stay_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, _, _ = fixture(root)
            manifest['shards'][0]['path'] = '../private.json'
            (root / 'data-manifest.json').write_text(json.dumps(manifest))
            with self.assertRaises(backend.CorpusError): backend.load_corpus(root)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture(root)
            (root / 'data-06.txt').write_text('guessed continuation')
            with self.assertRaises(backend.CorpusError): backend.load_corpus(root)

    def test_valid_shard_hashes_do_not_hide_a_corrupt_gzip_stream(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, _, _ = fixture(root)
            transport = base64.b64encode(b'\x1f\x8b\x08\x00' + b'\x00' * 6 + b'\xff' * 20 + b'\x00' * 8)
            for index, shard in enumerate(manifest['shards'][:6]):
                chunk = transport[index * len(transport) // 6:(index + 1) * len(transport) // 6]
                (root / shard['path']).write_bytes(chunk)
                shard.update(bytes=len(chunk), sha256=sha(chunk))
            (root / 'data-manifest.json').write_text(json.dumps(manifest))
            try:
                backend.load_corpus(root)
            except Exception as exc:
                self.assertIsInstance(exc, backend.CorpusError, 'Corrupt compressed bytes must be a corpus verification failure')
            else:
                self.fail('Corrupt gzip stream was accepted')

    def test_decode_limit_prevents_gzip_bomb(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture(root)
            with patch.object(backend, 'MAX_DECODED_BYTES', 20):
                with self.assertRaises(backend.CorpusError): backend.load_corpus(root)

    def test_provider_endpoints_are_fixed_and_query_encoded(self):
        expected = {'wikipedia': ('en.wikipedia.org', '/w/api.php', 'srsearch', 'srlimit'),
                    'openalex': ('api.openalex.org', '/works', 'search', 'per_page'),
                    'crossref': ('api.crossref.org', '/works', 'query', 'rows'),
                    'archive': ('archive.org', '/advancedsearch.php', 'q', 'rows'),
                    'github': ('api.github.com', '/search/repositories', 'q', 'per_page')}
        for provider, (host, path, query_key, limit_key) in expected.items():
            with self.subTest(provider=provider):
                endpoint = backend.provider_endpoint(provider, 'orbit & test? +', 30)
                url = urlsplit(endpoint)
                params = parse_qs(url.query)
                self.assertEqual((url.scheme, url.hostname, url.path), ('https', host, path))
                self.assertEqual(params[query_key], ['orbit & test? +'])
                self.assertEqual(params[limit_key], ['30'])
        with self.assertRaises(ValueError): backend.provider_endpoint('http://127.0.0.1', 'orbit')

    def test_all_providers_normalize_candidate_only_metadata(self):
        for provider, sample in SAMPLES.items():
            with self.subTest(provider=provider):
                endpoint = backend.provider_endpoint(provider, 'orbit')
                rows = backend.normalize_results(provider, sample, endpoint, '2026-10-03T00:00:00+00:00', 'c' * 64)
                self.assertEqual(len(rows), 1)
                row = rows[0]
                for key in ('id', 'refId', 'title', 'text', 'snippet', 'source', 'url', 'reason', 'score'): self.assertIn(key, row)
                self.assertEqual(row['kind'], 'web')
                self.assertEqual(row['providerId'], provider)
                self.assertEqual(row['provider'], backend.PROVIDERS[provider]['name'])
                self.assertEqual(row['authority'], 'EXTERNAL_CANDIDATE')
                self.assertEqual(row['metadata']['relation'], 'CANDIDATE_ONLY')
                self.assertFalse(row['metadata']['corroborated'])
                self.assertEqual(row['provenance'][0]['endpoint'], endpoint)
                self.assertEqual(row['provenance'][0]['retrievedAt'], '2026-10-03T00:00:00+00:00')
                self.assertEqual(row['provenance'][0]['responseSha256'], 'c' * 64)
                self.assertNotIn('uoid', row)
                self.assertNotIn('<', row['text'])
                self.assertNotIn('truth', row)

    def test_browser_contract_uses_archive_id_and_url_valued_source(self):
        self.assertIn('archive', backend.PROVIDERS, 'Browser archive provider ID is missing')
        samples = SAMPLES
        for provider in ('wikipedia', 'openalex', 'crossref', 'archive', 'github'):
            with self.subTest(provider=provider):
                endpoint = backend.provider_endpoint(provider, 'orbit')
                row = backend.normalize_results(provider, samples[provider], endpoint, 'now', 'x')[0]
                self.assertEqual(row['source'], row['url'])
                self.assertIn(urlsplit(row['source']).scheme, {'http', 'https'})
                self.assertEqual(row['providerId'], provider)
                self.assertEqual(row['provider'], backend.PROVIDERS[provider]['name'])
        with patch.object(backend, 'fetch_json', return_value=(samples['archive'], sha(b'archive'))):
            result = backend.search('orbit', providers=['archive'])
        self.assertEqual(result['results'][0]['providerId'], 'archive')

    def test_entity_encoded_html_is_plain_candidate_text(self):
        sample = {'query': {'search': [{'pageid': 42, 'title': 'Orbit',
                                      'snippet': '&lt;b&gt;Orbit&lt;/b&gt; &amp; mechanics'}]}}
        row = backend.normalize_results('wikipedia', sample, backend.provider_endpoint('wikipedia', 'orbit'), 'now', 'x')[0]
        self.assertEqual(row['text'], 'Orbit & mechanics')

    def test_unsafe_provider_result_links_and_malformed_rows_are_not_exposed(self):
        sample = {'items': [{'full_name': 'danger', 'html_url': 'javascript:alert(1)'},
                            {'full_name': 'local', 'html_url': 'http://127.0.0.1/private'}, 'bad row']}
        self.assertEqual(backend.normalize_results('github', sample, backend.provider_endpoint('github', 'test'), 'now', 'x'), [])

    def test_partial_provider_error_keeps_success_and_never_implies_absence(self):
        def fetch(endpoint):
            if urlsplit(endpoint).hostname == 'api.github.com': raise TimeoutError('secret must not be leaked')
            return SAMPLES['wikipedia'], sha(b'wiki')
        with patch.object(backend, 'fetch_json', side_effect=fetch):
            result = backend.search('orbit', providers=['wikipedia', 'github'])
        self.assertEqual(len(result['results']), 1)
        self.assertEqual(result['errors'][0]['provider'], 'github')
        self.assertIn('unavailable', result['errors'][0]['message'].lower())
        self.assertNotIn('secret', json.dumps(result))
        self.assertEqual(result['mode'], 'web')
        self.assertEqual(result['engine'], 'localhost')
        self.assertFalse(result['totalIsExact'])
        self.assertTrue(result['bounded'])

    def test_goal_must_prefer_avoid_are_applied_before_pagination(self):
        sample = {'items': [{'id': n, 'full_name': name, 'description': text,
                            'html_url': 'https://github.com/example/' + str(n)} for n, name, text in [
                            (1, 'Orbit basic', 'mechanics'), (2, 'Orbit preferred', 'mechanics future'),
                            (3, 'Orbit blocked', 'mechanics secret'), (4, 'Orbit irrelevant', 'other')]]}
        with patch.object(backend, 'fetch_json', return_value=(sample, sha(b'sample'))):
            first = backend.search('orbit', providers=['github'], goal='future', must='mechanics', prefer='preferred', avoid='secret', limit=1)
            second = backend.search('orbit', providers=['github'], goal='future', must='mechanics', prefer='preferred', avoid='secret', limit=1, offset=1)
        self.assertEqual(first['total'], 2)
        self.assertEqual(first['results'][0]['title'], 'Orbit preferred')
        self.assertEqual(second['results'][0]['title'], 'Orbit basic')
        self.assertTrue(first['hasNext'])
        self.assertFalse(first['hasPrevious'])
        self.assertTrue(second['hasPrevious'])
        self.assertFalse(second['hasNext'])
        self.assertIn('goal', first['results'][0]['reason'].lower())

    def test_candidate_snapshot_precedes_context_filters(self):
        sample = {'items': [{'id': 1, 'full_name': 'Orbit mechanics', 'description': 'required',
                            'html_url': 'https://github.com/example/one'},
                           {'id': 2, 'full_name': 'Orbit other', 'description': 'different',
                            'html_url': 'https://github.com/example/two'}]}
        with patch.object(backend, 'fetch_json', return_value=(sample, sha(b'snapshot'))):
            result = backend.search('orbit', providers=['github'], must='required', limit=1)
        self.assertIn('candidateResults', result, 'Unfiltered candidate snapshot is missing')
        self.assertEqual(result['totalRaw'], 2)
        self.assertEqual(len(result['candidateResults']), 2)
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['candidateResults'][1]['authority'], 'EXTERNAL_CANDIDATE')

    def test_prepared_query_is_not_expanded_with_raw_context(self):
        endpoints = []
        def fetch(endpoint):
            endpoints.append(endpoint)
            return SAMPLES['github'], sha(b'sample')
        self.assertIn('prepared_query', __import__('inspect').signature(backend.search).parameters,
                      'Prepared provider query support is missing')
        with patch.object(backend, 'fetch_json', side_effect=fetch):
            backend.search('orbit prepared', providers=['github'], goal='private raw goal',
                           must='title:secret OR evil', prepared_query=True)
        self.assertEqual(parse_qs(urlsplit(endpoints[0]).query)['q'], ['orbit prepared'])

    def test_default_added_context_is_encoded_as_query_data(self):
        endpoints = []
        def fetch(endpoint):
            endpoints.append(endpoint)
            return SAMPLES['github'], sha(b'sample')
        with patch.object(backend, 'fetch_json', side_effect=fetch):
            result = backend.search('orbit', providers=['github'], goal='future goal',
                                   must='title:secret OR evil', prefer='AND \"quoted\"')
        query = parse_qs(urlsplit(endpoints[0]).query)['q'][0]
        self.assertIn('future goal', query, 'Context query composition is missing')
        self.assertIn('title secret or evil', query)
        self.assertNotIn('title:', query)
        self.assertNotIn(' OR ', query)
        self.assertNotIn(' AND ', query)
        self.assertEqual(query, result['providerQuery'])

    def test_default_search_fetches_only_five_configured_providers(self):
        endpoints = []
        def fetch(endpoint):
            endpoints.append(endpoint)
            return {}, sha(b'empty')
        with patch.object(backend, 'fetch_json', side_effect=fetch):
            result = backend.search('orbit')
        self.assertEqual(len(endpoints), 5)
        self.assertEqual(len(result['providerRuns']), 5)
        self.assertEqual({r['provider'] for r in result['providerRuns']}, set(SAMPLES))
        self.assertTrue(all('30' in endpoint for endpoint in endpoints))

    def test_invalid_queries_and_provider_names_are_rejected_before_fetch(self):
        with patch.object(backend, 'fetch_json') as fetch:
            for args in ({'query': ''}, {'query': 'x' * 2049}, {'query': 'orbit', 'providers': ['unknown']},
                         {'query': 'orbit', 'offset': -1}, {'query': 'orbit', 'limit': 0}, {'query': 'orbit', 'limit': 51}):
                with self.subTest(args=args), self.assertRaises(ValueError): backend.search(**args)
            fetch.assert_not_called()

    def test_transport_has_response_limit_timeout_and_rejects_generic_proxy(self):
        with self.assertRaises(ValueError): backend.fetch_json('https://example.com/arbitrary')
        class Response(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        class Opener:
            def open(self, request, timeout):
                self.request, self.timeout = request, timeout
                return Response(b'x' * 101)
        opener = Opener()
        with patch.object(backend, 'MAX_PROVIDER_BYTES', 100), patch.object(backend, 'build_opener', return_value=opener):
            with self.assertRaises(ValueError): backend.fetch_json(backend.provider_endpoint('github', 'test'))
        self.assertLessEqual(opener.timeout, 15)
        self.assertEqual(opener.request.get_header('Accept'), 'application/json')

    def test_redirects_are_never_followed(self):
        with self.assertRaises(ValueError): backend.NoRedirect().redirect_request(None, None, 302, 'redirect', {}, 'http://127.0.0.1/private')

    def test_legacy_catalogue_preserves_country_category_and_policy_metadata(self):
        self.assertTrue(hasattr(backend, 'route_catalogue'), 'Legacy catalogue API is missing')
        catalogue = backend.route_catalogue(REPO_CORPUS)
        self.assertEqual(catalogue['capabilities']['routeCount'], 65)
        self.assertGreaterEqual(len(catalogue['countries']), 240)
        self.assertEqual(catalogue['capabilities']['directProviders'], ['crossref', 'europepmc'])
        self.assertIn('blocked_roots', catalogue['policy'])
        self.assertTrue(catalogue['source']['searchSha256'])
        plan = backend.route_plan('orbit', 'US', 'research', REPO_CORPUS)
        self.assertTrue(all(row['category'] == 'research' for row in plan['routes']))
        self.assertEqual(plan['country'], 'US')
        self.assertIn('United States', plan['effective_query'])
        self.assertEqual(plan['source'], catalogue['source'])

    def test_explicit_legacy_retrieval_is_separate_and_candidate_only(self):
        self.assertTrue(hasattr(backend, 'legacy_search'), 'Legacy retrieval API is missing')
        legacy = backend.legacy_module(REPO_CORPUS)
        class Response(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        class Opener:
            def open(self, request, timeout):
                if 'api.crossref.org' in request.full_url:
                    data = SAMPLES['crossref']
                else:
                    data = {'resultList': {'result': [{'id': '42', 'source': 'MED', 'title': 'Orbit paper'}]}}
                return Response(json.dumps(data).encode())
        with patch.object(legacy, 'build_opener', return_value=Opener()):
            result = backend.legacy_search('orbit', 'US', 'research', REPO_CORPUS)
        self.assertEqual(result['mode'], 'legacy-web')
        self.assertEqual(len(result['provider_runs']), 2)
        self.assertEqual({r['provider'] for r in result['provider_runs']}, {'crossref', 'europepmc'})
        self.assertTrue(all(r['relation'] == 'CANDIDATE_ONLY' for r in result['results']))
        self.assertFalse(result['authority_transfer'])
        self.assertTrue(result['source']['catalogSha256'])

    def test_optional_legacy_routes_are_planned_without_network(self):
        with patch.object(backend, 'fetch_json', side_effect=AssertionError('No network for plans')):
            plan = backend.route_plan('orbit', corpus_root=REPO_CORPUS)
        self.assertEqual(len(plan['routes']), 65)
        self.assertFalse(plan['authority_transfer'])
        self.assertTrue(all(row['url'].startswith('https://') for row in plan['routes']))


class HTTPTest(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(backend, 'The localhost search backend is not implemented yet')
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.docs = self.root / 'docs'
        self.docs.mkdir()
        (self.docs / 'index.html').write_text('<html>Workspace only</html>')
        self.corpus = self.root / 'conscience64'
        self.corpus.mkdir()
        fixture(self.corpus)
        (self.root / 'private.txt').write_text('Never static')
        self.server = backend.make_server(port=0, docs_root=self.docs, corpus_root=self.corpus)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        if hasattr(self, 'server'):
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(timeout=2)
            self.temp.cleanup()

    def request(self, path, method='GET', headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=2)
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        body = response.read()
        status, response_headers = response.status, dict(response.getheaders())
        connection.close()
        return status, response_headers, body

    def test_health_capabilities_corpus_and_static_routes(self):
        self.assertEqual(self.server.server_address[0], '127.0.0.1')
        self.assertEqual(self.request('/api/health')[0], 200)
        status, headers, raw = self.request('/api/capabilities')
        capabilities = json.loads(raw)
        self.assertEqual(status, 200)
        self.assertEqual(len(capabilities['providers']), 5)
        self.assertTrue(capabilities['corpus']['available'])
        self.assertEqual(capabilities['corpus']['recordCount'], 1)
        self.assertEqual(capabilities['corpus']['payloadShardCount'], 6)
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(json.loads(self.request('/api/corpus')[2])['records'][0]['logicalId'], 'original:one')
        self.assertIn(b'Workspace only', self.request('/')[2])

    def test_no_research_static_no_traversal_no_generic_proxy_no_directory_index(self):
        (self.docs / 'empty').mkdir()
        for path in ('/conscience64/data-manifest.json', '/research/projects/projects.json', '/data-00.txt',
                     '/../private.txt', '/%2e%2e/private.txt', '/empty/', '/api/proxy?url=https://example.com'):
            with self.subTest(path=path): self.assertIn(self.request(path)[0], {400, 403, 404})
        (self.docs / 'leak.txt').symlink_to(self.root / 'private.txt')
        self.assertEqual(self.request('/leak.txt')[0], 403)

    def test_nonlocal_host_and_origin_are_rejected(self):
        self.assertEqual(self.request('/api/corpus', headers={'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.request('/api/corpus', headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('/api/corpus', headers={'Origin': f'http://127.0.0.1:{self.port}'})[0], 200)

    def test_readonly_routes_and_bounded_query_inputs(self):
        self.assertEqual(self.request('/api/search?q=orbit', method='POST')[0], 405)
        self.assertEqual(self.request('/api/search?q=orbit&limit=999')[0], 400)
        self.assertEqual(self.request('/api/search?q=orbit&providers=unknown')[0], 400)
        self.assertEqual(self.request('/api/search?q=orbit&url=http://127.0.0.1')[0], 400)
        self.assertEqual(self.request('/api/search?q=' + 'x' * 2100)[0], 400)

    def test_search_http_preserves_parameters(self):
        with patch.object(backend, 'fetch_json', return_value=(SAMPLES['github'], sha(b'github'))):
            status, _, raw = self.request('/api/search?q=orbit&providers=github&must=mechanics&goal=mechanics&offset=0&limit=1')
        result = json.loads(raw)
        self.assertEqual(status, 200)
        self.assertEqual(result['results'][0]['providerId'], 'github')
        self.assertEqual(result['limit'], 1)
        self.assertEqual(len(result['providerRuns']), 1)

    def test_restricted_origin_corpus_returns_503_without_exposing_payload(self):
        manifest = json.loads((self.corpus / 'data-manifest.json').read_text())
        records = [{'uoid': 'uoid:sha256:' + 'a' * 64,
                    'logicalId': 'restricted:test', 'data': {'derived_from_private_history': True,
                    'text': 'restricted payload sentinel'}}]
        repack_records(self.corpus, manifest, records)
        status, _, raw = self.request('/api/corpus')
        self.assertEqual(status, 503)
        self.assertNotIn(b'restricted payload sentinel', raw)
        self.assertFalse(json.loads(self.request('/api/capabilities')[2])['corpus']['available'])

    def test_corpus_tamper_is_unavailable_not_a_false_empty_corpus(self):
        (self.corpus / 'data-00.txt').write_text('damaged')
        status, _, raw = self.request('/api/corpus')
        self.assertEqual(status, 503)
        self.assertIn('verification', json.loads(raw)['error'].lower())
        self.assertFalse(json.loads(self.request('/api/capabilities')[2])['corpus']['available'])


if __name__ == '__main__':
    unittest.main()
