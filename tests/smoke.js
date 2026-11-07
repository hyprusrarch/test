const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
global.window = global;
const documentListeners = {};
global.document = { pointerLockElement: null, addEventListener(name, fn) { documentListeners[name] = fn; }, removeEventListener() {}, exitPointerLock() { this.pointerLockElement = null; documentListeners.pointerlockchange?.(); } };
global.navigator = global.navigator || { deviceMemory: 4 }; 
global.Image = class { constructor() { this.complete = true; this.naturalWidth = 240; this.naturalHeight = 240; this.width = 240; this.height = 240; } set src(value) { this._src = value; this.onload?.(); } };
for (const file of ['js/data.js', 'js/gallery-art.js', 'js/konami.js', 'js/tech-archive.js', 'js/game.js', 'js/canvas-scene.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { filename: file });
}
const { makeGame } = global.EscapeGame;
const gradients = [];
let textureDraws = 0;
const ctx = new Proxy({
  transform() {},
  drawImage() { textureDraws++; },

  createLinearGradient() { const g = { addColorStop() {} }; gradients.push(g); return g; },
  createRadialGradient() { return { addColorStop() {} }; }
}, { get(target, key) { return key in target ? target[key] : () => {}; }, set(target, key, value) { target[key] = value; return true; } });
const listeners = {};
const overlayElements = [];
global.document.body = { insertBefore(element) { overlayElements.push(element); element.parentNode = this; } };
global.document.createElement = tag => ({ tagName: tag.toUpperCase(), width: 0, height: 0, style: {}, getContext(type) { return type === '2d' ? ctx : null; }, setAttribute() {}, remove() { this.removed = true; } });
const canvas = { width: 0, height: 0, style: {}, nextSibling: null, getContext(type) { return type === '2d' ? ctx : null; }, addEventListener(k, fn) { listeners[k] = fn; }, setPointerCapture() {}, requestPointerLock() { document.pointerLockElement = this; documentListeners.pointerlockchange?.(); }, getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 600 }; } };
global.window.innerWidth = 960; global.window.innerHeight = 600; global.window.devicePixelRatio = 2;
global.window.addEventListener = () => {}; global.window.removeEventListener = () => {}; global.window.matchMedia = () => ({ matches: false });
global.requestAnimationFrame = () => 1; global.cancelAnimationFrame = () => {};
const hits = [];
const scene = new global.CanvasMuseumScene(canvas, id => hits.push(id), () => {});
if (!scene.paintingOverlayCtx || overlayElements.length !== 1) throw new Error('High-resolution gallery painting overlay was not created');
for (const stage of [8, 9]) {
  for (const tier of [0, 1, 2]) {
    const game = makeGame(stage, tier, 20261106 + stage + tier);
    scene.setRoom(game, 0); scene.render();
    if (scene.roomFaceGroups.length !== 4) throw new Error('All three rooms and the optional library should remain resident');
    if (!scene.roomGeometry.some(face => face.zone === 'connector')) throw new Error('First connector hallway geometry is not present');
    if (scene.roomOffsets[2] - scene.roomOffsets[0] < 30) throw new Error('The connected world is not larger than a single room');
    for (let room = 0; room < 3; room++) {
      if (room > 0) for (let door = 0; door < room; door++) scene.openDoor(door);
      scene.camera = { x: scene.roomOffsets[room], y: 1.66, z: 5.1875 };
      scene.setActiveRoom(game, room); scene.render();
      if (scene.roomGeometry.some(face => face.points.length !== 4)) throw new Error(`Non-quad source geometry found in room ${room}`);
      if (scene.hotspots.length !== (room === 1 ? 16 : room === 2 ? 17 : 7) || scene.projectedHotspots.length < 3) throw new Error(`Hotspot test failed: ${stage}/${tier}/${room}`);
      if (!scene.hotspots.some(point => point.id === 'paper-0')) throw new Error('Physical clue paper hotspot is missing');
      if (room === 1 && (!scene.hotspots.some(point => point.id === 'photo-0') || !scene.hotspots.some(point => point.id === 'gallery-chair-0'))) throw new Error('Gallery photograph or chair hotspot is missing');
      const offset = scene.roomOffsets[room];
      const obstacle = room === 0 ? [-3.15, -2.2] : room === 1 ? [0, -2.45] : [0, -2.35];
      if (scene._canOccupy(offset + obstacle[0] * 1.25, obstacle[1] * 1.25)) throw new Error(`Collision missing: ${stage}/${tier}/${room}`);
      if (!scene._canOccupy(offset, 5.1875)) throw new Error(`Room spawn point blocked: ${stage}/${tier}/${room}`);
      const cachedGeometry = scene.roomGeometry;
      scene.render();
      if (scene.roomGeometry !== cachedGeometry) throw new Error('Static map geometry was rebuilt during render');
      scene.setMovement(0.5, 1); scene.setDark(room === 1); scene.setTorch(room === 1); scene.render(); scene.setMovement(0, 0);
    }
  }
}
if (!gradients.length || typeof listeners.pointerdown !== 'function') throw new Error('Canvas renderer initialization failed');
// The art gallery must contain real textured quads, one for each framed photo.
const galleryGame = makeGame(9, 0, 1234);
scene.setRoom(galleryGame, 0);
scene.openDoor(0); scene.openDoor(1);
scene.camera = { x: scene.roomOffsets[1], y: 1.66, z: 5.1875 };
scene.setActiveRoom(galleryGame, 1);
const photoFaces = scene.roomGeometry.filter(face => face.texture === 'gallery-photo');
if (photoFaces.length !== 4) throw new Error(`Expected four gallery photo planes, got ${photoFaces.length}`);
if (scene.hotspots.filter(point => point.id.startsWith('gallery-chair-')).length !== 5) throw new Error('All five gallery chairs must be interactable');
if (scene.hotspots.filter(point => point.id.startsWith('photo-')).length !== 4) throw new Error('All four gallery photographs must be inspectable');
if (!scene.roomFaceGroups[0] || !scene.roomGeometry.slice(scene.roomFaceGroups[0].faceStart, scene.roomFaceGroups[0].faceEnd).some(face => face.zone === 'connector')) throw new Error('First connector hallway geometry is missing');
scene.render();
if (textureDraws < 4) throw new Error('Gallery image texture was not rendered into all four frames');
if (scene.paintingOverlay.style.display !== 'block' || scene.paintingOverlay.width <= 0 || scene.paintingOverlay.height <= 0) throw new Error('High-resolution gallery painting overlay was not sized or displayed');
if (scene.paintingOverlay.width < Math.floor(parseFloat(scene.paintingOverlay.style.width) * 1.8) || scene.paintingOverlay.height < Math.floor(parseFloat(scene.paintingOverlay.style.height) * 1.8)) throw new Error('Gallery overlay should render its visible painting bounds at device pixel ratio');
const transformMatrices = [];
let quadTextureDraws = 0, quadClipCalls = 0, quadPathPoints = 0;
scene._drawTexturedQuad(photoFaces[0], [
  { x: 10, y: 20 }, { x: 250, y: 20 },
  { x: 250, y: -220 }, { x: 10, y: -220 }
], {
  save() {}, restore() {}, beginPath() {}, moveTo() { quadPathPoints++; },
  lineTo() { quadPathPoints++; }, closePath() {}, clip() { quadClipCalls++; },
  transform(...matrix) { transformMatrices.push(matrix); }, drawImage() { quadTextureDraws++; }
});
if (transformMatrices.length !== 1 || Math.abs(transformMatrices[0][0] - 1) > 1e-6 || Math.abs(transformMatrices[0][3] - 1) > 1e-6 || Math.abs(transformMatrices[0][4] - 10) > 1e-6 || Math.abs(transformMatrices[0][5] + 220) > 1e-6) throw new Error('Gallery image quad mapping matrix is incorrect');
if (quadTextureDraws !== 1 || quadClipCalls !== 1 || quadPathPoints !== 4) throw new Error('Gallery artwork must render as one clipped four-sided quad');
if (!global.GALLERY_ART_DATA?.startsWith('data:image/png;base64,')) throw new Error('Embedded gallery artwork data is missing');

