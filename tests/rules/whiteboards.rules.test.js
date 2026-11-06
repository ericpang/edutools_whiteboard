// Security-rule tests for the whiteboards branch of database.rules.json.
// They need the Realtime Database emulator, so CI skips them (its glob is tests/*.test.js).
//   npm run test:rules
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

const CODE = 'K7P3QM';
const TS = { '.sv': 'timestamp' };
const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '127.0.0.1:9000').split(':');

let env;
const handles = new Map();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cuteworld',
    database: {
      host,
      port: Number(port),
      rules: readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8'),
    },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearDatabase();
});

// A database handle signed in as `uid` (or signed out when uid is null).
function dbFor(uid) {
  const key = uid ?? '(signed out)';
  if (!handles.has(key)) {
    const context = uid ? env.authenticatedContext(uid) : env.unauthenticatedContext();
    handles.set(key, context.database());
  }
  return handles.get(key);
}

const at = (uid, path = '') => dbFor(uid).ref(`whiteboards/${CODE}${path ? `/${path}` : ''}`);
const seed = (data) => env.withSecurityRulesDisabled((context) => context.database().ref(`whiteboards/${CODE}`).set(data));

// What the app writes.
const newStroke = (uid, over = {}) => ({ type: 'stroke', uid, color: '#2b4fd8', size: 6, pts: '10,20 30,40', ts: TS, ...over });
const newText = (uid, over = {}) => ({ type: 'text', uid, color: '#d92d3a', size: 48, text: 'Hello', x: 100, y: 200, ts: TS, ...over });

// What is already in the database. Alex is in the room, Bea is waiting, Teacher owns the board.
const savedStroke = (uid) => ({ type: 'stroke', uid, color: '#1b1f27', size: 6, pts: '1,1 5,5', ts: 1500 });

function board(over = {}) {
  return {
    meta: { owner: 'teacher', title: 'Maths 3B', locked: false, requireApproval: false, createdAt: 1000, ...over.meta },
    students: over.students ?? {
      alex: { name: 'Alex', status: 'active', joinedAt: 1100 },
      bea: { name: 'Bea', status: 'pending', joinedAt: 1200 },
    },
    items: over.items ?? { i_alex: savedStroke('alex'), i_teacher: savedStroke('teacher') },
    ...(over.banned ? { banned: over.banned } : {}),
    ...(over.live ? { live: over.live } : {}),
    ...(over.presence ? { presence: over.presence } : {}),
  };
}

describe('creating a board', () => {
  const meta = (owner) => ({ owner, title: 'Maths 3B', locked: false, requireApproval: false, createdAt: TS });

  test('any signed-in user can create a board they own', async () => {
    await assertSucceeds(at('teacher', 'meta').set(meta('teacher')));
  });

  test('nobody can create a board in someone else’s name', async () => {
    await assertFails(at('mallory', 'meta').set(meta('teacher')));
  });

  test('signed-out visitors cannot create boards', async () => {
    await assertFails(at(null, 'meta').set(meta('teacher')));
  });

  test('codes must be six characters from the allowed alphabet', async () => {
    for (const bad of ['abc', 'K7P3Q', 'K7P3QMM', 'K7P3Q0', 'k7p3qm']) {
      await assertFails(dbFor('teacher').ref(`whiteboards/${bad}/meta`).set(meta('teacher')));
    }
  });

  test('a board needs every meta field and nothing extra', async () => {
    await assertFails(at('teacher', 'meta').set({ owner: 'teacher', title: 'Maths', createdAt: TS }));
    await assertFails(at('teacher', 'meta').set({ ...meta('teacher'), sneaky: true }));
    await assertFails(at('teacher', 'meta').set({ ...meta('teacher'), title: '' }));
    await assertFails(at('teacher', 'meta').set({ ...meta('teacher'), title: 'x'.repeat(81) }));
  });

  test('an existing board cannot be taken over', async () => {
    await seed(board());
    await assertFails(at('mallory', 'meta').set(meta('mallory')));
    await assertFails(at('mallory', 'meta/owner').set('mallory'));
  });
});

