import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abilityMessage, buildRoster, getAbility, initialStatus, studentScreen } from '../js/access.js';

const open = { owner: 'teacher', locked: false, requireApproval: false };
const active = { name: 'Alex', status: 'active' };

test('new students start pending only when approval is required', () => {
  assert.equal(initialStatus({ requireApproval: true }), 'pending');
  assert.equal(initialStatus({ requireApproval: false }), 'active');
  assert.equal(initialStatus({}), 'active');
  assert.equal(initialStatus(null), 'active');
});

test('getAbility: the admin can always draw, even when the board is locked', () => {
  assert.deepEqual(getAbility({ isOwner: true, meta: { ...open, locked: true } }), { canDraw: true, reason: 'ok' });
});

test('getAbility: an admitted student can draw on an open board', () => {
  assert.deepEqual(getAbility({ meta: open, me: active }), { canDraw: true, reason: 'ok' });
});

test('getAbility explains each reason a student cannot draw', () => {
  assert.equal(getAbility({ meta: null, me: active }).reason, 'closed');
  assert.equal(getAbility({ meta: open, me: active, banned: { name: 'Alex' } }).reason, 'removed');
  assert.equal(getAbility({ meta: open, me: null }).reason, 'not-joined');
  assert.equal(getAbility({ meta: open, me: { ...active, status: 'pending' } }).reason, 'pending');
  assert.equal(getAbility({ meta: { ...open, locked: true }, me: active }).reason, 'locked');
  assert.equal(getAbility({ meta: open, me: { ...active, viewOnly: true } }).reason, 'view-only');
  assert.equal(getAbility({ meta: open, me: null }).canDraw, false);
});

test('abilityMessage only has words for the reasons a student should see on the board', () => {
  assert.match(abilityMessage('locked'), /locked/);
  assert.match(abilityMessage('view-only'), /view-only/);
  assert.equal(abilityMessage('ok'), '');
  assert.equal(abilityMessage('anything-else'), '');
});

test('studentScreen follows the person through joining, waiting, the board and removal', () => {
  assert.equal(studentScreen({ meta: null, me: null }), 'not-found');
  assert.equal(studentScreen({ meta: null, me: null, seenMeta: true }), 'closed');
  assert.equal(studentScreen({ meta: open, me: null }), 'join');
  assert.equal(studentScreen({ meta: open, me: { ...active, status: 'pending' } }), 'waiting');
  assert.equal(studentScreen({ meta: open, me: active }), 'board');
  assert.equal(studentScreen({ meta: open, me: null, banned: { name: 'Alex' } }), 'removed');
  assert.equal(studentScreen({ meta: null, me: null, banned: { name: 'Alex' } }), 'removed', 'removal wins over a missing board');
});

test('buildRoster groups students and sorts each group', () => {
  const roster = buildRoster({
    students: {
      u1: { name: 'Zoe', status: 'active', joinedAt: 10 },
      u2: { name: 'Alex', status: 'active', joinedAt: 20 },
      u3: { name: 'Sam', status: 'pending', joinedAt: 40 },
      u4: { name: 'Bea', status: 'pending', joinedAt: 30 },
      u5: { name: 'Max', status: 'active', viewOnly: true, joinedAt: 5 },
    },
    presence: { u1: { name: 'Zoe' }, u5: { name: 'Max' } },
    banned: { u9: { name: 'Old', at: 100 }, u8: { name: 'Newer', at: 200 } },
  });

  assert.deepEqual(roster.waiting.map((r) => r.name), ['Bea', 'Sam'], 'first come, first served');
  assert.deepEqual(roster.members.map((r) => r.name), ['Max', 'Zoe', 'Alex'], 'online first, then by name');
  assert.deepEqual(roster.members.map((r) => r.online), [true, true, false]);
  assert.equal(roster.members[0].viewOnly, true);
  assert.deepEqual(roster.removed.map((r) => r.name), ['Newer', 'Old'], 'most recently removed first');
});

test('buildRoster copes with empty and odd data', () => {
  assert.deepEqual(buildRoster(), { waiting: [], members: [], removed: [] });
  assert.deepEqual(buildRoster({ students: null, presence: null, banned: null }), { waiting: [], members: [], removed: [] });
  const { members } = buildRoster({ students: { u1: {} } });
  assert.equal(members[0].name, 'Student');
});
