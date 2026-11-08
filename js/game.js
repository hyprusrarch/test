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
  const source = tier >= 2 ? [...core, ...stretch, ...challenge]
    : tier >= 1 ? [...core, ...stretch] : core;
  const unique = [...new Map(source.map(item => [String(item.w).toLowerCase(), item])).values()];
  const picks = shuffle(unique, random).slice(0, 5);

  return picks.map(word => {
    const pool = source.filter(item => item.w !== word.w);
    const distractors = shuffle(pool, random).slice(0, 3).map(item => item.w);
    return {
      kind: 'vocab', word: word.w, unit: 3, tier: word.tier || 0,
      prompt: 'Tap the word that means…', text: word.def,
      opts: shuffle([word.w, ...distractors], random), answer: word.w,
      hint: `It starts with “${word.w[0]}” and has ${word.w.replace(/[^a-z]/gi, '').length} letters.`
    };
  });
}

function buildReadingPuzzles(escape, tier, random) {
  const available = escape.reading.filter(item => item.tier <= tier);
  const hard = available.filter(item => item.tier === tier && tier > 0);
  const picks = hard.length ? [shuffle(hard, random)[0]] : [];
  shuffle(available.filter(item => !picks.includes(item)), random).forEach(item => {
    if (picks.length < 5) picks.push(item);
  });
  return shuffle(picks, random).slice(0, 5).map(item => {
    const otherNumbers = shuffle([1,2,3,4,5,6,7,8,9].filter(n => n !== item.a), random).slice(0, 3);
    return {
      kind: 'reading', prompt: 'Read the leaflet, then tap the answer.', text: item.q,
      opts: shuffle([item.a, ...otherNumbers], random).map(String), answer: String(item.a),
      hint: `Look at paragraph ${item.para}.`, para: item.para
    };
  });
}