// All rooms remain resident; only fully off-screen/behind-camera faces are culled.
scene.setRoom(galleryGame, 0);
if (scene.roomFaceGroups.map(group => group.roomIndex).join(',') !== '0,1,2,3') throw new Error('All rooms and the optional library must be built at run start');
if (!scene.colliders.some(box => box.minX > 11 && box.minX < 18)) throw new Error('Gallery collision data is not resident at run start');
if (!scene.colliders.some(box => box.minX > 31 && box.minX < 38)) throw new Error('Storeroom collision data is not resident at run start');
const residentGeometry = scene.roomGeometry;
const residentGroups = scene.roomFaceGroups.slice();
const residentFaceCount = scene.roomGeometry.length;
const residentFaceIds = scene.roomGeometry.map(face => face.faceId);
if (scene.libraryLayout.racks.length !== 20) throw new Error('Library must contain 20 bookcases');
if (scene.libraryLayout.papers.length !== 10) throw new Error('Library must contain ten papers');
const alternateLibrarySeed = makeGame(9, 0, 8765);
if (alternateLibrarySeed.librarySeed === galleryGame.librarySeed) throw new Error('Library paper layout seed should vary by run seed');
if (new Set(scene.libraryLayout.papers.map(paper => `${paper.rackId}:${paper.level}:${paper.col}`)).size !== 10) throw new Error('Library papers must occupy ten distinct cubbies');
if (scene.libraryLayout.racks.some(rack => !Number.isInteger(rack.row) || !Number.isInteger(rack.col))) throw new Error('Library shelf grid is not indexed into rows and columns');
if (!scene.roomGeometry.some(face => face.roomIndex === 3 && Number.isInteger(face.libraryNoteIndex))) throw new Error('Library paper geometry is missing');
if (scene.roomGeometry.filter(face => face.roomIndex === 3 && face.libraryNoteIndex != null).some(face => face.points.length !== 4 || face.points.some(point => Math.abs(point[2] - face.points[0][2]) > 1e-6))) throw new Error('Library papers must be stable front-mounted quads');
if (scene.roomGeometry.filter(face => face.roomIndex === 3 && face.libraryNoteIndex != null).some(face => face.layer !== 1)) throw new Error('Library papers must depth-sort with the shelf geometry rather than overlay it');
if (new Set(scene.libraryLayout.papers.map(paper => paper.rackId)).size !== 10) throw new Error('Library papers should be spread across ten different bookcases');
if (scene.libraryLayout.papers.some(paper => Math.abs(paper.z - (scene.libraryLayout.racks.find(rack => rack.id === paper.rackId).z + .366)) > 1e-6)) throw new Error('Library paper is not attached to the shelf end plane');
if (!Array.isArray(scene.libraryLayout.books) || scene.libraryLayout.books.length < 250) throw new Error('Library shelves are not sufficiently populated with books');
if (scene.libraryLayout.books.some(book => book.y < .34 || book.height > .40 || book.zFront > scene.libraryLayout.racks.find(rack => rack.id === book.rackId).z + .36)) throw new Error('A book is outside its shelf compartment');
if (scene.roomGeometry.filter(face => Number.isInteger(face.libraryBookIndex)).length !== scene.libraryLayout.books.length) throw new Error('Book spine geometry count does not match the generated books');
if (!scene.roomGeometry.some(face => scene.libraryLayout.books.some(book => face.libraryBookIndex === book.id))) throw new Error('Book spine geometry is missing');
if (scene.roomScaleX <= 1 || scene.roomScaleZ <= 1) throw new Error('Museum rooms were not enlarged');
scene.camera = { x: 0, y: 1.66, z: 0 }; scene.yaw = -Math.PI / 2;
scene.render();
if (!scene._frameFaces.some(face => face.doorBarrier === 0)) throw new Error('Closed door panel was not drawn');
scene.openDoor(0);
if (scene.roomGeometry !== residentGeometry || scene.roomGeometry.length !== residentFaceCount || scene.roomFaceGroups.some((group, i) => group !== residentGroups[i])) throw new Error('Unlocking a door changed resident room geometry');
if (scene.roomGeometry.some((face, i) => face.faceId !== residentFaceIds[i])) throw new Error('Unlocking a door changed stable face identifiers');
scene.render();
if (scene._frameFaces.some(face => face.doorBarrier === 0)) throw new Error('Opened door panel was not removed from the rendered scene');
if (scene._frameFaces.some(face => face.lockBarrier === 0)) throw new Error('Unlocked keypad/buttons were not removed from the rendered scene');
scene.setActiveRoom(galleryGame, 0);
if (scene.hotspots.some(point => point.id === 'lock')) throw new Error('Unlocked room still exposes its lock interaction hotspot');
scene.setActiveRoom(galleryGame, 1);
scene.camera = { x: 20, y: 1.66, z: 5.1875 }; scene.render();
if (!scene.roomGeometry.some(face => face.lockBarrier === 1)) throw new Error('Gallery lock geometry was not built');
scene.openDoor(1); scene.render();
if (scene._frameFaces.some(face => face.lockBarrier === 1 || face.doorBarrier === 1)) throw new Error('Gallery door lock/panel remained after unlock');
scene.setActiveRoom(galleryGame, 2);
scene.camera = { x: 40, y: 1.66, z: 5.1875 }; scene.yaw = -Math.PI / 2; scene.render();
if (!scene._frameFaces.some(face => face.lockBarrier === 'exit')) throw new Error('Final exit lock was not present before opening');
scene.openExit(); scene.render();
if (scene._frameFaces.some(face => face.lockBarrier === 'exit' || face.doorBarrier === 'exit')) throw new Error('Final exit lock/panel remained after opening');
const geometryBeforeLighting = scene.roomGeometry;
scene.setDark(true); scene.render();
if (scene.roomGeometry !== geometryBeforeLighting) throw new Error('Lighting toggle rebuilt static object geometry');
scene.setDark(false);
if (scene.roomFaceGroups.length !== 4) throw new Error('Door unlocking altered the resident world group count');
scene.render();
if (scene._drawPrimitives.length !== scene._frameFaces.length) throw new Error('Each visible surface should produce exactly one intact polygon draw call');
if (scene._drawPrimitives.some(item => item.points.length === 3)) throw new Error('A surface was unnecessarily split into triangle draw primitives');

