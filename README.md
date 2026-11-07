# After Hours — HTML + JavaScript Escape Room

A split-source museum escape room built with native HTML, embedded CSS, and JavaScript. The 3D-style scene is software-rendered with Canvas 2D perspective projection. No WebGL engine, Three.js, npm packages, frameworks, external JavaScript imports, backend, or build step are required.

## Run

Open `index.html` in a current browser. No local server is required. On Linux, you can also run `python3 -m http.server 8000` in this directory and open `http://localhost:8000`.

## Project layout

- `index.html` — page structure and embedded styles
- `js/data.js` — Stage 8 and Stage 9 museum content
- `js/gallery-art.js` — embedded user-provided gallery photograph
- `js/konami.js` — hidden developer test-menu sequence
- `js/tech-archive.js` — optional Stage 9 technology bonus
- `js/game.js` — puzzles, scoring, penalties, timers, and progression
- `js/canvas-scene.js` — Canvas 2D renderer, movement, collision, whole-world visibility culling, and interactions
- `js/app.js` — menus, game flow, modal puzzles, and UI controls
- `tests/smoke.js` — renderer and game regression checks

## Controls

Desktop: WASD or arrow keys to move. Click the 3D scene to capture the mouse; move the mouse to look. Press E or click a highlighted object to interact. Space jumps, or stands up when seated. E on a chair sits down or stands up. N opens the notebook, F activates the torch during the blackout event, and Escape releases the mouse and pauses.

Mobile: use the virtual joystick to move, swipe the scene to look, tap highlighted objects to interact, and use JUMP to jump or stand up. Tap a chair to sit down.

## World, rooms, and visibility

The three progression rooms and optional Library remain resident in memory. Rendering is room-aware: only the room occupied by the player renders its furniture, papers, shelves and paintings. Adjacent rooms contribute their actual enclosing perimeter walls and connector architecture only; no temporary doorway backdrops are used. Each progression room has a complete perimeter (front, rear, left and right walls), with real openings at the connecting doors. The Storeroom and Library show the real wall surfaces around their connecting opening from either side, while adjacent-room furniture and papers remain hidden. Faces are culled only when fully behind the near plane or wholly outside the viewport; partially visible faces are retained. No back-face or polygon-winding culling is used. Door unlocks remove the corresponding door panel, keypad and collision barrier. The three museum rooms are enlarged by 25% and remain connected by walkable corridors. The optional Library branches from the Storeroom through an open doorway and can be visited without changing the three-lock escape progression.

The Library contains 20 bookcases arranged in four rows and five columns. Each bookcase has eight shelf levels and five cubby columns. The shelves are populated with varied upright books in muted colors; each has a visible spine, side and top face, with simple gilt spine bands. Book geometry is kept to three quads per book to avoid the cost of full six-face boxes. Ten small papers are distributed across ten distinct bookcases using a per-run seeded random layout. Each paper is mounted directly against the aisle-facing shelf end plane, just 0.006 world units beyond the wood edge to avoid z-fighting without visibly floating in front of the shelf. Papers share the shelf depth-sorting layer instead of being forced into a foreground overlay, so a paper viewed from behind a shelf is correctly hidden by the wood. Their muted paper color and varied shelf positions keep them discoverable without making every clue immediately obvious. Press E or tap a paper nearby to collect it. Collected papers are removed from the shelf, automatically added to the Library hotbar and equipped without opening a modal, so movement continues. Each hotbar slot shows a miniature paper preview and title. Newly collected papers are equipped automatically. Select a hotbar slot or press 1–0 to equip a different paper; movement remains enabled while a paper is equipped. The hotbar and held-paper view are cleared when leaving the Library.

When a clue is solved, its code character appears in a vertical paper stack at the bottom-left of the screen (for example, `1 = R`). The stack changes to the current room's solved clues and clears when the next room is unlocked.

The main Canvas 2D scene intentionally renders at reduced resolution to lower CPU and memory use. Gallery paintings are drawn on a separate cropped transparent canvas at device-pixel-ratio resolution, with nearer scene faces masking the artwork so furniture continues to occlude it correctly. The gallery overlay only allocates pixels around the visible paintings rather than creating a second full-screen high-resolution surface.

Static geometry is cached between camera frames. The animation loop sleeps while idle, when movement is blocked, and while the tab is hidden. Jumping uses a gravity arc and airborne movement boost, with strict player-head clearance that keeps the full player below room roofs, including when jumping from raised platforms. Low desks and tables are platform surfaces: the player can land on their tops, walk across them, and fall naturally after stepping off. Chairs remain solid and interactive but are not treated as platforms; full-height shelving and walls remain impassable. Canvas 2D does not provide a hardware depth buffer, so complex intersecting surfaces can still show painter-order artifacts. Polygons remain intact quads/surfaces rather than being split into triangles.
## Interactions

Clue papers are single raised quadrilateral surfaces on tables; their printed lines and clue/code label are drawn inside the same projected face to avoid coplanar flicker. Click a paper or aim at it and press E to open its puzzle. Once solved, its paper shows the recovered code digit. Library archive papers sit flush against the aisle-facing ends of the shelf cubbies, are automatically added to an equipped hotbar with miniature previews, can be carried while moving, and are cleared from the hotbar when leaving the Library. Chairs face the table side of each room, and sitting uses a raised seated-eye camera position. Four gallery frames use the uploaded photograph and can be inspected to open a larger view. Chairs have solid collision and can be sat on. Jumping uses a simple vertical gravity arc.

## Developer test menu

During gameplay, enter the Konami Code: Up, Up, Down, Down, Left, Right, Left, Right, B, A. The hidden menu can add five minutes, solve the current room clues, move to a later room for testing, or open the final exit lock. These actions affect only the current run.

## Tests

With Node.js installed, run:

```sh
node tests/smoke.js
```

The tests cover Stage 8/9 content, all difficulty tiers, resident full-world geometry, room-aware prop culling and surrounding perimeter walls, conservative fully-offscreen face culling, platform landing/walking/falling, physical door opening, continuous room geometry, Library layout, populated bookcases and flush shelf-end paper placement, collectible paper removal, equipped-paper state, hotbar markup, leaving-Library cleanup, roof clearance while jumping from a raised platform, bottom-left solved-code display markup, chair interactions, actual jump clearance across a desk, pointer lock, mouse sensitivity, low-resolution scene rendering, high-resolution gallery artwork overlay, idle invalidation, and local HTML/JavaScript resource references.


## Map and library additions

All three progression rooms and the optional library are resident from the start. Geometry is only culled when a face is behind the camera or completely outside the viewport; unlocking doors no longer loads/unloads rooms. The main museum spaces are enlarged by 25% in X/Z. An optional library branch connects to the storeroom and contains 20 bookcases arranged in four rows and five columns. Each case has eight shelf rows and five cubby columns. Book spines, side faces and top faces populate the cubbies; ten archival papers are placed in deterministic pseudo-random cubbies directly against the shelf end plane and can be collected at close range and carried in the Library hotbar without opening a modal.

Solved room-code characters are shown as a vertical stack in the bottom-left HUD and clear when the next room is unlocked. Jumping can clear low furniture while tall objects and shelves remain solid.