describe('who can look at what', () => {
  beforeEach(() => seed(board({ banned: { carl: { name: 'Carl', at: 1300 } } })));

  test('any signed-in user can read the title and settings, signed-out visitors cannot', async () => {
    await assertSucceeds(at('stranger', 'meta').once('value'));
    await assertFails(at(null, 'meta').once('value'));
  });

  test('looking up a board that does not exist is not an error', async () => {
    const snapshot = await assertSucceeds(dbFor('stranger').ref('whiteboards/ZZZZZZ/meta').once('value'));
    assert(snapshot.val() === null);
  });

  test('boards cannot be listed, not even by their owner', async () => {
    await assertFails(dbFor('stranger').ref('whiteboards').once('value'));
    await assertFails(dbFor('teacher').ref('whiteboards').once('value'));
  });

  test('admitted students can read the board, who is online, and live strokes', async () => {
    await assertSucceeds(at('alex', 'items').once('value'));
    await assertSucceeds(at('alex', 'presence').once('value'));
    await assertSucceeds(at('alex', 'live').once('value'));
  });

  test('students waiting for approval, strangers, and removed students cannot read the board', async () => {
    for (const uid of ['bea', 'stranger', 'carl']) {
      await assertFails(at(uid, 'items').once('value'));
      await assertFails(at(uid, 'presence').once('value'));
      await assertFails(at(uid, 'live').once('value'));
    }
  });

  test('students cannot read the roster or the removed list, only their own entries', async () => {
    await assertFails(at('alex', 'students').once('value'));
    await assertFails(at('alex', 'banned').once('value'));
    await assertSucceeds(at('alex', 'students/alex').once('value'));
    await assertFails(at('alex', 'students/bea').once('value'));
    await assertSucceeds(at('carl', 'banned/carl').once('value'));
    await assertFails(at('alex', 'banned/carl').once('value'));
  });

  test('the owner can read everything, including by query', async () => {
    await assertSucceeds(at('teacher').once('value'));
    await assertSucceeds(at('teacher', 'students').once('value'));
    await assertSucceeds(at('teacher', 'banned').once('value'));
    await assertSucceeds(at('teacher', 'items').orderByChild('uid').equalTo('alex').once('value'));
  });
});

describe('joining', () => {
  const entry = (status, over = {}) => ({ name: 'Dana', status, joinedAt: TS, ...over });

  test('a student joins straight in when approval is not required', async () => {
    await seed(board());
    await assertSucceeds(at('dana', 'students/dana').set(entry('active')));
  });

  test('a student can always ask to join as pending', async () => {
    await seed(board());
    await assertSucceeds(at('dana', 'students/dana').set(entry('pending')));
  });

  test('when approval is required, a student cannot admit themselves', async () => {
    await seed(board({ meta: { requireApproval: true } }));
    await assertFails(at('dana', 'students/dana').set(entry('active')));
    await assertSucceeds(at('dana', 'students/dana').set(entry('pending')));
  });

  test('a student cannot create someone else’s entry', async () => {
    await seed(board());
    await assertFails(at('dana', 'students/eve').set(entry('active')));
  });

  test('a student cannot give themselves extra fields, including view-only', async () => {
    await seed(board());
    await assertFails(at('dana', 'students/dana').set(entry('active', { viewOnly: false })));
    await assertFails(at('dana', 'students/dana').set(entry('active', { admin: true })));
  });

  test('names must be between 1 and 24 characters', async () => {
    await seed(board());
    await assertFails(at('dana', 'students/dana').set(entry('active', { name: '' })));
    await assertFails(at('dana', 'students/dana').set(entry('active', { name: 'x'.repeat(25) })));
    await assertSucceeds(at('dana', 'students/dana').set(entry('active', { name: 'x'.repeat(24) })));
  });

  test('an existing entry cannot be rewritten, so view-only cannot be shaken off', async () => {
    await seed(board({ students: { alex: { name: 'Alex', status: 'active', viewOnly: true, joinedAt: 1100 } } }));
    await assertFails(at('alex', 'students/alex').set(entry('active', { name: 'Alex' })));
    await assertFails(at('alex', 'students/alex/viewOnly').remove());
    await assertFails(at('alex', 'students/alex').remove());
  });

  test('a pending student cannot approve themselves later', async () => {
    await seed(board({ meta: { requireApproval: true } }));
    await assertFails(at('bea', 'students/bea/status').set('active'));
  });

  test('removed students cannot join again', async () => {
    await seed(board({ banned: { carl: { name: 'Carl', at: 1300 } } }));
    await assertFails(at('carl', 'students/carl').set(entry('active', { name: 'Carl' })));
  });

  test('nobody can join a board that does not exist', async () => {
    await assertFails(at('dana', 'students/dana').set(entry('active')));
  });
});

