/**
 * Solution business logic: CRUD, lifecycle, history and search.
 *
 * Every function takes the acting user explicitly and enforces authorization
 * itself, so HTTP routes (and the future MCP server) stay thin adapters.
 * Private solutions owned by someone else are reported as "not found" so that
 * their existence is never revealed.
 */
import type { Actor } from '../env.ts';
import { assertCanAssign, canModify, canView, requireSignedIn, visibleSql, type Viewer } from './access.ts';
import { AppError, notFound } from '../lib/errors.ts';
import type { Resource } from '../lib/resources.ts';
import { newId, nowIso, parseJsonArray, slugify } from '../lib/util.ts';
import { deriveSummary, type SearchInput, type SolutionInput, type SolutionRef, type Status, type Visibility } from '../lib/validation.ts';
import { toPublicUser, type PublicUser } from './users.ts';

interface SolutionRow {
  id: string;
  owner_id: string;
  title: string;
  slug: string;
  summary: string;
  description_md: string;
  client: string | null;
  type: string;
  industry: string;
  function: string;
  category: string;
  technologies: string;
  keywords: string;
  resources: string;
  thumbnail_url: string | null;
  primary_resource: string | null;
  visibility: Visibility;
  status: Status;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  // joined owner columns
  owner_username: string;
  owner_org_domain: string | null;
  owner_name: string;
  owner_avatar_url: string | null;
  like_count: number;
  liked_by_me: number;
}

interface SolutionLikes {
  likeCount: number;
  likedByMe: boolean;
}

export interface Solution extends SolutionLikes {
  id: string;
  slug: string;
  path: string;
  title: string;
  summary: string;
  descriptionMd?: string;
  client: string | null;
  type: string;
  industry: string[];
  function: string[];
  category: string[];
  technologies: string[];
  keywords: string[];
  resources: Resource[];
  thumbnailUrl: string | null;
  primaryResource: string | null;
  visibility: Visibility;
  /** Organization domain; present only for organization-visible solutions. */
  orgDomain: string | null;
  status: Status;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  owner: PublicUser;
  isOwner: boolean;
}

export type UpdateEventType = 'created' | 'edited' | 'progress_updated' | 'status_changed' | 'visibility_changed';

export interface SolutionUpdate {
  id: string;
  eventType: UpdateEventType;
  message: string;
  changes: Record<string, unknown>;
  createdAt: string;
  author: PublicUser;
}

const SOLUTION_COLUMNS = `s.*, u.username AS owner_username, u.name AS owner_name, u.avatar_url AS owner_avatar_url,
         u.org_domain AS owner_org_domain`;
const SOLUTION_FROM = `FROM solutions s JOIN users u ON u.id = s.owner_id`;

function likeColumns(userId: string): string {
  return `(SELECT COUNT(*) FROM solution_likes WHERE solution_id = s.id) AS like_count,
          EXISTS (SELECT 1 FROM solution_likes WHERE solution_id = s.id AND user_id = ${userId}) AS liked_by_me`;
}

function toSolutionLikes(row: Pick<SolutionRow, 'like_count' | 'liked_by_me'>): SolutionLikes {
  return { likeCount: row.like_count, likedByMe: row.liked_by_me === 1 };
}

function toSolution(row: SolutionRow, viewer: Viewer, includeDescription: boolean): Solution {
  const s: Solution = {
    id: row.id,
    slug: row.slug,
    path: `/${row.owner_username}/${row.slug}`,
    title: row.title,
    summary: row.summary,
    client: row.client,
    type: row.type,
    industry: parseJsonArray<string>(row.industry),
    function: parseJsonArray<string>(row.function),
    category: parseJsonArray<string>(row.category),
    technologies: parseJsonArray<string>(row.technologies),
    keywords: parseJsonArray<string>(row.keywords),
    resources: parseJsonArray<Resource>(row.resources),
    thumbnailUrl: row.thumbnail_url,
    primaryResource: row.primary_resource,
    visibility: row.visibility,
    // Never reveal an owner's employer on public/private solutions.
    orgDomain: row.visibility === 'organization' ? row.owner_org_domain : null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    owner: toPublicUser({ username: row.owner_username, name: row.owner_name, avatar_url: row.owner_avatar_url }),
    isOwner: canModify(viewer, row),
    ...toSolutionLikes(row),
  };
  if (includeDescription) s.descriptionMd = row.description_md;
  return s;
}


