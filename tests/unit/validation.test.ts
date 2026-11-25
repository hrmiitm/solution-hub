import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectResourceType, safeHttpUrl, youtubeId } from '../../worker/src/lib/resources.ts';
import { slugify } from '../../worker/src/lib/util.ts';
import { deriveSummary, validateSolutionInput, validateUpdateMessage } from '../../worker/src/lib/validation.ts';
import { searchTerms } from '../../worker/src/services/solutions.ts';
import { baseUsername } from '../../worker/src/services/users.ts';

test('safeHttpUrl rejects dangerous schemes and credentials', () => {
  assert.equal(safeHttpUrl('https://github.com/a/b'), 'https://github.com/a/b');
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'ftp://x.org', 'https://user:pw@host.com', '//evil.com', 'not a url', '', 42]) {
    assert.equal(safeHttpUrl(bad), null, String(bad));
  }
  assert.equal(safeHttpUrl(`https://a.com/${'x'.repeat(3000)}`), null);
});

test('detectResourceType classifies common URLs', () => {
  const cases: [string, string][] = [
    ['https://www.youtube.com/watch?v=aircAruvnKk', 'youtube'],
    ['https://youtu.be/aircAruvnKk', 'youtube'],
    ['https://www.youtube.com/shorts/aircAruvnKk', 'youtube'],
    ['https://docs.google.com/presentation/d/abc/edit', 'slides'],
    ['https://arxiv.org/pdf/1706.03762', 'pdf'],
    ['https://example.com/paper.PDF', 'pdf'],
    ['https://example.com/a.png', 'image'],
    ['https://images.unsplash.com/photo-1?w=800', 'image'],
    ['https://raw.githubusercontent.com/o/r/main/README.md', 'markdown'],
    ['https://example.com/notes.txt', 'text'],
    ['https://github.com/openai/whisper', 'repository'],
    ['https://gitlab.com/group/project', 'repository'],
    ['https://huggingface.co/openai/whisper-large-v3', 'model'],
    ['https://huggingface.co/spaces/org/demo', 'demo'],
    ['https://docs.python.org/3/', 'documentation'],
    ['https://my-app.vercel.app', 'demo'],
    ['https://example.com/about', 'link'],
  ];
  for (const [url, type] of cases) assert.equal(detectResourceType(url), type, url);
  assert.equal(youtubeId('https://www.youtube.com/watch?v=<script>'), null);
});

test('slugify produces URL-safe slugs', () => {
  assert.equal(slugify('Live Translation (v2)!'), 'live-translation-v2');
  assert.equal(slugify('Crème Brûlée'), 'creme-brulee');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify('a'.repeat(100)).length, 60);
});

test('baseUsername derives from email', () => {
  assert.equal(baseUsername({ email: 'Ada.Lovelace@gmail.com', name: 'Ada' }), 'ada-lovelace');
  assert.equal(baseUsername({ email: 'x@y.com', name: '' }), 'user-x');
});

test('validateSolutionInput requires title and description on create', () => {
  assert.throws(() => validateSolutionInput({}, false), (e: any) => e.code === 'validation_failed' && !!e.details.title && !!e.details.descriptionMd);
  assert.throws(() => validateSolutionInput([], false), (e: any) => e.code === 'bad_request');
  const ok = validateSolutionInput({ title: '  Hello \u0000 world ', descriptionMd: 'Body' }, false);
  assert.equal(ok.title, 'Hello world');
  assert.equal(ok.status, undefined);
});

test('validateSolutionInput validates enums, URLs, and lists', () => {
  const bad = { title: 'T', descriptionMd: 'D', type: 'virus', visibility: 'secret', status: 'done', thumbnailUrl: 'javascript:x', resources: [{ label: 'x', url: 'javascript:alert(1)' }] };
  assert.throws(() => validateSolutionInput(bad, false), (e: any) => ['type', 'visibility', 'status', 'thumbnailUrl', 'resources[0].url'].every((k) => k in e.details));
  assert.throws(() => validateSolutionInput({ industry: Array.from({ length: 11 }, (_, i) => `i${i}`) }, true), (e: any) => 'industry' in e.details);
  assert.throws(() => validateSolutionInput({ title: 'x'.repeat(121) }, true), (e: any) => 'title' in e.details);

  const v = validateSolutionInput(
    { keywords: ['LLM', 'llm', ' Android ', ''], resources: [{ label: '', url: 'https://github.com/a/b' }, { label: 'dup', url: 'https://github.com/a/b' }] },
    true,
  );
  assert.deepEqual(v.keywords, ['llm', 'android']);
  assert.equal(v.resources?.length, 1);
  assert.deepEqual(v.resources?.[0], { label: 'github.com', url: 'https://github.com/a/b', type: 'repository' });
  assert.equal(v.title, undefined, 'partial updates leave absent fields undefined');
});

test('validateUpdateMessage requires a message', () => {
  assert.throws(() => validateUpdateMessage({ message: '   ' }));
  assert.equal(validateUpdateMessage({ message: ' done \r\n next ' }), 'done \n next');
});

test('deriveSummary strips markdown and truncates at a word boundary', () => {
  assert.equal(deriveSummary('# Title\n\nSome **bold** [link](https://x.y) text'), 'Some bold link text');
  assert.equal(deriveSummary('- [bad](javascript:alert(1)) end'), 'bad end');
  const long = deriveSummary('word '.repeat(100), 50);
  assert.ok(long.length <= 51 && long.endsWith('…'));
});

test('searchTerms normalizes whitespace, case, and caps the count', () => {
  assert.deepEqual(searchTerms('  Audio   FORENSICS  '), ['audio', 'forensics']);
  assert.deepEqual(searchTerms('c++ .net c#'), ['c++', '.net', 'c#']);
  assert.equal(searchTerms('a b c d e f g h i j k').length, 8);
  assert.deepEqual(searchTerms("'; DROP TABLE users; --"), ['drop', 'table', 'users']);
});