describe('what the admin can do', () => {
  beforeEach(() => seed(board()));

  test('lock and unlock the board, switch approval on and off, rename it', async () => {
    await assertSucceeds(at('teacher', 'meta').update({ locked: true }));
    await assertSucceeds(at('teacher', 'meta').update({ locked: false, requireApproval: true }));
    await assertSucceeds(at('teacher', 'meta/title').set('Science 2A'));
  });

  test('students cannot change the board settings', async () => {
    await assertFails(at('alex', 'meta').update({ locked: true }));
    await assertFails(at('alex', 'meta/title').set('Mine now'));
  });

  test('admit a waiting student', async () => {
    await assertSucceeds(at('teacher', 'students/bea').update({ status: 'active' }));
  });

  test('students cannot admit anyone, themselves or others', async () => {
    await assertFails(at('alex', 'students/bea').update({ status: 'active' }));
    await assertFails(at('bea', 'students/bea').update({ status: 'active' }));
  });

  test('turn view-only on and off for a student', async () => {
    await assertSucceeds(at('teacher', 'students/alex').update({ viewOnly: true }));
    await assertSucceeds(at('teacher', 'students/alex').update({ viewOnly: null }));
  });

  test('remove a student, blocking them and deleting their drawings, in one write', async () => {
    await assertSucceeds(
      at('teacher').update({
        'students/alex': null,
        'live/alex': null,
        'presence/alex': null,
        'banned/alex': { name: 'Alex', at: TS },
        'items/i_alex': null,
      }),
    );
    const snapshot = await at('teacher').once('value');
    assert(!snapshot.child('students/alex').exists());
    assert(!snapshot.child('items/i_alex').exists());
    assert(snapshot.child('items/i_teacher').exists(), 'other people’s drawings stay');
    assert(snapshot.child('banned/alex/name').val() === 'Alex');
  });

  test('let a removed student back in', async () => {
    await at('teacher', 'banned/carl').set({ name: 'Carl', at: TS });
    await assertSucceeds(at('teacher', 'banned/carl').remove());
  });

  test('students cannot remove, block or unblock anyone', async () => {
    await assertFails(at('alex', 'banned/bea').set({ name: 'Bea', at: TS }));
    await assertFails(at('alex', 'students/bea').remove());
    await at('teacher', 'banned/carl').set({ name: 'Carl', at: TS });
    await assertFails(at('carl', 'banned/carl').remove());
  });

  test('a removal record needs a name and a server time', async () => {
    await assertFails(at('teacher', 'banned/carl').set(true));
    await assertFails(at('teacher', 'banned/carl').set({ name: 'Carl', at: 5 }));
    await assertFails(at('teacher', 'banned/carl').set({ at: TS }));
  });

  test('clear the board', async () => {
    await assertSucceeds(at('teacher').update({ items: null, live: null }));
    await assertSucceeds(at('teacher', 'items').remove());
  });

  test('students cannot clear the board', async () => {
    await assertFails(at('alex', 'items').remove());
    await assertFails(at('alex').update({ items: null }));
  });

  test('delete the whole board', async () => {
    await assertFails(at('alex').remove());
    await assertSucceeds(at('teacher').remove());
  });
});

