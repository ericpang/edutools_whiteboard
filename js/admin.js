// Admin page. Without ?code it lists the boards this browser started and lets you start another.
// With a code it runs that board: the roster, admitting and removing students, locking, clearing, saving.
import { buildRoster } from './access.js';
import { parseBackground } from './background.js';
import { showBackgroundDialog } from './background-dialog.js';
import { createBoard } from './board.js';
import { admitStudent, deleteBoard, getMeta, letBackIn, removeStudent, setMeta, setViewOnly, startBoard, watch } from './db.js';
import { signIn } from './firebase.js';
import { iconHtml } from './icons.js';
import { adminLink, goTo, joinLink, pageUrl } from './nav.js';
import { forgetBoard, myBoards, rememberBoard } from './storage.js';
import { mountTray } from './tray.js';
import { $, confirmDialog, copyText, downloadBlob, el, explainError, explainSetupError, hydrateIcons, showScreen, toast } from './ui.js';
import { colorForUid, initials, inkOn, isValidCode, normalizeCode, sanitizeTitle } from './util.js';

const code = normalizeCode(new URLSearchParams(location.search).get('code'));

hydrateIcons();
$('#boards-link').href = pageUrl('admin.html');
start().catch(fatal);

function fatal(error) {
  console.error(error);
  $('#error-detail').textContent = `${explainSetupError(error)}${error?.code ? ` (${error.code})` : ''}`;
  showScreen('error');
}

function message(title, body, ...actions) {
  $('#message-title').textContent = title;
  $('#message-body').textContent = body;
  $('#message-actions').replaceChildren(...actions);
  showScreen('message');
}

const link = (href, label, primary = false) => el('a', { class: `btn${primary ? ' btn-primary' : ''}`, href }, label);

async function start() {
  const uid = await signIn();
  if (!code) return showBoards(uid);
  if (!isValidCode(code)) {
    return message('That doesn’t look like a board code', 'Board codes have 6 letters and numbers.', link(pageUrl('admin.html'), 'See your boards', true));
  }

  const meta = await getMeta(code);
  if (!meta) {
    forgetBoard(code);
    return message('That board doesn’t exist', 'It may have been deleted. Your other boards are still here.', link(pageUrl('admin.html'), 'See your boards', true));
  }
  if (meta.owner !== uid) {
    return message(
      'This board belongs to someone else',
      'Only the browser that started a board can run it. If this is your board, open it in the browser you started it in.',
      link(pageUrl('student.html', { code }), 'Join as a student', true),
      link(pageUrl('admin.html'), 'See your boards'),
    );
  }
  rememberBoard({ code, title: meta.title });
  return runBoard(uid, meta);
}

// ---- Your boards --------------------------------------------------------------------------

async function showBoards(uid) {
  showScreen('boards');
  const form = $('#create-form');
  const title = $('#new-title');
  const approval = $('#new-approval');
  const problem = $('#new-error');
  const submit = $('button[type="submit"]', form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = sanitizeTitle(title.value);
    if (!name) {
      problem.textContent = 'Give the board a name, like “Maths 3B”.';
      title.setAttribute('aria-invalid', 'true');
      title.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Starting…';
    try {
      const created = await startBoard(uid, { title: name, requireApproval: approval.checked });
      rememberBoard({ code: created, title: name });
      goTo('admin.html', { code: created });
    } catch (error) {
      toast(explainSetupError(error), 'error');
      submit.disabled = false;
      submit.textContent = 'Start board';
    }
  });
  title.addEventListener('input', () => {
    problem.textContent = '';
    title.removeAttribute('aria-invalid');
  });

  const remembered = myBoards();
  if (!remembered.length) {
    $('#boards-empty').hidden = false;
    return;
  }

  // Check each remembered board still exists and is ours; forget the ones that were deleted.
  const checked = await Promise.all(
    remembered.map(async (board) => {
      try {
        return { ...board, meta: await getMeta(board.code) };
      } catch {
        return { ...board, meta: undefined };
      }
    }),
  );
  const mine = [];
  for (const board of checked) {
    if (board.meta === null) forgetBoard(board.code);
    else if (board.meta === undefined || board.meta.owner === uid) mine.push({ ...board, title: board.meta?.title ?? board.title });
  }

  $('#boards-empty').hidden = mine.length > 0;
  $('#board-list').replaceChildren(
    ...mine.map((board) =>
      el(
        'li',
        { class: 'board-row' },
        el('span', { class: 'board-row-main' }, el('span', { class: 'board-row-title' }, board.title), el('span', { class: 'board-row-code', translate: 'no' }, formatCode(board.code))),
        link(adminLink(board.code), 'Open'),
      ),
    ),
  );
}