async function loadRow(db: D1Database, viewer: Viewer, id: string): Promise<SolutionRow | null> {
  return db.prepare(`SELECT ${SOLUTION_COLUMNS}, ${likeColumns('?2')} ${SOLUTION_FROM} WHERE s.id = ?1`)
    .bind(id, viewer?.userId ?? null).first<SolutionRow>();
}

async function loadReadable(db: D1Database, viewer: Viewer, id: string): Promise<SolutionRow> {
  const row = await loadRow(db, viewer, id);
  // Invisible solutions are reported as missing so their existence is not revealed.
  if (!row || !canView(viewer, row)) throw notFound('Solution');
  return row;
}

async function loadOwned(db: D1Database, viewer: Viewer, id: string): Promise<{ row: SolutionRow; actor: Actor }> {
  const actor = requireSignedIn(viewer);
  const row = await loadRow(db, actor, id);
  if (!row || !canView(actor, row)) throw notFound('Solution');
  if (!canModify(actor, row)) throw new AppError('forbidden', 'Only the owner can modify this solution');
  return { row, actor };
}

export async function getSolution(db: D1Database, viewer: Viewer, id: string): Promise<Solution> {
  return toSolution(await loadReadable(db, viewer, id), viewer, true);
}

export async function getSolutionByPath(db: D1Database, viewer: Viewer, username: string, slug: string): Promise<Solution> {
  const row = await db
    .prepare(`SELECT ${SOLUTION_COLUMNS}, ${likeColumns('?3')} ${SOLUTION_FROM} WHERE u.username = ?1 AND s.slug = ?2`)
    .bind(username.toLowerCase(), slug.toLowerCase(), viewer?.userId ?? null)
    .first<SolutionRow>();
  if (!row || !canView(viewer, row)) throw notFound('Solution');
  return toSolution(row, viewer, true);
}

/** Resolves an id or username/slug reference, with the same visibility rules as above. */
export async function resolveSolution(db: D1Database, viewer: Viewer, ref: SolutionRef): Promise<Solution> {
  return 'id' in ref ? getSolution(db, viewer, ref.id) : getSolutionByPath(db, viewer, ref.username, ref.slug);
}

export async function setSolutionLike(db: D1Database, viewer: Viewer, id: string, liked: boolean): Promise<SolutionLikes> {
  const actor = requireSignedIn(viewer);
  const binds: unknown[] = [id, actor.userId];
  const visible = visibleSql(actor, (value) => `?${binds.push(value)}`);
  const from = `${SOLUTION_FROM} WHERE s.id = ?1 AND ${visible}`;
  // Check visibility in the mutation and return the resulting count in the same batch.
  const mutation = liked
    ? `INSERT INTO solution_likes (solution_id, user_id) SELECT s.id, ?2 ${from}
       ON CONFLICT (solution_id, user_id) DO NOTHING`
    : `DELETE FROM solution_likes WHERE user_id = ?2 AND solution_id IN (SELECT s.id ${from})`;
  const [, result] = await db.batch<Pick<SolutionRow, 'like_count' | 'liked_by_me'>>([
    db.prepare(mutation).bind(...binds),
    db.prepare(`SELECT ${likeColumns('?2')} ${from}`).bind(...binds),
  ]);
  const row = result?.results[0];
  if (!row) throw notFound('Solution');
  return toSolutionLikes(row);
}