describe('drawing and writing', () => {
  beforeEach(() => seed(board()));

  test('an admitted student can add a stroke or a note', async () => {
    await assertSucceeds(at('alex', 'items/new1').set(newStroke('alex')));
    await assertSucceeds(at('alex', 'items/new2').set(newText('alex')));
    await assertSucceeds(at('alex', 'items/new3').set(newStroke('alex', { pts: '5,5' })));
  });

  test('the admin can draw, even when the board is locked', async () => {
    await at('teacher', 'meta').update({ locked: true });
    await assertSucceeds(at('teacher', 'items/new1').set(newStroke('teacher')));
  });

  test('students who are waiting, unknown, or removed cannot draw', async () => {
    await seed(board({ banned: { carl: { name: 'Carl', at: 1300 } } }));
    for (const uid of ['bea', 'stranger', 'carl']) {
      await assertFails(at(uid, 'items/new1').set(newStroke(uid)));
    }
  });

  test('nobody draws while the board is locked, or while they are view-only', async () => {
    await at('teacher', 'meta').update({ locked: true });
    await assertFails(at('alex', 'items/new1').set(newStroke('alex')));
    await at('teacher', 'meta').update({ locked: false });
    await at('teacher', 'students/alex').update({ viewOnly: true });
    await assertFails(at('alex', 'items/new1').set(newStroke('alex')));
  });

  test('drawing as someone else is refused', async () => {
    await assertFails(at('alex', 'items/new1').set(newStroke('teacher')));
    await assertFails(at('alex', 'items/new1').set(newStroke('bea')));
  });

  test('only well-formed strokes are accepted', async () => {
    const bad = [
      newStroke('alex', { color: 'red' }),
      newStroke('alex', { color: '#2B4FD8' }),
      newStroke('alex', { pts: 'abc' }),
      newStroke('alex', { pts: '10,20;30,40' }),
      newStroke('alex', { pts: '' }),
      newStroke('alex', { pts: '1,1 '.repeat(5001) }),
      newStroke('alex', { size: 0 }),
      newStroke('alex', { size: 500 }),
      newStroke('alex', { size: 'big' }),
      newStroke('alex', { ts: 1234 }),
      newStroke('alex', { extra: 1 }),
      newStroke('alex', { text: 'sneaky' }),
      newStroke('alex', { type: 'circle' }),
    ];
    for (const value of bad) await assertFails(at('alex', 'items/bad').set(value));
    const { pts, ...withoutPoints } = newStroke('alex');
    await assertFails(at('alex', 'items/bad').set(withoutPoints));
    const { ts, ...withoutTime } = newStroke('alex');
    await assertFails(at('alex', 'items/bad').set(withoutTime));
  });

  test('the largest stroke the app sends is accepted', async () => {
    const pts = Array.from({ length: 1500 }, () => '1920,1080').join(' ');
    await assertSucceeds(at('alex', 'items/big').set(newStroke('alex', { pts })));
  });

  test('only well-formed notes are accepted', async () => {
    const bad = [
      newText('alex', { text: '' }),
      newText('alex', { text: 'x'.repeat(301) }),
      newText('alex', { x: -1 }),
      newText('alex', { x: 1921 }),
      newText('alex', { y: 1081 }),
      newText('alex', { pts: '1,1 2,2' }),
    ];
    for (const value of bad) await assertFails(at('alex', 'items/bad').set(value));
    const { x, ...withoutX } = newText('alex');
    await assertFails(at('alex', 'items/bad').set(withoutX));
  });

  test('students can take back their own drawings, but not other people’s', async () => {
    await assertSucceeds(at('alex', 'items/i_alex').remove());
    await assertFails(at('alex', 'items/i_teacher').remove());
  });

  test('drawings cannot be edited after they are made', async () => {
    await assertFails(at('alex', 'items/i_alex').set(newStroke('alex')));
    await assertFails(at('alex', 'items/i_alex/color').set('#d92d3a'));
    await assertFails(at('alex', 'items/i_teacher/color').set('#d92d3a'));
  });

  test('nobody can undo while the board is locked', async () => {
    await at('teacher', 'meta').update({ locked: true });
    await assertFails(at('alex', 'items/i_alex').remove());
  });

  test('the admin can erase anybody’s drawing', async () => {
    await assertSucceeds(at('teacher', 'items/i_alex').remove());
  });
});