// Visibility is face-level only. Geometry from other rooms stays resident and
// can render when it is in the camera frustum; out-of-frame faces are discarded.
scene.camera = { x: 0, y: 1.66, z: 5.1875 }; scene.yaw = 0; scene.render();
if (scene._frameFaces.some(face => face.roomIndex === 0) === false) throw new Error('Ticket hall geometry was not rendered from its own room');
scene.camera = { x: 20, y: 1.66, z: 5.1875 }; scene.yaw = 0; scene.render();
if (scene._frameFaces.some(face => face.roomIndex === 1) === false) throw new Error('Gallery geometry was not rendered from its own room');
scene.camera = { x: 40, y: 1.66, z: 5.1875 }; scene.yaw = 0; scene.render();
if (scene._frameFaces.some(face => face.roomIndex === 2) === false) throw new Error('Storeroom geometry was not rendered from its own room');

// Gallery chairs have their backrests on +Z and face the tables on -Z.
const galleryBackrests = scene.roomGeometry.filter(face => face.roomIndex === 1 && face.objectTag === 'chair-back');
if (galleryBackrests.length < 5) throw new Error('Gallery chair backrests were not tagged/built');
for (const face of galleryBackrests) if (face.cz < 1.375) throw new Error(`Gallery chair backrest is on the table-facing side: ${face.cz}`);