function buildGrammarPuzzles(content, tier, random) {
  const entries = content.grammar.flatMap(point => point.items.map(item => ({ point, item })));
  const shuffled = shuffle(entries, random).slice(0, 5);
  return shuffled.map(({ point, item }) => {
    const [stem, right, ...wrong] = item;
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


function numberWord(value) {
  const words = ['zero','one','two','three','four','five','six','seven','eight','nine'];
  return /^\d$/.test(String(value)) ? words[Number(value)] : String(value);
}

function wordPaperSpots(kind) {
  // Every loose slip is placed on an actual horizontal search surface. These
  // coordinates are room-local and match the furniture dimensions/heights in
  // CanvasMuseumScene. Drawer slips are repositioned into their trays later.
  const surface = (x, z, y, xs, zs = [z]) =>
    zs.flatMap(spotZ => xs.map(spotX => ({ x: spotX, y, z: spotZ, width: .62, depth: .38 })));

  const vocab = [
    ...surface(-3.15, -2.2, 1.55, [-4.0, -2.5], [-2.55, -1.85]),
    ...surface(0, -2.15, 1.20, [-.32, .32], [-2.48, -1.82]),
    ...surface(3.12, -2.17, 1.35, [2.48, 3.76], [-2.50, -1.84]),
    ...surface(-5, 1.45, .62, [-5.55, -4.45]),
    ...surface(-4.25, -.15, .885, [-4.25], [.22]),
    ...surface(-.10, 3.15, .905, [.36], [3.47]),
    ...surface(4.25, -.10, .885, [4.25], [.27]),
    ...surface(-5.0, -4.1, .865, [-5.0], [-3.82]),
    ...surface(5.0, -4.1, .865, [5.0], [-3.82]),
    ...surface(-2.15, -4.8, .865, [-2.15], [-4.50]),
    ...surface(2.15, -4.8, .865, [2.15], [-4.50])
  ];

  // The Gallery's four drawer slips are hidden until opened. The remaining
  // papers sit in two tidy rows on the long central archive table.
  const reading = surface(0, -2.45, .82,
    [-2.60, -1.30, 0, 1.30, 2.60], [-2.70, -2.20]);

  // The Storeroom uses cabinet tops, the six existing shelf ledges, the low
  // display pedestal, and two added side worktables. Four slips are stored in
  // the drawers; the rest are spread across these physical surfaces.
  const grammar = [
    ...surface(-3.7, -2.45, 2.15, [-4.35, -3.05], [-2.82, -2.08]),
    ...surface(0, -2.35, 1.10, [-.45, .45], [-2.78, -1.92]),
    ...surface(1.9, .25, .95, [1.60, 2.20]),
    ...surface(-5.7, -1.0, .88, [-5.7]),
    ...surface(-5.7, -1.0, 1.78, [-5.7]),
    ...surface(-5.7, -1.0, 2.68, [-5.7]),
    ...surface(5.7, -1.0, .88, [5.7]),
    ...surface(5.7, -1.0, 1.78, [5.7]),
    ...surface(5.7, -1.0, 2.68, [5.7]),
    ...surface(-3.0, 3.65, .865, [-3.38, -2.62]),
    ...surface(3.0, 3.65, .865, [2.62, 3.38])
  ];
  return kind === 'vocab' ? vocab : kind === 'reading' ? reading : grammar;
}

function buildWordPapers(puzzles, kind, random) {
  const byValue = new Map();
  for (let panelIndex = 0; panelIndex < puzzles.length; panelIndex++) {
    const puzzle = puzzles[panelIndex];
    const candidates = [puzzle.answer, ...shuffle((puzzle.opts || []).filter(option => String(option) !== String(puzzle.answer)), random).slice(0,3)];
    for (const raw of candidates) {
      const value = String(raw);
      const key = value.trim().toLocaleLowerCase();
      if (!key || byValue.has(key)) continue;
      byValue.set(key, {
        id: byValue.size,
        value,
        display: numberWord(value),
        kind: puzzle.kind,
        sourcePanel: panelIndex,
        title: numberWord(value),
        body: puzzle.kind === 'reading' ? 'A number found in the visitor information.' : 'A word or phrase recovered from a loose note.'
      });
    }
  }
  const cards = [...byValue.values()];
  const spots = shuffle(wordPaperSpots(kind), random);
  return cards.map((card, index) => ({ ...card, ...(spots[index % spots.length] || spots[0]) }));
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
      puzzles: puzzles.map((puzzle, index) => ({ ...puzzle, object: room.objects[index] || `Archive clue ${index + 1}`, gives: code[index] })),
      wordPapers: buildWordPapers(puzzles, room.kind, random),
      code,
      key: makeGoldenKey(content, escape, room.kind, puzzles, random, archiveUsage),
      event: room.kind === 'reading'
        ? { type: 'powercut', at: RULES.powerCutAt }
        : { type: 'footsteps', at: 25 + Math.floor(random() * 25) }
    };
  });

  const librarySpecs = [
    { object:'Cataloguing', text:'What is the process of assigning a title and catalogue number to each book?', answer:'Cataloguing', gives:'S' },
    { object:'Conservation', text:'Which practice protects old books and documents from damage?', answer:'Conservation', gives:'T' },
    { object:'Classification', text:'What is the system of arranging books by subject?', answer:'Classification', gives:'A' },
    { object:'Acquisitions', text:'What is the library process of adding new books to its collection?', answer:'Acquisitions', gives:'C' },
    { object:'Restoration', text:'What is the repair of damaged books and historical documents called?', answer:'Restoration', gives:'K' }
  ];
  const libraryRoom = {
    name: 'The library archive',
    scene: 'The final archive is locked. Search the shelves and drawers for five terms, then use them at the archive answer panels to reveal the exit code.',
    kind: 'library', lock: 'letters', keyObject: null,
    puzzles: librarySpecs.map((item, index) => ({
      kind:'library', prompt:'ARCHIVE KNOWLEDGE', text:item.text, answer:item.answer,
      opts:[item.answer], object:item.object, gives:item.gives, hint:'Search the shelves and archive drawers for this term.'
    })),
    wordPapers: [], code: librarySpecs.map(item => item.gives),
    key: null, event: { type:'none', at: 0 }
  };
  rooms.push(libraryRoom);

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
    wrongCodes: 0, dial: Array.from({ length: game.rooms[0].code.length }, () => 0), open: null, out: false,
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
    play.dial = Array.from({ length: game.rooms[play.room].code.length }, () => 0);
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
  RULES, seededRandom, makeGame, buildWordPapers, newPlay, solvedCount, roomSeconds, escapeSeconds,
  guardLeft, finalLeft, leafletDark, stars, answerPuzzle, answerKey, answerEvent,
  takeHint, useTorch, tryCode, finishFinal, resultFor
};

})();
