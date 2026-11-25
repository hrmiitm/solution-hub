import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Actor } from '../../worker/src/env.ts';
import { allowedVisibilities, assertCanAssign, canModify, canView, visibleSql } from '../../worker/src/services/access.ts';

const rw = new Set(['read', 'write'] as const);
const user = (id: string, orgDomain: string | null, scopes: ReadonlySet<'read' | 'write'> = rw): Actor => ({ userId: id, username: id, orgDomain, scopes });
const owner = user('owner', 'acme.com');
const colleague = user('colleague', 'acme.com');
const outsider = user('outsider', 'other.com');
const personal = user('personal', null);
const sol = (visibility: 'public' | 'organization' | 'private', ownerOrg: string | null = 'acme.com') => ({
  owner_id: 'owner', visibility, owner_org_domain: ownerOrg,
});

test('visibility matrix', () => {
  const viewers = { anonymous: null, owner, colleague, outsider, personal };
  const expected: Record<string, Record<string, boolean>> = {
    public: { anonymous: true, owner: true, colleague: true, outsider: true, personal: true },
    organization: { anonymous: false, owner: true, colleague: true, outsider: false, personal: false },
    private: { anonymous: false, owner: true, colleague: false, outsider: false, personal: false },
  };
  for (const [vis, row] of Object.entries(expected)) {
    for (const [name, viewer] of Object.entries(viewers)) {
      assert.equal(canView(viewer, sol(vis as 'public')), row[name], `${vis} / ${name}`);
    }
  }
});

test('organization access fails closed when the owner has no organization', () => {
  assert.equal(canView(personal, { owner_id: 'x', visibility: 'organization', owner_org_domain: null }), false);
  assert.equal(canView(user('y', null), sol('organization', null)), false);
});

test('only the owner with write scope can modify', () => {
  assert.equal(canModify(owner, sol('public')), true);
  assert.equal(canModify(colleague, sol('organization')), false);
  assert.equal(canModify(null, sol('public')), false);
  assert.equal(canModify(user('owner', 'acme.com', new Set(['read'] as const)), sol('public')), false);
  assert.equal(canView(user('owner', 'acme.com', new Set(['write'] as const)), sol('public')), false, 'read scope needed to view');
});

test('organization visibility is unavailable to personal accounts', () => {
  assert.deepEqual(allowedVisibilities(personal), ['public', 'private']);
  assert.throws(() => assertCanAssign(personal, 'organization'), /invalid/);
  assert.doesNotThrow(() => assertCanAssign(owner, 'organization'));
});

test('visibleSql binds values and mirrors canView', () => {
  const binds: unknown[] = [];
  const bind = (v: unknown) => `?${binds.push(v)}`;
  assert.equal(visibleSql(null, bind), `s.visibility = 'public'`);
  const sql = visibleSql(colleague, bind);
  assert.match(sql, /s\.owner_id = \?1/);
  assert.match(sql, /u\.org_domain = \?2/);
  assert.deepEqual(binds, ['colleague', 'acme.com']);
  assert.doesNotMatch(visibleSql(personal, () => '?'), /organization/);
});