// Exactly one raised quad per paper clue; no coplanar print polygons remain.
for (const roomIndex of [0, 1, 2]) {
  const papers = scene.roomGeometry.filter(face => face.roomIndex === roomIndex && Number.isInteger(face.paperIndex));
  if (papers.length !== 3) throw new Error(`Room ${roomIndex} should contain three paper quads`);
  if (papers.some(face => face.points.length !== 4)) throw new Error('Clue paper is not a single quad');
}
let paperLabelsDrawn = 0;
const originalFillText = ctx.fillText;
ctx.fillText = function (value, ...args) { if (/^(?:CLUE|CODE)\s/.test(String(value))) paperLabelsDrawn++; };
scene.camera = { x: 0, y: 1.66, z: 5.1875 }; scene.yaw = 0; scene.render();
ctx.fillText = originalFillText;
if (paperLabelsDrawn < 1) throw new Error('Raised clue-paper face did not draw its printed label');

// Culling is conservative: only fully off-screen faces are rejected; reversed winding stays visible.
scene.camera = { x: 0, y: 1.66, z: 5.1875 }; scene.yaw = 0;
scene._prepareVertexTransforms(scene._getLoadedRoomGroups());
const reversedFace = { ...scene.roomGeometry[0], points: [...scene.roomGeometry[0].points].reverse(), indices: [...scene.roomGeometry[0].indices].reverse(), _framePoints: [] };
if (!scene._projectFace(reversedFace)) throw new Error('A face was removed based on winding');
const offscreenPoints = [[100, 0, -10], [101, 0, -10], [100, 1, -10]];
const offscreenIndices = offscreenPoints.map(point => { const index = scene._vertices.length; scene._vertices.push(point); return index; });
scene._syncGeometryBuffers();
scene._prepareVertexTransforms();
const farOffscreenFace = { points: offscreenPoints, indices: offscreenIndices, _framePoints: [], layer: 0, fill: '#fff' };
if (scene._projectFace(farOffscreenFace)) throw new Error('A fully off-screen face was not culled');
const partiallyVisiblePoints = [[-20, 0, -10], [20, 0, -10], [20, 1, -10], [-20, 1, -10]];
const partiallyVisibleIndices = partiallyVisiblePoints.map(point => { const index = scene._vertices.length; scene._vertices.push(point); return index; });
scene._syncGeometryBuffers();
scene._prepareVertexTransforms();
const partiallyVisibleFace = { points: partiallyVisiblePoints, indices: partiallyVisibleIndices, _framePoints: [], layer: 0, fill: '#fff' };
if (!scene._projectFace(partiallyVisibleFace)) throw new Error('A partially visible face was incorrectly culled');
const behindFace = { ...scene.roomGeometry[0], points: [[0,0,100],[1,0,100],[0,1,100]], indices: [0,1,2], _framePoints: [] };
// Near-plane clipping may yield no drawable polygon when it is entirely behind the camera.
if (scene._projectFace(behindFace)) throw new Error('Near-plane clipping should reject polygons entirely behind the camera');
// Cardinal headings should continue to produce drawable geometry with conservative screen-bound culling.
for (const cameraX of [0, 8, 16, 24, 32]) for (const yaw of [0, Math.PI/2, -Math.PI/2, Math.PI]) {
  scene.camera = { x: cameraX, y: 1.66, z: 0 }; scene.yaw = yaw;
  scene._prepareVertexTransforms(scene._getLoadedRoomGroups());
  scene.render();
  if (!scene._frameFaces.length) throw new Error(`No room faces rendered at x=${cameraX}, yaw=${yaw}`);
}
scene.camera = { x: scene.roomOffsets[1], y: 1.66, z: 5.1875 };
scene.setActiveRoom(galleryGame, 1);
scene.yaw = 0;
scene.render();
const priorPosition = { ...scene.camera };
scene.setActiveRoom(galleryGame, 2);
if (scene.camera.x !== priorPosition.x || scene.camera.z !== priorPosition.z) throw new Error('Changing active room teleported the player');
scene.setActiveRoom(galleryGame, 1);

// Door remains solid until its code is solved, then the same coordinate is walkable.
scene.setRoom(galleryGame, 0);
scene.camera = { x: 8.06, y: 1.66, z: 0 };
if (scene._canOccupy(8.75, 0)) throw new Error('Closed connector door did not block movement');
scene.openDoor(0);
if (!scene._canOccupy(8.75, 0)) throw new Error('Unlocked connector door remained blocked');
scene.camera = { x: 8.0, y: 1.66, z: 0 };
scene.yaw = -Math.PI/2;
scene.setMovement(0, 1);
if (!scene._move(.5) || scene.camera.x <= 8.75) throw new Error('Player could not walk through the unlocked doorway');
scene.setMovement(0, 0);
scene.camera = { x: 28.06, y: 1.66, z: 0 };
if (scene._canOccupy(28.75, 0)) throw new Error('Second connector door should block before unlock');
scene.openDoor(1);
if (!scene._canOccupy(28.75, 0)) throw new Error('Second connector door stayed blocked after unlock');
scene.camera = { x: 28.0, y: 1.66, z: 0 }; scene.yaw = -Math.PI/2; scene.setMovement(0, 1);
if (!scene._move(.5) || scene.camera.x <= 28.75) throw new Error('Player could not walk through the second connector');
scene.setMovement(0, 0);

