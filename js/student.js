// Student page: join a board by code, wait to be admitted if the teacher asks for that, then draw.
//
// Three things decide what the student sees, and each is watched live: the board's settings, their own
// student record, and their own removal record. access.js turns those into a screen.
import { abilityMessage, getAbility, initialStatus, studentScreen } from './access.js';
import { parseBackground } from './background.js';
import { createBoard } from './board.js';
import { wireCodeForm } from './code-form.js';
import { announce, joinBoard, watch, watchConnection } from './db.js';
import { signIn } from './firebase.js';
import { adminLink } from './nav.js';
import { mountTray } from './tray.js';
import { $, el, explainError, explainSetupError, hydrateIcons, showScreen, toast } from './ui.js';
import { colorForUid, initials, inkOn, isValidCode, normalizeCode, sanitizeName } from './util.js';

const code = normalizeCode(new URLSearchParams(location.search).get('code'));

hydrateIcons();
run().catch(fatal);

function fatal(error) {
  console.error(error);
  $('#error-detail').textContent = `${explainSetupError(error)}${error?.code ? ` (${error.code})` : ''}`;
  showScreen('error');
}

async function run() {
  if (!code) {
    wireCodeForm({ form: $('#code-form'), input: $('#code'), error: $('#code-error') });
    showScreen('code');
    return;
  }
  if (!isValidCode(code)) {
    $('#notfound-title').textContent = 'That doesn’t look like a board code';
    showScreen('not-found');
    return;
  }

  const uid = await signIn();

  let meta = null;
  let me = null;
  let banned = null;
  let seenMeta = false;
  let board = null;
  let stopTray = null;
  let stopWaiting = null;
  let stopBackground = null;
  let joining = false;
  const loaded = new Set();

  const loadedOne = (what) => {
    loaded.add(what);
    if (loaded.size === 3) render();
  };
  // A watcher stopping is not worth a toast: the page already shows what happened (removed, closed, locked).
  const watchStopped = (error) => console.warn('A live update stopped:', error.message);

  watch(
    code,
    'meta',
    (value) => {
      meta = value;
      seenMeta ||= Boolean(value);
      loadedOne('meta');
    },
    fatal,
  );
  watch(
    code,
    `students/${uid}`,
    (value) => {
      me = value;
      loadedOne('me');
    },
    watchStopped,
  );
  watch(
    code,
    `banned/${uid}`,
    (value) => {
      banned = value;
      loadedOne('banned');
    },
    watchStopped,
  );

  function render() {
    if (meta && meta.owner === uid) {
      // This is the admin's own board; they belong on the admin page.
      location.replace(adminLink(code));
      return;
    }

    const screen = studentScreen({ meta, me, banned, seenMeta });
    if (screen !== 'board') leaveBoard();
    if (screen === 'waiting') showWaiting();
    else stopShowingWaiting();

    if (screen === 'join') {
      $('#join-title').textContent = `Join ${meta.title}`;
      $('#join-note').hidden = meta.requireApproval !== true;
      $('#join-form button[type="submit"]').disabled = joining;
    } else if (screen === 'waiting') {
      $('#waiting-name').textContent = me.name;
    }

    showScreen(screen);
    if (screen === 'board') showBoard();
    // Focus the name field on computers; on a phone it would pop the keyboard up before the page has been read.
    if (screen === 'join' && matchMedia('(pointer: fine)').matches) $('#name').focus();
  }

  function showBoard() {
    $('#board-title').textContent = meta.title;
    document.title = `${meta.title} - Whiteboard`;

    if (!board) {
      board = createBoard({
        stage: $('#stage'),
        code,
        uid,
        name: me.name,
        onError: (error) => toast(explainError(error), 'error'),
        onPeople: renderPeople,
      });
      stopTray = mountTray($('#tray'), board);
      stopBackground = watch(code, 'background', (value) => board?.setBackground(parseBackground(value)), watchStopped);
    }
    board.setOwner(meta.owner);

    const ability = getAbility({ meta, me, banned });
    board.setAbility(ability);
    const note = abilityMessage(ability.reason);
    $('#banner').hidden = !note;
    $('#banner').textContent = note;
  }

  // While waiting to be admitted the student isn't on the board yet, but the admin should still see
  // that they are here, so presence is shared from the waiting screen too.
  function showWaiting() {
    if (stopWaiting) return;
    const name = me.name;
    stopWaiting = watchConnection((connected) => {
      if (connected) announce(code, uid, { name, color: colorForUid(uid) }).catch(() => {});
    });
  }

  function stopShowingWaiting() {
    stopWaiting?.();
    stopWaiting = null;
  }

  function leaveBoard() {
    if (!board) return;
    stopTray();
    stopBackground?.();
    board.destroy();
    board = null;
    stopTray = null;
    stopBackground = null;
  }

  // Who is here, shown as a row of initials in the top bar. The teacher comes first.
  function renderPeople(people) {
    const list = [...people.values()].sort((a, b) => Number(b.uid === meta?.owner) - Number(a.uid === meta?.owner) || a.name.localeCompare(b.name));
    const shown = list.slice(0, 6).map((person) => {
      const color = colorForUid(person.uid);
      return el(
        'li',
        { class: `avatar${person.uid === meta?.owner ? ' is-teacher' : ''}`, style: `--c: ${color}; --on: ${inkOn(color)}`, title: person.name },
        initials(person.name),
        el('span', { class: 'visually-hidden' }, person.name),
      );
    });
    if (list.length > 6) shown.push(el('li', { class: 'avatar avatar-more' }, `+${list.length - 6}`));
    $('#people').replaceChildren(...shown);
    $('#people-count').textContent = `${list.length} ${list.length === 1 ? 'person' : 'people'} here`;
  }

  $('#join-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = sanitizeName($('#name').value);
    const problem = $('#name-error');
    if (!name) {
      problem.textContent = 'Type your name so your teacher knows who you are.';
      $('#name').setAttribute('aria-invalid', 'true');
      $('#name').focus();
      return;
    }
    const button = $('#join-form button[type="submit"]');
    joining = true;
    button.disabled = true;
    button.textContent = 'Joining…';
    try {
      await joinBoard(code, uid, name, initialStatus(meta));
    } catch (error) {
      toast(explainError(error), 'error');
    } finally {
      joining = false;
      button.disabled = false;
      button.textContent = 'Join board';
    }
  });
  $('#name').addEventListener('input', () => {
    $('#name-error').textContent = '';
    $('#name').removeAttribute('aria-invalid');
  });
}
