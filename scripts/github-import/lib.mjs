// Shared helpers for the GitHub import: dataset loading, payload building and SQL generation.
// No network access and no secrets here. Imported by scripts/import.mjs and the tests.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));

export const SOLUTION_FILES = ['sanand0', 'jivraj-18', 'sujalpradhan', 'hrmiitm'].map((id) => `solutions-${id}.json`);
/** The previous fictional demo users (removed by cleanup) and the seeded users (ids use their own prefix). */
export const OLD_DEMO_ID_PREFIX = '5eed0000-';
export const SEED_USER_ID_PREFIX = '5eed1000-';
export const SIMULATED_PREFIX = '[Simulated test history]';

const iso = (v) => new Date(v).toISOString();
const day = (v) => iso(v).slice(0, 10);
const slugify = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

/** Real emails live in the git-ignored accounts.json; a fresh clone falls back to the placeholder template. */
function readAccounts() {
  try {
    return read('accounts.json').accounts;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return read('accounts.example.json').accounts.map((a) => ({ ...a, placeholder: true }));
  }
}

export function loadDataset() {
  const accounts = readAccounts();
  const meta = read('repo-metadata.json').repos;
  const simulated = read('simulated-history.json').scenarios;
  const sims = Object.fromEntries(Object.entries(simulated).map(([k, v]) => [k.toLowerCase(), v]));
  const solutions = SOLUTION_FILES.flatMap((f) => read(f)).map((s) => {
    const account = accounts.find((a) => a.id === s.account);
    const repo = meta[s.repo.toLowerCase()];
    if (!account) throw new Error(`Unknown account ${s.account} for ${s.repo}`);
    if (!repo) throw new Error(`No repository metadata for ${s.repo}`);
    return { ...s, accountInfo: account, repoMeta: repo, payload: buildPayload(s, repo), simulatedEvents: sims[s.repo.toLowerCase()] ?? [] };
  });
  return { accounts, solutions };
}

function blobUrl(repo, link) {
  const base = link.raw ? `https://raw.githubusercontent.com/${repo.repo}/${repo.defaultBranch}/` : `${repo.url}/blob/${repo.defaultBranch}/`;
  return base + encodeURI(link.path);
}

export function buildPayload(s, repo) {
  const resources = [{ label: 'GitHub repository', url: repo.url, type: 'repository' }];
  for (const l of s.links ?? []) {
    resources.push({ label: l.label, url: l.url ?? blobUrl(repo, l), type: l.type });
  }
  const licence = repo.license && repo.license !== 'NOASSERTION' ? ` · ${repo.license} licence` : '';
  const sections = [
    `> **Imported from GitHub:** [${repo.repo}](${repo.url}) · created ${day(repo.createdAt)} · last pushed ${day(repo.pushedAt)}${licence}`,
    ...(repo.isFork ? [`> **Fork:** ${repo.repo} is a fork of [${repo.parent}](https://github.com/${repo.parent}). ${s.attribution}`] : []),
    `## Overview\n${s.overview}`,
    `## Key capabilities\n${s.capabilities.map((c) => `- ${c}`).join('\n')}`,
    `## Potential use cases\n${s.useCases.map((c) => `- ${c}`).join('\n')}`,
    ...(s.note ? [`## Notes\n${s.note}`] : []),
    `## Source\nImported from the public GitHub repository [${repo.repo}](${repo.url}). Dates on this card are the repository's own. This card's visibility on SolutionHub is independent of the repository's visibility on GitHub.`,
  ];
  const md = sections.join('\n\n');
  return {
    input: {
      title: s.title,
      summary: s.summary,
      descriptionMd: md,
      type: s.type,
      category: s.category,
      technologies: s.technologies,
      keywords: s.keywords,
      resources,
      visibility: s.visibility,
    },
    source: {
      kind: 'github',
      repo: repo.repo,
      url: repo.url,
      createdAt: iso(repo.createdAt),
      pushedAt: iso(repo.pushedAt),
      license: repo.license ?? null,
      isFork: repo.isFork,
      parent: repo.parent ?? null,
    },
  };
}

// --- Initial status -----------------------------------------------------------

/** At most this many of each user's solutions start as Ongoing; the rest start as Completed. */
export const ONGOING_PER_ACCOUNT = 2;
export const COMPLETED_MESSAGE = 'Marked completed in the initial data (not derived from repository activity)';

/**
 * Initial status per solution: for each account, the ONGOING_PER_ACCOUNT most recently pushed repositories
 * (ties broken by creation date, then name) are 'ongoing'; all others are 'completed'.
 */
export function initialStatuses(solutions) {
  const status = new Map();
  const byAccount = Map.groupBy(solutions, (s) => s.account);
  for (const list of byAccount.values()) {
    const ranked = [...list].sort(
      (a, b) =>
        Date.parse(b.payload.source.pushedAt) - Date.parse(a.payload.source.pushedAt) ||
        Date.parse(b.payload.source.createdAt) - Date.parse(a.payload.source.createdAt) ||
        a.repoMeta.repo.localeCompare(b.repoMeta.repo),
    );
    ranked.forEach((s, i) => status.set(s.repoMeta.repo, i < ONGOING_PER_ACCOUNT ? 'ongoing' : 'completed'));
  }
  return status;
}

// --- SQL ---------------------------------------------------------------------

export const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