// The optional library is a walkable side room behind the storeroom.
scene.setRoom(galleryGame, 2);
scene.camera = { x: 40, y: 1.66, z: -6.0 }; scene.yaw = 0;
if (scene.isInLibrary()) throw new Error('Library area was detected before crossing its threshold');
scene.setMovement(0, 1);
for (let i = 0; i < 115; i++) scene._move(1/30);
scene.setMovement(0, 0);
if (!scene.isInLibrary()) throw new Error('Player could not physically enter the library connector');
if (scene.hotspots.filter(point => point.libraryNote).length !== 10) throw new Error('All ten library notes must be available to inspect');

// Chair interaction, standing, and a high enough jump to clear normal desks.
scene.setRoom(galleryGame, 0);
scene.camera = { x: -5.05 * 1.25, y: 1.66, z: 2.8 * 1.25 };
if (!scene.sitOnChair(0) || !scene.seated) throw new Error('Chair interaction failed');
if (scene.camera.y < 1.38) throw new Error('Sitting camera height was not raised');
if (!scene.jump() || scene.seated) throw new Error('Space/jump did not stand the player up');
scene.jump();
if (!(scene.jumpVelocity > 0)) throw new Error('Jump did not apply upward velocity');
let jumpPeak = 0;
for (let i = 0; i < 90 && (scene.jumpVelocity !== 0 || scene.jumpHeight > 0); i++) {
  scene._stepJump(1/60);
  jumpPeak = Math.max(jumpPeak, scene.jumpHeight);
}
if (jumpPeak < 1.95) throw new Error(`Jump arc too low to clear medium furniture (${jumpPeak.toFixed(2)}m)`);
scene.jumpHeight = jumpPeak;
if (!scene._canOccupy(0, -2.15 * 1.25)) throw new Error('Jumping cannot clear the medium-height table collision');
scene.jumpHeight = 0;
scene.camera = { x: 0, y: 1.66, z: -1.7 }; scene.yaw = 0; scene.jump(); scene.setMovement(0, 1);
for (let i = 0; i < 100 && (scene.jumpVelocity !== 0 || scene.jumpHeight > 0); i++) { scene._stepJump(1/60); scene._move(1/60); }
scene.setMovement(0, 0);
if (scene.camera.z > -3.72) throw new Error(`Jump could not physically clear the display table (stopped at z=${scene.camera.z.toFixed(2)})`);
scene.jumpHeight = 0; scene.jumpVelocity = 0; scene.camera.y = scene.eyeHeight; scene.camera = { x: scene.roomOffsets[1], y: 1.66, z: 2.0 }; scene.roomIndex = 1; scene.yaw = 0;
if (!scene.sitOnGalleryChair(2) || !scene.seated) throw new Error('Gallery chair seating failed');
if (scene.camera.y < 1.38) throw new Error('Gallery seated camera height was not raised');
scene.standUp();
for (let i = 0; i < 5; i++) {
  const positions = [-5,-2.5,0,2.5,5];
  scene.camera = { x: scene.roomOffsets[1] + positions[i] * 1.25, y: 1.66, z: 1.1 * 1.25 };
  if (!scene.sitOnGalleryChair(i) || !scene.seated) throw new Error(`Gallery chair ${i} could not be used`);
  scene.standUp();
}

// The Konami matcher should accept the full sequence and re-arm after activation.
let cheatActivations = 0;
const matchKonami = global.createKonamiMatcher(() => cheatActivations++);
for (const key of ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b']) {
  if (matchKonami(key)) throw new Error('Konami code activated before the final A key');
}
if (!matchKonami('a') || cheatActivations !== 1) throw new Error('Konami code did not activate the testing menu callback');
for (const key of global.KONAMI_SEQUENCE) matchKonami(key);
if (cheatActivations !== 2) throw new Error('Konami matcher did not re-arm after a successful sequence');

const stage9Tech = makeGame(9, 2, 987654);
if (!stage9Tech.rooms[0].key.prompt.includes('TECHNOLOGY ARCHIVE')) throw new Error('Stage 9 technology vocabulary archive key was not added');
if (!global.ESCAPE_TECH_ARCHIVE.relatedVocabulary.some(item => item.w === 'problem-solving')) throw new Error('Coding-related ESL vocabulary item is missing');
if (!stage9Tech.rooms[1].key.prompt.includes('DEVELOPER ARCHIVE')) throw new Error('Stage 9 project-language archive key was not added');
if (!stage9Tech.rooms[2].key.prompt.includes('TECHNOLOGY ARCHIVE')) throw new Error('Stage 9 technology grammar archive key was not added');
const stage8Keys = makeGame(8, 2, 987654);
if (stage8Keys.rooms.some(room => /ARCHIVE/.test(room.key.prompt))) throw new Error('Stage 8 content should remain unchanged');

if (!scene.roomGeometry.length) throw new Error('Room geometry was not cached');
if (!scene._vertices.length || scene._camForward.length !== scene._vertices.length) throw new Error('Shared vertex transform cache was not allocated');
if (!scene._shellFaces.length || !scene._propFaces.length || scene.roomFaceGroups.length !== 4) throw new Error('Continuous museum and library geometry groups are missing');
if (!(scene.maxPixels > 0) || !(scene.activeRenderScale > 0 && scene.activeRenderScale < 1)) throw new Error('Low-resolution scene backing scale was not enabled within the pixel budget');
scene._dirty = false; scene.setPaperState(scene.paperCodes, scene.paperSolved);
if (scene._dirty) throw new Error('Unchanged clue paper state caused a redundant render');
if (scene._canOccupy(0, -2.15)) throw new Error('Furniture collision is missing');
if (!scene._canOccupy(0, 0)) throw new Error('Walkable floor was incorrectly blocked');
scene.camera = { x: 0, y: 1.66, z: 5.1875 }; scene.setMovement(0, 1); scene._move(3);
if (scene.camera.z < -1.75) throw new Error('Player moved through a solid table');
scene.setMovement(0, 0);
scene.camera = { x: 0, y: 1.66, z: 5.1875 };
scene.yaw = 0;
scene.setMovement(0, 1);
const forwardStart = scene.camera.z;
if (!scene._move(0.1) || scene.camera.z >= forwardStart) throw new Error('W / ArrowUp must move forward');
scene.setMovement(0, 0);