async function uniqueSlug(db: D1Database, ownerId: string, title: string): Promise<string> {
  const base = slugify(title) || 'solution';
  const rows = await db
    // substr() prefix match instead of LIKE: D1 caps LIKE patterns at 50 bytes.
    .prepare(`SELECT slug FROM solutions WHERE owner_id = ?1 AND substr(slug, 1, length(?2)) = ?2`)
    .bind(ownerId, `${base}`)
    .all<{ slug: string }>();
  const taken = new Set(rows.results.map((r) => r.slug));
  if (!taken.has(base)) return base;
  // Base slugs are at most 60 chars, so a numeric suffix stays within the 80-char limit.
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** primary_resource must reference one of the solution's own resources. */
function normalizePrimary(primary: string | null | undefined, resources: Resource[]): string | null {
  if (!primary) return null;
  return resources.some((r) => r.url === primary) ? primary : null;
}

const json = (v: unknown) => JSON.stringify(v ?? []);

function updateStmt(db: D1Database, solutionId: string, authorId: string, type: UpdateEventType, message: string, changes: Record<string, unknown>, at: string) {
  return db
    .prepare(
      `INSERT INTO solution_updates (id, solution_id, author_id, event_type, message, changes, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(newId(), solutionId, authorId, type, message, JSON.stringify(changes), at);
}

export async function createSolution(db: D1Database, viewer: Viewer, input: SolutionInput): Promise<Solution> {
  const actor = requireSignedIn(viewer);
  const id = newId();
  const now = nowIso();
  const resources = input.resources ?? [];
  const description = input.descriptionMd ?? '';
  const summary = input.summary || deriveSummary(description);
  // Fail safe: nothing becomes visible to others unless explicitly requested.
  const visibility = input.visibility ?? 'private';
  assertCanAssign(actor, visibility);

  // Retry once if a concurrent create claimed the same slug.
  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = await uniqueSlug(db, actor.userId, input.title ?? '');
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO solutions (id, owner_id, title, slug, summary, description_md, client, type, industry,
               function, category, technologies, keywords, resources, thumbnail_url, primary_resource,
               visibility, status, created_at, updated_at, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'ongoing', ?18, ?18, NULL)`,
          )
          .bind(
            id, actor.userId, input.title, slug, summary, description, input.client ?? null, input.type ?? 'other',
            json(input.industry), json(input.function), json(input.category), json(input.technologies),
            json(input.keywords), json(resources), input.thumbnailUrl ?? null,
            normalizePrimary(input.primaryResource, resources), visibility, now,
          ),
        updateStmt(db, id, actor.userId, 'created', 'Created this solution', { visibility }, now),
      ]);
      return getSolution(db, actor, id);
    } catch (err) {
      if (attempt === 0 && String(err).includes('UNIQUE')) continue;
      throw err;
    }
  }
  throw new AppError('conflict', 'Could not allocate a unique slug');
}

const CONTENT_FIELDS: { key: keyof SolutionInput; column: keyof SolutionRow; label: string; json?: boolean }[] = [
  { key: 'title', column: 'title', label: 'title' },
  { key: 'summary', column: 'summary', label: 'summary' },
  { key: 'descriptionMd', column: 'description_md', label: 'description' },
  { key: 'client', column: 'client', label: 'client' },
  { key: 'type', column: 'type', label: 'type' },
  { key: 'industry', column: 'industry', label: 'industry', json: true },
  { key: 'function', column: 'function', label: 'function', json: true },
  { key: 'category', column: 'category', label: 'category', json: true },
  { key: 'technologies', column: 'technologies', label: 'technologies', json: true },
  { key: 'keywords', column: 'keywords', label: 'keywords', json: true },
  { key: 'resources', column: 'resources', label: 'resources', json: true },
  { key: 'thumbnailUrl', column: 'thumbnail_url', label: 'thumbnail', },
  { key: 'primaryResource', column: 'primary_resource', label: 'primary preview' },
];

/**
 * Applies a partial update. Content edits, visibility changes and completion
 * are recorded atomically with the row update. Reopening only changes state.
 */
