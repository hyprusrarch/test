# After Hours — HTML + JavaScript Escape Room

A split-source museum escape room built with native HTML, embedded CSS, and JavaScript. The 3D-style scene is software-rendered with Canvas 2D perspective projection. No WebGL engine, Three.js, npm packages, framework, external JavaScript import, multiplayer backend, or build step is required.

## Run

Open `index.html` in a current browser. A local server is optional; on Linux, `python3 -m http.server 8000` works from this directory.

## Project layout

- `index.html` — page structure and embedded styles
- `js/data.js` — Stage 8 and Stage 9 ESL content
- `js/gallery-art.js` — embedded original gallery photograph
- `assets/gallery-photo.png` — byte-identical standalone fallback for the original gallery photograph
- `js/konami.js` — hidden developer test-menu sequence
- `js/tech-archive.js` — Stage 9 technology bonus content
- `js/game.js` — puzzle generation, word banks, codes, scoring, penalties, timers, and four-room progression
- `js/canvas-scene.js` — Canvas 2D renderer, movement, collision, platforms, visibility culling, drawers, and object interactions
- `js/app.js` — menus, game flow, word-scavenger progression, hotbar, answer panels, and UI controls
- `tests/smoke.js` — regression tests for both stages and all difficulties

## Controls

Desktop: WASD/arrows move; click the scene to lock the mouse; mouse movement looks around; E or click interacts; Space jumps/stands; N opens the notebook; F uses the torch during the blackout event; Escape releases the mouse and pauses. Press 1–0 to select a collected word slip.

Mobile: use the virtual joystick to move, swipe the scene to look, tap interaction targets, and use JUMP to jump/stand. Tap a chair to sit.

## Four-room progression

The progression is Ticket Hall → Gallery → Storeroom → Library. The Library is the final room, not a disconnected bonus. Each of the four rooms has five physical answer panels and a five-character lock code (20 answer panels total). Solving the Storeroom exit lock opens the physical connector into the Library. The Storeroom's five answer panels are mounted on its opposite wall and face into the Storeroom; its exit door remains on the rear Library connector wall, with a separate keypad mounted beside the doorway. The five Library panels recover the final archive code; its lock leads to the final timed word scramble.

The first three museum room footprints use a compact 1.5× room scale, with their centres spaced 23.5 world units apart. The Library retains its smaller 1.25× footprint and connects directly to the Storeroom through a short passage. Room walls and floors define the larger footprint, while individual furniture, doors, answer panels, photographs and paper slips keep their normal object dimensions and consistent object-space coordinates. The Ticket Hall spawn is positioned beside the furnished search area rather than in the middle of the expanded floor.

All four room geometry groups remain resident. Rendering is room-aware: the active room's furniture, papers, shelves and paintings are drawn, with adjacent rooms contributing only their actual enclosing perimeter walls and connector surfaces. There are no temporary doorway backdrops. Faces are culled only when fully behind the near plane or completely outside the viewport; partially visible faces and reversed-winding polygons remain. No back-face or polygon-winding culling is used. Door unlocks remove the corresponding door, keypad and collision barrier.

## Word scavenger and answer panels

The old paper-pickup quiz interaction is removed. The three main rooms distribute full-size cream-coloured candidate word slips around furniture and tables, restoring the earlier readable paper appearance and interaction range. Loose papers remain collectible and have no glowing world markers. Library papers use their original readable dimensions and warmer paper stock. Each of five answer panels displays an ESL clue and accepts only a word the player has actually collected in the current room. Picking up a slip adds it to the room's hotbar and equips it; it does not open a modal. Correct answers reveal one lock character in panel order. Incorrect answers incur the standard time penalty and are remembered for that panel. Collected words remain available for other panels. The room hotbar clears when the player enters another room.

The Library follows the same final-room scavenger flow without any drawers or drawer cabinet. It contains 20 bookcases in a four-row by five-column layout; each case has eight shelf levels and five cubby columns. Book spines, side faces and top faces populate the shelves. Ten archive word slips are distributed across ten different bookcases using a per-run seeded layout, and all ten are immediately visible as shelf pickups. The five Library answer panels accept collected archive words and produce the final code `STACK`.