// A held direction that is fully blocked must not keep scheduling animation frames.
const oldRaf = global.requestAnimationFrame;
let blockedRafCount = 0;
global.requestAnimationFrame = () => { blockedRafCount++; return blockedRafCount; };
scene._raf = null;
scene._dirty = false;
scene.moveInput = { x: 0, y: 1 };
const originalMove = scene._move;
scene._move = () => false;
scene._loop(5000);
if (blockedRafCount !== 0) throw new Error('Blocked movement kept the animation loop alive');
scene._move = originalMove;
scene.moveInput = { x: 0, y: 0 };
scene.lastTime = 0;
global.requestAnimationFrame = oldRaf;
scene.setRoom(galleryGame, 0); scene.camera = { x: 0, y: 1.66, z: 4.75 }; scene.yaw = 0; scene.render();
const target = scene.projectedHotspots.find(point => point.id === 'paper-0');
if (!target) throw new Error('Puzzle hotspot was not projected');
const pointer = { button: 0, pointerType: 'mouse', pointerId: 1, clientX: target.x, clientY: target.y };
listeners.pointerdown(pointer); listeners.pointerup(pointer);
if (!hits.includes('paper-0')) throw new Error('Tap-to-interact hotspot test failed');
scene.setPointerLockEnabled(true);
listeners.pointerdown({ button: 0, pointerType: 'mouse', pointerId: 2, clientX: 480, clientY: 300 });
if (!scene.pointerLocked) throw new Error('Pointer lock was not enabled from a canvas click');
const beforeYaw = scene.yaw;
listeners.pointermove({ pointerType: 'mouse', movementX: 40, movementY: 10 });
if (scene.yaw === beforeYaw) throw new Error('Locked mouse movement did not rotate the camera');
listeners.pointerup({ button: 0, pointerType: 'mouse', pointerId: 2, clientX: 480, clientY: 300 });
if (hits.length !== 1) throw new Error('The initial pointer-lock click should not activate a hotspot');
// Pitch sign and sensitivity: upward mouse motion must look upward (horizon moves down).
scene.camera = { x: 0, y: 1.66, z: 5.1875 };
scene.yaw = 0; scene.pitch = 0;
const horizonBefore = scene._project(0, scene.camera.y, -1).y;
scene._look(0, -100, 0.0036);
const horizonAfter = scene._project(0, scene.camera.y, -1).y;
if (scene.pitch <= 0 || horizonAfter <= horizonBefore) throw new Error('Vertical mouse-look direction is inverted');
if (scene.pitch < 0.34 || scene.pitch > 0.38) throw new Error('Desktop mouse sensitivity is not reduced to 75%');
scene.pitch = 0; scene._look(0, -100, 0.0039);
if (scene.pitch < 0.37 || scene.pitch > 0.41) throw new Error('Touch drag sensitivity is not reduced to 75%');

// A pointer-lock failure must not permanently disable later user-gesture retries.
scene.releasePointerLock();
scene._onPointerLockError();
canvas.requestPointerLock = function () { throw new Error('simulated lock failure'); };
listeners.pointerdown({ button: 0, pointerType: 'mouse', pointerId: 3, clientX: 480, clientY: 300 });
if (!scene.drag) throw new Error('Drag-look fallback was not armed after a pointer-lock failure');
scene.drag = null;
const requestsBeforeRetry = global.__pointerLockRequests || 0;
canvas.requestPointerLock = function () {
  global.__pointerLockRequests = (global.__pointerLockRequests || 0) + 1;
  document.pointerLockElement = this;
  documentListeners.pointerlockchange?.();
};
scene.requestPointerLockFromGesture();
if (!scene.pointerLocked || (global.__pointerLockRequests || 0) !== requestsBeforeRetry + 1) throw new Error('Pointer lock retry after failure did not work');