describe('live strokes and who is online', () => {
  beforeEach(() => seed(board()));

  const live = { pts: '1,1 2,2', color: '#2b4fd8', size: 6 };
  const here = (name, over = {}) => ({ name, color: '#2b4fd8', x: 10, y: 20, at: TS, ...over });

  test('a student can share their own stroke while drawing', async () => {
    await assertSucceeds(at('alex', 'live/alex').set(live));
    await assertFails(at('alex', 'live/teacher').set(live));
  });

  test('a stroke preview cannot start while locked, but it can always be cleaned up', async () => {
    await at('alex', 'live/alex').set(live);
    await at('teacher', 'meta').update({ locked: true });
    await assertFails(at('alex', 'live/alex').set(live));
    await assertSucceeds(at('alex', 'live/alex').remove());
  });

  test('previews from people who are waiting, unknown or removed are refused', async () => {
    await assertFails(at('bea', 'live/bea').set(live));
    await assertFails(at('stranger', 'live/stranger').set(live));
  });

  test('a student can show their own cursor under their own name', async () => {
    await assertSucceeds(at('alex', 'presence/alex').set(here('Alex')));
    await assertSucceeds(at('alex', 'presence/alex').update({ x: 300, y: 400, at: TS }));
    await assertSucceeds(at('alex', 'presence/alex').update({ x: null, y: null, at: TS }));
  });

  test('a student cannot show a cursor under someone else’s name or id', async () => {
    await assertFails(at('alex', 'presence/alex').set(here('The Teacher')));
    await assertFails(at('alex', 'presence/teacher').set(here('Alex')));
  });

  test('cursor positions must be on the board', async () => {
    await assertFails(at('alex', 'presence/alex').set(here('Alex', { x: -5 })));
    await assertFails(at('alex', 'presence/alex').set(here('Alex', { y: 5000 })));
  });

  test('students who are waiting can show they are there, but removed students and strangers cannot', async () => {
    await seed(board({ banned: { carl: { name: 'Carl', at: 1300 } }, students: { carl: { name: 'Carl', status: 'active', joinedAt: 1 }, bea: { name: 'Bea', status: 'pending', joinedAt: 2 } } }));
    await assertSucceeds(at('bea', 'presence/bea').set(here('Bea')));
    await assertFails(at('carl', 'presence/carl').set(here('Carl')));
    await assertFails(at('stranger', 'presence/stranger').set(here('Stranger')));
  });

  test('the admin can show a cursor under any name', async () => {
    await assertSucceeds(at('teacher', 'presence/teacher').set(here('Teacher')));
  });

  test('anything else under the board is refused', async () => {
    await assertFails(at('teacher', 'notes').set('hello'));
    await assertFails(at('alex', 'secret').set('hello'));
  });
});

describe('removal takes effect', () => {
  test('a removed student loses access to the board straight away', async () => {
    await seed(board());
    await assertSucceeds(at('alex', 'items').once('value'));
    await assertSucceeds(at('alex', 'items/before').set(newStroke('alex')));

    await at('teacher').update({
      'students/alex': null,
      'banned/alex': { name: 'Alex', at: TS },
    });

    await assertFails(at('alex', 'items').once('value'));
    await assertFails(at('alex', 'items/after').set(newStroke('alex')));
    await assertFails(at('alex', 'presence/alex').set({ name: 'Alex', color: '#2b4fd8', at: TS }));
    await assertFails(at('alex', 'students/alex').set({ name: 'Alex', status: 'active', joinedAt: TS }));
  });

  test('a removed student can join again once the admin lets them back in', async () => {
    await seed(board({ banned: { carl: { name: 'Carl', at: 1300 } }, students: {} }));
    await at('teacher', 'banned/carl').remove();
    await assertSucceeds(at('carl', 'students/carl').set({ name: 'Carl', status: 'active', joinedAt: TS }));
    await assertSucceeds(at('carl', 'items').once('value'));
  });
});

