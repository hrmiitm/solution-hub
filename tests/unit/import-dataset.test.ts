import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialStatuses, loadDataset, seedSql, SIMULATED_PREFIX } from '../../scripts/github-import/lib.mjs';
import { safeHttpUrl } from '../../worker/src/lib/resources.ts';
import { validateSolutionInput } from '../../worker/src/lib/validation.ts';

const data = loadDataset();
const by = (account: string) => data.solutions.filter((s: { account: string }) => s.account === account);
const count = (account: string, v: string) => by(account).filter((s: any) => s.payload.input.visibility === v).length;

test('dataset has the 33 requested solutions with the requested visibility split', () => {
  assert.deepEqual(['sanand0', 'jivraj-18', 'sujalpradhan', 'hrmiitm'].map((a) => by(a).length), [10, 10, 10, 3]);
  for (const a of ['sanand0', 'jivraj-18', 'sujalpradhan']) assert.deepEqual([count(a, 'public'), count(a, 'organization'), count(a, 'private')], [6, 2, 2], a);
  assert.deepEqual([count('hrmiitm', 'public'), count('hrmiitm', 'organization'), count('hrmiitm', 'private')], [2, 0, 1]);
});

test('every payload passes the production input validation unchanged', () => {
  for (const s of data.solutions) {
    const v = validateSolutionInput(s.payload.input, false);
    assert.equal(v.summary, s.payload.input.summary, `${s.repo} summary altered`);
    assert.equal(v.keywords?.length, s.payload.input.keywords.length, `${s.repo} keywords`);
    assert.equal(v.technologies?.length, s.payload.input.technologies.length, `${s.repo} technologies`);
    assert.equal(v.resources?.length, s.payload.input.resources.length, `${s.repo} resources`);
  }
});

test('every post is identified as imported from GitHub, links its repository and has 3-5 capabilities', () => {
  for (const s of data.solutions) {
    const md = s.payload.input.descriptionMd;
    assert.match(md, /Imported from GitHub/, s.repo);
    const caps = md.split('## Key capabilities')[1]!.split('## ')[0]!.match(/^- /gm) ?? [];
    assert.ok(caps.length >= 3 && caps.length <= 5, `${s.repo}: ${caps.length}`);
    assert.equal(s.payload.input.resources[0]!.url, s.repoMeta.url);
    assert.ok(Date.parse(s.payload.source.createdAt) <= Date.parse(s.payload.source.pushedAt));
  }
});

test('URLs are valid; no emails, secrets or unreachable links; the fork keeps attribution', () => {
  for (const s of data.solutions) {
    for (const r of s.payload.input.resources) assert.ok(safeHttpUrl(r.url), `${s.repo}: ${r.url}`);
    const text = JSON.stringify(s.payload);
    assert.ok(!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text), `${s.repo} contains an email`);
    assert.ok(!/(api[_-]?key|secret|password|token)\s*[:=]\s*\S{6,}/i.test(text) && !/\bsk-[A-Za-z0-9]{16,}/.test(text), s.repo);
    assert.ok(!text.includes('onrender.com') && !text.includes('chatgpt.site'));
  }
  const fork = data.solutions.find((s: any) => s.repo === 'Jivraj-18/nl_to_sql')!;
  assert.match(fork.payload.input.descriptionMd, /fork of \[HArsh-ri01\/nl_to_sql\]/);
  assert.match(fork.payload.input.descriptionMd, /does not claim sole authorship/);
});