// Portrait projection should retain a stable vertical field of view.
scene.width = 390; scene.height = 844;
const portraitProjection = scene._project(1, scene.camera.y, -1);
if (!portraitProjection || portraitProjection.scale < 100) throw new Error('Portrait projection is using an excessively narrow focal length');
if (!scene._frameFaceCount) throw new Error('No room faces were submitted for rendering');
// Structural floors must render before walls, and room props must render after
// architecture. This prevents the large ground plane from painting over desks.
const renderLayers = scene._drawPrimitives.map(item => item.layer);
for (let i = 1; i < renderLayers.length; i++) {
  if (renderLayers[i] < renderLayers[i - 1]) throw new Error('Render layers are not in stable floor/architecture/prop order');
}
if (!scene.roomGeometry.some(face => face.layer === -1)) throw new Error('Floor render layer is missing');
if (!scene.roomGeometry.some(face => face.layer === 0) || !scene.roomGeometry.some(face => face.layer === 1)) throw new Error('Architecture or object render layer is missing');
if (scene.roomGeometry.some(face => face.points.length !== 4)) throw new Error('World geometry contains a non-quad surface');
if (scene._drawPrimitives.some(primitive => primitive.points.length === 3)) throw new Error('Renderer emitted a triangle instead of an intact polygon');
// Room-aware culling: only the active room's props render. Adjacent groups
// may contribute real perimeter/partition walls and connector architecture only.
scene.camera = { x: 0, y: 1.66, z: 2 };
scene.yaw = -Math.PI / 2;
scene._drawWorldGeometry();
if (scene._drawPrimitives.some(item => item.face.roomIndex === 1 && item.face.zone !== 'partition' && item.face.zone !== 'connector')) throw new Error('Gallery props leaked into the ticket hall');
if (!scene._drawPrimitives.some(item => item.face.roomIndex === 1 && item.face.zone === 'partition')) throw new Error('Adjacent room perimeter wall is missing');
if (scene.roomGeometry.some(face => ['partition-backdrop','library-backdrop'].includes(face.zone))) throw new Error('Temporary doorway backdrops should not exist');
scene.camera = { x: 20, y: 1.66, z: 2 };
scene.yaw = 0;
scene._drawWorldGeometry();
if (scene._drawPrimitives.some(item => item.face.roomIndex === 0 && item.face.zone !== 'partition' && item.face.zone !== 'connector')) throw new Error('Ticket hall props leaked into the gallery');
if (scene._drawPrimitives.some(item => item.face.roomIndex === 2 && item.face.zone !== 'partition' && item.face.zone !== 'connector')) throw new Error('Storeroom props leaked into the gallery');
scene.camera = { x: 40, y: 1.66, z: 2 };
scene._drawWorldGeometry();
if (scene._drawPrimitives.some(item => item.face.roomIndex === 1 && item.face.zone !== 'partition' && item.face.zone !== 'connector')) throw new Error('Gallery props leaked into the storeroom');
if (!scene._drawPrimitives.some(item => item.face.roomIndex === 3 && item.face.zone === 'partition')) throw new Error('Library perimeter wall should be visible from the storeroom');
if (scene._drawPrimitives.some(item => item.face.roomIndex === 3 && item.face.zone !== 'partition')) throw new Error('Library shelves or papers leaked into the storeroom');
scene.camera = { x: 40, y: 1.66, z: -20 }; scene.yaw = Math.PI;
scene._drawWorldGeometry();
if (scene._drawPrimitives.some(item => item.face.roomIndex === 2 && !['library-connector','partition'].includes(item.face.zone))) throw new Error('Storeroom props leaked into the library');
if (!scene._drawPrimitives.some(item => item.face.roomIndex === 2 && item.face.zone === 'partition')) throw new Error('Storeroom perimeter wall should be visible from the library');
for (let room = 0; room < 3; room++) {
  if (!scene.roomGeometry.some(face => face.roomIndex === room && face.zone === 'partition' && face.points.every(point => Math.abs(point[2] - 7.5) < .001))) throw new Error(`Room ${room} is missing its front enclosing wall`);
  const centerX = scene.roomOffsets[room];
  if (scene._canOccupy(centerX, 7.25)) throw new Error(`Room ${room} front wall has no collision`);
}
// Jumping can land on a low table, remain supported while standing on it,
// and transition to a fall when the player walks off the platform.
scene.camera = { x: -3.9375, y: 1.66, z: -2.75 };
scene.groundHeight = 0; scene.jumpHeight = 1.6; scene.jumpVelocity = -1;
scene._stepJump(.05);
if (Math.abs(scene.groundHeight - 1.55) > .02 || Math.abs(scene.camera.y - (scene.eyeHeight + 1.55)) > .02) throw new Error('Jump did not land on the desk platform');
if (!scene._canOccupy(scene.camera.x, scene.camera.z)) throw new Error('Player cannot walk on a landed platform');
scene.camera.x += 15;
scene._refreshPlatformSupport();
if (scene.groundHeight !== 0 || scene.jumpHeight <= 0) throw new Error('Walking off a platform did not initiate a fall');
scene.camera = { x: 0, y: 1.66, z: 5.1875 }; scene.yaw = 0; scene.pitch = 0; scene.jumpHeight = 0; scene.groundHeight = 0;
// A face crossing the near plane must not stroke the artificial clipping cap.
let outlineMoveCount = 0, outlineLineCount = 0, outlineStrokeCount = 0;
scene._drawClippedFaceOutline({
  stroke: '#000',
  points: [[-1, 0, 6], [1, 0, 6], [1, 1, -2], [-1, 1, -2]]
}, {
  beginPath() {}, moveTo() { outlineMoveCount++; }, lineTo() { outlineLineCount++; },
  stroke() { outlineStrokeCount++; }
});
if (outlineStrokeCount !== 1 || outlineMoveCount !== outlineLineCount || outlineLineCount > 4) throw new Error('Near-plane clipping generated an artificial outline edge');
// Library papers must sit beyond the aisle-facing shelf plane and sort with
// the shelf geometry. Collecting one removes its world face and hotspot.
const libraryNote = scene.libraryLayout.papers[0];
const libraryNoteFace = scene.roomGeometry.find(face => face.libraryNoteIndex === libraryNote.id);
const libraryRack = scene.libraryLayout.racks.find(rack => rack.id === libraryNote.rackId);
if (!libraryNoteFace || libraryNoteFace.layer !== 1) throw new Error('Library paper is not in the shelf depth-sorting layer');
if (Math.abs(libraryNote.z - (libraryRack.z + .36) - .006) > 1e-6) throw new Error('Library paper is not flush against the shelf end plane');
if (libraryNoteFace.points.some(point => Math.abs(point[2] - (libraryRack.z + .366) * scene.roomScaleZ) > 1e-6)) throw new Error('Library paper vertices are not on the shelf end plane');
scene.hotspots.push({ id: `library-paper-${libraryNote.id}`, libraryNote: true });
if (!scene.collectLibraryPaper(libraryNote.id)) throw new Error('Library paper could not be collected');
if (scene.hotspots.some(point => point.id === `library-paper-${libraryNote.id}`)) throw new Error('Collected paper hotspot was not removed');
scene.camera = { x: 40, y: 1.66, z: -20 }; scene.yaw = Math.PI;
scene._drawWorldGeometry();
if (scene._drawPrimitives.some(item => item.face.libraryNoteIndex === libraryNote.id)) throw new Error('Collected paper face remained visible on its shelf');
scene.setEquippedLibraryPaper({ title: 'Cataloguing', body: 'A short archive note used for testing.' });
if (!scene.equippedLibraryPaper || scene.equippedLibraryPaper.title !== 'Cataloguing') throw new Error('Equipped paper state was not stored');
scene.camera.z = -14.8;
scene.setEquippedLibraryPaper(null);
if (scene.equippedLibraryPaper !== null) throw new Error('Equipped paper did not clear when leaving the Library');
// A normal jump must keep the full player head below the room ceiling.
scene.groundHeight = 0; scene.jumpHeight = 0; scene.jumpVelocity = 7.2;
for (let i = 0; i < 50 && (scene.jumpVelocity !== 0 || scene.jumpHeight > 0); i++) scene._stepJump(.04);
if (scene.camera.y > 4.5 - .65 + .001) throw new Error('Player head crossed the room roof during a normal jump');

