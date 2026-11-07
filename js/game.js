(function () {

const CONTENT = window.CONTENT;
const TECH_ARCHIVE = window.ESCAPE_TECH_ARCHIVE || null;

const RULES = Object.freeze({
  guardSeconds: 720,
  starTimes: [360, 540],
  penalties: { wrong: 15, hint: 30, code: 30, event: 30, torch: 20, final: 60 },
  keyBonus: 30,
  eventSeconds: 10,
  finalSeconds: 60,
  powerCutAt: 60,
  torchSeconds: 20
});

const clone = value => JSON.parse(JSON.stringify(value));
const shuffle = (values, random) => {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const firstSentence = text => (text.match(/^.*?[.!?](\s|$)/) || [text])[0].trim();

function seededRandom(seed = Date.now()) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildVocabPuzzles(content, tier, random) {
  const core = shuffle(content.words, random);
  const stretch = shuffle(content.stretch, random);
  const challenge = shuffle(content.challenge, random);
  let picks;
  if (tier >= 2 && stretch.length && challenge.length) picks = [core[0], stretch[0], challenge[0]];
  else if (tier >= 1 && stretch.length) picks = [core[0], core[1], stretch[0]];
  else picks = core.slice(0, 3);

  return picks.map(word => {
    const pool = (word.extra ? [...stretch, ...challenge] : core).filter(item => item.w !== word.w);
    const distractors = shuffle(pool, random).slice(0, 3).map(item => item.w);
    return {
      kind: 'vocab',
      word: word.w,
      unit: 3,
      tier: word.tier || 0,
      prompt: 'Tap the word that means…',
      text: word.def,
      opts: shuffle([word.w, ...distractors], random),
      answer: word.w,
      hint: `It starts with “${word.w[0]}” and has ${word.w.replace(/[^a-z]/gi, '').length} letters.`
    };
  });
}

function buildReadingPuzzles(escape, tier, random) {
  const available = escape.reading.filter(item => item.tier <= tier);
  const hard = available.filter(item => item.tier === tier && tier > 0);
  const picks = hard.length ? [shuffle(hard, random)[0]] : [];
  shuffle(available.filter(item => !picks.includes(item)), random).forEach(item => {
    if (picks.length < 3) picks.push(item);
  });

  return shuffle(picks, random).map(item => {
    const otherNumbers = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9].filter(n => n !== item.a), random).slice(0, 3);
    return {
      kind: 'reading', prompt: 'Read the leaflet, then tap the answer.', text: item.q,
      opts: shuffle([item.a, ...otherNumbers], random).map(String), answer: String(item.a),
      hint: `Look at paragraph ${item.para}.`, para: item.para
    };
  });
}

function buildGrammarPuzzles(content, tier, random) {
  return shuffle(content.grammar, random).slice(0, 3).map(point => {
    const whole = point.items.filter(item => item[0] === '');
    const gaps = point.items.filter(item => item[0] !== '');
    const pool = tier >= 2 && whole.length ? whole : gaps.length ? gaps : whole;
    const [stem, right, ...wrong] = shuffle(pool, random)[0];
    return {
      kind: 'grammar', point: point.id,
      prompt: stem ? 'Fix the note: tap the right words.' : 'Only one of these sentences is right. Tap it.',
      text: stem, opts: shuffle([right, ...wrong], random), answer: right,
      hint: firstSentence(point.rule), rule: point.rule
    };
  });
}

function makeGoldenKey(content, escape, kind, used, random, archiveUsage = null) {
  // The optional keys introduce the original Stage 9 ESL Unit 5 Technology material.
  // Stage 8 keeps its own curriculum and uses the existing key generator.
  if (content.stage === 9 && TECH_ARCHIVE && archiveUsage) {
    if (kind === 'vocab') {
      const archiveWords = [...TECH_ARCHIVE.vocabulary, ...(TECH_ARCHIVE.relatedVocabulary || [])];
      const available = archiveWords.filter(word => !archiveUsage.vocabulary.has(word.w));
      const pool = available.length ? available : archiveWords;
      const word = shuffle(pool, random)[0];
      archiveUsage.vocabulary.add(word.w);
      const distractors = shuffle(archiveWords.filter(item => item.w !== word.w), random).slice(0, 3).map(item => item.w);
      return { kind: 'vocab', prompt: word.w === 'problem-solving' ? 'TECHNOLOGY ARCHIVE · ESL vocabulary: choose the word that means…' : 'TECHNOLOGY ARCHIVE · Unit 5: choose the word that means…', text: word.def, answer: word.w, opts: shuffle([word.w, ...distractors], random), note: word.note || '' };
    }
    if (kind === 'reading') {
      const available = TECH_ARCHIVE.projectStack.filter(item => !archiveUsage.projectStack.has(item.id));
      const pool = available.length ? available : TECH_ARCHIVE.projectStack;
      const item = shuffle(pool, random)[0];
      archiveUsage.projectStack.add(item.id);
      return { kind: 'developer', prompt: 'DEVELOPER ARCHIVE · identify the project technology', text: item.prompt, answer: item.answer, opts: shuffle([...item.opts], random), note: item.note };
    }
    if (kind === 'grammar') {
      const available = TECH_ARCHIVE.grammar.filter(item => !archiveUsage.grammar.has(item.stem));
      const pool = available.length ? available : TECH_ARCHIVE.grammar;
      const item = shuffle(pool, random)[0];
      archiveUsage.grammar.add(item.stem);
      return { kind: 'grammar', prompt: 'TECHNOLOGY ARCHIVE · Unit 5: choose the correct form', text: item.stem, answer: item.answer, opts: shuffle([...item.opts], random) };
    }
  }
  if (kind === 'vocab') {
    const challenge = content.challenge.filter(word => !used.some(p => p.word === word.w));
    const pool = challenge.length >= 4 ? challenge : content.words.filter(word => !used.some(p => p.word === word.w));
    const word = shuffle(pool, random)[0];
    return {
      kind: 'vocab', prompt: 'Challenge: tap the word that means…', text: word.def,
      answer: word.w, opts: shuffle([word.w, ...shuffle(pool.filter(x => x.w !== word.w), random).slice(0, 3).map(x => x.w)], random)
    };
  }
  if (kind === 'reading') {
    const rest = escape.reading.filter(item => !used.some(p => p.text === item.q));
    const hard = rest.filter(item => item.tier === 2);
    const item = shuffle(hard.length ? hard : rest, random)[0];
    return {
      kind: 'reading', prompt: 'Challenge: read the leaflet, then tap the answer.',
      text: item.q, answer: String(item.a),
      opts: shuffle([item.a, ...shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9].filter(n => n !== item.a), random).slice(0, 3)], random).map(String)
    };
  }
  const all = content.grammar.flatMap(point => point.items.map(item => ({ point: point.id, item })))
    .filter(entry => !used.some(p => p.answer === entry.item[1] && p.text === entry.item[0]));
  const whole = all.filter(entry => entry.item[0] === '');
  const { point, item } = shuffle(whole.length ? whole : all, random)[0];
  const [stem, right, ...wrong] = item;
  return {
    kind: 'grammar', point,
    prompt: stem ? 'Challenge: tap the right words.' : 'Challenge: only one of these sentences is right.',
    text: stem, answer: right, opts: shuffle([right, ...wrong], random)
  };
}