describe('the background picture', () => {
  const PNG = `data:image/png;base64,${'A'.repeat(100)}`;
  const JPEG = `data:image/jpeg;base64,${'/9j/'.repeat(25)}`;
  const picture = (over = {}) => ({ img: PNG, w: 1600, h: 900, name: 'Worksheet', at: TS, ...over });

  beforeEach(() => seed(board({ banned: { carl: { name: 'Carl', at: 1300 } } })));

  test('the admin can set it, replace it and take it away', async () => {
    await assertSucceeds(at('teacher', 'background').set(picture()));
    const { name, ...unnamed } = picture({ img: JPEG });
    await assertSucceeds(at('teacher', 'background').set(unnamed));
    await assertSucceeds(at('teacher', 'background').remove());
  });

  test('students cannot set, change or clear it', async () => {
    await assertFails(at('alex', 'background').set(picture()));
    await assertFails(at('bea', 'background').set(picture()));
    await at('teacher', 'background').set(picture());
    await assertFails(at('alex', 'background/img').set(JPEG));
    await assertFails(at('alex', 'background').remove());
  });

  test('admitted students can see it; waiting, removed and unknown people cannot', async () => {
    await at('teacher', 'background').set(picture());
    const seen = await assertSucceeds(at('alex', 'background').once('value'));
    assert(seen.child('w').val() === 1600);
    for (const uid of ['bea', 'carl', 'stranger']) await assertFails(at(uid, 'background').once('value'));
    await assertFails(at(null, 'background').once('value'));
  });

  test('only PNG and JPEG pictures are accepted, never links, scripts or other formats', async () => {
    for (const img of [
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      'data:text/html;base64,PGgxPjwvaDE+',
      'https://example.com/picture.png',
      'javascript:alert(1)',
      'AAAA',
      '',
    ]) {
      await assertFails(at('teacher', 'background').set(picture({ img })));
    }
    await assertFails(at('teacher', 'background').set(picture({ img: 12345 })));
  });

  test('the picture has a size limit, exactly the one the app prepares for', async () => {
    const prefix = 'data:image/png;base64,';
    await assertSucceeds(at('teacher', 'background').set(picture({ img: prefix + 'A'.repeat(1_500_000 - prefix.length) })));
    await assertFails(at('teacher', 'background').set(picture({ img: prefix + 'A'.repeat(1_500_001 - prefix.length) })));
  });

  test('it needs its size and a server time, and nothing extra', async () => {
    const { w, ...withoutWidth } = picture();
    await assertFails(at('teacher', 'background').set(withoutWidth));
    const { at: _at, ...withoutTime } = picture();
    await assertFails(at('teacher', 'background').set(withoutTime));
    await assertFails(at('teacher', 'background').set(picture({ at: 1234 })));
    await assertFails(at('teacher', 'background').set(picture({ w: 0 })));
    await assertFails(at('teacher', 'background').set(picture({ h: 5000 })));
    await assertFails(at('teacher', 'background').set(picture({ w: '1600' })));
    await assertFails(at('teacher', 'background').set(picture({ name: 'n'.repeat(81) })));
    await assertFails(at('teacher', 'background').set(picture({ extra: true })));
  });

  test('clearing the board leaves the background, and deleting the board takes it away', async () => {
    await at('teacher', 'background').set(picture());
    await assertSucceeds(at('teacher').update({ items: null, live: null }));
    const kept = await at('teacher', 'background/w').once('value');
    assert(kept.val() === 1600, 'the background is still there');
    await assertSucceeds(at('teacher').remove());
    // The owner has no rights over a board that no longer exists, so look with the rules switched off.
    let left = 'not looked at';
    await env.withSecurityRulesDisabled(async (context) => {
      left = (await context.database().ref(`whiteboards/${CODE}/background`).once('value')).val();
    });
    assert(left === null, 'the background went with the board');
  });
});