/** Deterministic UUID-shaped id, so re-running the seed never duplicates rows. */
export function stableId(...parts) {
  const h = createHash('sha1').update(['solutionhub-seed', ...parts].join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Removes the previous fictional demo users (and, via ON DELETE CASCADE, their solutions and history).
 * Only users that have no Google identity and carry the demo id prefix are touched. For a local reset,
 * the seeded users are removed as well so simulated history can be regenerated.
 */
export function cleanupSql({ resetSeeded = false } = {}) {
  const prefixes = [OLD_DEMO_ID_PREFIX, ...(resetSeeded ? [SEED_USER_ID_PREFIX] : [])];
  return `DELETE FROM users WHERE google_id IS NULL AND (${prefixes.map((p) => `id LIKE '${p}%'`).join(' OR ')});`;
}

/**
 * Seeds the four users (no Google identity: the first Google sign-in with the same verified email takes the
 * account over, see worker/src/services/users.ts) and their 33 solutions. Idempotent: users and solutions
 * use INSERT OR IGNORE with deterministic ids, so owner edits are never overwritten.
 *
 * `existing` maps account id -> existing user id (a user who already signed in keeps owning their solutions).
 * `simulated` adds clearly labelled SIMULATED history; use it for local testing only.
 */
export function seedSql(data = loadDataset(), { existing = {}, simulated = false, now = Date.now() } = {}) {
  const lines = [];
  const stamp = iso(now);
  const ownerOf = {};
  data.accounts.forEach((a, i) => {
    ownerOf[a.id] = existing[a.id] ?? `${SEED_USER_ID_PREFIX}0000-4000-8000-00000000000${i + 1}`;
    if (!existing[a.id]) {
      lines.push(
        `INSERT OR IGNORE INTO users (id, google_id, username, name, email, avatar_url, org_domain, created_at, updated_at) VALUES (${[ownerOf[a.id], null, a.localUsername, a.name, a.email.toLowerCase(), null, a.orgDomain ?? null, stamp, stamp].map(q).join(', ')});`,
      );
    }
  });
  for (const s of data.solutions) {
    const ownerId = ownerOf[s.account];
    const id = stableId('solution', s.repoMeta.repo.toLowerCase());
    const createdAt = s.payload.source.createdAt;
    const pushedAt = s.payload.source.pushedAt;
    const initial = initialStatuses(data.solutions).get(s.repoMeta.repo);
    let status = initial;
    let completedAt = initial === 'completed' ? pushedAt : null;
    let updatedAt = pushedAt;
    const events = [[createdAt, 'created', `Imported from GitHub: ${s.repoMeta.repo}`, { source: 'github', repo: s.repoMeta.repo, repoCreatedAt: createdAt, repoPushedAt: pushedAt }]];
    if (initial === 'completed') events.push([pushedAt, 'status_changed', COMPLETED_MESSAGE, { from: 'ongoing', to: 'completed', reason: 'initial-data' }]);
    for (const e of simulated ? s.simulatedEvents : []) {
      const at = new Date(Date.parse(s.payload.source.pushedAt) + e.dayOffset * 86_400_000 + 3_600_000).toISOString();
      if (Date.parse(at) > now) throw new Error(`Simulated event for ${s.repoMeta.repo} is in the future`);
      if ((e.kind === 'complete' && status === 'completed') || (e.kind === 'reopen' && status === 'ongoing')) {
        throw new Error(`Simulated ${e.kind} for ${s.repoMeta.repo} does not fit its state (${status})`);
      }
      if (e.kind === 'complete') {
        status = 'completed';
        completedAt = at;
        events.push([at, 'status_changed', `${SIMULATED_PREFIX} Marked as completed`, { from: 'ongoing', to: 'completed', simulated: true }]);
      } else if (e.kind === 'reopen') {
        status = 'ongoing';
        completedAt = null;
        events.push([at, 'status_changed', `${SIMULATED_PREFIX} Reopened`, { from: 'completed', to: 'ongoing', simulated: true }]);
      } else {
        events.push([at, 'progress_updated', `${SIMULATED_PREFIX} Progress update used to exercise the history timeline; this is not repository activity.`, { simulated: true }]);
      }
      updatedAt = at;
    }
    const p = s.payload.input;
    lines.push(
      `INSERT OR IGNORE INTO solutions (id, owner_id, title, slug, summary, description_md, client, type, industry, function, category, technologies, keywords, resources, thumbnail_url, primary_resource, visibility, status, created_at, updated_at, completed_at) VALUES (` +
        [id, ownerId, p.title, slugify(p.title), p.summary, p.descriptionMd, null, p.type, '[]', '[]', JSON.stringify(p.category), JSON.stringify(p.technologies), JSON.stringify(p.keywords), JSON.stringify(p.resources), null, null, p.visibility, status, createdAt, updatedAt, completedAt].map(q).join(', ') +
        `);`,
    );
    // Rows seeded by an earlier run of this script (all 'ongoing') are corrected in place, but only while still
    // untouched: any edit by the owner bumps updated_at, which makes this a no-op.
    if (initial === 'completed' && !simulated) {
      lines.push(`UPDATE solutions SET status = 'completed', completed_at = ${q(pushedAt)} WHERE id = ${q(id)} AND status = 'ongoing' AND updated_at = ${q(pushedAt)};`);
    }
    events.forEach(([at, type, message, changes], i) => {
      lines.push(
        `INSERT OR IGNORE INTO solution_updates (id, solution_id, author_id, event_type, message, changes, created_at) VALUES (${[stableId('event', id, i), id, ownerId, type, message, JSON.stringify(changes), at].map(q).join(', ')});`,
      );
    });
  }
  return lines;
}