function makeGame(stage = 9, tier = 0, seed = Date.now()) {
  const content = CONTENT[stage] || CONTENT[9];
  const escape = content.escape;
  const random = typeof seed === 'function' ? seed : seededRandom(seed);
  const archiveUsage = { vocabulary: new Set(), projectStack: new Set(), grammar: new Set() };
  const rooms = escape.rooms.map(room => {
    const puzzles = room.kind === 'vocab'
      ? buildVocabPuzzles(content, tier, random)
      : room.kind === 'reading'
        ? buildReadingPuzzles(escape, tier, random)
        : buildGrammarPuzzles(content, tier, random);
    const code = room.kind === 'reading'
      ? puzzles.map(p => p.answer)
      : room.lock === 'letters'
        ? puzzles.map(p => p.answer[0].toUpperCase())
        : puzzles.map(() => String(1 + Math.floor(random() * 9)));
    const used = puzzles.filter(p => p.kind === 'vocab').map(p => p.word);
    return {
      name: room.name, scene: room.scene, kind: room.kind, lock: room.lock,
      keyObject: room.keyObject,
      puzzles: puzzles.map((puzzle, index) => ({ ...puzzle, object: room.objects[index], gives: code[index] })),
      code,
      key: makeGoldenKey(content, escape, room.kind, puzzles, random, archiveUsage),
      event: room.kind === 'reading'
        ? { type: 'powercut', at: RULES.powerCutAt }
        : { type: 'footsteps', at: 25 + Math.floor(random() * 25) }
    };
  });

  const usedWords = new Set(rooms.flatMap(room => room.puzzles.filter(p => p.kind === 'vocab').map(p => p.word)));
  const quick = shuffle(content.words.filter(word => !usedWords.has(word.w)), random);
  rooms.forEach((room, index) => {
    if (room.event.type === 'footsteps') {
      const word = quick[index] || content.words[index];
      const others = shuffle(quick.filter(item => item.w !== word.w), random).slice(0, 2);
      Object.assign(room.event, {
        word: word.w, text: word.def,
        opts: shuffle([word.w, ...others.map(item => item.w)], random), answer: word.w
      });
    }
  });

  const finalWord = rooms[0].puzzles.map(p => p.answer)
    .filter(word => /^[a-z]{4,10}$/i.test(word))
    .sort((a, b) => b.length - a.length)[0]
    || content.words.map(word => word.w).find(word => /^[a-z]{4,10}$/i.test(word));
  let tiles = shuffle(finalWord.toUpperCase().split(''), random);
  if (tiles.join('') === finalWord.toUpperCase()) tiles = tiles.reverse();
  const sourceWord = [...content.words, ...content.stretch, ...content.challenge].find(word => word.w === finalWord);

  const librarySeed = Math.floor(random() * 4294967296) >>> 0;
  return {
    stage, tier, librarySeed, tierName: ['Core', 'Stretch', 'Challenge'][tier] || 'Core',
    title: escape.title, escape,
    rooms,
    final: { word: finalWord.toUpperCase(), tiles, clue: sourceWord?.def || '' }
  };
}

