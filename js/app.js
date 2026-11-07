(function () {

const CONTENT = window.CONTENT;
const {
  RULES, makeGame, newPlay, answerPuzzle, answerKey, answerEvent,
  takeHint, useTorch, tryCode, finishFinal, escapeSeconds, guardLeft,
  roomSeconds, finalLeft, leafletDark, resultFor, solvedCount
} = window.EscapeGame;
const CanvasMuseumScene = window.CanvasMuseumScene;

const $ = selector => document.querySelector(selector);
const menuScreen = $('#menu-screen');
const gameUI = $('#game-ui');
const modalRoot = $('#modal-root');
const hud = $('#game-hud');
const targetHint = $('#target-hint');
const toastEl = $('#toast');
const stageSelect = $('#stage-select');
const tierSelect = $('#tier-select');
const joystick = $('#joystick');
const joystickKnob = $('#joystick-knob');

const state = {
  stage: 9, tier: 0, game: null, play: null,
  mode: 'menu', paused: false, modal: null,
  focusedId: null, focusedLabel: '', toastTimer: null,
  dark: false, lastGuardNotice: false, eventNotice: null,
  keysDown: new Set(), lastHud: 0, lastTick: 0,
  joystickPointer: null, joystickOrigin: null, pauseAt: null, pausedModal: null, cheatMatcher: null,
  libraryNotesFound: new Set(), libraryInventory: [], equippedLibraryPaper: null
};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const pad = value => String(Math.max(0, Math.floor(value))).padStart(2, '0');
const formatTime = seconds => `${pad(Math.floor(Math.max(0, seconds) / 60))}:${pad(Math.max(0, seconds) % 60)}`;
const currentRoom = () => state.game.rooms[state.play.room];
const currentContent = () => CONTENT[state.stage].escape;
const codeAlphabet = () => currentRoom().lock === 'letters' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '123456789';

let scene;
let gameTickTimer = null;

function stopGameTick() {
  if (gameTickTimer != null) clearTimeout(gameTickTimer);
  gameTickTimer = null;
}

function scheduleGameTick() {
  stopGameTick();
  if (state.mode !== 'game' || state.paused || document.hidden) return;
  gameTickTimer = window.setTimeout(() => {
    gameTickTimer = null;
    tick(Date.now());
    scheduleGameTick();
  }, 500);
}

function showToast(message, type = '') {
  toastEl.textContent = message;
  toastEl.className = `toast show ${type}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function updateMenuCopy() {
  const content = CONTENT[Number(stageSelect.value)].escape;
  $('#story-copy').textContent = content.story;
  $('.eyebrow').innerHTML = `<span class="eyebrow-dot"></span> AFTER-HOURS INCIDENT · CASE ${Number(stageSelect.value)}`;
  $('.brand small').textContent = content.museum;
  $('#start-button').querySelector('span').textContent = '↗';
  const best = readBest(Number(stageSelect.value), Number(tierSelect.value));
  $('#best-record').textContent = best == null ? 'NO ESCAPE RECORD YET' : `BEST TIME · ${formatTime(best)}`;
}

function bestKey(stage, tier) { return `afterhours-best-${stage}-${tier}`; }
function readBest(stage, tier) {
  try {
    const value = Number(localStorage.getItem(bestKey(stage, tier)));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}
function storeBest(stage, tier, seconds) {
  try {
    const old = readBest(stage, tier);
    if (old == null || seconds < old) localStorage.setItem(bestKey(stage, tier), String(seconds));
  } catch { /* local storage may be disabled */ }
}

function startGame() {
  stopGameTick();
  state.stage = Number(stageSelect.value);
  state.tier = Number(tierSelect.value);
  state.game = makeGame(state.stage, state.tier, Date.now());
  state.play = newPlay(state.game);
  state.mode = 'game';
  state.paused = false;
  state.pauseAt = null;
  state.pausedModal = null;
  state.dark = false;
  state.lastGuardNotice = false;
  state.eventNotice = null;
  state.libraryNotesFound = new Set();
  state.libraryInventory = [];
  state.equippedLibraryPaper = null;
  state.modal = null;
  state.focusedId = null;
  scene.setPointerLockEnabled(true);
  scene.setRendering(true);
  menuScreen.hidden = true;
  gameUI.hidden = false;
  hud.hidden = false;
  modalRoot.hidden = true;
  modalRoot.innerHTML = '';
  scene.setRoom(state.game, 0);
  renderLibraryHotbar();
  updateProgress();
  updateHud(true);
  updateObjective();
  showToast('Find the three clues. The guard returns in 12 minutes.');
  scheduleGameTick();
}

function showMenu() {
  stopGameTick();
  state.mode = 'menu';
  state.paused = false;
  state.pauseAt = null;
  state.pausedModal = null;
  state.modal = null;
  state.game = null;
  state.play = null;
  state.libraryInventory = [];
  state.equippedLibraryPaper = null;
  state.libraryNotesFound = new Set();
  scene?.setEquippedLibraryPaper(null);
  state.dark = false;
  scene.setMovement(0, 0);
  scene.setPointerLockEnabled(false);
  scene.setDark(false);
  scene.setTorch(false);
  scene.setRendering(true);
  scene.setRoom(makeGame(Number(stageSelect.value), Number(tierSelect.value), 1776), 0, true);
  menuScreen.hidden = false;
  gameUI.hidden = true;
  hud.hidden = true;
  modalRoot.hidden = true;
  modalRoot.innerHTML = '';
  updateMenuCopy();
}

function updateProgress() {
  const items = document.querySelectorAll('.progress-item');
  const room = state.play?.room ?? 0;
  items.forEach((item, index) => {
    item.classList.toggle('active', index === room);
    item.classList.toggle('done', index < room);
  });
}

function updateObjective() {
  if (!state.play) return;
  const room = currentRoom();
  $('#objective-text').textContent = room.name;
  $('#objective-sub').textContent = room.scene;
  $('#hud-room').textContent = scene?.isInLibrary?.() ? 'LIBRARY' : room.name.toUpperCase();
  $('#torch-button').hidden = room.event.type !== 'powercut';
  $('#desktop-torch-button').hidden = room.event.type !== 'powercut';
}

function updateHud(force = false) {
  if (!state.play || state.mode !== 'game') return;
  const now = Date.now();
  if (!force && now - state.lastHud < 500) return;
  state.lastHud = now;
  const left = guardLeft(state.play, now);
  scene?.setPaperState(currentRoom().code, state.play.solved[state.play.room]);
  $('#guard-timer').textContent = formatTime(left);
  $('#guard-wrap').classList.toggle('near', left <= 60 && left > 0);
  $('#guard-wrap').classList.toggle('caught', state.play.caught);
  const solved = state.play.solved[state.play.room];
  const found = solved.filter(Boolean).length;
  $('#solved-label').textContent = `CLUES FOUND · ${found} / 3`;
  const stack = $('#solved-paper-stack');
  if (stack) {
    const rows = solved.map((isSolved, index) => isSolved
      ? `<div class="solved-paper-row"><span>${index + 1}</span><b>=</b><strong>${escapeHtml(currentRoom().code[index])}</strong></div>`
      : '').filter(Boolean);
    stack.innerHTML = rows.join('');
    stack.hidden = rows.length === 0;
  }
  $('#hud-room').textContent = scene?.isInLibrary?.() ? 'LIBRARY' : currentRoom().name.toUpperCase();
  $('#key-label').textContent = `GOLDEN KEYS · ${state.play.keys.filter(Boolean).length} / 3`;
  const torchAvailable = currentRoom().event.type === 'powercut';
  $('#torch-button').hidden = !torchAvailable;
  $('#desktop-torch-button').hidden = !torchAvailable;
  $('#torch-button').classList.toggle('on', now < state.play.torchUntil);
}

function openModal(html, type) {
  state.modal = { type };
  scene?.releasePointerLock();
  scene?.setRendering(false);
  modalRoot.innerHTML = html;
  modalRoot.hidden = false;
}
function closeModal(recaptureMouse = false) {
  state.modal = null;
  modalRoot.hidden = true;
  modalRoot.innerHTML = '';
  scene?.setRendering(true);
  // Called only from a real user gesture when recaptureMouse is true.
  // Pointer Lock requires transient activation; it cannot be restored from a timer.
  if (recaptureMouse && state.mode === 'game' && !state.paused) {
    scene?.requestPointerLockFromGesture();
  }
}

function roomDocument(para = null) {
  const doc = currentContent().doc;
  return `<div class="leaflet"><h3>${escapeHtml(doc.title)}</h3>${doc.paras.map((text, index) =>
    `<p class="${para === index + 1 ? 'highlight' : ''}"><b>${index + 1}.</b> ${escapeHtml(text)}</p>`
  ).join('')}</div>`;
}

function showPuzzle(index) {
  const room = currentRoom();
  const puzzle = room.puzzles[index];
  if (state.play.solved[state.play.room][index]) {
    openModal(`<article class="modal-card narrow"><p class="modal-kicker">CLUE ${index + 1} · SOLVED</p><h2>${escapeHtml(puzzle.object)}</h2><p class="modal-desc">You have already found this part of the code: <strong>${escapeHtml(puzzle.gives)}</strong>.</p><div class="modal-actions"><span></span><button class="gold-button" data-action="close">Close</button></div></article>`, 'solved');
    return;
  }
  const prompt = puzzle.prompt || 'Choose the correct answer.';
  const options = puzzle.opts.map((option, optionIndex) =>
    `<button class="answer-option" type="button" data-answer-index="${optionIndex}">${escapeHtml(option)}</button>`
  ).join('');
  const doc = puzzle.kind === 'reading' ? roomDocument(puzzle.para) : '';
  openModal(`<article class="modal-card" data-puzzle-index="${index}">
    <p class="modal-kicker">${escapeHtml(room.name)} · CLUE ${index + 1} OF 3</p>
    <h2>${escapeHtml(puzzle.object)}</h2>
    ${doc}
    <p class="modal-desc">${escapeHtml(prompt)}</p>
    <div class="question-box">${escapeHtml(puzzle.text)}</div>
    <div class="answer-list">${options}</div>
    <div id="answer-feedback"></div>
    <div class="modal-actions">
      <button class="text-button" data-action="hint">Use a hint (+30 sec)</button>
      <button class="secondary-button" data-action="close">Close</button>
    </div>
  </article>`, 'puzzle');
  state.modal.index = index;
  state.modal.feedback = false;
}

function answerCurrentPuzzle(optionIndex) {
  if (state.modal?.type !== 'puzzle' || state.modal.feedback) return;
  const index = state.modal.index;
  const puzzle = currentRoom().puzzles[index];
  const option = puzzle.opts[optionIndex];
  const buttons = modalRoot.querySelectorAll('[data-answer-index]');
  buttons.forEach(button => button.disabled = true);
  const result = answerPuzzle(state.game, state.play, index, option);
  updateHud(true);
  const selected = modalRoot.querySelector(`[data-answer-index="${optionIndex}"]`);
  const feedback = $('#answer-feedback');
  if (result === 'right') {
    selected?.classList.add('correct');
    state.modal.feedback = true;
    feedback.innerHTML = '<div class="answer-feedback">Correct. One segment of the room code has been found.</div>';
    modalRoot.querySelector('.modal-actions').innerHTML = '<span></span><button class="gold-button" data-action="continue">Continue</button>';
  } else {
    selected?.classList.add('wrong');
    feedback.innerHTML = `<div class="answer-feedback bad">Not quite. ${RULES.penalties.wrong} seconds have been added. Try another answer.</div>`;
    buttons.forEach(button => { if (!button.classList.contains('wrong')) button.disabled = false; });
    showToast(`Incorrect answer · +${RULES.penalties.wrong} seconds`, 'bad');
  }
}

function showGoldenKey() {
  const key = currentRoom().key;
  if (state.play.keys[state.play.room] !== null) {
    showToast(state.play.keys[state.play.room] ? 'This room’s golden key is already collected.' : 'The golden key opportunity has been missed.', 'bad');
    return;
  }
  const options = key.opts.map((option, index) => `<button class="answer-option" data-key-index="${index}">${escapeHtml(option)}</button>`).join('');
  openModal(`<article class="modal-card narrow">
    <p class="modal-kicker">OPTIONAL OBJECTIVE · GOLDEN KEY</p>
    <h2>A final challenge.</h2>
    <p class="modal-desc">One attempt only. A correct answer removes 30 seconds from your escape time. A wrong answer loses the key.</p>
    <div class="question-box">${escapeHtml(key.prompt)}<br><br>${escapeHtml(key.text)}</div>
    <div class="answer-list">${options}</div>
    <div id="key-feedback"></div>
    <div class="modal-actions"><span></span><button class="secondary-button" data-action="close">Leave it</button></div>
  </article>`, 'key');
}

function answerGoldenKey(optionIndex) {
  if (state.modal?.type !== 'key' || state.modal.answered) return;
  const key = currentRoom().key;
  const selected = key.opts[optionIndex];
  const ok = answerKey(state.game, state.play, selected);
  state.modal.answered = true;
  modalRoot.querySelectorAll('[data-key-index]').forEach(button => button.disabled = true);
  modalRoot.querySelector(`[data-key-index="${optionIndex}"]`)?.classList.add(ok ? 'correct' : 'wrong');
  const explanation = key.note ? `<p class="modal-desc">${escapeHtml(key.note)}</p>` : '';
  $('#key-feedback').innerHTML = `<div class="answer-feedback ${ok ? '' : 'bad'}">${ok ? 'Golden key collected. 30 seconds removed.' : 'The key challenge is lost. This was your only attempt.'}</div>${explanation}`;
  modalRoot.querySelector('.modal-actions').innerHTML = '<span></span><button class="gold-button" data-action="close">Continue</button>';
  updateHud(true);
  showToast(ok ? 'Golden key collected · −30 seconds' : 'Golden key lost', ok ? 'good' : 'bad');
}

function showLock() {
  const chars = codeAlphabet();
  const current = state.play.dial || [0, 0, 0];
  const found = state.play.solved[state.play.room].map((value, index) => value ? currentRoom().code[index] : null);
  const dials = current.map((value, index) => `
    <div class="dial">
      <button type="button" data-dial="${index}" data-step="1" aria-label="Increase code symbol">▲</button>
      <strong>${chars[value]}</strong>
      <button type="button" data-dial="${index}" data-step="-1" aria-label="Decrease code symbol">▼</button>
      <small>${found[index] ? 'FOUND' : `LOCK ${index + 1}`}</small>
    </div>`).join('');
  openModal(`<article class="modal-card narrow">
    <p class="modal-kicker">${escapeHtml(currentRoom().name)} · SECURITY LOCK</p>
    <h2>${state.play.room === 2 ? 'The exit keypad.' : 'The room lock.'}</h2>
    <p class="modal-desc">Enter the three-character code in the order of the objects. Solved clues are recorded in your notebook. Guessing is allowed, but a wrong code costs 30 seconds.</p>
    <div class="dial-row">${dials}</div>
    <div class="code-progress">${found.map(value => `<span class="${value ? 'found' : ''}"></span>`).join('')}</div>
    <div id="lock-feedback"></div>
    <div class="modal-actions"><button class="text-button" data-action="notebook">View notebook</button><div><button class="secondary-button" data-action="close">Cancel</button> <button class="gold-button" data-action="try-code">Unlock</button></div></div>
  </article>`, 'lock');
}

function adjustDial(index, step) {
  const max = codeAlphabet().length;
  state.play.dial[index] = (state.play.dial[index] + step + max) % max;
  showLock();
}

function submitCode() {
  const chars = codeAlphabet();
  const code = state.play.dial.map(index => chars[index]);
  const outcome = tryCode(state.game, state.play, code);
  updateHud(true);
  if (!outcome.ok) {
    $('#lock-feedback').innerHTML = `<div class="answer-feedback bad">The lock stays shut. +${RULES.penalties.code} seconds. Check the notebook for found characters.</div>`;
    showToast(`Incorrect code · +${RULES.penalties.code} seconds`, 'bad');
    return;
  }
  if (outcome.final) {
    scene.openExit();
    closeModal();
    showFinalLock();
      return;
  }
  const completedRoom = state.play.room - 1;
  scene.openDoor(completedRoom);
  scene.setActiveRoom(state.game, state.play.room);
  closeModal(true);
  state.dark = false;
  updateProgress();
  updateObjective();
  updateHud(true);
  showToast(`Door unlocked. Walk through to ${currentRoom().name.toLowerCase()}.`, 'good');
}

function showNotebook() {
  if (!state.play) return;
  const rooms = state.game.rooms.map((room, index) => {
    const solved = state.play.solved[index];
    const segments = room.code.map((code, i) => solved[i] ? code : '—').join(' · ');
    const key = state.play.keys[index] === true ? 'Collected' : state.play.keys[index] === false ? 'Missed' : 'Not found';
    return `<div class="notebook-entry"><p class="modal-kicker">ROOM ${index + 1} · ${escapeHtml(room.name)}</p><div class="question-box">${escapeHtml(segments)}</div><p class="modal-desc">Golden key: ${key}</p></div>`;
  }).join('');
  openModal(`<article class="modal-card narrow"><p class="modal-kicker">FIELD NOTES</p><h2>Your notebook.</h2><p class="modal-desc">Code segments appear here as you solve the objects. Each lock uses the three answers in the order shown.</p>${rooms}<div class="modal-actions"><span></span><button class="gold-button" data-action="close">Close notebook</button></div></article>`, 'notebook');
}

function showEvent() {
  const event = currentRoom().event;
  const options = event.opts.map((option, index) => `<button class="answer-option" data-event-index="${index}">${escapeHtml(option)}</button>`).join('');
  openModal(`<article class="modal-card narrow event-card">
    <p class="modal-kicker">SOUND DETECTED · ${RULES.eventSeconds} SECONDS</p>
    <h2>Footsteps nearby.</h2>
    <p class="modal-desc">Someone is coming down the corridor. Answer quickly and quietly to avoid drawing attention.</p>
    <div class="question-box">Choose the word that means:<br><br>${escapeHtml(event.text)}</div>
    <div class="final-time" id="event-timer">00:10</div>
    <div class="answer-list">${options}</div>
  </article>`, 'event');
  state.modal.started = Date.now();
}

function answerFootsteps(index) {
  if (state.modal?.type !== 'event') return;
  const event = currentRoom().event;
  const ok = event.opts[index] === event.answer;
  answerEvent(state.play, ok);
  state.play.eventStarted = null;
  closeModal(true);
  updateHud(true);
  showToast(ok ? 'The footsteps move away.' : `The guard heard you · +${RULES.penalties.event} seconds`, ok ? 'good' : 'bad');
}

function activateTorch() {
  if (!state.play || state.mode !== 'game' || currentRoom().event.type !== 'powercut') return;
  useTorch(state.play);
  scene.setDark(false);
  scene.setTorch(true);
  state.dark = false;
  updateHud(true);
  showToast(`Torch on for ${RULES.torchSeconds} seconds · +${RULES.penalties.torch} seconds`, 'bad');
}

function showFinalLock() {
  const final = state.game.final;
  state.play.final.pick ||= [];
  renderFinalLock();
}

function renderFinalLock() {
  const final = state.game.final;
  const pick = state.play.final.pick || [];
  const left = Math.max(0, Math.ceil(finalLeft(state.play)));
  const slots = final.tiles.map((letter, index) => {
    const chosenIndex = pick[index];
    return `<span class="final-slot">${chosenIndex == null ? '' : escapeHtml(final.tiles[chosenIndex])}</span>`;
  }).join('');
  const tiles = final.tiles.map((letter, index) => `<button class="final-tile" data-tile-index="${index}" ${pick.includes(index) ? 'disabled' : ''}>${escapeHtml(letter)}</button>`).join('');
  openModal(`<article class="modal-card narrow">
    <p class="modal-kicker">FINAL EXIT · 60 SECOND WORD LOCK</p>
    <h2>The street door.</h2>
    <p class="modal-desc">Put the letters of a word you found in the ticket hall in the correct order. The lock will release when the word is complete.</p>
    ${final.clue ? `<div class="question-box">Clue: ${escapeHtml(final.clue)}</div>` : ''}
    <div class="final-time ${left <= 10 ? 'near' : ''}" id="final-timer">${formatTime(left)}</div>
    <div class="final-slots">${slots}</div>
    <div class="final-tiles">${tiles}</div>
    <div class="modal-actions"><button class="secondary-button" data-action="undo-tile" ${pick.length ? '' : 'disabled'}>Undo</button><div><button class="secondary-button" data-action="clear-tiles" ${pick.length ? '' : 'disabled'}>Clear</button> <button class="gold-button" data-action="submit-final" ${pick.length === final.tiles.length ? '' : 'disabled'}>Check word</button></div></div>
  </article>`, 'final');
}

function addFinalTile(index) {
  if (state.modal?.type !== 'final') return;
  const pick = state.play.final.pick;
  if (pick.includes(index) || pick.length >= state.game.final.tiles.length) return;
  pick.push(index);
  renderFinalLock();
  if (pick.length === state.game.final.tiles.length) {
    const word = pick.map(tileIndex => state.game.final.tiles[tileIndex]).join('');
    if (word === state.game.final.word) completeGame(true);
    else {
      showToast('That word does not fit. Rearrange the letters.', 'bad');
      setTimeout(() => {
        if (state.mode === 'game' && state.modal?.type === 'final' && !state.play.final.done) {
          state.play.final.pick = [];
          renderFinalLock();
        }
      }, 650);
    }
  }
}

function completeGame(correct) {
  stopGameTick();
  finishFinal(state.play, correct);
  state.mode = 'done';
  closeModal();
  scene.setMovement(0, 0);
  const result = resultFor(state.game, state.play);
  storeBest(state.stage, state.tier, result.seconds);
  showResult(result);
}

function showResult(result) {
  gameUI.hidden = true;
  hud.hidden = false;
  $('#guard-timer').textContent = formatTime(guardLeft(state.play));
  const title = result.caught ? 'The guard caught you.' : 'You made it out.';
  const story = currentContent().escaped;
  const stars = [0, 1, 2].map(index => `<span class="${index < result.stars ? 'on' : ''}">★</span>`).join('');
  openModal(`<article class="modal-card narrow result-card">
    <p class="modal-kicker">CASE CLOSED · STAGE ${state.stage}</p>
    <h2>${title}</h2>
    <div class="result-stars">${stars}</div>
    <p class="modal-desc">${escapeHtml(story)} ${result.finalOk ? 'The exit word was entered before the lock timed out.' : 'The exit lock jammed, but released after the delay.'}</p>
    <div class="result-grid">
      <div class="result-stat"><strong>${formatTime(result.seconds)}</strong><span>ESCAPE TIME</span></div>
      <div class="result-stat"><strong>${result.rightFirst}/9</strong><span>FIRST-TRY CLUES</span></div>
      <div class="result-stat"><strong>${result.keys}/3</strong><span>GOLDEN KEYS</span></div>
    </div>
    <p class="modal-desc">Score: ${result.points.toLocaleString()} points · ${state.game.tierName} difficulty</p>
    <div class="modal-actions"><button class="secondary-button" data-action="menu">Main menu</button><button class="gold-button" data-action="again">Play again</button></div>
  </article>`, 'result');
}

function showGalleryPhoto(index) {
  const names = ['Gallery photograph I','Gallery photograph II','Gallery photograph III','Gallery photograph IV'];
  const art = window.GALLERY_ART_DATA;
  if (!art) return showToast('The gallery image is unavailable.', 'bad');
  openModal(`<article class="modal-card narrow gallery-viewer"><p class="modal-kicker">MUSEUM GALLERY · PHOTO ${index + 1}</p><h2>${names[index] || 'Gallery photograph'}</h2><img src="${art}" alt="Dog photograph displayed in the museum gallery" style="display:block;width:100%;max-height:52vh;object-fit:contain;border-radius:12px;background:#fff;margin:14px auto"><div class="modal-actions"><span></span><button class="gold-button" data-action="close">Close</button></div></article>`, 'gallery');
}

const LIBRARY_NOTES = [
  ['Cataloguing', 'Every donated book is assigned a catalogue number before it is placed on a shelf.'],
  ['Conservation', 'Keep archival paper away from direct sunlight, moisture and fingerprints.'],
  ['Classification', 'The library groups material by subject so visitors can find related books together.'],
  ['Acquisitions', 'A collection grows through purchases, donations and carefully documented transfers.'],
  ['Reference desk', 'Reference books are consulted in the library and are not normally borrowed.'],
  ['Restoration', 'A conservator repairs damaged bindings with reversible materials whenever possible.'],
  ['Archive rules', 'Historical letters are stored flat in protective folders to prevent creasing.'],
  ['Index cards', 'An index card records an item title, author, subject and shelf location.'],
  ['Quiet study', 'The reading area is kept quiet so visitors can study without disturbing others.'],
  ['Collection note', 'A complete catalogue records where each item came from and how it is preserved.']
];

function renderLibraryHotbar() {
  const hotbar = $('#paper-hotbar');
  const slots = $('#paper-hotbar-slots');
  if (!hotbar || !slots) return;
  const visible = state.mode === 'game' && !!scene?.isInLibrary?.() && state.libraryInventory.length > 0;
  hotbar.hidden = !visible;
  if (!visible) { slots.innerHTML = ''; return; }
  slots.innerHTML = state.libraryInventory.map((paperIndex, slotIndex) => {
    const note = LIBRARY_NOTES[paperIndex];
    const selected = paperIndex === state.equippedLibraryPaper;
    const preview = String(note[1] || '').replace(/\s+/g, ' ').slice(0, 34);
    return `<button type="button" class="paper-hotbar-slot${selected ? ' selected' : ''}" data-library-paper-slot="${slotIndex}" data-paper-index="${paperIndex}" aria-pressed="${selected}" title="Equip ${escapeHtml(note[0])}"><span class="paper-slot-index">${String(slotIndex + 1).padStart(2, '0')}</span><span class="paper-slot-art">${escapeHtml(preview)}</span><strong>${escapeHtml(note[0])}</strong></button>`;
  }).join('');
}

function equipLibraryPaper(index) {
  if (!state.libraryInventory.includes(index) || !scene?.isInLibrary?.()) return false;
  const note = LIBRARY_NOTES[index];
  state.equippedLibraryPaper = index;
  scene.setEquippedLibraryPaper(note ? { title: note[0], body: note[1] } : null);
  renderLibraryHotbar();
  return true;
}

function collectLibraryNote(index) {
  const note = LIBRARY_NOTES[index];
  if (!note || !scene?.isInLibrary?.()) return;
  if (state.libraryInventory.includes(index)) {
    equipLibraryPaper(index);
    showToast(`${note[0]} is already in your hotbar.`, '');
    return;
  }
  state.libraryNotesFound.add(index);
  state.libraryInventory.push(index);
  scene.collectLibraryPaper(index);
  equipLibraryPaper(index); // Newly collected papers are equipped automatically.
  showToast(`${note[0]} collected · added to hotbar`, 'good');
}

function handleAreaChange(nextArea, previousArea) {
  if (previousArea === 'library' && nextArea !== 'library') {
    // Archive papers are temporary Library inventory. They disappear from the
    // hotbar and from the player's hand immediately upon leaving the Library.
    state.libraryInventory = [];
    state.equippedLibraryPaper = null;
    state.libraryNotesFound.clear();
    scene?.setEquippedLibraryPaper(null);
  }
  renderLibraryHotbar();
  updateHud(true);
}

function handleInteract(id) {
  if (state.mode !== 'game' || state.paused || !state.play || state.modal) return;
  if (id === 'lock') return showLock();
  if (id === 'key') return showGoldenKey();
  const libraryPaper = /^library-paper-(\d+)$/.exec(id || '');
  if (libraryPaper) return collectLibraryNote(Number(libraryPaper[1]));
  if (id === 'chair-0' || id === 'chair-1') {
    if (scene.seated) scene.standUp();
    else if (!scene.sitOnChair(id === 'chair-0' ? 0 : 1)) showToast('Move closer to the chair to sit.', '');
    return;
  }
  const galleryChair = /^gallery-chair-(\d)$/.exec(id || '');
  if (galleryChair) {
    if (scene.seated) scene.standUp();
    else if (!scene.sitOnGalleryChair(Number(galleryChair[1]))) showToast('Move closer to the chair to sit.', '');
    return;
  }
  const paperMatch = /^(?:paper|puzzle)-(\d)$/.exec(id || '');
  if (paperMatch) return showPuzzle(Number(paperMatch[1]));
  const photoMatch = /^photo-(\d)$/.exec(id || '');
  if (photoMatch) return showGalleryPhoto(Number(photoMatch[1]));
}

function tick(now) {
  if (state.mode !== 'game' || state.paused || !state.play) return;
  const play = state.play;
  const room = currentRoom();
  const guard = guardLeft(play, now);
  updateHud();

  if (guard <= 0 && !play.caught) {
    play.caught = true;
    showToast('The night guard has returned. You are caught, but can still finish.', 'bad');
  }
  if (guard > 0 && guard <= 60 && !state.lastGuardNotice) {
    state.lastGuardNotice = true;
    showToast('One minute until the guard returns.', 'bad');
  }

  if (play.final && !play.final.done) {
    const left = finalLeft(play, now);
    const timer = $('#final-timer');
    if (timer) {
      timer.textContent = formatTime(left);
      timer.classList.toggle('near', left <= 10);
    }
    if (left <= 0) {
      showToast(`The exit lock jams · +${RULES.penalties.final} seconds`, 'bad');
      completeGame(false);
    }
    return;
  }

  if (room.event.type === 'footsteps' && play.events[play.room] == null && !play.eventStarted && roomSeconds(play, now) >= room.event.at) {
    play.eventStarted = now;
    showEvent();
  }
  if (play.eventStarted && play.events[play.room] == null) {
    const left = RULES.eventSeconds - (now - play.eventStarted) / 1000;
    const timer = $('#event-timer');
    if (timer) timer.textContent = formatTime(left);
    if (left <= 0) {
      answerEvent(play, false);
      play.eventStarted = null;
      closeModal();
      updateHud(true);
      showToast(`Too slow. The guard heard you · +${RULES.penalties.event} seconds`, 'bad');
    }
  }

  if (room.event.type === 'powercut') {
    const dark = leafletDark(state.game, play, now);
    if (dark !== state.dark) {
      state.dark = dark;
      scene.setDark(dark);
      scene.setTorch(false);
      if (dark) showToast('The gallery lights have gone out. Use your torch.');
    }
    if (now <= play.torchUntil) scene.setTorch(true);
    else scene.setTorch(false);
  }
}

function showTestMenu() {
  if (state.mode !== 'game' || !state.play) {
    showToast('Start a game before using the test menu.');
    return;
  }
  state.keysDown.clear();
  syncKeyboardMove();
  const roomIndex = state.play.room;
  const roomName = state.game.rooms[roomIndex].name;
  openModal(`<article class="modal-card narrow test-menu">
    <p class="modal-kicker">DEVELOPER TOOLS · KONAMI CODE</p>
    <h2>Test controls.</h2>
    <p class="modal-desc">Testing actions affect this run only. Current room: ${escapeHtml(roomName)}.</p>
    <div class="answer-list">
      <button class="answer-option" data-test-action="time">Add 5 minutes</button>
      <button class="answer-option" data-test-action="solve">Solve current room clues</button>
      <button class="answer-option" data-test-action="gallery">Jump to gallery</button>
      <button class="answer-option" data-test-action="storeroom">Jump to storeroom</button>
      <button class="answer-option" data-test-action="library">Jump to library</button>
      <button class="answer-option" data-test-action="final">Open final exit lock</button>
    </div>
    <div class="modal-actions"><span></span><button class="secondary-button" data-action="close">Close test menu</button></div>
  </article>`, 'test');
}

function testJumpToRoom(index) {
  if (!state.play || !state.game) return;
  const now = Date.now();
  state.play.room = Math.max(0, Math.min(2, index));
  state.play.roomStart[state.play.room] ??= now;
  state.play.final = null;
  state.play.dial = [0, 0, 0];
  state.dark = false;
  scene.setDark(false);
  scene.setTorch(false);
  scene.warpToRoomForTesting(state.game, state.play.room);
  updateProgress();
  updateObjective();
  updateHud(true);
  scheduleGameTick();
}

function runTestAction(action) {
  if (!state.play || state.mode !== 'game') return;
  if (action === 'time') {
    state.play.t0 += 5 * 60 * 1000;
    updateHud(true);
    showToast('Five minutes added to the guard timer.', 'good');
  } else if (action === 'solve') {
    state.play.solved[state.play.room] = [true, true, true];
    state.play.dial = currentRoom().code.map(value => codeAlphabet().indexOf(String(value).toUpperCase()));
    updateHud(true);
    updateProgress();
    showToast('Current room clues marked as solved.', 'good');
    showLock();
  } else if (action === 'gallery') {
    closeModal(true);
    testJumpToRoom(1);
    showToast('Jumped to the gallery.', 'good');
  } else if (action === 'storeroom') {
    closeModal(true);
    testJumpToRoom(2);
    showToast('Jumped to the storeroom.', 'good');
  } else if (action === 'library') {
    closeModal(true);
    testJumpToRoom(2);
    scene.camera.x = scene.roomOffsets[2];
    scene.camera.y = scene.eyeHeight;
    scene.camera.z = -20;
    scene.yaw = 0;
    scene.invalidate();
    updateHud(true);
    showToast('Jumped to the library.', 'good');
  } else if (action === 'final') {
    closeModal();
    state.play.room = 2;
    state.play.roomStart[2] ??= Date.now();
    state.play.solved = state.play.solved.map(() => [true, true, true]);
    state.play.final = { t0: Date.now(), done: false, pick: [] };
    scene.warpToRoomForTesting(state.game, 2);
    updateProgress();
    updateObjective();
    updateHud(true);
    showFinalLock();
  }
}

function setupKeyboard() {
  state.cheatMatcher = window.createKonamiMatcher(showTestMenu);
  window.addEventListener('keydown', event => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const key = event.key.toLowerCase();
    if (state.mode === 'game' && state.cheatMatcher?.(key)) {
      event.preventDefault();
      return;
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      event.preventDefault();
      state.keysDown.add(key);
      syncKeyboardMove();
    }
    if (key === 'e' && state.focusedId) handleInteract(state.focusedId);
    if (/^[0-9]$/.test(key) && state.mode === 'game' && scene?.isInLibrary?.()) {
      const slot = key === '0' ? 9 : Number(key) - 1;
      const paperIndex = state.libraryInventory[slot];
      if (paperIndex != null && equipLibraryPaper(paperIndex)) event.preventDefault();
    }
    if (key === ' ' && state.mode === 'game' && !state.modal) { event.preventDefault(); scene.jump(); }
    if (key === 'f') activateTorch();
    if (key === 'n' && state.mode === 'game') showNotebook();
    if (key === 'escape') {
      if (state.modal) closeModal(true);
      else if (state.mode === 'game') showPause();
    }
  });
  window.addEventListener('keyup', event => {
    state.keysDown.delete(event.key.toLowerCase());
    syncKeyboardMove();
  });
  window.addEventListener('blur', () => {
    state.keysDown.clear();
    syncKeyboardMove();
  });
}

function syncKeyboardMove() {
  const keys = state.keysDown;
  const x = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const y = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const joyX = state.joystickOrigin?.x || 0;
  const joyY = state.joystickOrigin?.y || 0;
  scene.setMovement(Math.max(-1, Math.min(1, x + joyX)), Math.max(-1, Math.min(1, y + joyY)));
}

function setupJoystick() {
  const max = 37;
  const release = () => {
    state.joystickPointer = null;
    state.joystickOrigin = null;
    joystickKnob.style.transform = 'translate(0, 0)';
    syncKeyboardMove();
  };
  joystick.addEventListener('pointerdown', event => {
    event.preventDefault();
    state.joystickPointer = event.pointerId;
    try { joystick.setPointerCapture(event.pointerId); } catch { /* optional */ }
    move(event);
  });
  joystick.addEventListener('pointermove', event => {
    if (state.joystickPointer !== event.pointerId) return;
    event.preventDefault();
    move(event);
  });
  joystick.addEventListener('pointerup', event => {
    if (state.joystickPointer === event.pointerId) release();
  });
  joystick.addEventListener('pointercancel', release);
  function move(event) {
    const rect = joystick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let dx = event.clientX - centerX;
    let dy = event.clientY - centerY;
    const length = Math.hypot(dx, dy);
    if (length > max) { dx = dx / length * max; dy = dy / length * max; }
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    state.joystickOrigin = { x: dx / max, y: -dy / max };
    syncKeyboardMove();
  }
}

function showPause() {
  if (state.mode !== 'game' || state.paused) return;
  stopGameTick();
  state.paused = true;
  state.pauseAt = Date.now();
  state.pausedModal = state.modal ? { modal: { ...state.modal }, html: modalRoot.innerHTML } : null;
  scene.setMovement(0, 0);
  openModal(`<article class="modal-card narrow">
    <p class="modal-kicker">GAME PAUSED</p><h2>Take a moment.</h2>
    <p class="modal-desc">The guard timer is paused while this menu is open.</p>
    <div class="modal-actions"><button class="secondary-button" data-action="menu">Leave game</button><button class="gold-button" data-action="resume">Resume</button></div>
  </article>`, 'pause');
}

modalRoot.addEventListener('click', event => {
  const testAction = event.target.closest('[data-test-action]');
  if (testAction) return runTestAction(testAction.dataset.testAction);
  const actionElement = event.target.closest('[data-action]');
  if (actionElement) {
    const action = actionElement.dataset.action;
    if (action === 'close') closeModal(true);
    else if (action === 'continue') { closeModal(true); updateHud(true); }
    else if (action === 'hint') {
      const index = state.modal.index;
      const puzzle = currentRoom().puzzles[index];
      const alreadyUsed = state.play.hints[state.play.room][index];
      takeHint(state.play, index);
      const note = modalRoot.querySelector('.hint-text') || document.createElement('p');
      note.className = 'hint-text';
      note.textContent = `Hint${alreadyUsed ? ' (already used)' : ` · +${RULES.penalties.hint} seconds`}: ${puzzle.hint}`;
      if (!note.parentNode) modalRoot.querySelector('.modal-actions').before(note);
      actionElement.disabled = true;
      actionElement.textContent = 'Hint used';
      updateHud(true);
    } else if (action === 'try-code') submitCode();
    else if (action === 'notebook') showNotebook();
    else if (action === 'undo-tile') { state.play.final.pick.pop(); renderFinalLock(); }
    else if (action === 'clear-tiles') { state.play.final.pick = []; renderFinalLock(); }
    else if (action === 'submit-final') {
      const word = state.play.final.pick.map(index => state.game.final.tiles[index]).join('');
      if (word === state.game.final.word) completeGame(true);
      else { state.play.final.pick = []; renderFinalLock(); showToast('Incorrect order. Try again.', 'bad'); }
    } else if (action === 'resume') {
      const pausedFor = state.pauseAt == null ? 0 : Date.now() - state.pauseAt;
      if (state.play && pausedFor > 0) {
        state.play.t0 += pausedFor;
        state.play.roomStart = state.play.roomStart.map(value => value == null ? null : value + pausedFor);
        if (state.play.final) state.play.final.t0 += pausedFor;
        if (state.play.eventStarted) state.play.eventStarted += pausedFor;
        if (state.play.torchUntil) state.play.torchUntil += pausedFor;
      }
      state.pauseAt = null;
      state.paused = false;
      const savedModal = state.pausedModal;
      state.pausedModal = null;
      if (savedModal) {
        state.modal = savedModal.modal;
        modalRoot.innerHTML = savedModal.html;
        modalRoot.hidden = false;
      } else closeModal(true);
      syncKeyboardMove();
      scheduleGameTick();
    } else if (action === 'menu') showMenu();
    else if (action === 'again') {
      stageSelect.value = String(state.stage);
      tierSelect.value = String(state.tier);
      startGame();
    }
    return;
  }
  const answer = event.target.closest('[data-answer-index]');
  if (answer) return answerCurrentPuzzle(Number(answer.dataset.answerIndex));
  const key = event.target.closest('[data-key-index]');
  if (key) return answerGoldenKey(Number(key.dataset.keyIndex));
  const eventOption = event.target.closest('[data-event-index]');
  if (eventOption) return answerFootsteps(Number(eventOption.dataset.eventIndex));
  const dial = event.target.closest('[data-dial]');
  if (dial) return adjustDial(Number(dial.dataset.dial), Number(dial.dataset.step));
  const tile = event.target.closest('[data-tile-index]');
  if (tile) return addFinalTile(Number(tile.dataset.tileIndex));
});

async function bootstrap() {
  let canvas = $('#world');
  const startButton = $('#start-button');
  startButton.disabled = true;
  startButton.setAttribute('aria-busy', 'true');
  startButton.querySelector('span').textContent = '…';

  const interactionKey = targetHint.querySelector('kbd');
  if (interactionKey && window.matchMedia?.('(pointer: coarse)').matches) interactionKey.textContent = 'TAP';
  const onFocus = (id, label) => {
    state.focusedId = id;
    state.focusedLabel = label;
    targetHint.hidden = !id || state.mode !== 'game' || !!state.modal;
    if (id && state.mode === 'game' && !state.modal) $('#target-label').textContent = label || 'Inspect object';
  };
  const onLockChange = (locked, message = '') => {
    const hint = $('#control-hint');
    if (hint) hint.innerHTML = locked
      ? '<span>W A S D</span> MOVE <i></i> <span>MOUSE</span> LOOK <i></i> <span>SPACE</span> JUMP / STAND <i></i> <span>E</span> INSPECT / SIT <i></i> <span>ESC</span> PAUSE'
      : '<span>W A S D</span> MOVE <i></i> <span>SPACE</span> JUMP <i></i> <span>E</span> INSPECT / SIT <i></i> <span>CLICK SCENE</span> LOCK MOUSE';
    if (message && state.mode === 'game' && !state.modal) showToast(message, '');
  };

  try {
    // Native Canvas 2D perspective renderer. No WebGL or external library.
    scene = new CanvasMuseumScene(canvas, handleInteract, onFocus, onLockChange, handleAreaChange);
    state.rendererMode = 'canvas-3d';
  } catch (error) {
    console.error('Unable to initialize the Canvas 2D renderer.', error);
    startButton.disabled = true;
    startButton.textContent = 'Canvas unavailable';
    showToast('This browser could not create a 2D canvas. Try a current browser.', 'bad');
    return;
  }

  $('#start-button').addEventListener('click', startGame);
  $('#jump-button').addEventListener('click', () => scene.jump());
  $('#paper-hotbar').addEventListener('click', event => {
    const slot = event.target.closest('[data-paper-index]');
    if (slot) equipLibraryPaper(Number(slot.dataset.paperIndex));
  });
  stageSelect.addEventListener('change', updateMenuCopy);
  tierSelect.addEventListener('change', updateMenuCopy);
  $('#notebook-button').addEventListener('click', showNotebook);
  $('#pause-button').addEventListener('click', showPause);
  $('#torch-button').addEventListener('click', activateTorch);
  $('#desktop-torch-button').addEventListener('click', activateTorch);
  $('.brand').addEventListener('click', event => {
    event.preventDefault();
    if (state.mode === 'menu') return;
    if (state.mode === 'game') showPause();
    else showMenu();
  });
  setupKeyboard();
  setupJoystick();
  showMenu();
  startButton.disabled = false;
  startButton.removeAttribute('aria-busy');
  startButton.querySelector('span').textContent = '↗';
  showToast('Canvas 3D ready. No external graphics libraries are used.', '');

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopGameTick();
      state.keysDown.clear();
      scene.setMovement(0, 0);
    } else {
      scheduleGameTick();
    }
  });
}

bootstrap();

})();
