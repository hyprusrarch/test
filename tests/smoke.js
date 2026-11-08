const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

global.window = global;
const documentListeners = {};
global.document = {
  hidden: false,
  pointerLockElement: null,
  addEventListener(name, fn) { documentListeners[name] = fn; },
  removeEventListener() {},
  exitPointerLock() { this.pointerLockElement = null; documentListeners.pointerlockchange?.(); }
};
global.navigator = { deviceMemory: 4 };
global.Image = class {
  constructor() { this.complete = true; this.naturalWidth = 640; this.naturalHeight = 480; this.width = 640; this.height = 480; }
  set src(value) { this._src = value; this.onload?.(); }
};
global.window.innerWidth = 1280;
global.window.innerHeight = 720;
global.window.devicePixelRatio = 2;
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.window.matchMedia = () => ({ matches: false });
global.requestAnimationFrame = () => 1;
global.cancelAnimationFrame = () => {};

const gradient = { addColorStop() {} };
const ctx = new Proxy({
  createLinearGradient() { return gradient; },
  createRadialGradient() { return gradient; },
  measureText(value) { return { width: String(value).length * 6 }; },
  getImageData() { return { data: new Uint8ClampedArray(4) }; }
}, {
  get(target, key) { return key in target ? target[key] : () => {}; },
  set(target, key, value) { target[key] = value; return true; }
});
const elements = [];
global.document.body = { insertBefore(element) { elements.push(element); element.parentNode = this; } };
global.document.createElement = tag => ({
  tagName: String(tag).toUpperCase(), width: 0, height: 0, style: {},
  getContext(type) { return type === '2d' ? ctx : null; },
  setAttribute() {}, remove() { this.removed = true; }
});
const listeners = {};
const canvas = {
  width: 0, height: 0, style: {}, nextSibling: null,
  getContext(type) { return type === '2d' ? ctx : null; },
  addEventListener(name, fn) { listeners[name] = fn; },
  setPointerCapture() {},
  requestPointerLock() { document.pointerLockElement = this; documentListeners.pointerlockchange?.(); },
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
};