// A non-breaking space keeps the two halves of a code together when a line wraps.
const formatCode = (value) => `${value.slice(0, 3)}\u00a0${value.slice(3)}`;

// ---- One board ----------------------------------------------------------------------------

function runBoard(uid, firstMeta) {
  showScreen('console');
  const app = $('#console');
  const roster = $('#roster');
  const banner = $('#banner');
  const lockSwitch = $('#lock-switch');
  const approveSwitch = $('#approve-switch');
  const openPanel = $('#open-panel');
  const panel = $('#panel');

  let meta = firstMeta;
  let students = {};
  let banned = {};
  let here = new Map();
  let leaving = false;
  let rosterQueued = false;
  let background = null;

  const board = createBoard({
    stage: $('#stage'),
    code,
    uid,
    name: 'Teacher',
    isOwner: true,
    onError: (error) => toast(explainError(error), 'error'),
    onPeople: (people) => {
      here = people;
      queueRoster();
    },
  });
  board.setOwner(uid);
  board.setAbility({ canDraw: true, reason: 'ok' });
  mountTray($('#tray'), board);

  $('#code').textContent = formatCode(code);

  const stops = [
    watch(
      code,
      'meta',
      (value) => {
        if (!value) return gone();
        meta = value;
        renderMeta();
      },
      (error) => toast(explainError(error), 'error'),
    ),
    watch(code, 'students', (value) => {
      students = value ?? {};
      queueRoster();
    }),
    watch(code, 'banned', (value) => {
      banned = value ?? {};
      queueRoster();
    }),
    watch(code, 'background', (value) => {
      background = parseBackground(value);
      board.setBackground(background);
    }),
  ];

  function gone() {
    if (leaving) return;
    stops.forEach((stop) => stop());
    board.destroy();
    forgetBoard(code);
    message('This board was deleted', 'Its drawings are gone and students have been disconnected.', link(pageUrl('admin.html'), 'See your boards', true));
  }

  function renderMeta() {
    document.title = `${meta.title} - Whiteboard`;
    $('#board-title').textContent = meta.title;
    lockSwitch.checked = meta.locked === true;
    approveSwitch.checked = meta.requireApproval === true;
    banner.hidden = meta.locked !== true;
    banner.textContent = 'The board is locked. Students can watch, but only you can draw.';
  }
  renderMeta();

  // ---- Roster

  const queueRoster = () => {
    if (rosterQueued) return;
    rosterQueued = true;
    requestAnimationFrame(() => {
      rosterQueued = false;
      renderRoster();
    });
  };

  // The three groups are built once, and each person's row is built once and then patched in place. A button is
  // never replaced while its person stays in the same group, so a click can't land on an element that was swapped
  // out a moment earlier. That matters: students arrive, and flip from offline to online, all the time.
  const makeGroup = (id, heading) => {
    const count = el('span', { class: 'count' });
    const list = el('ul', { class: 'people' });
    return { count, list, root: el('section', { class: 'roster-group', 'aria-labelledby': id, hidden: true }, el('h3', { id }, heading, count), list) };
  };
  const groups = {
    waiting: makeGroup('g-waiting', 'Waiting to join'),
    members: makeGroup('g-members', 'In the room'),
    removed: makeGroup('g-removed', 'Removed'),
  };
  const emptyNote = el('p', { class: 'empty', hidden: true }, 'No one has joined yet. Share the join code and students will appear here.');
  roster.replaceChildren(groups.waiting.root, groups.members.root, emptyNote, groups.removed.root);

  const rowButton = (what, uid, className, { text, icon, attrs } = {}) =>
    el('button', { class: `btn btn-small ${className}`.trim(), type: 'button', 'data-action': what, 'data-uid': uid, html: icon && iconHtml(icon, 18), ...attrs }, text);

  function makeRow(kind, uid) {
    const avatarEl = el('span', { class: 'avatar', 'aria-hidden': 'true' });
    const nameEl = el('span', { class: 'person-name', translate: 'no' });
    const dot = el('span', { class: 'dot', 'aria-hidden': 'true' });
    const stateText = document.createTextNode('');
    const stateEl = el('span', { class: 'person-state' }, dot, stateText);

    const admit = rowButton('admit', uid, 'btn-primary', { text: 'Admit' });
    const dismiss = rowButton('remove', uid, '', { text: 'Remove', attrs: { 'data-member': 'no' } });
    const viewOnly = rowButton('view-only', uid, 'btn-icon', { icon: 'eye' });
    const eject = rowButton('remove', uid, 'btn-icon', { icon: 'x', attrs: { 'data-member': 'yes' } });
    const letIn = rowButton('let-in', uid, '', { text: 'Let back in' });
    const buttons = { waiting: [admit, dismiss], member: [viewOnly, eject], removed: [letIn] }[kind];

    const color = colorForUid(uid);
    avatarEl.style.setProperty('--c', color);
    avatarEl.style.setProperty('--on', inkOn(color));

    return {
      node: el('li', { class: 'person' }, avatarEl, el('span', { class: 'person-main' }, nameEl, stateEl), el('span', { class: 'person-actions' }, ...buttons)),
      update(s) {
        avatarEl.textContent = initials(s.name);
        nameEl.textContent = s.name;
        stateEl.hidden = kind === 'removed';
        dot.classList.toggle('is-on', s.online === true);
        stateText.data = `${s.online ? 'Online' : 'Offline'}${s.viewOnly ? ', view-only' : ''}`;
        for (const button of buttons) button.dataset.name = s.name;
        admit.setAttribute('aria-label', `Admit ${s.name}`);
        dismiss.setAttribute('aria-label', `Remove ${s.name}`);
        eject.setAttribute('aria-label', `Remove ${s.name}`);
        eject.title = `Remove ${s.name}`;
        viewOnly.setAttribute('aria-label', `View-only for ${s.name}`);
        viewOnly.setAttribute('aria-pressed', String(s.viewOnly === true));
        viewOnly.title = s.viewOnly ? `Let ${s.name} draw again` : `Make ${s.name} view-only`;
        letIn.setAttribute('aria-label', `Let ${s.name} back in`);
      },
    };
  }

  let rowCache = new Map();
  let waitingSeen = new Set();

  // Puts `rows` into `group` in order, reusing each person's existing row. Returns the rows to remember.
  function fill(group, kind, rows) {
    const kept = new Map();
    const nodes = rows.map((s) => {
      const key = `${kind}:${s.uid}`;
      const row = rowCache.get(key) ?? makeRow(kind, s.uid);
      row.update(s);
      kept.set(key, row);
      return row.node;
    });
    nodes.forEach((node, index) => {
      if (group.list.children[index] !== node) group.list.insertBefore(node, group.list.children[index] ?? null);
    });
    while (group.list.children.length > nodes.length) group.list.lastElementChild.remove();
    group.count.textContent = String(rows.length);
    group.root.hidden = rows.length === 0;
    return kept;
  }

  function renderRoster() {
    const focused = document.activeElement?.closest?.('#roster') ? { action: document.activeElement.dataset.action, uid: document.activeElement.dataset.uid } : null;
    const { waiting, members, removed } = buildRoster({ students, presence: Object.fromEntries(here), banned });

    rowCache = new Map([...fill(groups.waiting, 'waiting', waiting), ...fill(groups.members, 'member', members), ...fill(groups.removed, 'removed', removed)]);

    // Tell screen readers when someone new is waiting, since the list changes without any focus moving.
    const fresh = waiting.filter((s) => !waitingSeen.has(s.uid));
    waitingSeen = new Set(waiting.map((s) => s.uid));
    if (fresh.length) $('#announce').textContent = fresh.length === 1 ? `${fresh[0].name} is waiting to join.` : `${fresh.length} students are waiting to join.`;

    emptyNote.hidden = members.length + waiting.length > 0;
    $('#student-count').textContent = String(members.length + waiting.length);
    openPanel.toggleAttribute('data-attention', waiting.length > 0);
    openPanel.setAttribute('aria-label', waiting.length ? `Students, ${waiting.length} waiting to join` : 'Students');

    if (focused) roster.querySelector(`[data-action="${focused.action}"][data-uid="${CSS.escape(focused.uid)}"]`)?.focus();
  }
  renderRoster();

  roster.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action: what, uid: id, name, member } = { ...button.dataset };
    try {
      if (what === 'admit') await admitStudent(code, id);
      else if (what === 'view-only') await setViewOnly(code, id, button.getAttribute('aria-pressed') !== 'true');
      else if (what === 'let-in') await letBackIn(code, id);
      else if (what === 'remove') await removeFlow(id, name, member === 'yes');
    } catch (error) {
      toast(explainError(error), 'error');
    }
  });

  async function removeFlow(id, name, isMember) {
    if (!isMember) return removeStudent(code, id, name);
    const { ok, checked } = await confirmDialog({
      title: `Remove ${name}?`,
      body: `${name} will be disconnected and can’t rejoin unless you let them back in.`,
      confirmLabel: `Remove ${name}`,
      danger: true,
      checkbox: { label: `Also delete ${name}’s drawings`, checked: false },
    });
    if (ok) await removeStudent(code, id, name, { deleteDrawings: checked });
  }

  // ---- Board controls

  async function flip(field, input) {
    try {
      await setMeta(code, { [field]: input.checked });
    } catch (error) {
      input.checked = !input.checked;
      toast(explainError(error), 'error');
    }
  }
  lockSwitch.addEventListener('change', () => flip('locked', lockSwitch));
  approveSwitch.addEventListener('change', () => flip('requireApproval', approveSwitch));

  $('#copy-link').addEventListener('click', async () => {
    toast((await copyText(joinLink(code))) ? 'Join link copied' : 'Couldn’t copy. Select the link and copy it by hand.');
  });

  $('#show-code').addEventListener('click', () => showCodeDialog());
  $('#show-qr').addEventListener('click', () => showCodeDialog());
  $('#background-button').addEventListener('click', () => showBackgroundDialog({ code, current: background }));

  $('#save-image').addEventListener('click', async () => {
    const blob = await board.exportPng();
    if (blob) downloadBlob(blob, `whiteboard-${code}.png`);
    else toast('Couldn’t save the image. Try again.', 'error');
  });

  $('#clear-board').addEventListener('click', async () => {
    const { ok } = await confirmDialog({
      title: 'Clear the whole board?',
      body: `This removes every drawing and note, including students’ work.${background ? ' The background stays.' : ''} You can’t undo it.`,
      confirmLabel: 'Clear board',
      danger: true,
    });
    if (!ok) return;
    try {
      await board.clear();
    } catch (error) {
      toast(explainError(error), 'error');
    }
  });

  $('#delete-board').addEventListener('click', async () => {
    const { ok } = await confirmDialog({
      title: 'Delete this board?',
      body: 'Students are disconnected and everything on the board is erased. You can’t undo it.',
      confirmLabel: 'Delete board',
      danger: true,
    });
    if (!ok) return;
    leaving = true;
    try {
      await deleteBoard(code);
      forgetBoard(code);
      goTo('admin.html');
    } catch (error) {
      leaving = false;
      toast(explainError(error), 'error');
    }
  });

  // The code, and a QR code for the same join link, large enough to read from the back of a room.
  async function showCodeDialog() {
    const link = joinLink(code);
    const { qrSvg } = await import('./qr.js');
    const dialog = el(
      'dialog',
      { class: 'dialog dialog-wide', 'aria-labelledby': 'code-dialog-title' },
      el(
        'form',
        { method: 'dialog' },
        el('h2', { id: 'code-dialog-title' }, 'Join this board'),
        el(
          'div',
          { class: 'join-share' },
          el('div', { class: 'qr', html: qrSvg(link, { label: `QR code for joining ${meta.title}` }) }),
          el(
            'div',
            { class: 'join-share-text' },
            el('p', {}, 'Scan the QR code with a camera, or go to'),
            el('p', { class: 'join-url' }, pageUrl('./')),
            el('p', {}, 'and enter the code'),
            el('p', { class: 'code code-huge', translate: 'no' }, formatCode(code)),
          ),
        ),
        el(
          'div',
          { class: 'dialog-actions' },
          el('button', { class: 'btn', type: 'button', onclick: async () => toast((await copyText(link)) ? 'Join link copied' : 'Couldn’t copy. Select the link and copy it by hand.') }, 'Copy link'),
          el('button', { class: 'btn btn-primary', value: 'close', autofocus: true }, 'Done'),
        ),
      ),
    );
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  // ---- Students panel: always visible on wide screens, a drawer on narrow ones

  const narrow = matchMedia('(max-width: 900px)');
  const setPanel = (open) => {
    app.classList.toggle('panel-open', open);
    openPanel.setAttribute('aria-expanded', String(open));
    panel.inert = narrow.matches && !open;
  };
  setPanel(false);
  narrow.addEventListener('change', () => setPanel(false));
  openPanel.addEventListener('click', () => setPanel(!app.classList.contains('panel-open')));
  $('#close-panel').addEventListener('click', () => {
    setPanel(false);
    openPanel.focus();
  });
  $('#scrim').addEventListener('click', () => setPanel(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && app.classList.contains('panel-open') && !document.querySelector('dialog[open]')) {
      setPanel(false);
      openPanel.focus();
    }
  });
}