export async function updateSolution(db: D1Database, viewer: Viewer, id: string, input: SolutionInput, progressMessage?: string): Promise<Solution> {
  const { row, actor } = await loadOwned(db, viewer, id);
  const now = nowIso();
  const next: Record<string, unknown> = {};

  if (input.summary === '' && input.descriptionMd !== undefined) input.summary = deriveSummary(input.descriptionMd);
  else if (input.summary === '') input.summary = deriveSummary(row.description_md);
  const resources = input.resources ?? parseJsonArray<Resource>(row.resources);
  if (input.primaryResource !== undefined || input.resources !== undefined) {
    input.primaryResource = normalizePrimary(input.primaryResource !== undefined ? input.primaryResource : row.primary_resource, resources);
  }

  const changedLabels: string[] = [];
  for (const f of CONTENT_FIELDS) {
    const value = input[f.key];
    if (value === undefined) continue;
    const stored = f.json ? json(value) : (value ?? null);
    if (stored !== (row[f.column] ?? null)) {
      next[f.column] = stored;
      changedLabels.push(f.label);
    }
  }

  const stmts: D1PreparedStatement[] = [];
  const recordChange = (type: UpdateEventType, message: string, changes: Record<string, unknown>) => {
    if (!stmts.length && input.changeNote) changes.note = input.changeNote;
    stmts.push(updateStmt(db, id, actor.userId, type, message, changes, now));
  };
  if (changedLabels.length) {
    const changes: Record<string, unknown> = { fields: changedLabels };
    if (input.resources) {
      const before = parseJsonArray<Resource>(row.resources);
      const added = input.resources.filter((r) => !before.some((b) => b.url === r.url)).map((r) => r.label);
      const removed = before.filter((b) => !input.resources!.some((r) => r.url === b.url)).map((r) => r.label);
      if (added.length || removed.length) changes.resources = { added, removed };
    }
    recordChange('edited', `Edited ${changedLabels.join(', ')}`, changes);
  }
  if (input.visibility && input.visibility !== row.visibility) {
    assertCanAssign(actor, input.visibility);
    next.visibility = input.visibility;
    const label = { public: 'Made public', organization: 'Shared with the organization', private: 'Made private' }[input.visibility];
    recordChange('visibility_changed', label, { from: row.visibility, to: input.visibility });
  }
  if (input.status && input.status !== row.status) {
    next.status = input.status;
    next.completed_at = input.status === 'completed' ? now : null;
    if (input.status === 'completed') {
      recordChange('status_changed', 'Marked as completed', { from: row.status, to: input.status });
    }
  }
  if (progressMessage && input.status !== 'ongoing') {
    stmts.push(updateStmt(db, id, actor.userId, 'progress_updated', progressMessage, {}, now));
  }
  if (!stmts.length && !Object.keys(next).length) return toSolution(row, actor, true);

  next.updated_at = now;
  const columns = Object.keys(next);
  // Column names come from the fixed whitelist above, never from user input.
  const set = columns.map((c, i) => `"${c}" = ?${i + 2}`).join(', ');
  stmts.unshift(db.prepare(`UPDATE solutions SET ${set} WHERE id = ?1`).bind(id, ...columns.map((c) => next[c])));
  await db.batch(stmts);
  return getSolution(db, actor, id);
}

export async function deleteSolution(db: D1Database, viewer: Viewer, id: string): Promise<void> {
  const { actor } = await loadOwned(db, viewer, id);
  await db.prepare(`DELETE FROM solutions WHERE id = ?1 AND owner_id = ?2`).bind(id, actor.userId).run();
}

export async function listUpdates(db: D1Database, viewer: Viewer, id: string, limit = 200): Promise<SolutionUpdate[]> {
  await loadReadable(db, viewer, id);
  const binds: unknown[] = [id, limit];
  const visible = visibleSql(viewer, (value) => `?${binds.push(value)}`);
  const rows = await db
    .prepare(
      `SELECT su.*, author.username, author.name, author.avatar_url
       FROM solution_updates su JOIN users author ON author.id = su.author_id
       JOIN solutions s ON s.id = su.solution_id
       JOIN users u ON u.id = s.owner_id
       WHERE su.solution_id = ?1 AND ${visible}
       ORDER BY su.created_at DESC, su.rowid DESC
       LIMIT ?2`,
    )
    .bind(...binds)
    .all<{ id: string; event_type: UpdateEventType; message: string; changes: string; created_at: string; username: string; name: string; avatar_url: string | null }>();
  return rows.results.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    message: r.message,
    changes: safeObject(r.changes),
    createdAt: r.created_at,
    author: toPublicUser(r),
  }));
}