for (const file of ['js/data.js', 'js/gallery-art.js', 'js/konami.js', 'js/tech-archive.js', 'js/game.js', 'js/canvas-scene.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { filename: file });
}
const { makeGame, newPlay, answerPuzzle, tryCode, finishFinal, resultFor } = global.EscapeGame;
const scene = new global.CanvasMuseumScene(canvas, () => {}, () => {});

assert.ok(scene.paintingOverlay && scene.paintingOverlayCtx, 'high-resolution painting overlay should be created');
assert.ok(scene.effectOverlay && scene.effectOverlayCtx, 'separate transparent ambient-effects overlay should be created');
assert.ok(scene._ambientInterval <= 1000 / 15, 'ambient effects should be capped at a modest frame rate');
const galleryAsset = fs.readFileSync(path.join(__dirname, '..', 'assets', 'gallery-photo.png'));
const embeddedGallery = Buffer.from(global.GALLERY_ART_DATA.split(',')[1], 'base64');
assert.deepEqual(galleryAsset, embeddedGallery, 'standalone gallery photo must restore the exact embedded original');
assert.equal(scene.galleryImage._src, global.GALLERY_ART_DATA, 'embedded original gallery image remains the primary texture source');
assert.ok(scene._drawAmbientEffects && scene._drawClockEffect && scene._drawFanEffect && scene._drawGalleryGlints, 'ambient animation render paths should be available');
assert.ok(scene.canvas.width * scene.canvas.height <= scene.maxPixels * 1.01, 'main scene backing store should stay within its pixel budget');
assert.equal(scene.roomScaleX, 1.5, 'museum rooms should use the compact 1.5x footprint scale');
assert.equal(scene.libraryScaleX, 1.25, 'Library should retain its original scale');
assert.deepEqual(scene.roomOffsets, [0, 23.5, 47]);

for (const stage of [8, 9]) {
  for (const tier of [0, 1, 2]) {
    const game = makeGame(stage, tier, 20261108 + stage * 10 + tier);
    assert.equal(game.rooms.length, 4, 'Library must be the fourth/final room');
    for (let roomIndex = 0; roomIndex < 4; roomIndex++) {
      const room = game.rooms[roomIndex];
      assert.equal(room.puzzles.length, 5, `${stage}/${tier}/${roomIndex} should have five panels`);
      assert.equal(room.code.length, 5, `${stage}/${tier}/${roomIndex} should have five lock characters`);
      if (roomIndex < 3) {
        assert.ok(room.wordPapers.length >= (room.kind === 'reading' ? 8 : 9), `${stage}/${tier}/${roomIndex} should have an expanded paper search`);
        assert.ok(room.wordPapers.every(p => p.width === .62 && p.depth === .38), 'main-room word slips should restore the earlier readable dimensions');
        const positions = new Set(room.wordPapers.map(p => `${p.x}:${p.y}:${p.z}`));
        assert.equal(positions.size, room.wordPapers.length, 'paper placement positions must not overlap');
        for (const puzzle of room.puzzles) {
          assert.ok(room.wordPapers.some(p => String(p.value).toLowerCase() === String(puzzle.answer).toLowerCase()), 'every answer must be recoverable from a paper');
        }
      }
    }
    assert.equal(game.rooms[3].code.join(''), 'STACK', 'Library must have the final archive code');

    const play = newPlay(game, 1000);
    for (let roomIndex = 0; roomIndex < 4; roomIndex++) {
      play.room = roomIndex;
      const room = game.rooms[roomIndex];
      for (let panelIndex = 0; panelIndex < 5; panelIndex++) {
        const puzzle = room.puzzles[panelIndex];
        const foundWord = roomIndex === 3 ? puzzle.answer : room.wordPapers.find(p => String(p.value).toLowerCase() === String(puzzle.answer).toLowerCase())?.value;
        assert.ok(foundWord, 'panel solution must exist as a found word');
        assert.equal(answerPuzzle(game, play, panelIndex, foundWord), 'right');
        assert.ok(play.solved[roomIndex][panelIndex]);
        assert.equal(puzzle.gives, room.code[panelIndex]);
      }
      const result = tryCode(game, play, room.code, 2000 + roomIndex);
      assert.equal(result.ok, true);
      assert.equal(result.final, roomIndex === 3, 'only the Library lock should lead to the final scramble');
    }
    finishFinal(play, true);
    assert.equal(play.out, true);
    assert.equal(resultFor(game, play, 3000).rightFirst, 20, 'all 20 answer panels count in results');
  }
}

const game = makeGame(9, 1, 881122);
scene.setRoom(game, 0);
assert.equal(scene.roomFaceGroups.length, 4, 'all rooms remain resident');
assert.ok(scene.roomGeometry.every(face => face.points.length === 4), 'scene geometry should use intact quads');
assert.ok(scene.roomGeometry.some(face => face.roomIndex === 3 && face.libraryNoteIndex != null), 'Library paper geometry should be present');
// Closed room exit doors must fill the visible portal so the player cannot
// slip around either side of a door panel.
for (let doorIndex = 0; doorIndex < 2; doorIndex++) {
  const doorX = scene.roomOffsets[doorIndex] + 7 * 1.5;
  const barrier = scene.colliders.find(box => Math.abs((box.minX + box.maxX) / 2 - doorX) < .02 && Math.abs((box.minZ + box.maxZ) / 2) < .02 && box.height < 4);
  assert.ok(barrier, `room ${doorIndex} should have a closed exit-door barrier`);
  assert.ok(barrier.maxZ - barrier.minZ >= 4.8, `room ${doorIndex} exit barrier should span the full doorway`);
  assert.ok(!scene._canOccupy(doorX, 2.0), `room ${doorIndex} player must not pass beside the closed exit door`);
}
assert.equal(scene.libraryLayout.racks.length, 20);
assert.equal(scene.libraryLayout.papers.length, 10);
assert.ok(scene.libraryLayout.papers.every(p => p.width >= .24 && p.width < .30 && p.height >= .26 && p.height < .31), 'Library papers should restore their earlier readable dimensions');
assert.ok(scene.libraryLayout.books.length >= 250);

// Five physical answer panels and more papers in every main room.
for (let roomIndex = 0; roomIndex < 3; roomIndex++) {
  scene.camera = { x: scene.roomOffsets[roomIndex], y: 1.66, z: 5.1875 * 1.25 };
  scene.setActiveRoom(game, roomIndex);
  assert.equal(scene.hotspots.filter(p => /^answer-panel-\d+$/.test(p.id)).length, 5);
  assert.equal(scene.roomGeometry.filter(f => f.roomIndex === roomIndex && Number.isInteger(f.answerPanelIndex)).length, 5);
  assert.equal(scene.roomGeometry.filter(f => f.roomIndex === roomIndex && Number.isInteger(f.wordPaperIndex)).length, game.rooms[roomIndex].wordPapers.length, 'all generated room papers should have matching world geometry');
}

// The Ticket Hall is deliberately denser: seven added tables and twelve added
// drawers are present only in this room. Filled and empty trays are mixed.
scene.setRoom(game, 0);
// Loose papers must sit fully inside the real tabletop/shelf footprint and at
// its actual top height. This catches stale map coordinates that leave papers
// floating beside furniture or embedded below desk surfaces.
const paperSurfaces = [
  [
    {x:-3.15,z:-2.2,w:2.45,d:1.25,y:1.55},
    {x:0,z:-2.15,w:1.45,d:1.2,y:1.20},
    {x:3.12,z:-2.17,w:2.45,d:1.2,y:1.35},
    {x:-5,z:1.45,w:2.2,d:.6,y:.62},
    {x:-4.25,z:-.15,w:1.9,d:1.15,y:.885},
    {x:-.10,z:3.15,w:2.05,d:1.2,y:.905},
    {x:4.25,z:-.10,w:1.85,d:1.15,y:.885},
    {x:-5,z:-4.1,w:1.9,d:1,y:.865},
    {x:5,z:-4.1,w:1.9,d:1,y:.865},
    {x:-2.15,z:-4.8,w:1.8,d:1.05,y:.865},
    {x:2.15,z:-4.8,w:1.8,d:1.05,y:.865}
  ],
  [{x:0,z:-2.45,w:6.5,d:1,y:.82}],
  [
    {x:-3.7,z:-2.45,w:2.7,d:1.3,y:2.15},
    {x:0,z:-2.35,w:1.8,d:1.5,y:1.1},
    {x:1.9,z:.25,w:1.25,d:1.1,y:.95},
    ...[-5.7,5.7].flatMap(x => [.88,1.78,2.68].map(y => ({x,z:-1,w:1.05,d:1.2,y}))),
    {x:-3,z:3.65,w:2.2,d:1.1,y:.865},
    {x:3,z:3.65,w:2.2,d:1.1,y:.865}
  ]
];
const isOnSurface = (paper, surfaces) => surfaces.some(surface =>
  Math.abs(paper.y - surface.y) < .002 &&
  Math.abs(paper.x - surface.x) <= (surface.w - paper.width) / 2 + .002 &&
  Math.abs(paper.z - surface.z) <= (surface.d - paper.depth) / 2 + .002);
for (let roomIndex = 0; roomIndex < 3; roomIndex++) {
  scene.setActiveRoom(game, roomIndex);
  const loose = game.rooms[roomIndex].wordPapers.filter(paper => !paper.drawerId);
  assert.ok(loose.length > 0, `room ${roomIndex} should retain loose searchable papers`);
  for (const paper of loose) {
    assert.ok(isOnSurface(paper, paperSurfaces[roomIndex]), `room ${roomIndex} paper ${paper.id} must sit on a real surface`);
    const face = scene.roomGeometry.find(item => item.roomIndex === roomIndex && item.wordPaperIndex === paper.id);
    const hotspot = scene.hotspots.find(item => item.id === `word-paper-${paper.id}`);
    assert.ok(face && hotspot, `room ${roomIndex} paper ${paper.id} must have geometry and a pickup target`);
    const centerX = face.points.reduce((sum, point) => sum + point[0], 0) / face.points.length;
    const centerZ = face.points.reduce((sum, point) => sum + point[2], 0) / face.points.length;
    assert.ok(Math.abs(hotspot.x - centerX) < .01 && Math.abs(hotspot.z - centerZ) < .01,
      `room ${roomIndex} paper ${paper.id} pickup target must match its rendered position`);
  }
}
scene.setActiveRoom(game, 0);
assert.equal(scene.extraTicketHallTables.length, 7, 'Ticket Hall should have seven additional tables');
const ticketDrawers = scene.drawers.filter(drawer => drawer.roomIndex === 0);
assert.equal(ticketDrawers.length, 14, 'Ticket Hall should have fourteen drawers in total');
assert.equal(ticketDrawers.filter(drawer => drawer.paperIds.length === 0).length, 8, 'Ticket Hall should include eight intentionally empty drawers');
assert.ok(ticketDrawers.some(drawer => drawer.paperIds.includes(4) && drawer.paperIds.includes(5)), 'one added drawer should hide papers 5 and 6');
assert.ok(ticketDrawers.some(drawer => drawer.paperIds.includes(6) && drawer.paperIds.includes(7)), 'another added drawer should hide papers 7 and 8');
assert.ok(ticketDrawers.some(drawer => drawer.paperIds.includes(8) && drawer.paperIds.includes(9)), 'rear side desk drawer should hide papers 9 and 10');
assert.ok(ticketDrawers.some(drawer => drawer.paperIds.includes(10)), 'one new archive drawer should contain an additional word slip');
assert.ok(!ticketDrawers.some(drawer => drawer.paperIds.includes(11)), 'the final word slip should remain loose on a desk for collection');
assert.ok(ticketDrawers.every(drawer => drawer.faces.length >= 5), 'all Ticket Hall drawers should have complete moving geometry');
for (const table of scene.extraTicketHallTables) {
  const cx = table.x * 1.25, cz = table.z * 1.25;
  assert.ok(scene.colliders.some(c => Math.abs((c.minX + c.maxX) * .5 - cx) < .01 && Math.abs((c.minZ + c.maxZ) * .5 - cz) < .01), `${table.id} should have a matching collision/platform footprint`);
}
scene.camera = { x: 0, y: scene.eyeHeight, z: 5.1875 * 1.25 }; scene.yaw = 0;
scene.setActiveRoom(game, 0);
assert.ok(!scene.hotspots.some(p => p.id === 'word-paper-4'), 'papers inside a closed added drawer should remain hidden');
scene.toggleDrawer('drawer-0-2');
assert.ok(scene.hotspots.some(p => p.id === 'word-paper-4'), 'opening a paper-filled added drawer should reveal its first paper');
scene.toggleDrawer('drawer-0-2');
assert.ok(!scene.hotspots.some(p => p.id === 'word-paper-4'), 'closing an added drawer should hide its paper again');

// The Storeroom must have its own visible, unlockable exit and its answer
// panels must be physically inside the Storeroom, opposite the Library portal.
scene.setRoom(game, 2);
scene.doorOpen = [true, true, false];
scene.libraryDoorOpen = false;
scene._buildColliders();
scene.setActiveRoom(game, 2);
const storeroomLock = scene.hotspots.find(point => point.id === 'lock');
assert.ok(storeroomLock, 'Storeroom should expose its own exit-lock hotspot');
assert.match(storeroomLock.label, /Storeroom exit/i, 'Storeroom lock should be named as the Storeroom exit');
assert.ok(storeroomLock.x > scene.roomOffsets[2] + 2, 'Storeroom keypad should be mounted on the right door jamb, outside the opening');
const storeroomDoorFace = scene.roomGeometry.find(face => face.roomIndex === 2 && face.doorBarrier === 'library');
assert.ok(storeroomDoorFace, 'closed Storeroom-to-Library door leaf must be visible in Storeroom geometry');
const storeroomKeypadFace = scene.roomGeometry.find(face => face.roomIndex === 2 && face.lockBarrier === 'library');
assert.ok(storeroomKeypadFace && storeroomKeypadFace.cx > scene.roomOffsets[2] + 2, 'Storeroom keypad geometry must sit beside its door, not over the doorway');
const storeroomPanelFaces = scene.roomGeometry.filter(face => face.roomIndex === 2 && Number.isInteger(face.answerPanelIndex));
const storeroomPanelHotspots = scene.hotspots.filter(point => /^answer-panel-\d$/.test(point.id));
assert.equal(storeroomPanelFaces.length, 5, 'Storeroom should have five room-local answer panels');
assert.equal(storeroomPanelHotspots.length, 5, 'Storeroom should have five room-local answer panel hotspots');
assert.ok(storeroomPanelFaces.every(face => face.cz > 8), 'Storeroom answer panels must be mounted on the Storeroom front wall, not the Library connector wall');
assert.ok(storeroomPanelFaces.every(face => face.nz < 0), 'Storeroom front-wall panels must face into the Storeroom');
for (const face of storeroomPanelFaces) {
  const hotspot = storeroomPanelHotspots.find(point => point.id === `answer-panel-${face.answerPanelIndex}`);
  assert.ok(hotspot && Math.abs(hotspot.x - face.cx) < .01 && Math.abs(hotspot.z - face.cz) < .01,
    `Storeroom panel ${face.answerPanelIndex} hotspot must align with its rendered face`);
}
assert.ok(!scene.roomGeometry.some(face => face.roomIndex === 2 && Math.abs(face.cx - scene.roomOffsets[2]) < 1.3 && face.cz > -8.9 && face.cz < -8.1 && face.layer === 1 && face.doorBarrier !== 'library'),
  'no decorative rear-wall slab should cover the real Storeroom exit');

// The Library is a final progression area after the Storeroom's third lock.
scene.openDoor(0); scene.openDoor(1); scene.openDoor(2);
scene.camera = { x: scene.roomOffsets[2], y: 1.66, z: -22.8 };
scene.setActiveRoom(game, 3);
assert.ok(scene.isInLibrary());
assert.ok(scene.hotspots.filter(p => p.libraryNote).every(p => p.discoverRange === 5.4), 'Library notes should restore their earlier interaction range');
assert.equal(scene.hotspots.filter(p => p.id.startsWith('library-answer-panel-')).length, 5);
assert.ok(scene.hotspots.some(p => p.id === 'lock'), 'final archive exit lock should be present');
assert.equal(scene.hotspots.filter(p => p.libraryNote).length, scene.libraryLayout.papers.filter(p => !p.drawerId).length);

// Restore the original camera framing and retain 1.5x movement speed (2.7 to 4.05).
scene.width = 1280; scene.height = 720;
const projection = scene._projectCamera({ forward: 10, lateral: 0, vertical: 0 });
assert.ok(Math.abs(projection.scale - (720 * 0.90 / 10)) < 1e-6, 'projection focal length should match the original pre-120 framing');
const restoredHorizontalFov = 2 * Math.atan(scene.width / (2 * 720 * 0.90)) * 180 / Math.PI;
assert.ok(restoredHorizontalFov > 88 && restoredHorizontalFov < 92, 'horizontal FOV should return to the original approximately 90-degree framing');
const sourceForProjection = fs.readFileSync(path.join(__dirname, '..', 'js', 'canvas-scene.js'), 'utf8');
assert.ok((sourceForProjection.match(/const focal = this\.height \* 0\.90/g) || []).length >= 2, 'both projection passes should use the restored original FOV');
assert.ok(!sourceForProjection.includes('0.28867513459481287'), '120-degree FOV must be removed');
scene.setRoom(game, 0);
assert.ok(Math.abs(scene.camera.z - 5.1875 * 1.25) < 1e-6, 'spawn should stay near the original object layout inside the enlarged room');
const mainFloor = scene.roomGeometry.find(face => face.roomIndex === 0 && face.layer === -1 && face.points.length === 4);
assert.ok(mainFloor, 'main room floor should exist');
const floorWidth = Math.max(...mainFloor.points.map(point => point[0])) - Math.min(...mainFloor.points.map(point => point[0]));
assert.ok(Math.abs(floorWidth - 21.0) < 1e-6, 'main room width should be compacted to 1.5x the original shell width');
const mainFloorDepth = Math.max(...mainFloor.points.map(point => point[2])) - Math.min(...mainFloor.points.map(point => point[2]));
assert.ok(Math.abs(mainFloorDepth - 18.0) < 1e-6, 'main room depth should be compacted with its width');
assert.ok(Math.abs(scene.roomOffsets[1] - scene.roomOffsets[0] - floorWidth - 2.5) < 1e-6, 'adjacent room shells should be separated by a short connector');
assert.ok(Math.abs((2.2 - 12 * 1.25) - (-6 * 1.5) - (-3.8)) < 1e-6, 'Storeroom-to-Library corridor should retain a walkable connector after compacting the room');
// Room footprints grow, but furniture remains at the earlier physical dimensions.
const savedGeometry = scene._geometry, savedVertices = scene._vertices, savedVertexMap = scene._vertexMap, savedFaceId = scene._nextFaceId;
scene._geometry = []; scene._vertices = []; scene._vertexMap = new Map(); scene._nextFaceId = 0;
scene._box(2, 0, -1, 2, 1, 2, '#776655');
const boxPoints = scene._geometry.flatMap(face => face.points);
const boxWidth = Math.max(...boxPoints.map(point => point[0])) - Math.min(...boxPoints.map(point => point[0]));
const boxDepth = Math.max(...boxPoints.map(point => point[2])) - Math.min(...boxPoints.map(point => point[2]));
const boxCenterX = (Math.max(...boxPoints.map(point => point[0])) + Math.min(...boxPoints.map(point => point[0]))) / 2;
const boxCenterZ = (Math.max(...boxPoints.map(point => point[2])) + Math.min(...boxPoints.map(point => point[2]))) / 2;
assert.ok(Math.abs(boxWidth - 2.5) < 1e-6 && Math.abs(boxDepth - 2.5) < 1e-6, 'a 2x2 prop should remain 2.5x2.5 world units, not grow with the room');
assert.ok(Math.abs(boxCenterX - 2.5) < 1e-6 && Math.abs(boxCenterZ + 1.25) < 1e-6, 'prop centers should retain their previous object-space positions while room boundaries expand');
// Wall-mounted elements opt into the large room transform while their dimensions stay fixed.
scene._geometry = []; scene._vertices = []; scene._vertexMap = new Map(); scene._nextFaceId = 0;
scene._roomBox(2, 0, -5, 2, 1, .2, '#776655');
const wallBoxPoints = scene._geometry.flatMap(face => face.points);
const wallCenterX = (Math.max(...wallBoxPoints.map(point => point[0])) + Math.min(...wallBoxPoints.map(point => point[0]))) / 2;
const wallCenterZ = (Math.max(...wallBoxPoints.map(point => point[2])) + Math.min(...wallBoxPoints.map(point => point[2]))) / 2;
assert.ok(Math.abs(wallCenterX - 3.0) < 1e-6 && Math.abs(wallCenterZ + 7.5) < 1e-6, 'room-anchored fixtures should stay attached to compacted walls');
scene._geometry = savedGeometry; scene._vertices = savedVertices; scene._vertexMap = savedVertexMap; scene._nextFaceId = savedFaceId;
const savedColliders = scene.colliders;
scene.colliders = [];
scene._addCollider(2, -1, 2, 2, 1.2, true);
const propCollider = scene.colliders[0];
assert.ok(Math.abs((propCollider.maxX - propCollider.minX) - 2.5) < 1e-6, 'prop collision width must remain at original scale');
assert.ok(Math.abs((propCollider.maxZ - propCollider.minZ) - 2.5) < 1e-6, 'prop collision depth must remain at original scale');
scene.colliders = savedColliders;
scene.camera = { x: 0, y: scene.eyeHeight, z: 10.0 };
scene.yaw = 0;
scene.setMovement(0, 1);
const beforeZ = scene.camera.z;
scene._move(0.1);
scene.setMovement(0, 0);
assert.ok(Math.abs((beforeZ - scene.camera.z) - 0.405) < 0.01, 'movement speed should be 4.05 world units per second');

// Room-aware culling: active room props stay visible; adjacent room props do not.
scene.camera = { x: 0, y: scene.eyeHeight, z: 6.484375 }; scene.yaw = 0;
scene.setActiveRoom(game, 0);
assert.ok(scene.hotspots.some(p => p.wordPaper && p.discoverRange === 7.5), 'main word slips should restore their earlier interaction range');
// Every loose paper's world face and interaction target must share one position.
for (const paper of game.rooms[0].wordPapers.filter(item => !item.drawerId)) {
  const face = scene.roomGeometry.find(item => item.roomIndex === 0 && item.wordPaperIndex === paper.id);
  const hotspot = scene.hotspots.find(item => item.id === `word-paper-${paper.id}`);
  if (!face || !hotspot) continue;
  const centerX = face.points.reduce((sum, point) => sum + point[0], 0) / face.points.length;
  const centerZ = face.points.reduce((sum, point) => sum + point[2], 0) / face.points.length;
  assert.ok(Math.abs(hotspot.x - centerX) < .01 && Math.abs(hotspot.z - centerZ) < .01, `paper ${paper.id} pickup target must align with its rendered face`);
}
// Object-centred drawer geometry stays attached to its parent cabinet/table.
for (const drawer of scene.drawers.filter(item => item.roomIndex === 0)) {
  assert.ok(drawer.faces.length >= 5, `${drawer.id} should have a complete tray`);
  const expectedFront = (drawer.z + drawer.depth) * 1.25;
  assert.ok(drawer.faces.some(face => face.points.every(point => Math.abs(point[2] - expectedFront) < .01)), `${drawer.id} front face should align with the host furniture`);
  const drawerHotspot = scene.hotspots.find(point => point.id === drawer.id);
  assert.ok(drawerHotspot && Math.abs(drawerHotspot.z - (expectedFront + .125)) < .01, `${drawer.id} interaction target should sit just ahead of its front face`);
}
// A paper within reach must create an actual screen-space target at its own face.
const testPaper = game.rooms[0].wordPapers.find(item => !item.drawerId);
scene.camera = { x: testPaper.x * 1.25, y: scene.eyeHeight, z: testPaper.z * 1.25 + 2.5 };
scene.yaw = 0; scene.pitch = 0;
scene.setActiveRoom(game, 0);
scene.render();
const paperTarget = scene.projectedHotspots.find(point => point.id === `word-paper-${testPaper.id}`);
assert.ok(paperTarget, 'a reachable loose paper must have a projected pickup target');
assert.equal(scene._nearestHotspot(paperTarget.x, paperTarget.y)?.id, `word-paper-${testPaper.id}`, 'the paper surface must be directly clickable/interactable');
scene._drawWorldGeometry();
assert.ok(scene._drawPrimitives.some(p => p.face.roomIndex === 0), 'active room geometry must render');
assert.ok(!scene._drawPrimitives.some(p => p.face.roomIndex === 1 && p.face.zone !== 'partition' && p.face.zone !== 'connector'), 'gallery props must be culled from ticket hall');
assert.ok(scene._visibleFacePool.length < scene.roomGeometry.length, 'render collection should exclude inactive-room props before projection');
const transformedVertices = scene._vertexStamps.reduce((count, value) => count + (value === scene._vertexStamp ? 1 : 0), 0);
assert.ok(transformedVertices < scene._vertices.length, 'camera transforms should touch only vertices used by renderable faces');
scene.camera = { x: scene.roomOffsets[1], y: scene.eyeHeight, z: 6.484375 };
scene.setActiveRoom(game, 1); scene._drawWorldGeometry();
assert.ok(!scene._drawPrimitives.some(p => p.face.roomIndex === 0 && p.face.zone !== 'partition' && p.face.zone !== 'connector'), 'ticket hall props must be culled from gallery');
scene.render();
assert.equal(scene.paintingOverlay.style.display, 'block', 'high-resolution gallery paintings should render when inside the gallery');

// Stable painting mask does not depend on a camera-depth threshold that toggles.
const sceneSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'canvas-scene.js'), 'utf8');
const overlaySource = sceneSource.slice(sceneSource.indexOf('  _drawGalleryOverlay()'), sceneSource.indexOf('  _drawWorldGeometry()'));
assert.ok(overlaySource.includes("face.layer < 1"), 'painting overlay should use a stable foreground-only mask');
assert.ok(!overlaySource.includes('photoDepth') && !overlaySource.includes('_polygonDepthAt'), 'painting mask must not toggle on average-depth thresholds');
const overlaysSource = sceneSource.slice(sceneSource.indexOf('  _drawOverlays()'), sceneSource.indexOf('  _drawEquippedPaper('));
assert.ok(overlaysSource.includes('if (!point.wordPaper && !point.libraryNote)'), 'loose papers must not show glowing hotspot markers');
assert.ok(scene._move && scene.jump, 'movement and jumping APIs should exist');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptPaths = [...html.matchAll(/<script\s+src=["']([^"']+)/g)].map(match => match[1]);
for (const scriptPath of scriptPaths) {
  assert.ok(fs.existsSync(path.join(__dirname, '..', scriptPath)), `missing local script ${scriptPath}`);
  assert.ok(!/^https?:/i.test(scriptPath), 'no external JavaScript libraries should be loaded');
}
assert.ok(!/three\.min\.js|type=["']module["']/i.test(html), 'project must remain native HTML/JavaScript without external modules');
assert.equal((html.match(/class="progress-item/g) || []).length, 4, 'HUD progression must show four rooms');
assert.ok(html.includes('20 PANELS'), 'menu copy should advertise all 20 panels');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
assert.ok(appSource.includes("jumpButton.addEventListener('pointerdown'"), 'mobile jump must trigger on pointerdown');
assert.ok(appSource.includes('jumpButton.setPointerCapture(event.pointerId)'), 'jump button should retain touch pointer capture');
assert.ok(appSource.includes("if (event.detail === 0) activateMobileJump(event)"), 'keyboard accessibility should remain available for the jump button');
const coarseCss = html.slice(html.indexOf('@media (pointer: coarse) and (min-width: 681px)'));
assert.ok(coarseCss.includes('.mobile-jump { display: grid;'), 'landscape tablets must receive a visible jump button');
assert.ok(coarseCss.includes('touch-action: none'), 'mobile jump button must suppress browser gesture cancellation');
assert.ok(html.includes('prefers-reduced-motion: reduce'), 'UI animations must respect reduced-motion preferences');
assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'gallery-photo.png')), 'gallery photo fallback asset should ship with the project');
assert.ok(appSource.includes("'assets/gallery-photo.png'"), 'gallery viewer should fall back to the restored standalone asset');
scene.setRoom(game, 0);
const animatedDrawer = scene.drawers.find(drawer => drawer.roomIndex === 0);
assert.ok(animatedDrawer && animatedDrawer.faces.length > 0, 'drawer moving faces should be registered for animation');
assert.equal(scene.toggleDrawer(animatedDrawer.id), true, 'drawer should open');
assert.equal(animatedDrawer.offset, 0, 'drawer motion should begin from its closed position');
assert.equal(animatedDrawer.targetOffset, .48, 'drawer should target its open position');
assert.equal(scene._stepDrawerAnimations(.06), true, 'drawer animation should update the moving geometry');
assert.ok(animatedDrawer.offset > 0 && animatedDrawer.offset < .48, 'drawer should ease rather than snap open');
assert.equal(scene.toggleDrawer(animatedDrawer.id), false, 'drawer should close');
assert.equal(animatedDrawer.targetOffset, 0, 'drawer should target its closed position');
assert.equal(scene._stepDrawerAnimations(.06), true, 'closing drawer animation should update geometry');
const originalCanvasRect = canvas.getBoundingClientRect;
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2560, height: 1440 });
scene.resize();
assert.ok(canvas.width * canvas.height <= scene.maxPixels * 1.01, 'high-resolution main scene should respect its backing-store budget');
scene._drawAmbientEffects(1000);
assert.equal(scene.effectOverlay.style.display, 'block', 'ambient overlay should render while a game room is active');
assert.ok(scene.effectOverlay.width * scene.effectOverlay.height <= 260000 * 1.01, 'ambient effect overlay should stay within its pixel budget');
scene.camera.x = scene.roomOffsets[1];
scene.setActiveRoom(game, 1);
scene.render();
assert.ok(scene.paintingOverlay.width * scene.paintingOverlay.height <= 700000 * 1.01, 'Gallery painting overlay should stay within its pixel budget');
scene.camera.x = 0;
scene.setActiveRoom(game, 0);
canvas.getBoundingClientRect = originalCanvasRect;
scene.resize();
assert.equal(scene.jump(), true, 'jump action should start from the floor');
assert.equal(scene.jumpVelocity, 7.2, 'jump input should set the upward impulse');
scene.jumpVelocity = 0; scene.jumpHeight = 0;
scene.dispose();
console.log('PASS: 2 ESL stages × 3 difficulty tiers; four-room progression; 1.5x room footprints; Ticket Hall and Storeroom furniture/drawers; surface-aligned papers/hotspots; inactive-room vertex culling; Library connector; mobile pointerdown jump/touch capture; 20 answer panels; original FOV and movement; stable Gallery artwork; byte-identical gallery PNG; ambient overlay with clock/fan/glint effects; eased drawer motion; reduced-motion styling; strict main/ambient/Gallery pixel budgets at 1440p; local HTML/JavaScript resources.');