Each main room has five physical answer panels and receives up to twenty candidate word slips (reading rooms have a smaller unique set because their number answers are drawn from 1–9). Loose slips are generated from the actual tabletop and shelf surfaces in each room, using the same local coordinates and heights as the rendered furniture. This keeps papers from floating beside desks, clipping below table tops or appearing on chair seats. Papers are intact quads with their printed word drawn on the same face. Drawers slide open and closed; contained papers are hidden and non-interactable while closed. The Ticket Hall has seven additional work tables with books, document trays, a pen cup, a lamp and archive clutter, plus twelve additional drawers: some contain extra word slips and others are intentionally empty. Together with its original drawers, the Ticket Hall has fourteen drawers to search. The Storeroom has two matching side worktables with collision and paper placement. The Gallery keeps its long central archive table and uses its top for loose clues.

Solved code characters are shown vertically at the bottom-left of the HUD and clear on room progression. The word hotbar is room-scoped. The larger equipped-paper preview remains visible while moving and can be selected with keys 1–0.

## World, movement, and rendering

The camera framing has been restored to the original pre-120 setting (approximately 90° horizontal FOV at a 16:9 viewport; focal length = 0.90 × viewport height). Movement speed remains 4.05 world units per second, 1.5× the earlier 2.7 value. First-person pointer lock, mobile joystick/swipe controls, a touch-captured JUMP button, chair seating, jumping, and low furniture platforms remain. Low desks and tables can be landed on and walked across; stepping off causes a fall. The player head remains below the 4.5-unit room ceiling, including when jumping from raised platforms. Walls and full-height shelves remain solid.

The main Canvas 2D scene renders at reduced resolution with a strict pixel budget. The renderer collects the active room's faces and only neighbouring boundary/connector faces before transforming vertices; inactive-room furniture is not projected. Per-frame draw records, hotspot records, room-group lists and vertex transforms are reused, and screen-space bounds provide a broad-phase check for hotspot occlusion. Gallery paintings use a separate high-resolution transparent overlay capped at 700,000 backing-store pixels. Their occlusion mask is stable and layer-based: only foreground prop layers can mask the wall-mounted artwork. It does not use frame-to-frame average-depth thresholds. The original gallery photograph is restored in all four frames and in the image viewer; `assets/gallery-photo.png` is an exact fallback copy of the embedded image.

Ambient animation is isolated on a second transparent overlay with a strict 260,000-pixel backing-store budget and an 18 FPS cap. The main scene has its own 340,000–480,000-pixel budget depending on device capability; the limits remain effective at 1440p and larger viewports. It adds restrained floating dust, pulsing lamp halos, a working wall clock in the Ticket Hall, a rotating ventilation fan in the Storeroom, and occasional light glints across the Gallery photographs. Drawers ease open and closed with frame-rate-independent motion. The effects loop runs only during active gameplay, stops when the tab is hidden or rendering is disabled, and respects `prefers-reduced-motion`. UI controls also use short transitions with a reduced-motion override. New wall fixture plates and Gallery caption rails add detail without increasing the main render resolution.

Static geometry and gradients are cached; the main render loop sleeps while idle, when movement is blocked, and while the tab is hidden. The ambient overlay does not force the main geometry renderer to redraw, except while a drawer is physically moving. Canvas 2D has no hardware depth buffer, so complex intersecting geometry can still show painter-order limitations. Surfaces remain intact quads/polygons rather than being split into triangle fans.

## Optional ESL bonus and developer tools

Stage 9 retains the optional technology vocabulary/project-language challenge. Stage 8 uses its original content. During gameplay, enter the Konami Code: Up, Up, Down, Down, Left, Right, Left, Right, B, A. The hidden test menu can add five minutes, solve the current room clues, move to a room for testing, or open the final exit sequence. Cheats affect only the current run.

## Tests

With Node.js installed, run:

```sh
node tests/smoke.js
```

The tests cover Stage 8 and Stage 9 at Core, Stretch and Challenge; five panels and five code characters in every room; collected-word answers; four-room progression and final Library lock; full-size readable paper slips; seven additional Ticket Hall tables with tabletop props; fourteen Ticket Hall drawers with both empty and paper-filled trays; 20 bookcases and ten immediately collectible Library shelf notes; no Library drawers or cabinet; all-room geometry; active-room prop culling; restored original FOV; enlarged room shells with unchanged object-space positions and dimensions; matching collision, paper-hotspot and drawer transforms; 1.5× movement speed; stable gallery painting masking; restored gallery image bytes and fallback asset; drawer easing; ambient overlay creation and drawing; reduced-motion styling; and local HTML/JavaScript references.

testing - add custom xp value changes in konami code menu, either positive or negative
