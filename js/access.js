// Who may do what on a board, worked out from data the pages already watch. The security rules in
// database.rules.json are the real enforcement; this only decides what the screen shows.
// Pure, so it can be unit tested in Node.

export function initialStatus(meta) {
  return meta?.requireApproval === true ? 'pending' : 'active';
}

// `me` is the person's own students/{uid} record, `banned` their own banned/{uid} record.
export function getAbility({ isOwner = false, meta, me, banned }) {
  if (!meta) return { canDraw: false, reason: 'closed' };
  if (isOwner) return { canDraw: true, reason: 'ok' };
  if (banned) return { canDraw: false, reason: 'removed' };
  if (!me) return { canDraw: false, reason: 'not-joined' };
  if (me.status !== 'active') return { canDraw: false, reason: 'pending' };
  if (meta.locked === true) return { canDraw: false, reason: 'locked' };
  if (me.viewOnly === true) return { canDraw: false, reason: 'view-only' };
  return { canDraw: true, reason: 'ok' };
}

const MESSAGES = {
  locked: 'The board is locked. You can watch, but not draw, until your teacher unlocks it.',
  'view-only': 'Your teacher set you to view-only. You can watch, but not draw.',
};

export const abilityMessage = (reason) => MESSAGES[reason] ?? '';

// Which screen the student page shows. `seenMeta` is true once the board has been loaded in this visit,
// so a board that vanishes reads as closed rather than never having existed.
export function studentScreen({ meta, me, banned, seenMeta = false }) {
  if (banned) return 'removed';
  if (!meta) return seenMeta ? 'closed' : 'not-found';
  if (!me) return 'join';
  return me.status === 'active' ? 'board' : 'waiting';
}

// Groups the admin's roster. Waiting students go first come, first served; members show who is online first.
export function buildRoster({ students, presence, banned } = {}) {
  const waiting = [];
  const members = [];
  for (const [uid, record] of Object.entries(students ?? {})) {
    const row = {
      uid,
      name: record?.name || 'Student',
      online: Boolean(presence?.[uid]),
      viewOnly: record?.viewOnly === true,
      joinedAt: Number(record?.joinedAt) || 0,
    };
    (record?.status === 'pending' ? waiting : members).push(row);
  }

  const removed = Object.entries(banned ?? {}).map(([uid, record]) => ({
    uid,
    name: record?.name || 'Student',
    at: Number(record?.at) || 0,
  }));

  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.uid.localeCompare(b.uid);
  waiting.sort((a, b) => a.joinedAt - b.joinedAt || byName(a, b));
  members.sort((a, b) => Number(b.online) - Number(a.online) || byName(a, b));
  removed.sort((a, b) => b.at - a.at || byName(a, b));
  return { waiting, members, removed };
}