test('seed SQL is idempotent by construction and keeps simulated history local-only and labelled', () => {
  const sql = seedSql(data);
  assert.ok(sql.every((l: string) => l.startsWith('INSERT OR IGNORE') || l.startsWith('UPDATE solutions SET status')), 'inserts are INSERT OR IGNORE; the only update is the guarded refresh');
  assert.ok(sql.filter((l: string) => l.startsWith('UPDATE')).every((l: string) => / WHERE id = '[^']+' AND updated_at = '[^']+';$/.test(l)), 'the refresh never touches rows the owner has edited');
  assert.equal(sql.filter((l: string) => l.includes('INTO solutions')).length, 33);
  assert.ok(!sql.join('\n').includes('simulated'), 'production seed has no simulated history');
  const local = seedSql(data, { simulated: true }).join('\n');
  assert.ok(local.includes(SIMULATED_PREFIX) && local.includes('"simulated":true'));
  assert.deepEqual(seedSql(data, { now: 1 << 30 }).length, sql.length);
  // Ids are deterministic across runs.
  assert.deepEqual(seedSql(data).filter((l: string) => l.includes('INTO solutions'))[0], sql.filter((l: string) => l.includes('INTO solutions'))[0]);
});

test('at most two solutions per user start Ongoing: the most recently pushed ones; the rest are Completed', () => {
  const status = initialStatuses(data.solutions);
  for (const a of ['sanand0', 'jivraj-18', 'sujalpradhan', 'hrmiitm']) {
    const mine = by(a).sort((x: any, y: any) => Date.parse(y.payload.source.pushedAt) - Date.parse(x.payload.source.pushedAt));
    assert.deepEqual(mine.map((s: any) => status.get(s.repoMeta.repo)), mine.map((_: unknown, i: number) => (i < 2 ? 'ongoing' : 'completed')), a);
  }
  const ongoing = data.solutions.filter((s: any) => status.get(s.repoMeta.repo) === 'ongoing').map((s: any) => s.repoMeta.repo).sort();
  assert.deepEqual(ongoing, ['Jivraj-18/cad-bench', 'Jivraj-18/machine-sound-diagnosis', 'SujalPradhan/automatic-brand-placement-audit', 'SujalPradhan/content-dna-analyzer', 'hrmiitm/fde', 'hrmiitm/llm-dl-models-benchmarkings', 'sanand0/scripts', 'sanand0/skills']);
  const sql = seedSql(data).join('\n');
  assert.equal((sql.match(/'ongoing', '20\d\d-[^']*', '20\d\d-[^']*', NULL\);/g) ?? []).length, 8, 'eight ongoing rows have no completion date');
  assert.equal((sql.match(/Marked completed in the initial data/g) ?? []).length, 25);
  assert.ok(seedSql(data, { simulated: true }).length > 0, 'simulated sequences fit the initial states');
});

const isMedia = (r: { type: string; url: string }) =>
  ['youtube', 'image', 'pdf', 'slides'].includes(r.type) || /(^|\.)(youtube\.com|youtu\.be)$/.test(new URL(r.url).hostname) || (r.type === 'documentation' && new URL(r.url).hostname.endsWith('anthropic.com'));

test('at least 70% of solutions carry an image, document, video or slides; previews and thumbnails are consistent', () => {
  const withMedia = data.solutions.filter((s: any) => s.payload.input.resources.some(isMedia));
  assert.ok(withMedia.length / data.solutions.length >= 0.7, `${withMedia.length}/${data.solutions.length}`);
  for (const s of data.solutions) {
    const { resources, primaryResource, thumbnailUrl } = s.payload.input;
    if (primaryResource) assert.ok(resources.some((r: any) => r.url === primaryResource), `${s.repo}: primary must be one of its resources`);
    if (thumbnailUrl) {
      const r = resources.find((x: any) => x.url === thumbnailUrl);
      assert.equal(r?.type, 'image', `${s.repo}: thumbnail must be one of its image resources`);
    }
    for (const r of resources) {
      assert.equal(r.url, new URL(r.url).toString(), `${s.repo}: URL not normalised`);
      assert.ok(r.label.length > 0 && r.label.length <= 100);
    }
    assert.ok(resources.length <= 20);
  }
});

test('YouTube resources are real watch URLs and papers are arXiv PDFs', () => {
  for (const s of data.solutions) {
    for (const r of s.payload.input.resources) {
      if (r.type === 'youtube') assert.match(r.url, /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/);
      if (r.type === 'pdf' && r.url.includes('arxiv.org')) assert.match(r.url, /^https:\/\/arxiv\.org\/pdf\/\d{4}\.\d{4,5}$/);
    }
  }
});
