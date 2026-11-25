#!/usr/bin/env node
// Initial database population from the GitHub-repository dataset (scripts/github-import/). Reusable and idempotent.
//
//   node scripts/import.mjs validate                      dataset checks (no database)
//   node scripts/import.mjs check-links                   fetch every resource/thumbnail URL in the dataset (network; run before seeding)
//   node scripts/import.mjs backup [--target local|remote]
//   node scripts/import.mjs clean  [--target local|remote]   backup, then remove the old fictional demo users and their solutions
//   node scripts/import.mjs seed   [--target local|remote]   backup, clean, then create the 4 users and 33 solutions
//   node scripts/import.mjs status [--target local|remote]
//
// Local seeding also adds clearly labelled SIMULATED history (completed, reopened, updated after completion) and resets
// the seeded users first. Remote seeding never adds simulated history and never deletes seeded users or their data.
// Anything that writes to production needs --confirm-production.
//
// The seeded users have no Google identity (no subject IDs are invented). The first Google sign-in whose verified
// email (and `hd` domain) matches takes the account over; everyone is an equal user with owner-only editing.
// Preserved always: users with a Google identity, their sessions and every solution they own.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OLD_DEMO_ID_PREFIX, SEED_USER_ID_PREFIX, cleanupSql, loadDataset, q, seedSql } from './github-import/lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = join(root, 'worker');
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const target = flag('--target') ?? 'local';
if (!['local', 'remote'].includes(target)) fail('--target must be local or remote');
const where = `--${target}`;

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const wrangler = (...a) => execFileSync('npx', ['wrangler', ...a], { cwd: workerDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const query = (sql) => JSON.parse(wrangler('d1', 'execute', 'solutionhub', where, '--json', `--command=${sql}`)).flatMap((r) => r.results);

function execute(lines) {
  const file = join(mkdtempSync(join(tmpdir(), 'solutionhub-import-')), 'import.sql');
  writeFileSync(file, lines.join('\n') + '\n');
  wrangler('d1', 'execute', 'solutionhub', where, `--file=${file}`);
}

function backup() {
  const dir = join(root, 'backups'); // git-ignored; contains real data when target=remote
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${target}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
  wrangler('d1', 'export', 'solutionhub', where, `--output=${file}`);
  console.log(`backup written: ${file}`);
}

const counts = () =>
  query(
    `SELECT (SELECT count(*) FROM users) AS users,
            (SELECT count(*) FROM users WHERE google_id IS NOT NULL) AS signed_in_users,
            (SELECT count(*) FROM users WHERE google_id IS NULL AND (id LIKE '${OLD_DEMO_ID_PREFIX}%')) AS old_demo_users,
            (SELECT count(*) FROM users WHERE google_id IS NULL AND id LIKE '${SEED_USER_ID_PREFIX}%') AS unclaimed_seed_users,
            (SELECT count(*) FROM solutions) AS solutions,
            (SELECT count(*) FROM solution_updates) AS history_events`,
  )[0];

function clean({ resetSeeded }) {
  backup();
  const before = counts();
  execute([cleanupSql({ resetSeeded })]);
  const after = counts();
  console.log('before:', JSON.stringify(before));
  console.log('after: ', JSON.stringify(after));
  if (after.signed_in_users !== before.signed_in_users) fail('signed-in users changed unexpectedly');
}

if (['clean', 'seed'].includes(cmd) && target === 'remote' && !args.includes('--confirm-production')) {
  fail('this writes to the production database; re-run with --confirm-production');
}

switch (cmd) {
  case 'validate':
    console.log(`dataset OK: ${loadDataset().solutions.length} solutions`);
    break;
  case 'check-links': {
    const urls = new Map();
    for (const s of loadDataset().solutions) {
      for (const r of s.payload.input.resources) urls.set(r.url, s.repoMeta.repo);
      if (s.payload.input.thumbnailUrl) urls.set(s.payload.input.thumbnailUrl, s.repoMeta.repo);
    }
    let bad = 0;
    await Promise.all(
      [...urls].map(async ([url, repo]) => {
        try {
          const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 solutionhub-link-check', range: 'bytes=0-0' }, signal: AbortSignal.timeout(25_000) });
          // 405 is how MCP endpoints answer a plain GET; they are not listed as resources anyway.
          if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
          bad++;
          console.log(`BROKEN  ${repo}  ${url}  (${e.message})`);
        }
      }),
    );
    console.log(`${urls.size} URLs checked, ${bad} broken`);
    if (bad) process.exit(1);
    break;
  }
  case 'backup':
    backup();
    break;
  case 'clean':
    clean({ resetSeeded: false });
    break;
  case 'seed': {
    const local = target === 'local';
    clean({ resetSeeded: local });
    const data = loadDataset();
    if (!local && data.accounts.some((a) => a.placeholder)) fail('scripts/github-import/accounts.json (real emails, git-ignored) is missing; refusing to seed production with placeholders');
    // A user who already signed in (matched by email) keeps owning their solutions. A username held by someone else is an error.
    const existing = {};
    for (const a of data.accounts) {
      const byEmail = query(`SELECT id FROM users WHERE lower(email) = ${q(a.email.toLowerCase())}`)[0];
      const byName = query(`SELECT id FROM users WHERE username = ${q(a.localUsername)}`)[0];
      if (byEmail) existing[a.id] = byEmail.id;
      else if (byName && !byName.id.startsWith(SEED_USER_ID_PREFIX)) fail(`username ${a.localUsername} is already taken by another user`);
    }
    execute(seedSql(data, { existing, simulated: local }));
    console.log(`seeded ${data.accounts.length} users and ${data.solutions.length} solutions${local ? ' (with labelled simulated history)' : ''}`);
    console.log('counts:', JSON.stringify(counts()));
    break;
  }
  case 'status':
    console.log('counts:', JSON.stringify(counts()));
    break;
  default:
    fail('usage: import.mjs validate|backup|clean|seed|status [--target local|remote] [--confirm-production]');
}