// A jump started while standing on the tallest ordinary table cannot lift the
// camera/eye point through the 4.5-unit room ceiling.
scene.groundHeight = 2.15; scene.jumpHeight = 0; scene.jumpVelocity = 7.2;
for (let i = 0; i < 50 && (scene.jumpVelocity !== 0 || scene.jumpHeight > 0); i++) scene._stepJump(.04);
if (scene.camera.y > 4.5 - .65 + .001) throw new Error('Jump allowed the player camera to pass through the room roof');
if (scene.jumpHeight > 4.5 - .65 - scene.eyeHeight - scene.groundHeight + .001) throw new Error('Jump exceeded the available ceiling clearance from a raised platform');
// Crossing out of the Library triggers the room-change callback immediately.
scene.camera = { x: 40, y: 1.66, z: -16.0 };
scene._lastArea = 'library';
let libraryExitEvent = null;
scene.onAreaChange = (next, previous) => { libraryExitEvent = { next, previous }; };
scene.camera.z = -14.9;
scene._notifyAreaChanged();
if (!libraryExitEvent || libraryExitEvent.previous !== 'library' || libraryExitEvent.next !== '2') throw new Error('Leaving the Library did not trigger the inventory-clear transition');

scene.dispose();
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptPaths = [...html.matchAll(/<script\s+src=[\"']([^\"']+)/g)].map(match => match[1]);
for (const scriptPath of scriptPaths) {
  if (!fs.existsSync(path.join(__dirname, '..', scriptPath))) throw new Error(`Missing script: ${scriptPath}`);
  if (/^https?:/i.test(scriptPath)) throw new Error('External script dependency found');
}
if (/three\.min\.js|type=[\"']module[\"']/i.test(html)) throw new Error('External renderer or module loader found');
const hotbarHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const hotbarApp = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
if (!hotbarHtml.includes('id="paper-hotbar"') || !hotbarHtml.includes('paper-hotbar-slots')) throw new Error('Library paper hotbar markup is missing');
if (!hotbarApp.includes('state.libraryInventory.push(index)') || !hotbarApp.includes('equipLibraryPaper(index)')) throw new Error('Collected papers are not automatically added and equipped');
if (!hotbarApp.includes('state.libraryInventory = []') || !hotbarApp.includes('scene?.setEquippedLibraryPaper(null)')) throw new Error('Library paper inventory is not cleared on area exit');
if (!hotbarApp.includes('paper-slot-art')) throw new Error('Hotbar slots do not render paper previews');
if (!hotbarApp.includes("key === '0' ? 9 : Number(key) - 1")) throw new Error('Numeric hotbar selection is missing');

console.log('Passed: Stage 8/9 and tiers; resident world geometry with active-room prop culling and real perimeter walls; platform landing/walking/falling; conservative face-level culling; continuous connectors; optional 20-bookcase library populated with books and ten randomized shelf-end collectible papers plus a movement-safe hotbar; roof-limited jumping; solved-paper HUD stack; jump clearance over medium furniture; door panel/keypad disappearance; facing chairs and raised seating; single-quad paper surfaces and inline print rendering; intact polygon drawing; gallery textures; furniture collision; pointer lock and mouse controls; HDPI scaling; idle invalidation; low-resolution scene render with high-resolution gallery artwork overlay; local HTML/JS resources.');