function safeObject(value: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(value);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function addProgressUpdate(db: D1Database, viewer: Viewer, id: string, message: string, limit?: number): Promise<SolutionUpdate[]> {
  const { actor } = await loadOwned(db, viewer, id);
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE solutions SET updated_at = ?2 WHERE id = ?1`).bind(id, now),
    updateStmt(db, id, actor.userId, 'progress_updated', message, {}, now),
  ]);
  return listUpdates(db, actor, id, limit);
}

// ---------------------------------------------------------------------------
// Search

/** Search filters; validated in lib/validation.ts (REST query or MCP tool arguments). */
export type SearchParams = SearchInput;

export interface SearchResult {
  items: Solution[];
  total: number;
  page: number;
  limit: number;
}

export const MAX_SEARCH_TERMS = 8;

/** Normalizes free text into up to 8 lowercase search terms. */
export function searchTerms(q: string | undefined): string[] {
  const seen = new Set<string>();
  for (const raw of (q ?? '').toLowerCase().split(/\s+/)) {
    const term = raw.replace(/^[^\p{L}\p{N}#+.]+|[^\p{L}\p{N}#+]+$/gu, '').slice(0, 50);
    if (term) seen.add(term);
    if (seen.size >= MAX_SEARCH_TERMS) break;
  }
  return [...seen];
}

// Weighted fields; instr() on lowercased text gives case-insensitive partial
// matching with no LIKE-wildcard escaping concerns. Scores favour title and
// keyword hits over incidental matches in the description or URLs.
const SEARCH_FIELDS: { expr: string; weight: number }[] = [
  { expr: `lower(s.title)`, weight: 12 },
  { expr: `lower(s.keywords)`, weight: 8 },
  { expr: `lower(s.summary)`, weight: 5 },
  { expr: `lower(s.category || ' ' || s.technologies || ' ' || s.industry || ' ' || s.function || ' ' || s.type)`, weight: 4 },
  { expr: `lower(u.username || ' ' || u.name || ' ' || coalesce(s.client, ''))`, weight: 3 },
  { expr: `lower(s.description_md)`, weight: 1 },
  { expr: `lower(s.resources)`, weight: 1 },
];

/**
 * Lists solutions visible to the actor with keyword search, filters, sorting
 * and pagination. Visibility is enforced in SQL via access.visibleSql.
 * All values are bound parameters; numbered placeholders (?N) let each search
 * term be bound once yet referenced by several expressions.
 */
export async function searchSolutions(db: D1Database, viewer: Viewer, params: SearchParams, likedOnly = false): Promise<SearchResult> {
  const binds: unknown[] = [];
  const bind = (v: unknown) => {
    binds.push(v);
    return `?${binds.length}`;
  };

  const where: string[] = [visibleSql(viewer, bind)];
  if (likedOnly) {
    const actor = requireSignedIn(viewer);
    where.push(`s.id IN (SELECT solution_id FROM solution_likes WHERE user_id = ${bind(actor.userId)})`);
  }
  if (params.visibility?.length) where.push(`s.visibility IN (SELECT value FROM json_each(${bind(JSON.stringify(params.visibility))}))`);
  if (params.status) where.push(`s.status = ${bind(params.status)}`);
  if (params.owner) where.push(`u.username = ${bind(params.owner.toLowerCase())}`);
  if (params.types?.length) where.push(`s.type IN (SELECT value FROM json_each(${bind(JSON.stringify(params.types))}))`);
  const multi: [keyof SearchParams, string][] = [
    ['industry', 'industry'],
    ['function', 'function'],
    ['category', 'category'],
    ['technology', 'technologies'],
  ];
  for (const [param, column] of multi) {
    const values = params[param] as string[] | undefined;
    if (!values?.length) continue;
    where.push(
      `EXISTS (SELECT 1 FROM json_each(s."${column}") a JOIN json_each(${bind(JSON.stringify(values.map((v) => v.toLowerCase())))}) b
               ON lower(a.value) = b.value)`,
    );
  }

  const terms = searchTerms(params.q);
  let whereBindCount = 0;
  const scoreParts: string[] = [];
  for (const term of terms) {
    const p = bind(term);
    where.push(`(${SEARCH_FIELDS.map((f) => `instr(${f.expr}, ${p}) > 0`).join(' OR ')})`);
    scoreParts.push(...SEARCH_FIELDS.map((f) => `(instr(${f.expr}, ${p}) > 0) * ${f.weight}`));
    scoreParts.push(`(instr(lower(s.title), ${p}) = 1) * 4`);
  }
  whereBindCount = binds.length;
  if (terms.length > 1) scoreParts.push(`(instr(lower(s.title), ${bind(terms.join(' '))}) > 0) * 15`);
  const score = scoreParts.length ? scoreParts.join(' + ') : '0';

  const sort = params.sort ?? 'updated';
  const order = {
    relevance: `score DESC, s.updated_at DESC`,
    updated: `s.updated_at DESC, like_count DESC`,
    created: `s.created_at DESC, like_count DESC`,
    oldest: `s.created_at ASC`,
  }[sort];

  const limit = Math.min(Math.max(params.limit ?? 24, 1), 50);
  const page = Math.min(Math.max(params.page ?? 1, 1), 1000);
  const whereSql = where.join(' AND ');
  const from = `${SOLUTION_FROM} WHERE ${whereSql}`;
  const likes = likeColumns(viewer ? bind(viewer.userId) : 'NULL');

  const [countRes, rowsRes] = await db.batch([
    // The count query references only the WHERE parameters.
    db.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...binds.slice(0, whereBindCount)),
    db
      .prepare(
        `SELECT ${SOLUTION_COLUMNS}, ${likes}, ${score} AS score
         ${from} ORDER BY ${order}, s.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      )
      .bind(...binds),
  ]);
  const total = (countRes?.results[0] as { total: number } | undefined)?.total ?? 0;
  const items = ((rowsRes?.results ?? []) as SolutionRow[]).map((r) => toSolution(r, viewer, false));
  return { items, total, page, limit };
}

