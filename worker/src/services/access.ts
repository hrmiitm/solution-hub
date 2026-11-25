/**
 * The single source of truth for who may see and change a solution.
 *
 * Every read path (detail, path lookup, search, profiles, counts, categories,
 * history) and every write path goes through these functions, including MCP.
 *
 *   public        anyone, including anonymous visitors
 *   organization  the owner, plus signed-in users whose verified Google
 *                 Workspace domain (`hd`) equals the owner's
 *   private       the owner only
 *
 * All signed-in users are equal: only the owner can modify or delete their solutions.
 */
import type { Actor } from '../env.ts';
import { AppError } from '../lib/errors.ts';
import type { Visibility } from '../lib/validation.ts';

/** The caller of a read operation: a signed-in actor or an anonymous visitor (null). */
export type Viewer = Actor | null;

export interface AccessSubject {
  owner_id: string;
  visibility: Visibility;
  /** The owner's current verified organization domain. */
  owner_org_domain: string | null;
}

export function canView(viewer: Viewer, s: AccessSubject): boolean {
  if (s.visibility === 'public') return true;
  if (!viewer) return false;
  if (s.owner_id === viewer.userId) return true;
  return s.visibility === 'organization' && !!viewer.orgDomain && viewer.orgDomain === s.owner_org_domain;
}

export function canModify(viewer: Viewer, s: Pick<AccessSubject, 'owner_id'>): boolean {
  return !!viewer && viewer.userId === s.owner_id;
}

/** Visibility levels this actor may assign to their own solutions. */
export function allowedVisibilities(actor: Actor): Visibility[] {
  return actor.orgDomain ? ['public', 'organization', 'private'] : ['public', 'private'];
}

export function assertCanAssign(actor: Actor, visibility: Visibility): void {
  if (!allowedVisibilities(actor).includes(visibility)) {
    throw new AppError('validation_failed', 'Some fields are invalid', {
      visibility: 'Organization visibility requires a Google Workspace (organization) account',
    });
  }
}

export function requireSignedIn(viewer: Viewer): Actor {
  if (!viewer) throw new AppError('unauthorized', 'Sign in required');
  return viewer;
}

/**
 * SQL predicate equivalent to canView, for list/count queries. Expects the
 * solution aliased as `s` and its owner (users) as `u`. Values are bound via
 * `bind`, which returns the placeholder to use.
 */
export function visibleSql(viewer: Viewer, bind: (v: unknown) => string): string {
  if (!viewer) return `s.visibility = 'public'`;
  const parts = [`s.visibility = 'public'`, `s.owner_id = ${bind(viewer.userId)}`];
  if (viewer.orgDomain) parts.push(`(s.visibility = 'organization' AND u.org_domain = ${bind(viewer.orgDomain)})`);
  return `(${parts.join(' OR ')})`;
}
