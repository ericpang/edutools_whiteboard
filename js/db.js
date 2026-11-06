// Everything the app says to Firebase, in one place. Paths match database.rules.json:
//
//   whiteboards/{CODE}
//     meta                 owner, title, locked, requireApproval, createdAt
//     students/{uid}       name, status ('pending' | 'active'), viewOnly, joinedAt
//     banned/{uid}         name, at   (removed students)
//     items/{id}           one stroke or note: type, uid, color, size, pts | text/x/y, ts
//     live/{uid}           the stroke someone is drawing right now
//     presence/{uid}       name, color, cursor x/y, at
//     background           img (PNG or JPEG data URL), w, h, name, at: the picture or PDF page behind the board
import {
  db,
  equalTo,
  get,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onDisconnect,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from './firebase.js';
import { generateCode } from './util.js';

const boardPath = (code, path = '') => (path ? `whiteboards/${code}/${path}` : `whiteboards/${code}`);
const at = (code, path) => ref(db, boardPath(code, path));

export const isDenied = (error) => error?.code === 'PERMISSION_DENIED' || /permission[_ ]denied/i.test(error?.message ?? '');

// ---- Reading --------------------------------------------------------------------------------

export async function getMeta(code) {
  return (await get(at(code, 'meta'))).val();
}

// Calls back with the value at `path` now and whenever it changes. Returns a function that stops listening.
export function watch(code, path, onData, onError) {
  return onValue(at(code, path), (snapshot) => onData(snapshot.val()), onError);
}

// Calls back as children come, change and go. Initial children arrive as 'added' in key order.
export function watchChildren(code, path, { added, changed, removed }, onError) {
  const target = at(code, path);
  const stops = [
    onChildAdded(target, (snapshot) => added?.(snapshot.key, snapshot.val()), onError),
    onChildChanged(target, (snapshot) => changed?.(snapshot.key, snapshot.val()), onError),
    onChildRemoved(target, (snapshot) => removed?.(snapshot.key, snapshot.val()), onError),
  ];
  return () => stops.forEach((stop) => stop());
}

// Calls back with true or false as the connection to Firebase drops and returns.
export function watchConnection(onChange) {
  return onValue(ref(db, '.info/connected'), (snapshot) => onChange(snapshot.val() === true));
}

// ---- Admin: boards --------------------------------------------------------------------------

export async function startBoard(uid, { title, requireApproval }) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateCode();
    if ((await get(at(code, 'meta'))).exists()) continue;
    try {
      await set(at(code, 'meta'), { owner: uid, title, locked: false, requireApproval: Boolean(requireApproval), createdAt: serverTimestamp() });
      return code;
    } catch (error) {
      // Someone may have taken the code a moment ago. If it is still free, the rules refused us for another reason.
      if (!isDenied(error) || !(await get(at(code, 'meta'))).exists()) throw error;
    }
  }
  throw new Error('Could not find a free board code. Try again.');
}

export const setMeta = (code, patch) => update(at(code, 'meta'), patch);
export const clearBoard = (code) => update(at(code), { items: null, live: null });
export const deleteBoard = (code) => remove(at(code));

// The picture or PDF page behind the board. `img` is a PNG or JPEG data URL; the rules cap its length.
export const setBackground = (code, { img, w, h, name }) => set(at(code, 'background'), { img, w, h, ...(name ? { name } : {}), at: serverTimestamp() });
export const clearBackground = (code) => remove(at(code, 'background'));

// ---- Admin: students ------------------------------------------------------------------------

export const admitStudent = (code, uid) => update(at(code, `students/${uid}`), { status: 'active' });
export const setViewOnly = (code, uid, on) => update(at(code, `students/${uid}`), { viewOnly: on ? true : null });
export const letBackIn = (code, uid) => remove(at(code, `banned/${uid}`));

// Removes a student and blocks them from coming back, in one write so nobody sees a half-removed state.
export async function removeStudent(code, uid, name, { deleteDrawings = false } = {}) {
  const changes = {
    [`students/${uid}`]: null,
    [`live/${uid}`]: null,
    [`presence/${uid}`]: null,
    [`banned/${uid}`]: { name, at: serverTimestamp() },
  };
  if (deleteDrawings) {
    const theirs = await get(query(at(code, 'items'), orderByChild('uid'), equalTo(uid)));
    theirs.forEach((child) => {
      changes[`items/${child.key}`] = null;
    });
  }
  await update(at(code), changes);
}

// ---- Students: joining ----------------------------------------------------------------------

export async function joinBoard(code, uid, name, status) {
  const entry = (s) => ({ name, status: s, joinedAt: serverTimestamp() });
  try {
    await set(at(code, `students/${uid}`), entry(status));
  } catch (error) {
    if (!isDenied(error)) throw error;
    // The admin may have switched approval on or off since we looked. Try once more with the current setting.
    const meta = await getMeta(code);
    if (!meta) throw error;
    await set(at(code, `students/${uid}`), entry(meta.requireApproval === true ? 'pending' : 'active'));
  }
}

// ---- Drawing --------------------------------------------------------------------------------

// Adds a stroke or note. The id is known at once so the caller can track it; `saved` settles when the server answers.
export function addItem(code, item) {
  const target = push(at(code, 'items'));
  return { id: target.key, saved: set(target, { ...item, ts: serverTimestamp() }) };
}

export const removeItem = (code, id) => remove(at(code, `items/${id}`));

export const setLive = (code, uid, stroke) => (stroke ? set(at(code, `live/${uid}`), stroke) : remove(at(code, `live/${uid}`)));

// ---- Presence -------------------------------------------------------------------------------

// Shows the person as here, and arranges for them to disappear when the connection drops.
// Call again after a reconnect, because the server runs the clean-up when the connection is lost.
export async function announce(code, uid, { name, color }) {
  const here = at(code, `presence/${uid}`);
  const stroke = at(code, `live/${uid}`);
  await Promise.all([onDisconnect(here).remove(), onDisconnect(stroke).remove()]);
  await set(here, { name, color, at: serverTimestamp() });
}

export const moveCursor = (code, uid, x, y) =>
  update(at(code, `presence/${uid}`), { x: x === null ? null : Math.round(x), y: y === null ? null : Math.round(y), at: serverTimestamp() });

export async function leave(code, uid) {
  await Promise.all([remove(at(code, `presence/${uid}`)), remove(at(code, `live/${uid}`))]);
}