function newPlay(game, now = Date.now()) {
  return {
    room: 0, t0: now, penalty: 0,
    solved: game.rooms.map(room => room.puzzles.map(() => false)),
    tries: game.rooms.map(room => room.puzzles.map(() => 0)),
    hints: game.rooms.map(room => room.puzzles.map(() => false)),
    wrongCodes: 0, dial: [0, 0, 0], open: null, out: false,
    roomStart: game.rooms.map((room, index) => index ? null : now),
    keys: game.rooms.map(() => null), events: game.rooms.map(() => null),
    torchUntil: 0, final: null, caught: false, eventStarted: null
  };
}

const solvedCount = play => play.solved.flat().filter(Boolean).length;
const roomSeconds = (play, now = Date.now()) => Math.max(0, (now - (play.roomStart[play.room] ?? now)) / 1000);
const escapeSeconds = (play, now = Date.now()) => Math.round((now - play.t0) / 1000) + play.penalty;
const guardLeft = (play, now = Date.now()) => RULES.guardSeconds - escapeSeconds(play, now);
const finalLeft = (play, now = Date.now()) => play.final ? RULES.finalSeconds - (now - play.final.t0) / 1000 : RULES.finalSeconds;
const leafletDark = (game, play, now = Date.now()) =>
  game.rooms[play.room].event.type === 'powercut' && roomSeconds(play, now) >= RULES.powerCutAt && now > play.torchUntil;
const stars = seconds => seconds > RULES.guardSeconds ? 0 : seconds <= RULES.starTimes[0] ? 3 : seconds <= RULES.starTimes[1] ? 2 : 1;

function answerPuzzle(game, play, index, option) {
  const puzzle = game.rooms[play.room].puzzles[index];
  play.tries[play.room][index]++;
  if (option === puzzle.answer) {
    play.solved[play.room][index] = true;
    return 'right';
  }
  play.penalty += RULES.penalties.wrong;
  return 'wrong';
}

function answerKey(game, play, option) {
  if (play.keys[play.room] != null) return play.keys[play.room];
  const correct = option === game.rooms[play.room].key.answer;
  play.keys[play.room] = correct;
  if (correct) play.penalty -= RULES.keyBonus;
  return correct;
}

function answerEvent(play, correct) {
  if (play.events[play.room] == null) {
    play.events[play.room] = correct ? 'ok' : 'missed';
    if (!correct) play.penalty += RULES.penalties.event;
  }
}

function takeHint(play, index) {
  if (!play.hints[play.room][index]) {
    play.hints[play.room][index] = true;
    play.penalty += RULES.penalties.hint;
  }
}

function useTorch(play, now = Date.now()) {
  play.penalty += RULES.penalties.torch;
  play.torchUntil = now + RULES.torchSeconds * 1000;
}

function tryCode(game, play, code, now = Date.now()) {
  const room = game.rooms[play.room];
  if (code.join('') === room.code.join('')) {
    if (play.room === game.rooms.length - 1) {
      if (!play.final) play.final = { t0: now, done: false, pick: [] };
      return { ok: true, final: true };
    }
    play.room++;
    play.open = null;
    play.dial = [0, 0, 0];
    play.roomStart[play.room] = now;
    return { ok: true, final: false };
  }
  play.wrongCodes++;
  play.penalty += RULES.penalties.code;
  return { ok: false, final: false };
}

function finishFinal(play, correct) {
  if (play.final && !play.final.done) {
    play.final.done = true;
    play.final.ok = correct;
    if (!correct) play.penalty += RULES.penalties.final;
    play.out = true;
  }
}

function resultFor(game, play, now = Date.now()) {
  const seconds = escapeSeconds(play, now);
  const rightFirst = game.rooms.flatMap((room, roomIndex) => room.puzzles.map((p, index) =>
    play.solved[roomIndex][index] && play.tries[roomIndex][index] === 1 && !play.hints[roomIndex][index]
  )).filter(Boolean).length;
  const keys = play.keys.filter(value => value === true).length;
  const caught = seconds > RULES.guardSeconds;
  return {
    seconds, rightFirst, keys, caught, stars: stars(seconds),
    finalOk: !!play.final?.ok,
    points: Math.max(100, 3000 - seconds * 2 + rightFirst * 50)
  };
}

window.EscapeGame = {
  RULES, seededRandom, makeGame, newPlay, solvedCount, roomSeconds, escapeSeconds,
  guardLeft, finalLeft, leafletDark, stars, answerPuzzle, answerKey, answerEvent,
  takeHint, useTorch, tryCode, finishFinal, resultFor
};

})();