// ---------------------------------------------------------------------------
// Categories

export interface CategoryValue {
  value: string;
  count: number;
}

/**
 * Distinct metadata values with counts, computed only over solutions the
 * viewer can see (optionally narrowed to some levels), so counts never leak
 * solutions the viewer cannot access.
 */
export async function listCategories(db: D1Database, viewer: Viewer, visibility?: Visibility[]) {
  const binds: unknown[] = [];
  const bind = (v: unknown) => `?${binds.push(v)}`;
  let visible = visibleSql(viewer, bind);
  if (visibility?.length) visible += ` AND s.visibility IN (SELECT value FROM json_each(${bind(JSON.stringify(visibility))}))`;
  const from = `solutions s JOIN users u ON u.id = s.owner_id`;
  const facet = (column: string) =>
    db
      .prepare(
        `SELECT j.value AS value, COUNT(*) AS count
         FROM ${from}, json_each(s."${column}") j
         WHERE ${visible} AND j.type = 'text'
         GROUP BY lower(j.value) ORDER BY count DESC, value LIMIT 100`,
      )
      .bind(...binds);
  const plain = (column: string) =>
    db
      .prepare(`SELECT s."${column}" AS value, COUNT(*) AS count FROM ${from} WHERE ${visible} GROUP BY s."${column}" ORDER BY count DESC`)
      .bind(...binds);
  const results = await db.batch([
    plain('type'),
    plain('status'),
    facet('industry'),
    facet('function'),
    facet('category'),
    facet('technologies'),
    db
      .prepare(`SELECT s.client AS value, COUNT(*) AS count FROM ${from} WHERE ${visible} AND s.client IS NOT NULL AND s.client != '' GROUP BY lower(s.client) ORDER BY count DESC LIMIT 100`)
      .bind(...binds),
  ]);
  const values = (i: number) => (results[i]?.results ?? []) as CategoryValue[];
  return {
    type: values(0),
    status: values(1),
    industry: values(2),
    function: values(3),
    category: values(4),
    technology: values(5),
    client: values(6),
  };
}
