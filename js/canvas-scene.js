(function () {

/* Native Canvas 2D perspective renderer. No WebGL or external dependencies. */
const OCCLUDER_LIMIT = 64;
const BOOK_BAND_LINES = [.16, .25, .82];
const BOOK_PLAIN_LINES = [.17, .82];
const MAIN_ROOM_SCALE = 1.5;
const MAIN_ROOM_SPACING = 23.5;
const LIBRARY_WORLD_OFFSET_Z = 2.2;
const LIBRARY_FRONT_WORLD_Z = LIBRARY_WORLD_OFFSET_Z - 12 * 1.25;
const MAIN_ROOM_REAR_WORLD_Z = -6 * MAIN_ROOM_SCALE;

class CanvasMuseumScene {
  constructor(canvas, onInteract = () => {}, onFocus = () => {}, onLockChange = () => {}, onAreaChange = () => {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!this.ctx) throw new Error('Canvas 2D is unavailable in this browser.');

    this.onInteract = onInteract;
    this.onFocus = onFocus;
    this.onLockChange = onLockChange;
    this.onAreaChange = onAreaChange;
    this._lastArea = null;
    this.collectedLibraryPapers = new Set();
    this.collectedRoomPapers = new Set();
    this.collectedWordPapers = new Set();
    this.drawers = [];
    this.drawerById = new Map();
    this.libraryPanelSolved = Array(5).fill(false);
    this.currentGame = null;
    this.equippedLibraryPaper = null;
    this.equippedPaper = null;
    this.camera = { x: 0, y: 1.66, z: 4.15 };
    this.yaw = 0;
    this.pitch = 0;
    this.moveInput = { x: 0, y: 0 };
    this.playerRadius = 0.28;
    this.bounds = { minX: -14, maxX: 58, minZ: -34, maxZ: 12 };
    this.roomScaleX = MAIN_ROOM_SCALE; // room footprint is compact; props retain their 1.25x object scale
    this.roomScaleZ = MAIN_ROOM_SCALE;
    this.libraryScaleX = 1.25;
    this.libraryScaleZ = 1.25;
    this.roomOffsets = [0, MAIN_ROOM_SPACING, MAIN_ROOM_SPACING * 2];
    this._worldOffsetZ = 0;
    this.mapKinds = ['vocab', 'reading', 'grammar'];
    this.doorOpen = [false, false, false];
    this.libraryDoorOpen = false;
    this.exitOpen = false;
    this._worldOffsetX = 0;
    this.eyeHeight = 1.66;
    this.jumpHeight = 0;
    this.jumpVelocity = 0;
    this.groundHeight = 0;
    this.seated = false;
    this._standingPosition = null;
    this.colliders = [];
    this.hotspots = [];
    this.projectedHotspots = [];
    this._projectedHotspotPool = [];
    this.focused = null;
    this.drag = null;
    this.mouseDown = false;
    this.pointerLocked = false;
    this.lockRequestPointerId = null;
    this.pointerLockEnabled = false;
    this.pointerLockFailed = false;
    this.dark = false;
    this.torch = false;
    this.roomIndex = 0;
    this.roomKind = 'vocab';
    this.lastFrame = 0;
    this.lastTime = 0;
    this.frameMs = 1000 / 30;
    this.rendering = true;
    this._raf = null;
    this._dirty = true;
    this._geometry = [];
    this.roomGeometry = [];
    this._shellFaces = [];
    this._propFaces = [];
    this._frameFaces = [];
    this._vertices = [];
    this._vertexMap = new Map();
    this._nextFaceId = 0;
    this._drawPrimitives = [];
    this._drawItemPool = [];
    this._galleryPhotoPool = [];
    this._visibleFacePool = [];
    this._vertexStamps = new Uint32Array(0);
    this._vertexStamp = 0;
    this._camForward = new Float32Array(0);
    this._camLateral = new Float32Array(0);
    this._camVertical = new Float32Array(0);
    this._screenX = new Float32Array(0);
    this._screenY = new Float32Array(0);
    this.lamps = [];
    this._gradients = Object.create(null);
    this._wakeTimer = null;
    this.galleryImage = null;
    this.paintingOverlay = null;
    this.paintingOverlayCtx = null;
    this.effectOverlay = null;
    this.effectOverlayCtx = null;
    this._galleryOverlayRect = null;
    this._effectOverlayRect = null;
    this._ambientTimer = null;
    this._ambientLastTime = 0;
    this._ambientInterval = 1000 / 18;
    this._ambientEnabled = false;
    this._ambientAllowed = true;
    this._prefersReducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this._dustSeeds = this._makeDustSeeds();
    this._initPaintingOverlay();
    this._initEffectsOverlay();
    if (typeof Image !== 'undefined') {
      this.galleryImage = new Image();
      this.galleryImage.decoding = 'async';
      this.galleryImage.onload = () => this.invalidate();
      this.galleryImage.onerror = () => {
        // Keep the original embedded artwork as the primary source, but recover
        // from a damaged data URI or a browser refusing that source by using
        // the byte-identical standalone project asset.
        if (!this._galleryFallbackTried) {
          this._galleryFallbackTried = true;
          this.galleryImage.src = 'assets/gallery-photo.png';
        }
      };
      this.galleryImage.src = window.GALLERY_ART_DATA || 'assets/gallery-photo.png';
    }

    const coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
    const memory = Number(navigator.deviceMemory || 4);
    // Intentionally conservative backing resolution: the software renderer is CPU-bound,
    // and reducing pixel count also reduces canvas compositing/bandwidth cost.
    this.maxScale = coarse ? 0.70 : memory <= 4 ? 0.75 : 0.82;
    this.maxPixels = coarse ? 260000 : memory <= 4 ? 340000 : 480000;
    this.renderScale = Math.min(window.devicePixelRatio || 1, this.maxScale);
    this.activeRenderScale = this.renderScale;
    this.resize = () => {
      const rect = this.canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || window.innerWidth || 1));
      const height = Math.max(1, Math.round(rect.height || window.innerHeight || 1));
      // Bound the backing store by total pixels, not only by devicePixelRatio. This
      // prevents 1440p/4K windows from silently creating multi-megapixel CPU canvases.
      const pixelBudgetScale = Math.sqrt(this.maxPixels / (width * height));
      const effectiveScale = Math.max(0.05, Math.min(this.renderScale, pixelBudgetScale, this.maxScale));
      const nextWidth = Math.max(1, Math.round(width * effectiveScale));
      const nextHeight = Math.max(1, Math.round(height * effectiveScale));
      this.width = width;
      this.height = height;
      this.activeRenderScale = effectiveScale;
      if (this.canvas.width !== nextWidth || this.canvas.height !== nextHeight) {
        this.canvas.width = nextWidth;
        this.canvas.height = nextHeight;
      }
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.ctx.setTransform(effectiveScale, 0, 0, effectiveScale, 0, 0);
      this._gradients = Object.create(null);
      this._fastFrames = 0;
      this._slowFrames = 0;
      this.invalidate();
    };
    this.resize();
    window.addEventListener('resize', this.resize, { passive: true });
    this._onVisibilityChange = () => {
      if (document.hidden) {
        if (this._raf != null) cancelAnimationFrame(this._raf);
        if (this._wakeTimer != null) clearTimeout(this._wakeTimer);
        this._raf = null;
        this._wakeTimer = null;
        this.lastTime = 0;
        this._stopAmbientLoop();
      } else {
        this.invalidate();
        this._startAmbientLoop();
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    this._bindPointer();
    this._bindPointerLock();

    this._loop = time => {
      this._raf = null;
      if (!this.rendering || document.hidden) return;
      const moving = !!(this.moveInput.x || this.moveInput.y);
      const jumping = this.jumpVelocity !== 0 || this.jumpHeight > 0;
      let moved = false;
      if (moving || jumping) {
        const elapsed = this.lastTime ? time - this.lastTime : this.frameMs;
        const delta = Math.min(0.05, Math.max(0, elapsed / 1000));
        this.lastTime = time;
        // Apply vertical motion before horizontal collision checks so a jump
        // clears low furniture on the very first simulated frame.
        if (this._stepJump(delta)) moved = true;
        if (this._move(delta)) moved = true;
      } else {
        this.lastTime = 0;
      }
      if (this._dirty) {
        const start = performance.now();
        this.render();
        this._dirty = false;
        this.lastFrame = time;
        this._adaptQuality(performance.now() - start);
      }
      // Simulation and rendering share a capped cadence. This avoids doing 60–144
      // collision/scheduling passes per second when the scene only renders at 24–30 FPS.
      if ((moved || this._dirty) && !document.hidden) this._scheduleFrame();
    };
    this.invalidate();
  }

  _scheduleFrame() {
    if (!this.rendering || document.hidden || this._raf != null || this._wakeTimer != null) return;
    const active = !!(this.moveInput.x || this.moveInput.y || this.jumpVelocity !== 0 || this.jumpHeight > 0);
    const elapsed = performance.now() - this.lastFrame;
    const delay = active ? Math.max(0, this.frameMs - elapsed) : 0;
    if (delay > 2) {
      this._wakeTimer = setTimeout(() => {
        this._wakeTimer = null;
        if (this.rendering && !document.hidden && this._raf == null) {
          this._raf = requestAnimationFrame(this._loop);
        }
      }, delay);
    } else {
      this._raf = requestAnimationFrame(this._loop);
    }
  }

  _initPaintingOverlay() {
    // Keep gallery artwork sharp even when the main software-rendered scene is
    // deliberately downscaled. The transparent overlay is cropped to the
    // visible painting bounds, so it does not allocate a second full-screen buffer.
    if (typeof document.createElement !== 'function') return;
    const parent = this.canvas.parentNode || document.body;
    if (!parent || typeof parent.insertBefore !== 'function') return;
    const overlay = document.createElement('canvas');
    overlay.setAttribute?.('aria-hidden', 'true');
    Object.assign(overlay.style, {
      position: 'fixed', pointerEvents: 'none', display: 'none',
      zIndex: '1', imageRendering: 'auto'
    });
    parent.insertBefore(overlay, this.canvas.nextSibling || null);
    this.paintingOverlay = overlay;
    this.paintingOverlayCtx = overlay.getContext('2d', { alpha: true, desynchronized: true });
    if (!this.paintingOverlayCtx) {
      overlay.remove?.();
      this.paintingOverlay = null;
    }
  }

  _initEffectsOverlay() {
    if (typeof document.createElement !== 'function') return;
    const parent = this.canvas.parentNode || document.body;
    if (!parent || typeof parent.insertBefore !== 'function') return;
    const overlay = document.createElement('canvas');
    overlay.setAttribute?.('aria-hidden', 'true');
    Object.assign(overlay.style, {
      position: 'fixed', pointerEvents: 'none', display: 'none',
      zIndex: '2', imageRendering: 'auto'
    });
    const anchor = this.paintingOverlay || this.canvas;
    parent.insertBefore(overlay, anchor.nextSibling || null);
    this.effectOverlay = overlay;
    this.effectOverlayCtx = overlay.getContext('2d', { alpha: true, desynchronized: true });
    if (!this.effectOverlayCtx) {
      overlay.remove?.();
      this.effectOverlay = null;
    }
  }

  _makeDustSeeds() {
    const seeds = [];
    for (let room = 0; room < 4; room++) {
      const count = room === 3 ? 16 : 12;
      for (let i = 0; i < count; i++) {
        seeds.push({
          room,
          x: (((i * 37 + room * 19) % 113) / 113) * 11.2 - 5.6,
          y: .55 + ((i * 17 + room * 7) % 31) / 10,
          z: room === 3 ? -13.2 - ((i * 23) % 132) / 10 : -5.1 + ((i * 23) % 102) / 10,
          phase: i * 1.731 + room * .91,
          speed: .24 + ((i * 11) % 17) / 34,
          size: .8 + ((i * 7) % 5) * .22
        });
      }
    }
    return seeds;
  }

  _startAmbientLoop() {
    if (!this._ambientEnabled || !this._ambientAllowed || this._prefersReducedMotion ||
        !this.rendering || document.hidden || !this.currentGame || !this.effectOverlayCtx || this._ambientTimer != null) return;
    const tick = () => {
      this._ambientTimer = null;
      if (!this._ambientEnabled || !this._ambientAllowed || this._prefersReducedMotion ||
          !this.rendering || document.hidden || !this.currentGame) return;
      const now = performance.now();
      const delta = this._ambientLastTime ? Math.min(.12, Math.max(0, (now - this._ambientLastTime) / 1000)) : this._ambientInterval / 1000;
      this._ambientLastTime = now;
      if (this._stepDrawerAnimations(delta)) this.invalidate();
      this._drawAmbientEffects(now);
      this._ambientTimer = setTimeout(tick, this._ambientInterval);
    };
    this._ambientTimer = setTimeout(tick, 0);
  }

  _stopAmbientLoop() {
    if (this._ambientTimer != null) clearTimeout(this._ambientTimer);
    this._ambientTimer = null;
    this._ambientLastTime = 0;
    if (this.effectOverlayCtx && this.effectOverlay) {
      this.effectOverlayCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.effectOverlayCtx.clearRect(0, 0, this.effectOverlay.width, this.effectOverlay.height);
      this.effectOverlay.style.display = 'none';
    }
  }

  _stepDrawerAnimations(delta) {
    let changed = false;
    for (const drawer of this.drawers) {
      const target = Number.isFinite(drawer.targetOffset) ? drawer.targetOffset : (drawer.open ? .48 : 0);
      if (Math.abs(target - drawer.offset) < .002) {
        if (drawer.offset !== target) drawer.offset = target;
        drawer.animating = false;
        continue;
      }
      const previous = drawer.offset;
      // Exponential easing is frame-rate independent and has no overshoot.
      const blend = 1 - Math.exp(-Math.max(.001, delta) * 12);
      drawer.offset += (target - drawer.offset) * blend;
      if (Math.abs(target - drawer.offset) < .006) {
        drawer.offset = target;
        drawer.animating = false;
      } else drawer.animating = true;
      const worldOffset = drawer.offset * Math.min(this.roomScaleZ, 1.25);
      for (const face of drawer.faces) {
        const base = face.drawerBaseZ || [];
        for (let i = 0; i < face.points.length; i++) face.points[i][2] = base[i] + worldOffset;
      }
      if (Math.abs(previous - drawer.offset) > .0001) changed = true;
    }
    return changed;
  }

  _roomWorldPoint(room, x, y, z) {
    if (room === 3) return {
      x: this.roomOffsets[2] + x * this.libraryScaleX,
      y,
      z: LIBRARY_WORLD_OFFSET_Z + z * this.libraryScaleZ
    };
    return {
      x: this.roomOffsets[room] + x * MAIN_ROOM_SCALE,
      y,
      z: z * MAIN_ROOM_SCALE
    };
  }

  _drawAmbientEffects(now) {
    const overlay = this.effectOverlay, ctx = this.effectOverlayCtx;
    if (!overlay || !ctx || !this.currentGame) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = this.width, height = this.height;
    const budgetScale = Math.sqrt(260000 / Math.max(1, width * height));
    const scale = Math.max(.05, Math.min(window.devicePixelRatio || 1, budgetScale, 1.2));
    const pixelWidth = Math.max(1, Math.round(width * scale));
    const pixelHeight = Math.max(1, Math.round(height * scale));
    if (overlay.width !== pixelWidth) overlay.width = pixelWidth;
    if (overlay.height !== pixelHeight) overlay.height = pixelHeight;
    const cached = this._effectOverlayRect;
    if (!cached || cached.left !== rect.left || cached.top !== rect.top || cached.width !== width || cached.height !== height) {
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      this._effectOverlayRect = { left: rect.left, top: rect.top, width, height };
    }
    overlay.style.display = 'block';
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const seconds = now * .001;
    const activeRoom = this.renderRoomIndex ?? (this.isInLibrary() ? 3 : this._physicalRoomForX(this.camera.x));

    // Subtle floating dust gives the rooms depth without forcing the main
    // geometry renderer to redraw. Seeds are fixed and reused between frames.
    for (const mote of this._dustSeeds) {
      if (mote.room !== activeRoom) continue;
      const drift = seconds * mote.speed + mote.phase;
      const localX = mote.x + Math.sin(drift) * .12;
      const localY = mote.y + Math.sin(drift * .73) * .20 + ((seconds * mote.speed * .035) % 1) * .12;
      const localZ = mote.z + Math.cos(drift * .81) * .11;
      const world = this._roomWorldPoint(activeRoom, localX, localY, localZ);
      const point = this._project(world.x, world.y, world.z);
      if (!point || point.depth > 15 || point.x < -4 || point.x > width + 4 || point.y < -4 || point.y > height + 4) continue;
      const pulse = .5 + .5 * Math.sin(drift * 1.7);
      ctx.globalAlpha = (this.dark ? .10 : .12) + pulse * (this.dark ? .16 : .10);
      ctx.fillStyle = '#f1d9ae';
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(.65, Math.min(2, point.scale * .009 * mote.size)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Warm lamp halos pulse gently. Only three projected points are evaluated
    // per room, and the effect layer is capped independently of device DPR.
    for (let i = 0; activeRoom !== 3 && i < this.lamps.length; i++) {
      const lamp = this.lamps[i];
      if (this._physicalRoomForX(lamp.x) !== activeRoom) continue;
      const point = this._project(lamp.x, lamp.y, lamp.z);
      if (!point || point.depth > 18) continue;
      const pulse = .5 + .5 * Math.sin(seconds * 1.35 + i * 1.9);
      const radius = Math.max(2, Math.min(14, point.scale * .045));
      ctx.globalAlpha = (this.dark ? (this.torch ? .13 : .045) : .07) + pulse * .07;
      ctx.fillStyle = '#ffd89b';
      ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(1.2, radius * .18), 0, Math.PI * 2);
      ctx.fillStyle = '#ffe9c1'; ctx.fill();
    }

    if (activeRoom === 0) this._drawClockEffect(ctx, seconds);
    if (activeRoom === 2) this._drawFanEffect(ctx, seconds);
    if (activeRoom === 1) this._drawGalleryGlints(ctx, seconds);
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  _drawClockEffect(ctx, seconds) {
    const world = this._roomWorldPoint(0, -5.55, 2.62, -5.56);
    const point = this._project(world.x, world.y, world.z);
    if (!point || point.depth > 17 || point.x < -48 || point.x > this.width + 48 || point.y < -48 || point.y > this.height + 48) return;
    const radius = Math.max(7, Math.min(27, point.scale * .14));
    const minute = ((seconds / 60) % 60) / 60 * Math.PI * 2 - Math.PI / 2;
    const hour = ((seconds / 3600) % 12) / 12 * Math.PI * 2 - Math.PI / 2;
    const second = (seconds % 60) / 60 * Math.PI * 2 - Math.PI / 2;
    ctx.save(); ctx.translate(point.x, point.y);
    ctx.fillStyle = 'rgba(14,20,21,.86)'; ctx.beginPath(); ctx.arc(0,0,radius+2,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#d8c49c'; ctx.beginPath(); ctx.arc(0,0,radius,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#60472e'; ctx.lineWidth = Math.max(.8,radius*.075);
    for (let i=0;i<12;i++) {
      const angle = i*Math.PI/6;
      ctx.beginPath(); ctx.moveTo(Math.cos(angle)*radius*.76,Math.sin(angle)*radius*.76);
      ctx.lineTo(Math.cos(angle)*radius*.91,Math.sin(angle)*radius*.91); ctx.stroke();
    }
    ctx.strokeStyle = '#493629'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1,radius*.10);
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(hour)*radius*.42,Math.sin(hour)*radius*.42); ctx.stroke();
    ctx.lineWidth = Math.max(.7,radius*.065); ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(minute)*radius*.68,Math.sin(minute)*radius*.68); ctx.stroke();
    ctx.strokeStyle = '#a44f39'; ctx.lineWidth = Math.max(.55,radius*.025);
    ctx.beginPath(); ctx.moveTo(-Math.cos(second)*radius*.16,-Math.sin(second)*radius*.16);
    ctx.lineTo(Math.cos(second)*radius*.78,Math.sin(second)*radius*.78); ctx.stroke();
    ctx.fillStyle = '#493629'; ctx.beginPath(); ctx.arc(0,0,Math.max(1,radius*.06),0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  _drawFanEffect(ctx, seconds) {
    const world = this._roomWorldPoint(2, -5.55, 3.12, -5.64);
    const point = this._project(world.x, world.y, world.z);
    if (!point || point.depth > 15 || point.x < -48 || point.x > this.width + 48 || point.y < -48 || point.y > this.height + 48) return;
    const radius = Math.max(8, Math.min(26, point.scale * .15));
    ctx.save(); ctx.translate(point.x, point.y);
    ctx.fillStyle = 'rgba(13,20,19,.88)'; ctx.beginPath(); ctx.arc(0,0,radius+2,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#98784e'; ctx.lineWidth = Math.max(1,radius*.10); ctx.beginPath(); ctx.arc(0,0,radius,0,Math.PI*2); ctx.stroke();
    ctx.rotate(seconds * 1.35);
    for (let i=0;i<3;i++) {
      ctx.rotate(Math.PI*2/3);
      ctx.fillStyle = '#8d7653'; ctx.strokeStyle = '#c0a16e'; ctx.lineWidth = Math.max(.6,radius*.035);
      ctx.beginPath(); ctx.moveTo(0,-radius*.12); ctx.quadraticCurveTo(radius*.16,-radius*.56,radius*.74,-radius*.70);
      ctx.quadraticCurveTo(radius*.62,-radius*.15,radius*.08,radius*.12); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#c8aa78'; ctx.beginPath(); ctx.arc(0,0,radius*.16,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  _drawGalleryGlints(ctx, seconds) {
    if (this.dark && !this.torch) return;
    const xs = [-4.2,-1.8,1.8,4.2];
    for (let i=0;i<xs.length;i++) {
      const x = xs[i];
      const centerX = this.roomOffsets[1] + x * MAIN_ROOM_SCALE;
      const centerZ = -5.65 * MAIN_ROOM_SCALE + .12 * 1.25;
      const corners = [
        { x: centerX - .58 * 1.25, y: 1.56, z: centerZ },
        { x: centerX + .58 * 1.25, y: 1.56, z: centerZ },
        { x: centerX + .58 * 1.25, y: 2.72, z: centerZ },
        { x: centerX - .58 * 1.25, y: 2.72, z: centerZ }
      ].map(p => this._project(p.x,p.y,p.z));
      if (corners.some(p => !p || p.depth > 20)) continue;
      const progress = (seconds * .075 + i * .27) % 1;
      const x1 = corners[0].x + (corners[1].x - corners[0].x) * progress;
      const y1 = corners[0].y + (corners[1].y - corners[0].y) * progress;
      const x2 = corners[3].x + (corners[2].x - corners[3].x) * progress;
      const y2 = corners[3].y + (corners[2].y - corners[3].y) * progress;
      ctx.save(); ctx.beginPath();
      ctx.moveTo(corners[0].x,corners[0].y); ctx.lineTo(corners[1].x,corners[1].y);
      ctx.lineTo(corners[2].x,corners[2].y); ctx.lineTo(corners[3].x,corners[3].y); ctx.closePath(); ctx.clip();
      ctx.globalAlpha = .11; ctx.strokeStyle = '#fff4d8'; ctx.lineWidth = Math.max(2, Math.min(5, Math.abs(x2-x1) * .015 + 2));
      ctx.beginPath(); ctx.moveTo(x1-12,y1+12); ctx.lineTo(x2+12,y2-12); ctx.stroke();
      ctx.restore();
    }
  }

  _bindPointerLock() {
    this._onPointerLockChange = () => {
      const locked = document.pointerLockElement === this.canvas;
      const changed = locked !== this.pointerLocked;
      this.pointerLocked = locked;
      this.drag = null;
      this.mouseDown = false;
      if (changed) {
        this.onLockChange(locked);
        this.invalidate();
      }
    };
    this._onPointerLockError = () => {
      this.pointerLockFailed = true;
      this.onLockChange(false, 'Mouse capture was blocked. Click the scene to retry, or drag to look.');
      this.invalidate();
    };
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    document.addEventListener('pointerlockerror', this._onPointerLockError);
  }

  _requestPointerLock(pointerId = null) {
    if (!this.pointerLockEnabled || this.pointerLocked || document.hidden) return;
    this.lockRequestPointerId = pointerId;
    this.pointerLockFailed = false;
    if (typeof this.canvas.requestPointerLock !== 'function') {
      this._pointerLockFallback();
      return;
    }
    try {
      // Use the baseline call first. Optional raw-input flags fail on some browser/OS combinations.
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') {
        result.catch(() => this._pointerLockFallback());
      }
    } catch {
      this._pointerLockFallback();
    }
  }

  requestPointerLockFromGesture() {
    // Must be called synchronously from a click/tap/keyboard gesture.
    this._requestPointerLock(null);
  }

  _pointerLockFallback() {
    this.pointerLockFailed = true;
    this.onLockChange(false, 'Mouse capture is unavailable. Drag the scene to look around.');
    this.invalidate();
  }

  setPointerLockEnabled(enabled) {
    this.pointerLockEnabled = !!enabled;
    if (!this.pointerLockEnabled) this.releasePointerLock();
  }

  releasePointerLock() {
    if (document.pointerLockElement === this.canvas && document.exitPointerLock) document.exitPointerLock();
  }

  _bindPointer() {
    this.canvas.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') {
        if (event.button !== 0) return;
        if (this.pointerLocked) {
          this.mouseDown = true;
          return;
        }
        if (this.pointerLockEnabled) {
          if (this.pointerLockFailed) {
            // Preserve drag-to-look fallback while allowing every new gesture to retry lock.
            this.drag = {
              x: event.clientX, y: event.clientY,
              lastX: event.clientX, lastY: event.clientY,
              moved: false, id: event.pointerId, type: event.pointerType
            };
            try { this.canvas.setPointerCapture(event.pointerId); } catch { /* optional */ }
          }
          this._requestPointerLock(event.pointerId);
          return;
        }
      }
      this.drag = {
        x: event.clientX, y: event.clientY,
        lastX: event.clientX, lastY: event.clientY,
        moved: false, id: event.pointerId, type: event.pointerType
      };
      try { this.canvas.setPointerCapture(event.pointerId); } catch { /* optional */ }
    });

    this.canvas.addEventListener('pointermove', event => {
      if (this.pointerLocked && event.pointerType === 'mouse') {
        const dx = Number(event.movementX || 0);
        const dy = Number(event.movementY || 0);
        this._look(dx, dy, 0.0036);
        this._focusCenter();
        return;
      }
      if (!this.drag || this.drag.id !== event.pointerId) {
        if (event.pointerType === 'mouse') this._focusAt(event.clientX, event.clientY);
        return;
      }
      const dx = event.clientX - this.drag.lastX;
      const dy = event.clientY - this.drag.lastY;
      if (Math.abs(event.clientX - this.drag.x) + Math.abs(event.clientY - this.drag.y) > 7) this.drag.moved = true;
      if (this.drag.moved) this._look(dx, dy, event.pointerType === 'touch' ? 0.0039 : 0.0036);
      this.drag.lastX = event.clientX;
      this.drag.lastY = event.clientY;
    });

    this.canvas.addEventListener('pointerup', event => {
      if (this.pointerLocked && event.pointerType === 'mouse') {
        if (event.button !== 0) return;
        this.mouseDown = false;
        if (this.lockRequestPointerId === event.pointerId) { this.lockRequestPointerId = null; return; }
        const hit = this._nearestHotspot(this.width * 0.5, this.height * 0.5);
        if (hit) this.onInteract(hit.id);
        return;
      }
      if (this.lockRequestPointerId === event.pointerId) this.lockRequestPointerId = null;
      if (!this.drag || this.drag.id !== event.pointerId) return;
      const wasTap = !this.drag.moved;
      this.drag = null;
      if (wasTap) {
        const rect = this.canvas.getBoundingClientRect();
        const hit = this._nearestHotspot(event.clientX - rect.left, event.clientY - rect.top);
        if (hit) this.onInteract(hit.id);
      }
    });
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; this.mouseDown = false; });
    this.canvas.addEventListener('contextmenu', event => event.preventDefault());
  }

  _look(dx, dy, sensitivity) {
    if (!dx && !dy) return;
    this.yaw -= dx * sensitivity;
    this.pitch = Math.max(-0.72, Math.min(0.72, this.pitch - dy * sensitivity));
    this.invalidate();
  }

  _cameraPoint(x, y, z) {
    const dx = x - this.camera.x;
    const dz = z - this.camera.z;
    return {
      forward: dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw),
      lateral: dx * Math.cos(this.yaw) + dz * -Math.sin(this.yaw),
      vertical: y - this.camera.y
    };
  }

  _projectCamera(point) {
    // Derive focal length from viewport height; using min(width,height) creates severe portrait distortion.
    const focal = this.height * 0.90; // restored original horizontal framing
    const scale = focal / point.forward;
    return {
      x: this.width * 0.5 + point.lateral * scale,
      // Positive pitch is looking upward: the horizon must move downward on screen.
      y: this.height * 0.54 - (point.vertical - Math.tan(this.pitch) * point.forward) * scale,
      depth: point.forward,
      scale
    };
  }

  _project(x, y, z) {
    const point = this._cameraPoint(x, y, z);
    if (point.forward < 0.12) return null;
    return this._projectCamera(point);
  }

  _poly(points, fill, stroke = null, texture = null, metadata = null) {
    const offsetX = this._worldOffsetX || 0;
    const sx = this.roomScaleX || 1;
    const sz = this.roomScaleZ || 1;
    const offsetZ = this._worldOffsetZ || 0;
    const worldPoints = metadata?.worldCoordinates
      ? points.map(point => [point[0], point[1], point[2]])
      : points.map(point => [point[0] * sx + offsetX, point[1], point[2] * sz + offsetZ]);
    points = worldPoints;
    const a = points[0], b = points[1], c = points[2];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const invLength = 1 / (Math.hypot(nx, ny, nz) || 1);
    let cx = 0, cy = 0, cz = 0;
    const indices = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      cx += point[0]; cy += point[1]; cz += point[2];
      const key = `${point[0]}|${point[1]}|${point[2]}`;
      let index;
      if (metadata?.noVertexDedup) {
        // Sliding drawer parts need private vertices so their transforms never
        // drag an adjacent cabinet face that happens to share the same corner.
        index = this._vertices.length;
        this._vertices.push(point);
      } else {
        index = this._vertexMap.get(key);
        if (index === undefined) {
          index = this._vertices.length;
          this._vertexMap.set(key, index);
          this._vertices.push(point);
        }
      }
      indices[i] = index;
    }
    const invCount = 1 / points.length;
    const face = {
      points, indices, fill, stroke, texture, layer: this._activeLayer ?? 0,
      cx: cx * invCount, cy: cy * invCount, cz: cz * invCount,
      nx: nx * invLength, ny: ny * invLength, nz: nz * invLength,
      _depth: 0, _visible: false,
      faceId: this._nextFaceId++,
      roomIndex: this._buildingRoomIndex ?? 0,
      zone: this._activeZone || 'room',
      doorBarrier: this._activeDoorBarrier ?? null,
      lockBarrier: this._activeLockBarrier ?? null,
      objectTag: this._activeObjectTag ?? null,
      ...(metadata || {})
    };
    this._geometry.push(face);
    if (face.drawerMove && face.drawerId && this.drawerById?.has(face.drawerId)) {
      face.drawerBaseZ = face.points.map(point => point[2]);
      this.drawerById.get(face.drawerId).faces.push(face);
    }
    return face;
  }

  _polyRoomLength(points, centerZ, fill, stroke = null, texture = null, metadata = null) {
    const sx = this.roomScaleX || 1, sz = this.roomScaleZ || 1;
    const sizeSZ = Math.min(sz, 1.25);
    const worldPoints = points.map(point => [
      point[0] * sx + (this._worldOffsetX || 0),
      point[1],
      centerZ * sz + (this._worldOffsetZ || 0) + (point[2] - centerZ) * sizeSZ
    ]);
    return this._poly(worldPoints, fill, stroke, texture, { ...(metadata || {}), worldCoordinates: true });
  }

  _polyFixed(points, centerX, centerZ, fill, stroke = null, texture = null, metadata = null) {
    const sx = this.roomScaleX || 1, sz = this.roomScaleZ || 1;
    const sizeSX = Math.min(sx, 1.25), sizeSZ = Math.min(sz, 1.25);
    const worldCenterX = centerX * sx + (this._worldOffsetX || 0);
    const worldCenterZ = centerZ * sz + (this._worldOffsetZ || 0);
    const worldPoints = points.map(point => [
      worldCenterX + (point[0] - centerX) * sizeSX,
      point[1],
      worldCenterZ + (point[2] - centerZ) * sizeSZ
    ]);
    return this._poly(worldPoints, fill, stroke, texture, { ...(metadata || {}), worldCoordinates: true });
  }

  _polyObjectFixed(points, centerX, centerZ, fill, stroke = null, texture = null, metadata = null) {
    // Props use a uniform object-space transform: both their centers and their
    // dimensions stay at the original 1.25x physical scale. Room shells continue
    // to use the larger room transform in _poly(). This keeps nested parts such
    // as drawer fronts, table tops, papers and their hit targets aligned.
    const sx = Math.min(this.roomScaleX || 1, 1.25);
    const sz = Math.min(this.roomScaleZ || 1, 1.25);
    const worldCenterX = centerX * sx + (this._worldOffsetX || 0);
    const worldCenterZ = centerZ * sz + (this._worldOffsetZ || 0);
    const worldPoints = points.map(point => [
      worldCenterX + (point[0] - centerX) * sx,
      point[1],
      worldCenterZ + (point[2] - centerZ) * sz
    ]);
    return this._poly(worldPoints, fill, stroke, texture, { ...(metadata || {}), worldCoordinates: true });
  }

  _roomBox(x, y, z, width, height, depth, color, accent = null) {
    this._boxRoomAnchored = true;
    try { this._box(x, y, z, width, height, depth, color, accent); }
    finally { this._boxRoomAnchored = false; }
  }

  _box(x, y, z, width, height, depth, color, accent = null) {
    const x0 = x - width / 2, x1 = x + width / 2;
    const y0 = y, y1 = y + height;
    const z0 = z - depth / 2, z1 = z + depth / 2;
    // Box faces are stored with consistent winding. Furniture and its parts
    // stay in object space; wall-mounted/ceiling fixtures opt into room scale.
    const fixedPoly = this._boxRoomAnchored ? this._polyFixed.bind(this) : this._polyObjectFixed.bind(this);
    const firstFace = this._geometry.length;
    fixedPoly([[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0]], x, z, shade(color, 0.62));
    fixedPoly([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], x, z, color, 'rgba(16,20,20,.4)');
    fixedPoly([[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]], x, z, shade(color, 1.2));
    fixedPoly([[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]], x, z, shade(color, 0.72));
    fixedPoly([[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]], x, z, shade(color, 0.84));
    if (accent) {
      fixedPoly([[x0,y1-0.07,z1+0.006],[x1,y1-0.07,z1+0.006],[x1,y1,z1+0.006],[x0,y1,z1+0.006]], x, z, accent);
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = firstFace; i < this._geometry.length; i++) {
      for (const point of this._geometry[i].points) {
        if (point[0] < minX) minX = point[0]; if (point[0] > maxX) maxX = point[0];
        if (point[1] < minY) minY = point[1]; if (point[1] > maxY) maxY = point[1];
        if (point[2] < minZ) minZ = point[2]; if (point[2] > maxZ) maxZ = point[2];
      }
    }
    const mx = (minX + maxX) / 2, my = (minY + maxY) / 2, mz = (minZ + maxZ) / 2;
    for (let i = firstFace; i < this._geometry.length; i++) {
      const face = this._geometry[i];
      if (Math.abs(face.ny) > 0.5) continue;
      const outward = (face.cx - mx) * face.nx + (face.cy - my) * face.ny + (face.cz - mz) * face.nz;
      face.solidSide = outward >= 0 ? 1 : -1;
      face.solidBottom = minY;
    }
  }

  _buildWorkTable(x, z, width, height, depth, palette = {}) {
    const top = palette.top || '#76563a';
    const apron = palette.apron || '#533a29';
    const legs = palette.legs || '#493324';
    const accent = palette.accent || '#a17a4d';
    const legW = .12;
    const insetX = width * .40;
    const insetZ = depth * .39;
    // Thick, continuous top; four legs; and two aprons make a walk-up desk.
    this._box(x, height, z, width, .105, depth, top, accent);
    for (const dx of [-insetX, insetX]) {
      for (const dz of [-insetZ, insetZ]) {
        this._box(x + dx, 0, z + dz, legW, height, legW, legs);
      }
    }
    this._box(x, height * .67, z - depth * .40, width * .82, height * .18, .10, apron);
    this._box(x, height * .67, z + depth * .40, width * .82, height * .18, .10, apron);
    // A lower stretcher gives the desk visual weight without adding a collider.
    this._box(x, height * .24, z, width * .72, .075, .09, shade(legs, 1.14));
  }

  _focusAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const hit = this._nearestHotspot(clientX - rect.left, clientY - rect.top);
    this._setFocus(hit);
  }

  _focusCenter() {
    this._setFocus(this._nearestHotspot(this.width * 0.5, this.height * 0.5));
  }

  _setFocus(hit) {
    const id = hit?.id || null;
    if (id !== this.focused) {
      this.focused = id;
      this.onFocus(id, hit?.label || '');
    }
  }

  _screenPointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      const crosses = ((a.y > y) !== (b.y > y)) &&
        (x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-9) + a.x);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  _polygonDepthAt(x, y, points) {
    if (points.length < 3) return null;
    const p0 = points[0];
    for (let i = 1; i < points.length - 1; i++) {
      const p1 = points[i], p2 = points[i + 1];
      const denominator = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
      if (Math.abs(denominator) < 1e-9) continue;
      const a = ((p1.y - p2.y) * (x - p2.x) + (p2.x - p1.x) * (y - p2.y)) / denominator;
      const b = ((p2.y - p0.y) * (x - p2.x) + (p0.x - p2.x) * (y - p2.y)) / denominator;
      const c = 1 - a - b;
      if (a < -1e-5 || b < -1e-5 || c < -1e-5) continue;
      // Perspective-correct interpolation is linear in reciprocal camera depth.
      const inverseDepth = a / p0.depth + b / p1.depth + c / p2.depth;
      return inverseDepth > 0 ? 1 / inverseDepth : null;
    }
    return null;
  }

  _isScreenPointOccluded(x, y, depth, tolerance = 0.24) {
    // A hotspot/label is hidden only when a nearer projected polygon covers
    // the point. Interpolate reciprocal depth at that exact screen coordinate
    // rather than comparing polygon-average depth, which can hide visible edges.
    const limit = depth - tolerance;
    for (const face of this._frameFaces) {
      if (face.layer < 0 || !face.points) continue;
      const bounds = face._screenBounds;
      if (face._nearDepth !== undefined && face._nearDepth >= limit) continue;
      if (bounds && (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY)) continue;
      const points = face._framePoints || [];
      if (!this._screenPointInPolygon(x, y, points)) continue;
      const surfaceDepth = this._polygonDepthAt(x, y, points);
      if (surfaceDepth != null && surfaceDepth < depth - tolerance) return true;
    }
    return false;
  }

  _nearestHotspot(x, y) {
    let best = null;
    let bestDistance = 43;
    for (const point of this.projectedHotspots) {
      if (point.worldDistance > (point.discoverRange || 8.5)) continue;
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance < bestDistance) { best = point; bestDistance = distance; }
    }
    return best;
  }

  setMovement(x, y) {
    this.moveInput.x = Math.max(-1, Math.min(1, x));
    this.moveInput.y = Math.max(-1, Math.min(1, y));
    if (x || y) this.lastTime = 0;
    this.invalidate();
  }

  setRendering(enabled) {
    this.rendering = !!enabled;
    this._ambientEnabled = this.rendering;
    if (!this.rendering) {
      if (this._raf != null) cancelAnimationFrame(this._raf);
      if (this._wakeTimer != null) clearTimeout(this._wakeTimer);
      this._raf = null;
      this._wakeTimer = null;
      this._stopAmbientLoop();
      this.setMovement(0, 0);
    } else {
      this.invalidate();
      this._startAmbientLoop();
    }
  }

  invalidate() {
    this._dirty = true;
    if (this.rendering && this._loop) this._scheduleFrame();
  }

  _adaptQuality(renderMs) {
    if (renderMs > 19 && this.renderScale > 0.38) {
      this._slowFrames = (this._slowFrames || 0) + 1;
      this._fastFrames = 0;
      if (this._slowFrames >= 5) {
        this._slowFrames = 0;
        this._setRenderScale(Math.max(0.38, this.renderScale - 0.08));
        if (renderMs > 30) this.frameMs = 1000 / 24;
      }
    } else if (renderMs < 11 && this.renderScale < Math.min(this.maxScale, window.devicePixelRatio || 1)) {
      this._fastFrames = (this._fastFrames || 0) + 1;
      this._slowFrames = 0;
      if (this._fastFrames >= 150) {
        this._fastFrames = 0;
        this._setRenderScale(Math.min(this.maxScale, window.devicePixelRatio || 1, this.renderScale + 0.025));
        this.frameMs = 1000 / 30;
      }
    } else {
      this._slowFrames = Math.max(0, (this._slowFrames || 0) - 1);
      this._fastFrames = 0;
    }
  }

  _setRenderScale(value) {
    const next = Math.max(0.42, Math.min(1.8, value));
    if (Math.abs(next - this.renderScale) < 0.005) return;
    this.renderScale = next;
    this.resize();
  }

  _circleHitsBox(x, z, box) {
    const closestX = Math.max(box.minX, Math.min(x, box.maxX));
    const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
    const dx = x - closestX, dz = z - closestZ;
    return dx * dx + dz * dz < this.playerRadius * this.playerRadius;
  }

  _canOccupy(x, z) {
    const r = this.playerRadius;
    if (x < this.bounds.minX + r || x > this.bounds.maxX - r || z < this.bounds.minZ + r || z > this.bounds.maxZ - r) return false;
    const feet = this.groundHeight + this.jumpHeight;
    for (const box of this.colliders) {
      // Once the player's feet are at or above a low object's top, its sides
      // no longer block horizontal movement. This permits walking across it.
      if (feet >= (box.height || 4.5) - 0.08) continue;
      if (this._circleHitsBox(x, z, box)) return false;
    }
    return true;
  }

  _hasPlatformSupport(x, z, height = this.groundHeight) {
    return this.colliders.some(box => box.platformable &&
      Math.abs(box.height - height) < 0.12 && this._circleHitsBox(x, z, box));
  }

  _refreshPlatformSupport() {
    if (this.groundHeight > 0 && this.jumpHeight === 0 && !this._hasPlatformSupport(this.camera.x, this.camera.z)) {
      // Step off a raised object: fall smoothly back to the room floor.
      this.jumpHeight = this.groundHeight;
      this.groundHeight = 0;
      this.jumpVelocity = 0;
      this._dirty = true;
    }
  }

  _move(delta) {
    if (this.seated) return false;
    const { x, y } = this.moveInput;
    if (!x && !y) return false;
    const length = Math.hypot(x, y);
    const nx = length > 1 ? x / length : x;
    const ny = length > 1 ? y / length : y;
    const speed = (this.jumpHeight > 0.12 ? 6.0 : 4.05) * delta;
    const dx = (-Math.sin(this.yaw) * ny + Math.cos(this.yaw) * nx) * speed;
    const dz = (-Math.cos(this.yaw) * ny - Math.sin(this.yaw) * nx) * speed;
    if (Math.abs(dx) + Math.abs(dz) < 1e-8) return false;
    // Substeps prevent fast movement from tunnelling through thin props.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.08));
    const stepX = dx / steps, stepZ = dz / steps;
    let moved = false;
    for (let i = 0; i < steps; i++) {
      const nextX = this.camera.x + stepX;
      if (Math.abs(stepX) > 1e-9 && this._canOccupy(nextX, this.camera.z)) { this.camera.x = nextX; moved = true; }
      const nextZ = this.camera.z + stepZ;
      if (Math.abs(stepZ) > 1e-9 && this._canOccupy(this.camera.x, nextZ)) { this.camera.z = nextZ; moved = true; }
    }
    if (moved) {
      this._refreshPlatformSupport();
      this.camera.y = this.eyeHeight + this.groundHeight + this.jumpHeight;
      this._notifyAreaChanged();
      this._dirty = true;
    }
    return moved;
  }

  _addCollider(x, z, width, depth, height = 4.5, platformable = height <= 2.2, scaleWidth = false, scaleDepth = false) {
    const sx = this.roomScaleX || 1, sz = this.roomScaleZ || 1;
    const sizeSX = scaleWidth ? sx : Math.min(sx, 1.25);
    const sizeSZ = scaleDepth ? sz : Math.min(sz, 1.25);
    const wallAnchored = !!(scaleWidth || scaleDepth);
    const positionSX = wallAnchored ? sx : Math.min(sx, 1.25);
    const positionSZ = wallAnchored ? sz : Math.min(sz, 1.25);
    const worldX = x * positionSX + (this._worldOffsetX || 0);
    const worldZ = z * positionSZ + (this._worldOffsetZ || 0);
    this.colliders.push({
      minX: worldX - width * sizeSX / 2, maxX: worldX + width * sizeSX / 2,
      minZ: worldZ - depth * sizeSZ / 2, maxZ: worldZ + depth * sizeSZ / 2,
      height, platformable: !!platformable
    });
  }

  _buildColliders() {
    this.colliders = [];
    // The three museum rooms use a compact 1.5x floor-plan scale. Props retain
    // their 1.25x object-space size and are distributed across the floor plan.
    this.roomScaleX = MAIN_ROOM_SCALE; this.roomScaleZ = MAIN_ROOM_SCALE; this._worldOffsetZ = 0;
    for (let roomIndex = 0; roomIndex < 3; roomIndex++) {
      this.roomKind = this.mapKinds[roomIndex];
      this._worldOffsetX = this.roomOffsets[roomIndex];
      if (this.roomKind === 'vocab') {
        this._addCollider(-3.15, -2.2, 2.45, 1.25, 1.55);
        this._addCollider(0, -2.15, 1.45, 1.2, 1.2);
        this._addCollider(3.12, -2.17, 2.45, 1.2, 1.35);
        this._addCollider(-5, 1.45, 2.2, 0.6, .62);
        // Five added Ticket Hall work tables. Their collision footprints match
        // the same unchanged object scale used by the visible geometry.
        this._addCollider(-4.25, -.15, 1.9, 1.15, .90, true);
        this._addCollider(-.10, 3.15, 2.05, 1.20, .90, true);
        this._addCollider(4.25, -.10, 1.85, 1.15, .90, true);
        this._addCollider(-5.0, -4.1, 1.9, 1.0, .88, true);
        this._addCollider(5.0, -4.1, 1.9, 1.0, .88, true);
        // Two inner archive desks added to fill the central/rear search area.
        this._addCollider(-2.15, -4.8, 1.8, 1.05, .86, true);
        this._addCollider(2.15, -4.8, 1.8, 1.05, .86, true);
        this._addCollider(-2.15, -3.45, .78, .78, 1.55, false);
        this._addCollider(2.15, -3.45, .78, .78, 1.55, false);
        this._addCollider(-5.0, -2.8, .78, .78, 1.55, false);
        this._addCollider(5.0, -2.8, .78, .78, 1.55, false);
      } else if (this.roomKind === 'reading') {
        this._addCollider(0, -2.45, 6.5, 1.0, .82);
        for (const x of [-5,-2.5,0,2.5,5]) this._addCollider(x, 1.1, .9, .9, 1.5, false);
      } else {
        this._addCollider(-3.7, -2.45, 2.7, 1.3, 2.15);
        this._addCollider(0, -2.35, 1.8, 1.5, 1.1);
        this._addCollider(3.45, -2.15, 2.8, .15, 1.45);
        this._addCollider(1.9, .25, 1.25, 1.1, .95);
        // Two compact archive worktables provide real surfaces for the loose
        // Storeroom clues. Their footprints match the geometry below.
        this._addCollider(-3.0, 3.65, 2.2, 1.1, .88, true);
        this._addCollider(3.0, 3.65, 2.2, 1.1, .88, true);
        for (const x of [-5.7,5.7]) this._addCollider(x,-1.0,.34,1.35,3.15);
      }
      this._addCollider(-5.05, 2.8, .78, .78, 1.55, false);
      this._addCollider(5.05, 2.8, .78, .78, 1.55, false);
      this._addCollider(0, 6, 14, .28, 4.5, false, true, false);
      if (roomIndex === 2) {
        const rearPortalHalf = 1.6 * 1.25 / this.roomScaleX;
        const rearSegmentWidth = 7 - rearPortalHalf;
        const rearSegmentCenter = (7 + rearPortalHalf) / 2;
        this._addCollider(-rearSegmentCenter,-6,rearSegmentWidth,.28,4.5,false,true,false);
        this._addCollider(rearSegmentCenter,-6,rearSegmentWidth,.28,4.5,false,true,false);
        if (!this.libraryDoorOpen) this._addCollider(0,-6,3.2,.34,3.15);
      } else this._addCollider(0,-6,14,.28,4.5,false,true,false);
    }
    // First room outer west wall.
    this._worldOffsetX = this.roomOffsets[0];
    this._addCollider(-7,0,.28,12,4.5,false,false,true);
    // Two east-west doorways between the three expanded museum rooms.
    for (let i=0;i<2;i++) {
      this._worldOffsetX = this.roomOffsets[i];
      const portalHalfZ = 1.3 * 1.25 / this.roomScaleZ;
      const sideSegmentLength = 6 - portalHalfZ;
      const sideSegmentCenter = (6 + portalHalfZ) / 2;
      this._addCollider(7,-sideSegmentCenter,.28,sideSegmentLength,4.5,false,false,true);
      this._addCollider(7,sideSegmentCenter,.28,sideSegmentLength,4.5,false,false,true);
      if (!this.doorOpen[i]) this._addCollider(7,0,.34,3.25,3.15,false,false,true);
    }
    // Gallery and storeroom west-side door surrounds.
    for (let i=1;i<3;i++) {
      this._worldOffsetX = this.roomOffsets[i];
      const portalHalfZ = 1.3 * 1.25 / this.roomScaleZ;
      const sideSegmentLength = 6 - portalHalfZ;
      const sideSegmentCenter = (6 + portalHalfZ) / 2;
      this._addCollider(-7,-sideSegmentCenter,.28,sideSegmentLength,4.5,false,false,true);
      this._addCollider(-7,sideSegmentCenter,.28,sideSegmentLength,4.5,false,false,true);
    }
    // The two room-to-room corridors are kept to the physical doorway width.
    // Their side walls are world-space geometry between the enlarged room shells.
    this.roomScaleX = 1; this.roomScaleZ = 1; this._worldOffsetX = 0; this._worldOffsetZ = 0;
    for (let i = 0; i < 2; i++) {
      const leftX = this.roomOffsets[i] + 7 * MAIN_ROOM_SCALE;
      const rightX = this.roomOffsets[i + 1] - 7 * MAIN_ROOM_SCALE;
      const halfWidth = 1.3 * 1.25;
      this._addCollider((leftX + rightX) / 2, -halfWidth, rightX - leftX, .16, 4.5, false, false);
      this._addCollider((leftX + rightX) / 2, halfWidth, rightX - leftX, .16, 4.5, false, false);
    }
    // Storeroom east wall is solid; the Library entrance is on its north wall.
    this.roomScaleX = MAIN_ROOM_SCALE; this.roomScaleZ = MAIN_ROOM_SCALE;
    this._worldOffsetX = this.roomOffsets[2]; this._worldOffsetZ = 0;
    this._addCollider(7,0,.28,12,4.5,false,false,true);

    // Short world-space connector between the compact Storeroom rear wall
    // and the unchanged-size Library entrance.
    this.roomScaleX = 1; this.roomScaleZ = 1; this._worldOffsetZ = 0;
    this._worldOffsetX = this.roomOffsets[2];
    const libraryGap = Math.max(.2, Math.abs(LIBRARY_FRONT_WORLD_Z - MAIN_ROOM_REAR_WORLD_Z));
    const libraryGapCenter = (LIBRARY_FRONT_WORLD_Z + MAIN_ROOM_REAR_WORLD_Z) * .5;
    this._addCollider(-2, libraryGapCenter, .20, libraryGap, 4.5);
    this._addCollider(2, libraryGapCenter, .20, libraryGap, 4.5);

    this.roomScaleX = this.libraryScaleX; this.roomScaleZ = this.libraryScaleZ;
    this._worldOffsetX = this.roomOffsets[2]; this._worldOffsetZ = LIBRARY_WORLD_OFFSET_Z;
    // Library perimeter, entrance opening, final exit opening, and archive shelves.
    this._addCollider(-7,-20,.28,16,4.5);
    this._addCollider(7,-20,.28,16,4.5);
    this._addCollider(-4.25,-12,5.5,.28,4.5);
    this._addCollider(4.25,-12,5.5,.28,4.5);
    if (!this.libraryDoorOpen) this._addCollider(0,-12,3.2,.30,3.15);
    this._addCollider(-4.25,-28,5.5,.28,4.5);
    this._addCollider(4.25,-28,5.5,.28,4.5);
    if (!this.exitOpen) this._addCollider(0,-28,3.2,.30,3.15);
    for (const rack of (this.libraryLayout?.racks || [])) this._addCollider(rack.x,rack.z,2.32,.86,3.7);

    this.roomScaleX = MAIN_ROOM_SCALE; this.roomScaleZ = MAIN_ROOM_SCALE; this._worldOffsetX = 0; this._worldOffsetZ = 0;
  }

  _createLibraryLayout(game) {
    const columns = [-5.8, -2.9, 0, 2.9, 5.8];
    const rows = [-13.6, -17.6, -21.6, -25.6];
    const racks = [];
    rows.forEach((z, row) => columns.forEach((x, col) => racks.push({ id: row * 5 + col, x, z, row, col })));
    // Place one note on each of ten distinct, shuffled bookcases. This keeps
    // clues distributed throughout the room instead of clustering by chance.
    let seed = Number.isFinite(game?.librarySeed) ? game.librarySeed >>> 0 : (0x6d2b79f5 ^ ((Number(game?.stage) || 9) * 374761393) ^ ((Number(game?.tier) || 0) * 668265263)) >>> 0;
    const random = () => { const t0 = (seed = (seed + 0x6D2B79F5) >>> 0); let t = t0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const shuffled = racks.slice();
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const papers = shuffled.slice(0, 10).map((rack, id) => {
      const level = Math.floor(random() * 8);
      const col = Math.floor(random() * 5);
      const shelfY = .34 + level * .43;
      const compartment = 2.25 / 5;
      const x = rack.x - 1.125 + compartment * (col + .5) + (random() - .5) * .12;
      // Attach the sheet to the aisle-facing end plane of the shelf. The shelf
      // ends at rack.z + .36; this six-millimetre offset avoids z-fighting.
      const y = shelfY + .215 + (random() - .5) * .035;
      const z = rack.z + .366;
      return { id, rackId: rack.id, level, col, x, y, z, width: .25 + random() * .045, height: .27 + random() * .035, angle: (random() - .5) * .07 };
    });

    // Populate the cubbies with varied upright books. Each book uses a spine,
    // side and top quad rather than a full six-face box to limit draw cost.
    const paperSlots = new Set(papers.map(p => `${p.rackId}:${p.level}:${p.col}`));
    const books = [];
    const bookColors = ['#765044','#405a66','#867044','#53664d','#70465a','#6b6257','#3f4b59','#96634a'];
    for (const rack of racks) {
      for (let level = 0; level < 8; level++) {
        const available = [0,1,2,3,4].filter(col => !paperSlots.has(`${rack.id}:${level}:${col}`));
        if (!available.length) continue;
        const bundleCount = 1 + (random() < .42 ? 1 : 0);
        for (let bundle = 0; bundle < bundleCount; bundle++) {
          if (!available.length) break;
          const pick = Math.floor(random() * available.length);
          const col = available.splice(pick, 1)[0];
          const bookCount = 1 + Math.floor(random() * 3);
          const compartment = 2.25 / 5;
          const center = rack.x - 1.125 + compartment * (col + .5);
          const widths = Array.from({ length: bookCount }, () => .062 + random() * .035);
          const gap = .012;
          const totalWidth = widths.reduce((a,b) => a+b, 0) + gap * (bookCount - 1);
          let cursor = center - totalWidth * .5 + (random() - .5) * .035;
          const shelfY = .34 + level * .43;
          for (let i = 0; i < bookCount; i++) {
            const width = widths[i];
            books.push({
              id: books.length, rackId: rack.id, level, col,
              x: cursor + width * .5,
              y: shelfY + .012,
              width,
              height: .22 + random() * .17,
              zBack: rack.z - .12,
              zFront: rack.z + .285,
              color: bookColors[Math.floor(random() * bookColors.length)],
              band: random() < .64
            });
            cursor += width + gap;
          }
        }
      }
    }
    return { racks, papers, books };
  }

  _appendLibraryGeometry() {
    if (this.roomFaceGroups.some(group => group.roomIndex === 3)) return;
    const previousKind = this.roomKind, previousOffset = this._worldOffsetX, previousOffsetZ = this._worldOffsetZ;
    const previousScaleX = this.roomScaleX, previousScaleZ = this.roomScaleZ;
    const previousBuildingRoom = this._buildingRoomIndex, previousZone = this._activeZone;
    this.roomKind = 'library';
    this.roomScaleX = this.libraryScaleX; this.roomScaleZ = this.libraryScaleZ; this._worldOffsetZ = LIBRARY_WORLD_OFFSET_Z;
    this._worldOffsetX = this.roomOffsets[2];
    this._buildingRoomIndex = 3;
    this._activeZone = 'library';
    const faceStart = this._geometry.length, vertexStart = this._vertices.length;
    const floor = '#514537', wall = '#3b4a4d';
    this._activeLayer = -1;
    this._poly([[-7,0,-12],[7,0,-12],[7,0,-28],[-7,0,-28]], floor, 'rgba(213,178,122,.12)');
    // Actual Library perimeter walls remain visible from the Storeroom through
    // the connecting opening. Shelves, notes and floor are still room-private.
    this._activeZone = 'partition';
    this._activeLayer = 0;
    this._poly([[-7,0,-28],[-1.6,0,-28],[-1.6,4.5,-28],[-7,4.5,-28]], wall);
    this._poly([[1.6,0,-28],[7,0,-28],[7,4.5,-28],[1.6,4.5,-28]], wall);
    this._poly([[-1.6,3.15,-28],[1.6,3.15,-28],[1.6,4.5,-28],[-1.6,4.5,-28]], wall);
    if (!this.exitOpen) {
      const oldBarrier = this._activeDoorBarrier; this._activeDoorBarrier = 'exit';
      this._poly([[-1.56,0,-28.035],[1.56,0,-28.035],[1.56,3.1,-28.035],[-1.56,3.1,-28.035]], '#49382a', '#b28c59');
      this._activeDoorBarrier = oldBarrier;
    }
    this._poly([[-7,4.5,-12],[-7,4.5,-28],[7,4.5,-28],[7,4.5,-12]], shade(wall,.55));
    this._poly([[-7,0,-12],[-7,0,-28],[-7,4.5,-28],[-7,4.5,-12]], shade(wall,.78));
    this._poly([[7,0,-28],[7,0,-12],[7,4.5,-12],[7,4.5,-28]], shade(wall,.72));
    // South wall frames an open doorway aligned with the connector from the storeroom.
    this._poly([[-7,0,-12],[-1.6,0,-12],[-1.6,4.5,-12],[-7,4.5,-12]], wall);
    this._poly([[1.6,0,-12],[7,0,-12],[7,4.5,-12],[1.6,4.5,-12]], wall);
    this._poly([[-1.6,3.15,-12],[1.6,3.15,-12],[1.6,4.5,-12],[-1.6,4.5,-12]], wall);
    if (!this.libraryDoorOpen) {
      const oldBarrier = this._activeDoorBarrier; this._activeDoorBarrier = 'library';
      this._poly([[-1.56,0,-12.035],[1.56,0,-12.035],[1.56,3.1,-12.035],[-1.56,3.1,-12.035]], '#49382a', '#b28c59');
      this._activeDoorBarrier = oldBarrier;
    }
    // Shelving: 20 bookcases in a 4 x 5 layout. Each bookcase has 8 shelf
    // rows and 5 vertical columns (40 individual cubbies).
    this._activeZone = 'library';
    this._activeLayer = 1;
    for (const rack of this.libraryLayout.racks) {
      const x0=rack.x-1.125, x1=rack.x+1.125, z0=rack.z-.36, z1=rack.z+.36;
      const wood='#624a32', edge='#98734b';
      this._poly([[x0,.12,z0],[x1,.12,z0],[x1,3.82,z0],[x0,3.82,z0]], '#44382c');
      this._poly([[x0,.12,z0],[x0,.12,z1],[x0,3.82,z1],[x0,3.82,z0]], wood);
      this._poly([[x1,.12,z1],[x1,.12,z0],[x1,3.82,z0],[x1,3.82,z1]], shade(wood,.84));
      for (let level=0; level<8; level++) {
        const y=.34+level*.43;
        this._poly([[x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1]], level%2 ? '#80613f' : '#76583a', edge);
      }
      for (let col=1; col<5; col++) {
        const x=x0+(x1-x0)*col/5;
        this._poly([[x,.18,z0+.04],[x,3.78,z0+.04],[x,3.78,z1],[x,.18,z1]], '#77583a');
      }
      this._poly([[x0,3.82,z0],[x1,3.82,z0],[x1,3.82,z1],[x0,3.82,z1]], '#62482f', edge);
    }
    // Books are individual props. Their spines face the aisle (+Z), with side
    // and top quads to give them volume while avoiding full six-face boxes.
    for (const book of this.libraryLayout.books || []) {
      const x0 = book.x - book.width * .5, x1 = book.x + book.width * .5;
      const y0 = book.y, y1 = book.y + book.height;
      const z0 = book.zBack, z1 = book.zFront;
      const side = shade(book.color, .72), top = shade(book.color, 1.2);
      this._poly([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], book.color, 'rgba(20,16,12,.35)', null, { libraryBookIndex: book.id, bookBand: book.band });
      this._poly([[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]], side);
      this._poly([[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]], top);
    }
    // The final exit keypad sits at the far-left end of the rear wall, separate
    // from the five answer panels. It disappears with the final exit door.
    if (!this.exitOpen) {
      const oldLock = this._activeLockBarrier; this._activeLockBarrier = 'exit';
      this._box(-6.50, .92, -27.72, .56, .58, .18, '#242b2c', '#c49a61');
      this._poly([[-6.70,1.05,-27.615],[-6.30,1.05,-27.615],[-6.30,1.35,-27.615],[-6.70,1.35,-27.615]], '#172529', '#c09a60');
      this._activeLockBarrier = oldLock;
    }
    // Five archive answer stations are mounted along the rear wall.
    for (let index = 0; index < 5; index++) {
      const x = [-5.4, -2.7, 0, 2.7, 5.4][index];
      this._box(x, .82, -27.72, 1.02, .78, .16, '#29383a', '#b18a55');
      this._poly([
        [x-.43, .98, -27.63], [x+.43, .98, -27.63],
        [x+.43, 1.55, -27.63], [x-.43, 1.55, -27.63]
      ], '#172529', '#c09a60', null, { answerPanelIndex: index, answerPanelRoom: 'library' });
    }

    // Ten papers are mounted flush to the aisle-facing shelf end plane with
    // only a tiny offset to prevent z-fighting against the wooden edge.
    this.libraryPaperLayout = [];
    this._activeLayer = 2;
    for (const note of this.libraryLayout.papers) {
      const cos = Math.cos(note.angle || 0), sin = Math.sin(note.angle || 0);
      const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sy]) => {
        const dx = sx * note.width * .5, dy = sy * note.height * .5;
        return [note.x + dx * cos - dy * sin, note.y + dx * sin + dy * cos, note.z];
      });
      const face = this._poly(corners, note.tint || '#c9bea4', '#65563e', null, {
        libraryNoteIndex: note.id
      });
      this.libraryPaperLayout.push({ ...note, faceId: face.faceId });
    }
    this._activeLayer = 1;
    // Sign is on the library back wall.
    this._poly([[-2.2,3.72,-27.9],[2.2,3.72,-27.9],[2.2,4.18,-27.9],[-2.2,4.18,-27.9]], '#55432f', '#a17b4d');
    this.roomFaceGroups.push({ roomIndex: 3, faceStart, faceEnd: this._geometry.length, vertexStart, vertexEnd: this._vertices.length });
    this._buildingRoomIndex = previousBuildingRoom;
    this._activeZone = previousZone || 'room';
    this._worldOffsetX = previousOffset; this._worldOffsetZ = previousOffsetZ;
    this.roomScaleX = previousScaleX; this.roomScaleZ = previousScaleZ;
    this.roomKind = previousKind;
    this._syncGeometryBuffers();
  }

  setRoom(game, roomIndex = 0, menu = false) {
    this._ambientAllowed = !menu;
    if (menu) this._stopAmbientLoop();
    this.dark = false;
    this.torch = false;
    this.mapKinds = (game?.rooms || []).map(room => room.kind || 'vocab');
    while (this.mapKinds.length < 4) this.mapKinds.push(['vocab','reading','grammar','library'][this.mapKinds.length]);
    this.roomScaleX = MAIN_ROOM_SCALE; // room footprint is compact; props retain their 1.25x object scale
    this.roomScaleZ = MAIN_ROOM_SCALE;
    this.libraryScaleX = 1.25;
    this.libraryScaleZ = 1.25;
    this.roomOffsets = [0, MAIN_ROOM_SPACING, MAIN_ROOM_SPACING * 2];
    this._worldOffsetZ = 0;
    this.doorOpen = [false, false, false];
    this.libraryDoorOpen = false;
    this.exitOpen = false;
    this.currentGame = game;
    this.paperByRoom = Object.create(null);
    this.collectedLibraryPapers = new Set();
    this.collectedRoomPapers = new Set();
    this.collectedWordPapers = new Set();
    this.libraryPanelSolved = Array(5).fill(false);
    this.equippedLibraryPaper = null;
    this.equippedPaper = null;
    this.libraryLayout = this._createLibraryLayout(game);
    this._prepareDrawerLayouts(game);
    this.camera = { x: 0, y: this.eyeHeight, z: 5.1875 * Math.min(this.roomScaleZ, 1.25) };
    this.yaw = 0;
    this.pitch = 0;
    this.jumpHeight = 0;
    this.jumpVelocity = 0;
    this.groundHeight = 0;
    this.seated = false;
    this._standingPosition = null;
    this.bounds = { minX: -14, maxX: 58, minZ: -34, maxZ: 12 };
    this._buildColliders();
    this._buildRoomGeometry();
    this.setActiveRoom(game, roomIndex);
    this._lastArea = this._currentAreaId();
    this.invalidate();
    this._startAmbientLoop();
  }

  _prepareDrawerLayouts(game) {
    this.drawers = [];
    this.drawerById = new Map();
    const roomSpecs = [
      [
        { x: -3.15, y: .58, frontZ: -1.575, width: .94, height: .27, depth: .46, paperIds: [0,1] },
        { x: 0, y: .40, frontZ: -1.55, width: .88, height: .25, depth: .44, paperIds: [2,3] },
        // Added desk A: one paper-filled drawer and one deliberately empty drawer.
        { x: -4.72, y: .43, frontZ: .425, width: .72, height: .23, depth: .38, paperIds: [4,5] },
        { x: -3.78, y: .43, frontZ: .425, width: .72, height: .23, depth: .38, paperIds: [] },
        // Added desk B: one paper-filled drawer and one empty drawer.
        { x: -.58, y: .43, frontZ: 3.775, width: .76, height: .23, depth: .40, paperIds: [6,7] },
        { x: .40, y: .43, frontZ: 3.775, width: .76, height: .23, depth: .40, paperIds: [] },
        // Side desk D: one filled drawer and one empty drawer.
        { x: -5.48, y: .40, frontZ: -3.60, width: .68, height: .22, depth: .36, paperIds: [8,9] },
        { x: -4.52, y: .40, frontZ: -3.60, width: .68, height: .22, depth: .36, paperIds: [] },
        // Side desk E: two deliberately empty drawers.
        { x: 4.52, y: .40, frontZ: -3.60, width: .68, height: .22, depth: .36, paperIds: [] },
        { x: 5.48, y: .40, frontZ: -3.60, width: .68, height: .22, depth: .36, paperIds: [] },
        // Two new central/rear desks: one clue drawer and three empty drawers.
        { x: -2.60, y: .40, frontZ: -4.275, width: .72, height: .22, depth: .38, paperIds: [10] },
        { x: -1.70, y: .40, frontZ: -4.275, width: .72, height: .22, depth: .38, paperIds: [] },
        { x: 1.70, y: .40, frontZ: -4.275, width: .72, height: .22, depth: .38, paperIds: [] },
        { x: 2.60, y: .40, frontZ: -4.275, width: .72, height: .22, depth: .38, paperIds: [] }
      ],
      [
        { x: -1.55, y: .14, frontZ: -1.95, width: 1.05, height: .25, depth: .44, paperIds: [0,1] },
        { x: 1.55, y: .14, frontZ: -1.95, width: 1.05, height: .25, depth: .44, paperIds: [2,3] }
      ],
      [
        { x: 1.43, y: .24, frontZ: .80, width: .56, height: .24, depth: .38, paperIds: [0,1] },
        { x: 2.24, y: .24, frontZ: .80, width: .56, height: .24, depth: .38, paperIds: [2,3] }
      ]
    ];
    for (let roomIndex = 0; roomIndex < 3; roomIndex++) {
      const papers = game?.rooms?.[roomIndex]?.wordPapers || [];
      for (let index = 0; index < roomSpecs[roomIndex].length; index++) {
        const spec = roomSpecs[roomIndex][index];
        const id = `drawer-${roomIndex}-${index}`;
        const drawer = {
          id, roomIndex, areaId: String(roomIndex), x: spec.x, y: spec.y,
          z: spec.frontZ - spec.depth, width: spec.width, height: spec.height,
          depth: spec.depth, open: false, offset: 0, targetOffset: 0, animating: false, faces: [], paperIds: spec.paperIds.slice()
        };
        this.drawers.push(drawer);
        this.drawerById.set(id, drawer);
        spec.paperIds.forEach((paperId, slot) => {
          const paper = papers.find(item => item.id === paperId);
          if (!paper) return;
          paper.drawerId = id;
          paper.x = drawer.x + (slot === 0 ? -drawer.width * .20 : drawer.width * .20);
          paper.y = drawer.y + .035;
          paper.z = drawer.z + drawer.depth * .53;
          paper.width = Math.min(.30, drawer.width * .34);
          paper.depth = Math.min(.32, drawer.depth * .62);
        });
      }
    }

  }

  _buildDrawerGeometry(drawer) {
    const x0 = drawer.x - drawer.width * .5, x1 = drawer.x + drawer.width * .5;
    const y0 = drawer.y, y1 = drawer.y + drawer.height;
    const z0 = drawer.z, z1 = drawer.z + drawer.depth;
    const poly = (points, fill, stroke = null, texture = null, metadata = null) => this._polyObjectFixed(points, drawer.x, drawer.z + drawer.depth * 0.5, fill, stroke, texture, metadata);
    const rim = '#8c6842';
    const dark = '#211b16';
    // Fixed dark cavity and frame remain in place while the tray slides out.
    poly([[x0,y0+.018,z0+.025],[x1,y0+.018,z0+.025],[x1,y1-.018,z0+.025],[x0,y1-.018,z0+.025]], dark, '#55402d', null, { drawerId: drawer.id, drawerStatic: true });
    poly([[x0-.035,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0-.035,y1,z0]], shade(rim,.78), null, null, { drawerId: drawer.id, drawerStatic: true });
    poly([[x1,y0,z1],[x1+.035,y0,z0],[x1+.035,y1,z0],[x1,y1,z1]], shade(rim,.78), null, null, { drawerId: drawer.id, drawerStatic: true });
    const moving = (points, fill, stroke = null) => poly(points, fill, stroke, null, {
      drawerId: drawer.id, drawerMove: true, noVertexDedup: true
    });
    // Sliding tray: bottom, side walls, rear wall, front panel and pull handle.
    moving([[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]], '#6d5034', '#a17a4d');
    moving([[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]], '#765638', '#a17a4d');
    moving([[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]], '#60452e', '#a17a4d');
    moving([[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]], '#62472f', '#a17a4d');
    moving([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], '#9a7449', '#4b3827');
    const handleW = Math.min(.22, drawer.width * .42), handleY = y0 + drawer.height * .58;
    moving([[drawer.x-handleW/2,handleY,z1+.012],[drawer.x+handleW/2,handleY,z1+.012],
      [drawer.x+handleW/2,handleY+.035,z1+.012],[drawer.x-handleW/2,handleY+.035,z1+.012]], '#c3a16d', '#59452f');
  }

  toggleDrawer(id) {
    const drawer = this.drawerById?.get(String(id));
    if (!drawer) return null;
    drawer.open = !drawer.open;
    drawer.targetOffset = drawer.open ? .48 : 0;
    drawer.animating = Math.abs(drawer.targetOffset - drawer.offset) > .002;
    if (this._prefersReducedMotion) {
      drawer.offset = drawer.targetOffset;
      const worldOffset = drawer.offset * Math.min(this.roomScaleZ, 1.25);
      for (const face of drawer.faces) {
        const base = face.drawerBaseZ || [];
        for (let i = 0; i < face.points.length; i++) face.points[i][2] = base[i] + worldOffset;
      }
      drawer.animating = false;
    } else this._startAmbientLoop();
    if (this.currentGame) this.setActiveRoom(this.currentGame, this.roomIndex);
    this.invalidate();
    return drawer.open;
  }

  _answerPanelSpots(kind) {
    const xs = [-5.4, -2.7, 0, 2.7, 5.4];
    if (kind === 'grammar') {
      // Storeroom panels belong to the room, not the Library connector wall.
      // Mount them on the opposite wall and turn their faces toward -Z.
      return xs.map((x, index) => ({
        x, y: index % 2 ? 1.00 : 1.12, z: 5.88, faceSide: 'front'
      }));
    }
    return xs.map((x, index) => ({
      x, y: index % 2 ? 1.00 : 1.12, z: -5.48, faceSide: 'rear'
    }));
  }

  setActiveRoom(game, roomIndex) {
    this.currentGame = game || this.currentGame;
    this.roomIndex = Math.max(0, Math.min(3, roomIndex));
    const isLibrary = this.roomIndex === 3;
    const oldScaleX = this.roomScaleX, oldScaleZ = this.roomScaleZ, oldOffsetZ = this._worldOffsetZ;
    if (isLibrary) {
      this.roomScaleX = this.libraryScaleX;
      this.roomScaleZ = this.libraryScaleZ;
      this._worldOffsetZ = LIBRARY_WORLD_OFFSET_Z;
    } else {
      this.roomScaleX = MAIN_ROOM_SCALE;
      this.roomScaleZ = MAIN_ROOM_SCALE;
      this._worldOffsetZ = 0;
    }
    this.roomKind = this.mapKinds[this.roomIndex] || (isLibrary ? 'library' : ['vocab','reading','grammar'][this.roomIndex]);
    const offset = this.roomOffsets[Math.min(this.roomIndex, 2)];
    this.hotspots = [];
    const savedPaperState = this.paperByRoom?.[this.roomIndex];
    this.paperCodes = game.rooms[this.roomIndex].code || [];
    this.paperSolved = savedPaperState?.solved?.slice() || Array.from({length:this.paperCodes.length}, () => false);
    const add = (id, label, x, y, z, extra = {}) => {
      const clueMatch = /^paper-(\d+)$/.exec(id);
      if (clueMatch && this.collectedRoomPapers.has(`${this.roomIndex}:${Number(clueMatch[1])}`)) return;
      const positionScaleX = extra.roomAnchored ? this.roomScaleX : Math.min(this.roomScaleX, 1.25);
      const positionScaleZ = extra.roomAnchored ? this.roomScaleZ : Math.min(this.roomScaleZ, 1.25);
      const { roomAnchored, ...meta } = extra;
      this.hotspots.push({ id, label, x: x * positionScaleX + offset, y, z: z * positionScaleZ + this._worldOffsetZ, roomIndex: this.roomIndex, ...meta });
    };
    if (isLibrary) {
      if (!this.exitOpen) add('lock', 'Final archive exit lock', -6.50, 1.42, -27.15, { discoverRange: 9 });
      for (let index = 0; index < 5; index++) {
        const x = [-5.4,-2.7,0,2.7,5.4][index];
        add(`library-answer-panel-${index}`, `Use library answer panel ${index + 1}`, x, 1.42, -27.2, { libraryAnswerPanel: true, panelIndex: index, discoverRange: 10 });
      }
      for (const note of (this.libraryLayout?.papers || [])) {
        if (this.collectedLibraryPapers.has(note.id)) continue;
        add(`library-paper-${note.id}`, `Collect archive word ${note.id + 1}`, note.x, note.y + .06, note.z + .02, { discoverRange: 5.4, libraryNote: true });
      }
    } else {
      const roomData = game.rooms[this.roomIndex];
      const lockAlreadyOpen = this.roomIndex === 2 ? this.libraryDoorOpen : !!this.doorOpen[this.roomIndex];
      if (!lockAlreadyOpen) {
        if (this.roomIndex === 2) add('lock', 'Unlock the Storeroom exit', 1.55, 1.42, -5.595, { discoverRange: 7, roomAnchored: true });
        else add('lock', 'Connecting door lock', 6.45, 1.45, 0, { roomAnchored: true });
      }
      const panelSpots = this._answerPanelSpots(this.roomKind);
      panelSpots.forEach((spot, index) => {
        const faceDirection = spot.faceSide === 'front' ? -1 : 1;
        add(`answer-panel-${index}`, `Use answer panel ${index + 1}`, spot.x, spot.y + .48,
          spot.z + faceDirection * (.076 * 1.25 / this.roomScaleZ),
          { answerPanel: true, panelIndex: index, roomAnchored: true });
      });
      for (const drawer of this.drawers.filter(item => item.roomIndex === this.roomIndex)) {
        add(drawer.id, `${drawer.open ? 'Close' : 'Open'} drawer`, drawer.x, drawer.y + drawer.height * .55, drawer.z + drawer.depth + (drawer.targetOffset ?? drawer.offset) + .10, { drawer: true, drawerOpen: drawer.open, discoverRange: 4.8 });
      }
      for (const paper of (roomData.wordPapers || [])) {
        if (this.collectedWordPapers.has(`${this.roomIndex}:${paper.id}`)) continue;
        const containingDrawer = paper.drawerId ? this.drawerById.get(paper.drawerId) : null;
        if (containingDrawer && !containingDrawer.open) continue;
        add(`word-paper-${paper.id}`, `Pick up word: ${paper.display}`, paper.x, paper.y + .08, paper.z + (containingDrawer?.targetOffset ?? containingDrawer?.offset ?? 0), { wordPaper: true, wordPaperIndex: paper.id, discoverRange: 7.5 });
      }
      if (this.roomKind === 'vocab') add('key', game.rooms[0].keyObject, -2.12, 0.62, -0.68);
      else if (this.roomKind === 'reading') {
        [-4.2,-1.8,1.8,4.2].forEach((x,i) => add(`photo-${i}`, 'Inspect gallery photograph', x, 1.8, -5.56, { roomAnchored: true }));
        [-5,-2.5,0,2.5,5].forEach((x,i) => add(`gallery-chair-${i}`, 'Sit on gallery chair', x, .98, 1.1));
        add('key', game.rooms[1].keyObject, -4.5, 1.9, -4.82);
      } else add('key', game.rooms[2].keyObject, 1.9, 1.05, 0.25);
      add('chair-0', 'Sit on the left chair', -5.05, 0.72, 2.8);
      add('chair-1', 'Sit on the right chair', 5.05, 0.72, 2.8);
    }
    this.roomScaleX = oldScaleX; this.roomScaleZ = oldScaleZ; this._worldOffsetZ = oldOffsetZ;
    this._setFocus(null);
    this.invalidate();
  }

  _currentAreaId() {
    return this.isInLibrary() ? 'library' : String(this._physicalRoomForX(this.camera.x));
  }

  getCurrentAreaId() { return this._currentAreaId(); }

  _notifyAreaChanged() {
    const next = this._currentAreaId();
    if (this._lastArea == null) { this._lastArea = next; return; }
    if (next === this._lastArea) return;
    const previous = this._lastArea;
    this._lastArea = next;
    this.onAreaChange(next, previous);
  }

  collectWordPaper(roomIndex, index) {
    const room = Number(roomIndex), paper = Number(index);
    if (!Number.isInteger(room) || room < 0 || room > 3 || !Number.isInteger(paper) || paper < 0) return false;
    const key = `${room}:${paper}`;
    if (this.collectedWordPapers.has(key)) return false;
    this.collectedWordPapers.add(key);
    const hotspotId = `word-paper-${paper}`;
    this.hotspots = this.hotspots.filter(point => !(point.id === hotspotId && point.roomIndex === room));
    if (this.focused === hotspotId) this._setFocus(null);
    this.invalidate();
    return true;
  }

  collectRoomPaper(roomIndex, index) {
    const room = Number(roomIndex), clue = Number(index);
    if (!Number.isInteger(room) || room < 0 || room > 2 || !Number.isInteger(clue) || clue < 0 || clue > 2) return false;
    const key = `${room}:${clue}`;
    if (this.collectedRoomPapers.has(key)) return false;
    this.collectedRoomPapers.add(key);
    const hotspotId = `paper-${clue}`;
    this.hotspots = this.hotspots.filter(point => !(point.id === hotspotId && point.roomIndex === room));
    if (this.focused === hotspotId) this._setFocus(null);
    this.invalidate();
    return true;
  }

  collectLibraryPaper(index) {
    const id = Number(index);
    if (!Number.isInteger(id) || id < 0 || id >= 10 || this.collectedLibraryPapers.has(id)) return false;
    this.collectedLibraryPapers.add(id);
    const hotspotId = `library-paper-${id}`;
    this.hotspots = this.hotspots.filter(point => point.id !== hotspotId);
    if (this.focused === hotspotId) this._setFocus(null);
    this.invalidate();
    return true;
  }

  setLibraryPanelState(solved) {
    this.libraryPanelSolved = Array.isArray(solved) ? solved.slice(0,5) : Array(5).fill(false);
    this.invalidate();
  }

  setEquippedPaper(paper) {
    this.equippedPaper = paper && typeof paper === 'object'
      ? { title: String(paper.title || 'Collected paper'), body: String(paper.body || '') }
      : null;
    this.equippedLibraryPaper = this.equippedPaper;
    this.invalidate();
  }

  setEquippedLibraryPaper(paper) { this.setEquippedPaper(paper); }

  setPaperState(code, solved) {
    const nextCodes = Array.isArray(code) ? code : this.paperCodes || [];
    const nextSolved = Array.isArray(solved) ? solved.slice() : Array.from({length: nextCodes.length}, () => false);
    const changed = nextCodes.join('|') !== (this.paperCodes || []).join('|') ||
      nextSolved.some((value, index) => value !== this.paperSolved?.[index]);
    if (!changed) return;
    this.paperCodes = nextCodes;
    this.paperSolved = nextSolved;
    this.paperByRoom[this.roomIndex] = { codes: nextCodes.slice(), solved: nextSolved.slice() };
    this.invalidate();
  }

  openDoor(roomIndex) {
    if (roomIndex < 0 || roomIndex > 2 || this.doorOpen[roomIndex]) return;
    this.doorOpen[roomIndex] = true;
    if (roomIndex === 2) this.libraryDoorOpen = true;
    if (this.roomIndex === roomIndex) this.hotspots = this.hotspots.filter(point => point.id !== 'lock');
    this._buildColliders();
    // All spaces are resident from the beginning. Unlocking changes only the
    // door state and its collision barrier; geometry is never unloaded/rebuilt.
    this.invalidate();
  }

  openExit() {
    this.exitOpen = true;
    this.hotspots = this.hotspots.filter(point => point.id !== 'lock');
    this._buildColliders();
    this.invalidate();
  }

  warpToRoomForTesting(game, roomIndex) {
    const index = Math.max(0, Math.min(3, roomIndex));
    for (let i = 0; i < Math.min(index,3); i++) this.doorOpen[i] = true;
    if (index >= 3) this.libraryDoorOpen = true;
    this._buildColliders();
    this.camera.x = this.roomOffsets[index];
    this.camera.y = this.eyeHeight;
    this.camera.z = index === 3 ? (LIBRARY_WORLD_OFFSET_Z - 20 * 1.25) : 5.1875 * Math.min(this.roomScaleZ, 1.25);
    this.yaw = 0;
    this.pitch = 0;
    this.setActiveRoom(game, index);
    this._buildRoomGeometry();
    this._notifyAreaChanged();
    this.invalidate();
  }

  _syncGeometryBuffers() {
    this.roomGeometry = this._geometry;
    // Store room-local face lists once at build time. Adjacent rooms need only
    // contribute their perimeter/connector faces, not their full furniture.
    this._roomGroupsByIndex = [];
    for (const group of this.roomFaceGroups || []) {
      group.faces = this.roomGeometry.slice(group.faceStart, group.faceEnd);
      group.boundaryFaces = group.faces.filter(face =>
        face.zone === 'partition' || face.zone === 'connector' || face.zone === 'library-connector');
      this._roomGroupsByIndex[group.roomIndex] = group;
    }
    const count = this._vertices.length;
    this._camForward = new Float32Array(count);
    this._camLateral = new Float32Array(count);
    this._camVertical = new Float32Array(count);
    this._screenX = new Float32Array(count);
    this._screenY = new Float32Array(count);
    this._vertexStamps = new Uint32Array(count);
    this._vertexStamp = 0;
  }

  _appendRoomGeometry(roomIndex) {
    if (this.roomFaceGroups.some(group => group.roomIndex === roomIndex)) return;
    const previousKind = this.roomKind;
    const previousOffset = this._worldOffsetX;
    const previousOffsetZ = this._worldOffsetZ;
    const previousScaleX = this.roomScaleX, previousScaleZ = this.roomScaleZ;
    this.roomScaleX = MAIN_ROOM_SCALE; this.roomScaleZ = MAIN_ROOM_SCALE; this._worldOffsetZ = 0;
    this.roomKind = this.mapKinds[roomIndex] || ['vocab','reading','grammar'][roomIndex];
    this._worldOffsetX = this.roomOffsets[roomIndex];
    const faceStart = this._geometry.length;
    const vertexStart = this._vertices.length;
    const previousBuildingRoom = this._buildingRoomIndex;
    const previousZone = this._activeZone;
    const previousLockBarrier = this._activeLockBarrier;
    this._buildingRoomIndex = roomIndex;
    this._activeZone = 'room';
    this._activeLockBarrier = null;
    this._buildSingleRoomGeometry(roomIndex);
    this.roomFaceGroups.push({
      roomIndex, faceStart, faceEnd: this._geometry.length,
      vertexStart, vertexEnd: this._vertices.length
    });
    this._buildingRoomIndex = previousBuildingRoom;
    this._activeZone = previousZone || 'room';
    this._activeLockBarrier = previousLockBarrier ?? null;
    this._worldOffsetX = previousOffset; this._worldOffsetZ = previousOffsetZ;
    this.roomScaleX = previousScaleX; this.roomScaleZ = previousScaleZ;
    this.roomKind = previousKind;
  }

  _buildRoomGeometry() {
    // Build the complete map once for a new run or an explicit developer warp.
    // Door unlocks only change the barrier/collider state; geometry stays resident.
    this._geometry = [];
    this._vertices = [];
    this._vertexMap = new Map();
    this._nextFaceId = 0;
    this.lamps = [];
    this.roomFaceGroups = [];
    this._activeDoorBarrier = null;
    // Keep the whole map resident. Visibility is handled by per-face camera
    // clipping and screen-space culling, never by progression-room unloading.
    for (let roomIndex = 0; roomIndex < 3; roomIndex++) this._appendRoomGeometry(roomIndex);
    this._appendLibraryGeometry();
    this._syncGeometryBuffers();
    this._worldOffsetX = 0;
    this.roomKind = this.mapKinds[this.roomIndex] || 'vocab';
    this._frameFaces.length = 0;
    this._drawPrimitives.length = 0;
  }

  _buildSingleRoomGeometry(roomIndex) {
    const wall = this.roomKind === 'vocab' ? '#354b59' : this.roomKind === 'reading' ? '#48535d' : '#535a50';
    const floor = this.roomKind === 'vocab' ? '#594637' : this.roomKind === 'reading' ? '#45494a' : '#554536';
    // Continuous world: each room has its own floor and back wall, while
    // the east/west walls contain real door openings between adjacent rooms.
    // The floor is a true background surface: draw it before room walls and props.
    // Sorting it together with vertical faces by polygon-average depth caused the
    // floor to jump in front of desks and cabinets at common viewing angles.
    this._activeLayer = -1;
    this._poly([[-7,0,6],[7,0,6],[7,0,-6],[-7,0,-6]], this.dark ? '#090d10' : floor, 'rgba(213,178,122,.18)');
    this._activeLayer = 0;
    const rearZone = this._activeZone;
    this._activeZone = 'partition';
    if (roomIndex === 2) {
      // Storeroom rear perimeter wall has a real opening into the library.
      const rearPortalHalf = 1.6 * 1.25 / this.roomScaleX;
      const rearPanelHalf = 1.56 * 1.25 / this.roomScaleX;
      this._poly([[-7,0,-6],[-rearPortalHalf,0,-6],[-rearPortalHalf,4.5,-6],[-7,4.5,-6]], this.dark ? '#10161b' : wall);
      this._poly([[rearPortalHalf,0,-6],[7,0,-6],[7,4.5,-6],[rearPortalHalf,4.5,-6]], this.dark ? '#10161b' : wall);
      this._poly([[-rearPortalHalf,3.15,-6],[rearPortalHalf,3.15,-6],[rearPortalHalf,4.5,-6],[-rearPortalHalf,4.5,-6]], this.dark ? '#10161b' : wall);
      if (!this.libraryDoorOpen) {
        const oldBarrier = this._activeDoorBarrier; this._activeDoorBarrier = 'library';
        this._polyFixed([[-rearPanelHalf,0,-6.035],[rearPanelHalf,0,-6.035],[rearPanelHalf,3.1,-6.035],[-rearPanelHalf,3.1,-6.035]], 0, -6.035, '#49382a', '#b28c59');
        this._activeDoorBarrier = oldBarrier;
      } else {
        // Keep the Storeroom exit visibly identifiable after unlocking: the
        // door leaf is swung against the left jamb instead of disappearing.
        this._poly([
          [-rearPortalHalf + .10,0,-6],
          [-rearPortalHalf + .10,0,-4.48],
          [-rearPortalHalf + .10,3.08,-4.48],
          [-rearPortalHalf + .10,3.08,-6]
        ], this.dark ? '#252b30' : '#49382a', '#b28c59');
      }
    } else {
      this._poly([[-7,0,-6],[7,0,-6],[7,4.5,-6],[-7,4.5,-6]], this.dark ? '#10161b' : wall);
    }
    this._activeZone = rearZone || 'room';
    this._poly([[-7,4.5,6],[-7,4.5,-6],[7,4.5,-6],[7,4.5,6]], this.dark ? '#090d11' : shade(wall, 0.48));
    // Complete the fourth perimeter wall. The spawn is inside this wall;
    // east/west doorways remain the progression exits.
    const sideColor = this.dark ? '#0c1116' : shade(wall, .76);
    const perimeterZone = this._activeZone;
    this._activeZone = 'partition';
    this._poly([[-7,0,6],[7,0,6],[7,4.5,6],[-7,4.5,6]], sideColor);
    this._activeZone = perimeterZone || 'room';
    const sideWall = (x, portal, closed, outer=false) => {
      if (!portal) {
        this._poly([[x,0,-6],[x,0,6],[x,4.5,6],[x,4.5,-6]], sideColor);
        return;
      }
      const portalHalf = 1.3 * 1.25 / this.roomScaleZ;
      const panelHalf = 1.18 * 1.25 / this.roomScaleZ;
      const wallHalfThickness = .035 * 1.25 / this.roomScaleX;
      this._poly([[x,0,-6],[x,0,-portalHalf],[x,4.5,-portalHalf],[x,4.5,-6]], sideColor);
      this._poly([[x,0,portalHalf],[x,0,6],[x,4.5,6],[x,4.5,portalHalf]], sideColor);
      this._poly([[x,3.15,-portalHalf],[x,3.15,portalHalf],[x,4.5,portalHalf],[x,4.5,-portalHalf]], sideColor);
      if (closed) {
        const door = outer ? '#49382a' : '#57412d';
        const previousBarrier = this._activeDoorBarrier;
        this._activeDoorBarrier = outer ? 'exit' : roomIndex;
        this._polyFixed([[x-wallHalfThickness,0,-panelHalf],[x-wallHalfThickness,0,panelHalf],[x-wallHalfThickness,3.08,panelHalf],[x-wallHalfThickness,3.08,-panelHalf]], x, 0, door, '#b28c59');
        this._polyFixed([[x+wallHalfThickness,0,panelHalf],[x+wallHalfThickness,0,-panelHalf],[x+wallHalfThickness,3.08,-panelHalf],[x+wallHalfThickness,3.08,panelHalf]], x, 0, shade(door,1.12), '#b28c59');
        this._activeDoorBarrier = previousBarrier;
      }
    };
    const roomZoneBeforeWalls = this._activeZone;
    this._activeZone = 'partition';
    if (roomIndex === 0) sideWall(-7, false, true, true);
    else sideWall(-7, true, false, false);
    const closing = roomIndex < 2 ? !this.doorOpen[roomIndex] : true;
    if (roomIndex < 2) sideWall(7, true, closing, false); else sideWall(7, false, true, true);
    this._activeZone = roomZoneBeforeWalls || 'room';

    // Two-metre enclosed connector between adjacent room shells. The doorway
    // remains a real opening; these surfaces bridge the old gap without moving
    // the player or changing world coordinates.
    if (roomIndex < 2) {
      const keepSX = this.roomScaleX, keepSZ = this.roomScaleZ;
      const keepOX = this._worldOffsetX, keepOZ = this._worldOffsetZ;
      const leftX = this.roomOffsets[roomIndex] + 7 * keepSX;
      const rightX = this.roomOffsets[roomIndex + 1] - 7 * keepSX;
      const halfWidth = 1.3 * 1.25;
      const corridorFloor = this.dark ? '#090d10' : shade(floor, .92);
      const corridorWall = this.dark ? '#0c1116' : shade(wall, .82);
      this.roomScaleX = 1; this.roomScaleZ = 1; this._worldOffsetX = 0; this._worldOffsetZ = 0;
      this._activeZone = 'connector';
      this._activeLayer = -1;
      this._poly([[leftX,0,-halfWidth],[rightX,0,-halfWidth],[rightX,0,halfWidth],[leftX,0,halfWidth]], corridorFloor, 'rgba(213,178,122,.12)');
      this._activeLayer = 0;
      this._poly([[leftX,4.5,halfWidth],[rightX,4.5,halfWidth],[rightX,4.5,-halfWidth],[leftX,4.5,-halfWidth]], this.dark ? '#090d11' : shade(wall,.48));
      this._poly([[leftX,0,-halfWidth],[leftX,4.5,-halfWidth],[rightX,4.5,-halfWidth],[rightX,0,-halfWidth]], corridorWall);
      this._poly([[rightX,0,halfWidth],[rightX,4.5,halfWidth],[leftX,4.5,halfWidth],[leftX,0,halfWidth]], corridorWall);
      this.roomScaleX = keepSX; this.roomScaleZ = keepSZ; this._worldOffsetX = keepOX; this._worldOffsetZ = keepOZ;
      this._activeZone = 'room';
    }
    if (roomIndex === 2) {
      // The enlarged Storeroom connects to the original-size Library through a
      // short real-world corridor. Build these connector faces in world units so
      // the main-room scale does not accidentally stretch the connector.
      const keepSX = this.roomScaleX, keepSZ = this.roomScaleZ, keepOZ = this._worldOffsetZ;
      this.roomScaleX = 1; this.roomScaleZ = 1; this._worldOffsetZ = 0;
      const corridorFloor = this.dark ? '#090d10' : shade(floor,.9);
      const corridorWall = this.dark ? '#0c1116' : shade(wall,.78);
      this._activeZone = 'library-connector';
      this._activeLayer = -1;
      const corridorStartZ = MAIN_ROOM_REAR_WORLD_Z;
      const corridorEndZ = LIBRARY_FRONT_WORLD_Z;
      this._poly([[-2,0,corridorStartZ],[2,0,corridorStartZ],[2,0,corridorEndZ],[-2,0,corridorEndZ]], corridorFloor);
      this._activeLayer = 0;
      this._poly([[-2,4.5,corridorStartZ],[2,4.5,corridorStartZ],[2,4.5,corridorEndZ],[-2,4.5,corridorEndZ]], shade(wall,.48));
      this._poly([[-2,0,corridorStartZ],[-2,0,corridorEndZ],[-2,4.5,corridorEndZ],[-2,4.5,corridorStartZ]], corridorWall);
      this._poly([[2,0,corridorEndZ],[2,0,corridorStartZ],[2,4.5,corridorStartZ],[2,4.5,corridorEndZ]], corridorWall);
      this.roomScaleX = keepSX; this.roomScaleZ = keepSZ; this._worldOffsetZ = keepOZ;
      this._activeZone = 'room';
    }

    this._activeLayer = 1;
    // The first two rooms use this rear-wall feature as a decorative door.
    // The Storeroom has a real, independently unlockable doorway to the Library
    // in the rear partition above; do not cover that portal with a faux door.
    if (roomIndex !== 2) this._roomBox(0,0,-5.68,2.1,3.05,.22,'#443326','#b38c54');
    if (this.roomKind === 'vocab') {
      this.extraTicketHallTables = [
        { id: 'ticket-table-a', x: -4.25, z: -.15, width: 1.9, depth: 1.15, height: .78 },
        { id: 'ticket-table-b', x: -.10, z: 3.15, width: 2.05, depth: 1.20, height: .80 },
        { id: 'ticket-table-c', x: 4.25, z: -.10, width: 1.85, depth: 1.15, height: .78 },
        { id: 'ticket-table-d', x: -5.0, z: -4.1, width: 1.9, depth: 1.0, height: .76 },
        { id: 'ticket-table-e', x: 5.0, z: -4.1, width: 1.9, depth: 1.0, height: .76 },
        { id: 'ticket-table-f', x: -2.15, z: -4.8, width: 1.8, depth: 1.05, height: .76 },
        { id: 'ticket-table-g', x: 2.15, z: -4.8, width: 1.8, depth: 1.05, height: .76 }
      ];
      this._box(-3.15,0,-2.2,2.45,1.55,1.25,'#64462f','#9d7547');
      this._box(0,0,-2.15,1.45,1.2,1.2,'#8b6742','#b18a56');
      this._box(3.12,0,-2.17,2.45,1.35,1.2,'#60462f','#a17b4a');
      this._box(-5,0,1.45,2.2,.62,.6,'#634b35');

      // Extra Ticket Hall furniture: three desks with different silhouettes.
      // Their object dimensions are intentionally unchanged; only room floor
      // area is expanded by the room transform.
      this._buildWorkTable(-4.25, -.15, 1.9, .78, 1.15, {
        top:'#876542', apron:'#5d402b', legs:'#503827', accent:'#b18a58'
      });
      this._buildWorkTable(-.10, 3.15, 2.05, .80, 1.20, {
        top:'#6f5b43', apron:'#46382b', legs:'#46382b', accent:'#a78b63'
      });
      this._buildWorkTable(4.25, -.10, 1.85, .78, 1.15, {
        top:'#755038', apron:'#503524', legs:'#493020', accent:'#bd9461'
      });
      // Two compact side desks create distinct search areas along the rear corners.
      this._buildWorkTable(-5.0, -4.1, 1.9, .76, 1.0, {
        top:'#795b3b', apron:'#523b29', legs:'#493626', accent:'#b18a58'
      });
      this._buildWorkTable(5.0, -4.1, 1.9, .76, 1.0, {
        top:'#6e5237', apron:'#493526', legs:'#433124', accent:'#a98455'
      });
      // Two central archive desks fill the formerly empty rear aisle. Their four
      // drawers include one hidden clue and three intentionally empty trays.
      this._buildWorkTable(-2.15, -4.8, 1.8, .76, 1.05, {
        top:'#76583c', apron:'#4d3929', legs:'#443123', accent:'#b18a58'
      });
      this._buildWorkTable(2.15, -4.8, 1.8, .76, 1.05, {
        top:'#806044', apron:'#513b29', legs:'#463222', accent:'#b8905e'
      });
      this._buildChair(-5.0, -2.8, .72);
      this._buildChair(5.0, -2.8, .72);
      this._buildChair(-2.15, -3.45, .72);
      this._buildChair(2.15, -3.45, .72);

      // Desk-top objects make the area feel used without adding more paper
      // pickups: bound books, a document tray, a pen cup and a small lamp.
      this._box(-4.60,.885,-.34,.34,.055,.25,'#334d5b','#8c7654');
      this._box(-4.60,.945,-.34,.34,.055,.25,'#6a3f38','#bd9a68');
      this._box(-3.78,.89,-.28,.24,.10,.24,'#41372f','#a98758');
      this._box(-.58,.905,2.92,.42,.055,.30,'#4c5962','#b28d5d');
      this._box(-.58,.965,2.92,.42,.055,.30,'#786047','#c09c6c');
      this._box(.56,.905,3.02,.22,.16,.22,'#332d28','#a88758');
      this._box(4.00,.885,-.20,.30,.055,.24,'#65503a','#b08b5b');
      this._box(4.50,.885,-.26,.11,.28,.11,'#4e463b','#b28d5e');
      this._box(4.50,1.165,-.26,.34,.10,.34,'#ddc89d','#a17a4d');
      // Small bound volumes, a ledger stack and a desk lamp make the added
      // side desks readable as furnished workstations, not bare collision boxes.
      this._box(-5.48,.825,-4.28,.38,.05,.28,'#405664','#b18c5c');
      this._box(-5.48,.88,-4.28,.38,.05,.28,'#765047','#c2a06b');
      this._box(-4.72,.825,-4.25,.22,.12,.20,'#332c25','#a98758');
      this._box(4.65,.825,-4.28,.34,.05,.26,'#6c4a3b','#b18c5c');
      this._box(5.38,.825,-4.25,.12,.23,.12,'#453f36','#a98758');
      this._box(5.38,1.06,-4.25,.34,.08,.34,'#d5c49c','#a98758');
      // Additional desk clutter: closed ledgers, a small sorting tray and parcels.
      this._box(-2.62,.825,-4.92,.42,.05,.30,'#3d5360','#b18c5c');
      this._box(-2.62,.88,-4.92,.42,.05,.30,'#764a3b','#c2a06b');
      this._box(-1.72,.825,-4.91,.32,.11,.23,'#41352c','#9e8058');
      this._box(1.72,.825,-4.90,.38,.05,.29,'#45565a','#b18c5c');
      this._box(1.72,.88,-4.90,.38,.05,.29,'#79533d','#c2a06b');
      this._box(2.62,.825,-4.92,.25,.15,.24,'#514536','#a98758');
    } else if (this.roomKind === 'reading') {
      this._box(0,0,-2.45,6.5,.82,1,'#56432f','#9b7747');
      for (const x of [-4.2,-1.8,1.8,4.2]) {
        this._roomBox(x,1.4,-5.65,1.65,1.65,.12,'#9e8155','#c0a36f');
        // Front-facing picture surface sits just in front of the frame's +Z face.
        // The renderer maps the supplied photo across this intact four-sided surface.
        this._polyFixed([
          [x-.58,1.56,-5.565], [x+.58,1.56,-5.565],
          [x+.58,2.72,-5.565], [x-.58,2.72,-5.565]
        ], x, -5.65, '#594736', null, 'gallery-photo');
        // Small brass caption rail below each original gallery photograph.
        this._roomBox(x,1.30,-5.65,.84,.16,.10,'#574633','#b18a58');
      }
      for (const x of [-5,-2.5,0,2.5,5]) this._buildChair(x, 1.1, .64);
    } else {
      this._box(-3.7,0,-2.45,2.7,2.15,1.3,'#58412d','#947044');
      this._box(0,0,-2.35,1.8,1.1,1.5,'#80603c','#a5814f');
      this._box(3.45,0,-2.15,2.8,1.45,.15,'#d0c2a2','#a17c4b');
      this._box(1.9,0,.25,1.25,.95,1.1,'#735337','#9b7547');
      // Matching archive tables occupy the open front half of the Storeroom.
      // Their tops host the final loose word slips instead of leaving them
      // floating beside the old cabinet/shelf arrangement.
      this._buildWorkTable(-3.0, 3.65, 2.2, .76, 1.1, {
        top:'#765a3e', apron:'#4d3929', legs:'#443123', accent:'#b18a58'
      });
      this._buildWorkTable(3.0, 3.65, 2.2, .76, 1.1, {
        top:'#806044', apron:'#513b29', legs:'#463222', accent:'#b8905e'
      });
    }

    // Drawer units are attached to the existing desks/cabinets. The first four
    // word slips in each room are placed inside these trays and stay hidden until
    // the corresponding drawer is opened.
    for (const drawer of this.drawers.filter(item => item.roomIndex === roomIndex)) this._buildDrawerGeometry(drawer);

    // Each room has five physical answer consoles. Loose word slips are
    // separate collectibles scattered across the room's furniture.
    const panelSpots = this._answerPanelSpots(this.roomKind);
    panelSpots.forEach((spot, index) => {
      this._roomBox(spot.x, spot.y, spot.z, .82, .62, .14, '#29383a', '#b18a55');
      const faceDirection = spot.faceSide === 'front' ? -1 : 1;
      const faceZ = spot.z + faceDirection * .076;
      const facePoints = spot.faceSide === 'front'
        ? [[spot.x+.34,spot.y+.12,faceZ], [spot.x-.34,spot.y+.12,faceZ],
           [spot.x-.34,spot.y+.54,faceZ], [spot.x+.34,spot.y+.54,faceZ]]
        : [[spot.x-.34,spot.y+.12,faceZ], [spot.x+.34,spot.y+.12,faceZ],
           [spot.x+.34,spot.y+.54,faceZ], [spot.x-.34,spot.y+.54,faceZ]];
      this._polyFixed(facePoints, spot.x, spot.z, '#172529', '#c09a60', null,
        { answerPanelIndex: index, answerPanelRoom: roomIndex });
    });
    const wordPapers = this.currentGame?.rooms?.[roomIndex]?.wordPapers || [];
    this._activeLayer = 2;
    for (const paper of wordPapers) {
      const width = paper.width || .72, depth = paper.depth || .43;
      const top = paper.y + (paper.drawerId ? .012 : .018);
      const paperAngle = paper.angle || 0;
      const paperCos = Math.cos(paperAngle), paperSin = Math.sin(paperAngle);
      const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([px,pz]) => {
        const dx = px * width * .5, dz = pz * depth * .5;
        return [paper.x + dx * paperCos - dz * paperSin, top, paper.z + dx * paperSin + dz * paperCos];
      });
      this._polyObjectFixed(corners, paper.x, paper.z, paper.tint || '#eee5d1', '#9b8a70', null, {
        wordPaperIndex: paper.id, wordPaperRoom: roomIndex, wordPaperDisplay: paper.display,
        ...(paper.drawerId ? { drawerId: paper.drawerId, drawerPaper: true, drawerMove: true, noVertexDedup: true } : {})
      });
    }
    this._activeLayer = 1;
    // Seating exists in all three spaces. The pair is kept away from the doorway.
    this._buildChair(-5.05, 2.8, .72);
    this._buildChair(5.05, 2.8, .72);

    const trim = this.dark ? '#171b1e' : '#9b805d';
    this._activeLayer = -1;
    for (let z = -5; z <= 5; z += 1.5) {
      this._polyRoomLength([[-6.8,0.012,z],[6.8,0.012,z],[6.8,0.018,z+0.025],[-6.8,0.018,z+0.025]], z, this.dark ? '#111518' : 'rgba(24,20,17,.22)');
    }
    this._activeLayer = 1;
    this._poly([[-6.8,.18,-5.94],[6.8,.18,-5.94],[6.8,.28,-5.94],[-6.8,.28,-5.94]], trim);
    this._poly([[-6.8,4.12,-5.94],[6.8,4.12,-5.94],[6.8,4.2,-5.94],[-6.8,4.2,-5.94]], trim);
    if (roomIndex === 0) {
      // A framed clock gives the ticket hall a readable landmark; its hands
      // are drawn on the lightweight ambient overlay rather than rebuilt geometry.
      this._roomBox(-5.55,2.12,-5.72,.86,1.02,.16,'#49382a','#b18a55');
    } else if (roomIndex === 2) {
      // The storeroom's wall fan is an animated overlay mounted over this plate.
      this._roomBox(-5.55,2.72,-5.72,.86,.86,.16,'#343d38','#b18a55');
    }
    for (const x of [-5.6,-2.8,0,2.8,5.6]) this._roomBox(x,4.25,-2.8,.12,.16,6.1, this.dark ? '#171c20' : '#6b6254');
    for (const x of [-3.8,0,3.8]) {
      this._roomBox(x,4.1,-1.6,.42,.08,.42, this.dark ? '#282018' : '#c3a477');
      this.lamps.push({ x: x * this.roomScaleX + (this._worldOffsetX || 0), y: 3.96, z: -1.6 * this.roomScaleZ });
    }
    if (roomIndex !== 2) {
      this._roomBox(0,0,-5.84,2.38,3.18,.12, this.dark ? '#211d18' : '#715338');
      this._roomBox(0,.08,-5.72,1.92,2.9,.10, this.dark ? '#211b16' : '#493628', this.dark ? '#443322' : '#b38c54');
      this._roomBox(.69,1.35,-5.61,.055,.22,.06,'#c4a66e');
    }
    // The keypad and its buttons are part of the door lock, so they vanish
    // together with the door panel when this room's code is accepted.
    if (roomIndex < 2) {
      this._activeLockBarrier = roomIndex;
      this._roomBox(6.38, 1.03, 0, .18, .44, .28, '#242b2c', '#c49a61');
      for (const z of [-.075, 0, .075]) this._poly([[6.49,1.19,z-.025],[6.49,1.19,z+.025],[6.49,1.25,z+.025],[6.49,1.25,z-.025]], '#d8c49a');
      this._activeLockBarrier = null;
    } else if (!this.libraryDoorOpen) {
      // The Storeroom keypad is mounted on the right jamb, outside the clear
      // doorway width, so the actual exit door remains visible and usable.
      this._activeLockBarrier = 'library';
      this._roomBox(1.55, .98, -5.70, .30, .56, .16, '#242b2c', '#c49a61');
      this._poly([[1.43,1.12,-5.595],[1.67,1.12,-5.595],[1.67,1.43,-5.595],[1.43,1.43,-5.595]], '#172529', '#c09a60');
      this._activeLockBarrier = null;
    }
    if (this.roomKind === 'grammar') {
      for (const x of [-5.7,5.7]) {
        this._box(x,0,-1.0,.16,3.15,.22, this.dark ? '#25211b' : '#705236');
        for (const y of [0.8,1.7,2.6]) this._box(x, y, -1.0, 1.05,.08,1.2, this.dark ? '#2b261f' : '#8a6944');
      }
    }
  }

  _buildChair(x, z, seatY = .72) {
    const wood = '#65482f';
    const leg = .075, seatW = .72, seatD = .68;
    this._box(x, seatY, z, seatW, .13, seatD, '#8a6845', '#b18a58');
    for (const dx of [-.29,.29]) for (const dz of [-.26,.26]) {
      this._box(x+dx, 0, z+dz, leg, seatY, leg, wood);
    }
    // All current tables are positioned toward -Z from their chairs; place
    // the backrest behind the sitter on +Z so the chair faces the tables.
    const oldTag = this._activeObjectTag;
    this._activeObjectTag = 'chair-back';
    this._box(x, seatY+.13, z+.27, seatW, .88, .11, wood, '#9b754a');
    this._activeObjectTag = oldTag || null;
  }

  _clipProject(points) {
    const near = 0.12;
    let polygon = points.map(point => this._cameraPoint(point[0], point[1], point[2]));
    const clipped = [];
    for (let i = 0; i < polygon.length; i++) {
      const current = polygon[i];
      const next = polygon[(i + 1) % polygon.length];
      const currentInside = current.forward >= near;
      const nextInside = next.forward >= near;
      if (currentInside && nextInside) {
        clipped.push(next);
      } else if (currentInside && !nextInside) {
        const t = (near - current.forward) / (next.forward - current.forward);
        clipped.push({
          forward: near,
          lateral: current.lateral + (next.lateral - current.lateral) * t,
          vertical: current.vertical + (next.vertical - current.vertical) * t
        });
      } else if (!currentInside && nextInside) {
        const t = (near - current.forward) / (next.forward - current.forward);
        clipped.push({
          forward: near,
          lateral: current.lateral + (next.lateral - current.lateral) * t,
          vertical: current.vertical + (next.vertical - current.vertical) * t
        });
        clipped.push(next);
      }
    }
    if (clipped.length < 3) return null;
    let depth = 0;
    const projected = clipped.map(point => {
      depth += point.forward;
      return this._projectCamera(point);
    });
    depth /= clipped.length;
    return { projected, depth };
  }

  _prepareVertexTransforms(faces) {
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    const tanPitch = Math.tan(this.pitch);
    this._sinYaw = sinYaw;
    this._cosYaw = cosYaw;
    const focal = this.height * 0.90;
    const cx = this.camera.x, cy = this.camera.y, cz = this.camera.z;
    const vertices = this._vertices;
    const forward = this._camForward;
    const lateral = this._camLateral;
    const vertical = this._camVertical;
    const sx = this._screenX, sy = this._screenY;
    const stamps = this._vertexStamps;
    let stamp = (this._vertexStamp + 1) >>> 0;
    if (stamp === 0) {
      stamps.fill(0);
      stamp = 1;
    }
    this._vertexStamp = stamp;

    // Transform only vertices referenced by faces that can actually be drawn.
    // The previous group-range pass also transformed every vertex in both
    // neighbouring rooms even though only their boundary walls were visible.
    for (const face of faces) {
      const indices = face.indices;
      for (let j = 0; j < indices.length; j++) {
        const i = indices[j];
        if (stamps[i] === stamp) continue;
        stamps[i] = stamp;
        const point = vertices[i];
        const dx = point[0] - cx;
        const dz = point[2] - cz;
        const f = dx * -sinYaw + dz * -cosYaw;
        const l = dx * cosYaw - dz * sinYaw;
        const v = point[1] - cy;
        forward[i] = f;
        lateral[i] = l;
        vertical[i] = v;
        if (f > 0.12) {
          const scale = focal / f;
          sx[i] = this.width * 0.5 + l * scale;
          sy[i] = this.height * 0.54 - (v - tanPitch * f) * scale;
        } else {
          sx[i] = 0;
          sy[i] = 0;
        }
      }
    }
  }

  _physicalRoomForX(x) {
    const firstBoundary = (this.roomOffsets[0] + this.roomOffsets[1]) * .5;
    const secondBoundary = (this.roomOffsets[1] + this.roomOffsets[2]) * .5;
    return x < firstBoundary ? 0 : x < secondBoundary ? 1 : 2;
  }

  isInLibrary() {
    const front = LIBRARY_FRONT_WORLD_Z;
    const rear = LIBRARY_WORLD_OFFSET_Z - 28 * 1.25;
    return this.camera.x >= this.roomOffsets[2] - 9.5 &&
      this.camera.x <= this.roomOffsets[2] + 9.5 && this.camera.z < front + .8 && this.camera.z > rear - .8;
  }

  _getLoadedRoomGroups() {
    // Keep all geometry resident, but render only the room the player occupies.
    // Adjacent room groups contribute only real enclosing perimeter walls and
    // connector architecture; neighbouring props and papers stay hidden.
    this.physicalRoomIndex = this._physicalRoomForX(this.camera.x);
    this.inLibrary = this.isInLibrary();
    const active = this.inLibrary ? 3 : this.physicalRoomIndex;
    this.renderRoomIndex = active;
    const groups = this._loadedRoomGroupPool || (this._loadedRoomGroupPool = []);
    groups.length = 0;
    const indexed = this._roomGroupsByIndex || (this._roomGroupsByIndex = []);
    const add = index => {
      const group = indexed[index] || this.roomFaceGroups.find(item => item.roomIndex === index);
      if (group && groups[groups.length - 1] !== group) groups.push(group);
    };
    add(active);
    if (active >= 0 && active <= 2) {
      if (active > 0) add(active - 1);
      if (active < 2) add(active + 1);
      if (active === 2) add(3); // render the Library's actual perimeter wall, not its props
    } else if (active === 3) {
      add(2); // render the Storeroom perimeter and connector from inside the Library
    }
    return groups;
  }

  _projectFace(face) {
    const indices = face.indices;
    const near = 0.12;
    let needsClip = false;
    let depth = 0;
    for (let i = 0; i < indices.length; i++) {
      const forward = this._camForward[indices[i]];
      if (forward < near) needsClip = true;
      depth += forward;
    }

    // Reuse each face's projected-point buffer so normal frames do not allocate
    // a fresh point array/object graph for every polygon.
    const points = face._framePoints || (face._framePoints = []);
    if (needsClip) {
      const clipped = this._clipProject(face.points);
      if (!clipped) return null;
      depth = clipped.depth;
      points.length = clipped.projected.length;
      for (let i = 0; i < clipped.projected.length; i++) {
        const source = clipped.projected[i];
        const target = points[i] || (points[i] = { x: 0, y: 0, depth: 0 });
        target.x = source.x;
        target.y = source.y;
        target.depth = source.depth;
      }
    } else {
      depth /= indices.length;
      points.length = indices.length;
      for (let i = 0; i < indices.length; i++) {
        const index = indices[i];
        const target = points[i] || (points[i] = { x: 0, y: 0, depth: 0 });
        target.x = this._screenX[index];
        target.y = this._screenY[index];
        target.depth = this._camForward[index];
      }
    }
    if (points.length < 3) return null;

    // Conservative viewport culling: keep a face whenever any part of its
    // projected bounds can touch the canvas. No back-face or occlusion culling
    // is performed, so walls and furniture are never discarded by orientation.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
    const margin = 12;
    if (maxX < -margin || minX > this.width + margin ||
        maxY < -margin || minY > this.height + margin) return null;

    const bounds = face._screenBounds || (face._screenBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    bounds.minX = minX; bounds.minY = minY; bounds.maxX = maxX; bounds.maxY = maxY;
    face._depth = depth;
    let nearDepth = Infinity;
    for (let i = 0; i < points.length; i++) if (points[i].depth < nearDepth) nearDepth = points[i].depth;
    face._nearDepth = nearDepth;
    return face;
  }

  _drawTexturedQuad(face, projected, ctx) {
    const image = this.galleryImage;
    if (!image || !image.complete || !(image.naturalWidth || image.width)) return false;
    if (projected.length !== 4) return false;

    // Map the complete image to one clipped quadrilateral using a best-fit
    // affine transform. The frame remains a single four-sided surface; no
    // internal triangle fan or diagonal seam is introduced.
    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;
    const p = projected;
    // Face order: bottom-left, bottom-right, top-right, top-left.
    const cx = (p[0].x + p[1].x + p[2].x + p[3].x) * 0.25;
    const cy = (p[0].y + p[1].y + p[2].y + p[3].y) * 0.25;
    const ax = ((p[1].x + p[2].x) - (p[0].x + p[3].x)) * 0.5;
    const ay = ((p[1].y + p[2].y) - (p[0].y + p[3].y)) * 0.5;
    const bx = ((p[0].x + p[1].x) - (p[2].x + p[3].x)) * 0.5;
    const by = ((p[0].y + p[1].y) - (p[2].y + p[3].y)) * 0.5;
    const a = ax / w, b = ay / w;
    const c = bx / h, d = by / h;
    const e = cx - (ax + bx) * 0.5;
    const f = cy - (ay + by) * 0.5;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    ctx.lineTo(p[1].x, p[1].y);
    ctx.lineTo(p[2].x, p[2].y);
    ctx.lineTo(p[3].x, p[3].y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(image, 0, 0, w, h);
    ctx.restore();
    return true;
  }

  _drawProjectedFace(face, ctx) {
    const points = face._framePoints;
    if (face.texture === 'gallery-photo' && points.length === 4 && this._drawTexturedQuad(face, points, ctx)) return;

    ctx.beginPath();
    ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));
    for (let i = 1; i < points.length; i++) ctx.lineTo(Math.round(points[i].x), Math.round(points[i].y));
    ctx.closePath();
    ctx.fillStyle = face.fill;
    ctx.fill();
    if (face.stroke) {
      ctx.strokeStyle = face.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  _drawClippedFaceOutline(face, ctx) {
    if (!face.stroke) return;
    // Clip each original edge independently. Stroking the clipped fill polygon
    // closes its artificial near-plane edge, which used to create long diagonal
    // seams across walls and floors when a surface crossed the camera plane.
    const points = face.points;
    const near = 0.12;
    ctx.beginPath();
    let hasSegment = false;
    for (let i = 0; i < points.length; i++) {
      const a = this._cameraPoint(points[i][0], points[i][1], points[i][2]);
      const next = points[(i + 1) % points.length];
      const b = this._cameraPoint(next[0], next[1], next[2]);
      const aInside = a.forward >= near;
      const bInside = b.forward >= near;
      if (!aInside && !bInside) continue;
      let p0 = a, p1 = b;
      if (aInside !== bInside) {
        const t = (near - a.forward) / (b.forward - a.forward);
        const intersection = {
          forward: near,
          lateral: a.lateral + (b.lateral - a.lateral) * t,
          vertical: a.vertical + (b.vertical - a.vertical) * t
        };
        if (!aInside) p0 = intersection;
        else p1 = intersection;
      }
      const s0 = this._projectCamera(p0);
      const s1 = this._projectCamera(p1);
      if (!Number.isFinite(s0.x + s0.y + s1.x + s1.y)) continue;
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(s1.x, s1.y);
      hasSegment = true;
    }
    if (hasSegment) {
      ctx.strokeStyle = face.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  _drawPrimitive(primitive, ctx) {
    const face = primitive.face;
    const points = primitive.points;
    if (!points || points.length < 3) return;
    if (primitive.type === 'texture' && points.length === 4) {
      if (this.paintingOverlayCtx && this.galleryImage?.complete && this.galleryImage?.naturalWidth) return;
      if (this._drawTexturedQuad(face, points, ctx)) return;
    }

    // Draw the face as one intact polygon (normally a quad). Do not fan-split
    // surfaces into triangles: this avoids visible diagonal seams and keeps
    // one depth value and one draw call per surface.
    ctx.beginPath();
    ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));
    for (let i = 1; i < points.length; i++) ctx.lineTo(Math.round(points[i].x), Math.round(points[i].y));
    ctx.closePath();
    ctx.fillStyle = face.fill;
    ctx.fill();
    if (face.stroke) {
      ctx.strokeStyle = face.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    this._drawFaceDetails(face, points, ctx);
  }

  _drawFaceDetails(face, points, ctx) {
    if (points.length !== 4) return;
    if (Number.isInteger(face.paperIndex) || Number.isInteger(face.libraryNoteIndex)) this._drawPaperDetails(face, points, ctx);
    if (Number.isInteger(face.wordPaperIndex)) this._drawWordPaperDetails(face, points, ctx);
    if (Number.isInteger(face.answerPanelIndex)) this._drawAnswerPanelDetails(face, points, ctx);
    if (Number.isInteger(face.libraryBookIndex)) this._drawLibraryBookDetails(face, points, ctx);
  }

  _inscribedRect(points, out, offset) {
    const n = points.length;
    if (n < 3) return false;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += Math.round(points[i].x); cy += Math.round(points[i].y); }
    cx /= n; cy /= n;
    let left = -Infinity, right = Infinity, top = -Infinity, bottom = Infinity;
    for (let i = 0; i < n; i++) {
      const ax = Math.round(points[i].x), ay = Math.round(points[i].y);
      const bx = Math.round(points[(i + 1) % n].x), by = Math.round(points[(i + 1) % n].y);
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
        const x = ax + (cy - ay) * (bx - ax) / (by - ay);
        if (x <= cx) { if (x > left) left = x; } else if (x < right) right = x;
      }
      if ((ax <= cx && bx > cx) || (bx <= cx && ax > cx)) {
        const y = ay + (cx - ax) * (by - ay) / (bx - ax);
        if (y <= cy) { if (y > top) top = y; } else if (y < bottom) bottom = y;
      }
    }
    if (!(left > -Infinity && right < Infinity && top > -Infinity && bottom < Infinity)) return false;
    for (const scale of [1, .85, .7, .5]) {
      const l = cx + (left - cx) * scale + 1, r = cx + (right - cx) * scale - 1;
      const t = cy + (top - cy) * scale + 1, b = cy + (bottom - cy) * scale - 1;
      if (r - l < 12 || b - t < 12) return false;
      if (this._rectInsideConvex(points, l, t, r, b)) {
        out[offset] = l; out[offset + 1] = t; out[offset + 2] = r; out[offset + 3] = b;
        return true;
      }
    }
    return false;
  }

  _rectInsideConvex(points, l, t, r, b) {
    const n = points.length;
    let sign = 0;
    for (let i = 0; i < n; i++) {
      const ax = Math.round(points[i].x), ay = Math.round(points[i].y);
      const bx = Math.round(points[(i + 1) % n].x), by = Math.round(points[(i + 1) % n].y);
      const ex = bx - ax, ey = by - ay;
      for (let k = 0; k < 4; k++) {
        const px = k & 1 ? r : l, py = k & 2 ? b : t;
        const cross = ex * (py - ay) - ey * (px - ax);
        if (cross === 0) continue;
        const s = cross > 0 ? 1 : -1;
        if (sign === 0) sign = s; else if (s !== sign) return false;
      }
    }
    return true;
  }

  _drawLibraryBookDetails(face, points, ctx) {
    const bounds = face._screenBounds;
    if (bounds && bounds.maxX - bounds.minX < 10 && bounds.maxY - bounds.minY < 10) return;
    const [a,b,c,d] = points;
    ctx.strokeStyle = 'rgba(218,190,130,.62)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const bands = face.bookBand ? BOOK_BAND_LINES : BOOK_PLAIN_LINES;
    for (let i = 0; i < bands.length; i++) {
      const t = bands[i];
      ctx.moveTo(a.x + (d.x - a.x) * t, a.y + (d.y - a.y) * t);
      ctx.lineTo(b.x + (c.x - b.x) * t, b.y + (c.y - b.y) * t);
    }
    ctx.stroke();
  }

  _drawWordPaperDetails(face, points, ctx) {
    const [a,b,c,d] = points;
    const lerp = (p,q,t) => ({ x:p.x+(q.x-p.x)*t, y:p.y+(q.y-p.y)*t });
    ctx.save();
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.lineTo(c.x,c.y); ctx.lineTo(d.x,d.y); ctx.closePath(); ctx.clip();
    ctx.strokeStyle = 'rgba(92,75,53,.30)'; ctx.lineWidth = .55;
    for (const t of [.28,.72]) {
      const left = lerp(a,d,t), right = lerp(b,c,t);
      ctx.beginPath(); ctx.moveTo(left.x,left.y); ctx.lineTo(right.x,right.y); ctx.stroke();
    }
    const text = String(face.wordPaperDisplay || 'WORD').trim();
    const centerTop = lerp(lerp(a,d,.28),lerp(b,c,.28),.5);
    const width = Math.hypot(b.x-a.x,b.y-a.y);
    const font = Math.max(5, Math.min(10, width * .11));
    ctx.fillStyle = '#41382d'; ctx.font = `800 ${font}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const short = text.length > 24 ? `${text.slice(0,23)}…` : text;
    ctx.fillText(short, centerTop.x, centerTop.y, Math.max(10,width*.92));
    ctx.restore();
  }

  _drawAnswerPanelDetails(face, points, ctx) {
    const [a,b,c,d] = points;
    const centerX = points.reduce((sum,p)=>sum+p.x,0)/4;
    const centerY = points.reduce((sum,p)=>sum+p.y,0)/4;
    const libraryPanel = face.answerPanelRoom === 'library';
    const status = libraryPanel ? this.libraryPanelSolved?.[face.answerPanelIndex] : this.paperByRoom[face.answerPanelRoom]?.solved?.[face.answerPanelIndex];
    const code = libraryPanel ? (this.currentGame?.rooms?.[3]?.code?.[face.answerPanelIndex] ?? '?') : this.paperByRoom[face.answerPanelRoom]?.codes?.[face.answerPanelIndex];
    ctx.save();
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.lineTo(c.x,c.y); ctx.lineTo(d.x,d.y); ctx.closePath(); ctx.clip();
    ctx.fillStyle = 'rgba(9,17,20,.55)'; ctx.fill();
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='#d5b477'; ctx.font='700 7px system-ui,sans-serif';
    ctx.fillText(status ? `FOUND · ${code ?? ''}` : `ANSWER ${face.answerPanelIndex+1}`, centerX, centerY, Math.max(12,Math.hypot(b.x-a.x,b.y-a.y)-4));
    ctx.restore();
  }

  _drawPaperDetails(face, points, ctx) {
    if (Number.isInteger(face.libraryNoteIndex)) {
      const p0 = points[0], p1 = points[1], p2 = points[2], p3 = points[3];
      const lerp = (a,b,t) => ({ x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t });
      const noteTitles = ['CATALOGUING','CONSERVATION','CLASSIFICATION','ACQUISITIONS','REFERENCE DESK','RESTORATION','ARCHIVE RULES','INDEX CARDS','QUIET STUDY','COLLECTION NOTE'];
      const center = lerp(lerp(p0,p3,.34),lerp(p1,p2,.34),.5);
      const width = Math.hypot(p1.x-p0.x,p1.y-p0.y);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.closePath(); ctx.clip();
      ctx.globalAlpha = .12; ctx.fillStyle = '#51483a'; ctx.font = `600 ${Math.max(3.2,Math.min(4,width*.055))}px system-ui,sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(noteTitles[face.libraryNoteIndex] || 'ARCHIVE WORD', center.x, center.y, Math.max(10,width*.9));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(48,39,28,.35)'; ctx.lineWidth = .55;
      for (const t of [.58,.76]) {
        const a=lerp(p0,p3,t), b=lerp(p1,p2,t);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    const state = this.paperByRoom[face.paperRoom] || { codes: this.paperCodes || [], solved: this.paperSolved || [] };
    const index = face.paperIndex;
    const leftBack = points[0], rightBack = points[1], rightFront = points[2], leftFront = points[3];
    const lerp = (a, b, t) => ({ x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t });
    ctx.save();
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let i=1;i<points.length;i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath(); ctx.clip();
    ctx.strokeStyle = 'rgba(93,82,66,.26)'; ctx.lineWidth = .45;
    for (const t of [.25,.42,.59]) {
      const a = lerp(leftBack,leftFront,t), b = lerp(rightBack,rightFront,t);
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
    const c0 = lerp(leftBack,rightBack,.5), c1 = lerp(leftFront,rightFront,.5);
    const center = lerp(c0,c1,.82);
    const solved = !!state.solved?.[index];
    const code = state.codes?.[index] ?? this.paperCodes?.[index] ?? '?';
    const fontSize = Math.max(5, Math.min(9, Math.hypot(rightBack.x-leftBack.x,rightBack.y-leftBack.y)*.12));
    ctx.font = `700 ${fontSize}px ui-monospace,monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#74634d';
    ctx.fillText(solved ? `CODE ${code}` : `CLUE ${index+1}`, center.x, center.y);
    ctx.restore();
  }

  _doorBarrierIsOpen(face) {
    if (face.doorBarrier === 'library' || face.lockBarrier === 'library') return !!this.libraryDoorOpen;
    if (face.doorBarrier === 'exit' || face.lockBarrier === 'exit') return this.exitOpen;
    if (Number.isInteger(face.doorBarrier)) return !!this.doorOpen[face.doorBarrier];
    if (Number.isInteger(face.lockBarrier)) return !!this.doorOpen[face.lockBarrier];
    return false;
  }

  _drawGalleryOverlay() {
    const overlay = this.paintingOverlay;
    const ctx = this.paintingOverlayCtx;
    if (!overlay || !ctx || !this.galleryImage?.complete || !this.galleryImage?.naturalWidth) return;
    const photos = this._galleryPhotoPool;
    photos.length = 0;
    for (const item of this._drawPrimitives) {
      if (item.type === 'texture' && item.points?.length === 4) photos.push(item);
    }
    if (!photos.length || this.renderRoomIndex !== 1) {
      overlay.style.display = 'none';
      return;
    }

    // Keep a fixed full-viewport backing store while in the gallery. Resizing a
    // cropped overlay every camera frame caused 1px resampling jumps and visible
    // photo flicker. The bounded pixel budget keeps the transparent overlay cheap.
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
    const budgetScale = Math.sqrt(700000 / Math.max(1, this.width * this.height));
    const scale = Math.max(.05, Math.min(dpr, budgetScale, 1.5));
    const pixelWidth = Math.max(1, Math.round(this.width * scale));
    const pixelHeight = Math.max(1, Math.round(this.height * scale));
    if (overlay.width !== pixelWidth) overlay.width = pixelWidth;
    if (overlay.height !== pixelHeight) overlay.height = pixelHeight;
    const cachedRect = this._galleryOverlayRect;
    if (!cachedRect || cachedRect.left !== rect.left || cachedRect.top !== rect.top || cachedRect.width !== this.width || cachedRect.height !== this.height) {
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${this.width}px`;
      overlay.style.height = `${this.height}px`;
      this._galleryOverlayRect = { left: rect.left, top: rect.top, width: this.width, height: this.height };
    }
    overlay.style.display = 'block';
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = this.dark ? (this.torch ? .62 : .16) : 1;
    for (const photo of photos) this._drawTexturedQuad(photo.face, photo.points, ctx);
    ctx.globalAlpha = 1;

    // Stable foreground-only masking. Gallery artwork is mounted on the rear
    // wall, so only prop layers (furniture, shelving, papers) can occlude it.
    // Do not compare average depths here: those thresholds changed abruptly as
    // camera-space values fluctuated by a few pixels and made paintings flicker.
    ctx.globalCompositeOperation = 'destination-out';
    // One foreground mask pass is sufficient for every painting: destination-
    // out on transparent parts of the overlay is a no-op. The previous nested
    // photo × face loop repeated identical masks once per painting.
    for (const face of this._frameFaces) {
      if (face.texture === 'gallery-photo' || face.roomIndex !== 1 || face.layer < 1) continue;
      const points = face._framePoints;
      if (!points || points.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    for (const point of this.projectedHotspots) {
      if (point.x < 0 || point.x > this.width || point.y < 0 || point.y > this.height) continue;
      const radius = Math.max(5, Math.min(15, (this.width * .28867513459481287 / point.depth) * .10));
      ctx.beginPath(); ctx.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(224,182,109,.10)'; ctx.fill();
      ctx.strokeStyle = 'rgba(236,199,133,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(point.x, point.y, radius * .35, 0, Math.PI * 2);
      ctx.fillStyle = '#f1d9a9'; ctx.fill();
    }
    if (this.pointerLocked) {
      const cx = this.width * .5, cy = this.height * .5;
      ctx.strokeStyle = this.focused ? 'rgba(255,214,145,.95)' : 'rgba(245,241,226,.8)';
      ctx.lineWidth = 1.4; ctx.beginPath();
      ctx.moveTo(cx - 8, cy); ctx.lineTo(cx - 3, cy);
      ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy - 3);
      ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + 8); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#f1d9a9'; ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  _drawWorldGeometry() {
    const ctx = this.ctx;
    const loadedGroups = this._getLoadedRoomGroups();
    const activeRoom = this.renderRoomIndex ?? this.physicalRoomIndex ?? 0;
    const visibleFaces = this._visibleFacePool;
    visibleFaces.length = 0;

    const firstEastDoor = this.roomOffsets[0] + 7 * MAIN_ROOM_SCALE;
    const secondEastDoor = this.roomOffsets[1] + 7 * MAIN_ROOM_SCALE;
    const secondWestDoor = this.roomOffsets[1] - 7 * MAIN_ROOM_SCALE;
    const thirdWestDoor = this.roomOffsets[2] - 7 * MAIN_ROOM_SCALE;
    const nearSideConnector = activeRoom >= 0 && activeRoom <= 2 && (
      Math.abs(this.camera.x - firstEastDoor) < 2.4 ||
      Math.abs(this.camera.x - secondWestDoor) < 2.4 ||
      Math.abs(this.camera.x - secondEastDoor) < 2.4 ||
      Math.abs(this.camera.x - thirdWestDoor) < 2.4);
    const nearLibraryConnector = activeRoom === 3
      ? Math.abs(this.camera.z - LIBRARY_FRONT_WORLD_Z) < 4.5
      : activeRoom === 2 && Math.abs(this.camera.z - MAIN_ROOM_REAR_WORLD_Z) < 4.5;

    // Collect only the active room plus the small set of real boundary faces
    // needed to preserve adjacent architecture and the connecting corridors.
    for (const group of loadedGroups) {
      const active = group.roomIndex === activeRoom;
      const source = active ? group.faces : group.boundaryFaces;
      if (!source) continue;
      for (const face of source) {
        if (active) {
          if (face.zone === 'connector' && !nearSideConnector) continue;
          if (face.zone === 'library-connector' && !nearLibraryConnector) continue;
        } else if (activeRoom === 3) {
          if (face.roomIndex !== 2 || (face.zone !== 'library-connector' && face.zone !== 'partition')) continue;
        } else {
          if (face.zone === 'connector' && !nearSideConnector) continue;
          if (face.zone === 'library-connector' && !nearLibraryConnector) continue;
          if (face.zone !== 'partition' && face.zone !== 'connector' && face.zone !== 'library-connector') continue;
        }
        if (Number.isInteger(face.libraryNoteIndex) && this.collectedLibraryPapers.has(face.libraryNoteIndex)) continue;
        if (Number.isInteger(face.paperIndex) && this.collectedRoomPapers.has(face._paperKey || (face._paperKey = `${face.paperRoom}:${face.paperIndex}`))) continue;
        if (Number.isInteger(face.wordPaperIndex) && this.collectedWordPapers.has(face._wordKey || (face._wordKey = `${face.wordPaperRoom}:${face.wordPaperIndex}`))) continue;
        if (face.drawerPaper && !this.drawerById.get(face.drawerId)?.open) continue;
        if (this._doorBarrierIsOpen(face)) continue;
        visibleFaces.push(face);
      }
    }

    this._prepareVertexTransforms(visibleFaces);
    ctx.lineJoin = 'miter';
    const projectedFaces = this._frameFaces;
    projectedFaces.length = 0;
    const drawList = this._drawPrimitives;
    drawList.length = 0;
    let order = 0;
    const camX = this.camera.x, camY = this.camera.y, camZ = this.camera.z;
    for (const face of visibleFaces) {
      if (face.solidSide !== undefined && camY > face.solidBottom) {
        const p0 = face.points[0];
        if (face.solidSide * (face.nx * (camX - p0[0]) + face.ny * (camY - p0[1]) + face.nz * (camZ - p0[2])) <= 0) continue;
      }
      if (!this._projectFace(face)) continue;
      const points = face._framePoints;
      projectedFaces.push(face);
      const primitive = this._drawItemPool[order] || (this._drawItemPool[order] = {});
      primitive.face = face;
      primitive.points = points;
      primitive.key = face.layer * 1024 - Math.min(face._depth, 1000);
      primitive.type = face.texture === 'gallery-photo' && points.length === 4 ? 'texture' : 'fill';
      drawList.push(primitive);
      order++;
    }

    // The renderer has no depth buffer. Preserve semantic layers and sort
    // only the already-culled faces in the active room back-to-front. Array
    // sort is stable, so equal keys keep submission order.
    drawList.sort((a, b) => a.key - b.key);
    const occluders = this._occluderRects || (this._occluderRects = new Float32Array(OCCLUDER_LIMIT * 4));
    let occluderCount = 0;
    for (let i = drawList.length - 1; i >= 0; i--) {
      const primitive = drawList[i];
      const face = primitive.face;
      primitive.skip = false;
      const bounds = face._screenBounds;
      const x0 = bounds.minX - 1, x1 = bounds.maxX + 1, y0 = bounds.minY - 1, y1 = bounds.maxY + 1;
      for (let k = 0; k < occluderCount; k++) {
        const o = k * 4;
        if (x0 >= occluders[o] && x1 <= occluders[o + 2] && y0 >= occluders[o + 1] && y1 <= occluders[o + 3]) { primitive.skip = true; break; }
      }
      if (primitive.skip || occluderCount >= OCCLUDER_LIMIT || primitive.type === 'texture') continue;
      if ((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY) < 600) continue;
      let opaque = face._opaque;
      if (opaque === undefined) opaque = face._opaque = !!face.fill && !face.fill.startsWith('rgba') && !face.fill.startsWith('hsla') && !face.texture;
      if (!opaque) continue;
      if (this._inscribedRect(primitive.points, occluders, occluderCount * 4)) occluderCount++;
    }
    let fill = null, stroke = null;
    ctx.lineWidth = 1;
    for (let i = 0; i < drawList.length; i++) {
      const primitive = drawList[i];
      if (primitive.skip) continue;
      const face = primitive.face;
      if (primitive.type === 'texture') { this._drawPrimitive(primitive, ctx); fill = null; stroke = null; continue; }
      const points = primitive.points;
      ctx.beginPath();
      ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));
      for (let k = 1; k < points.length; k++) ctx.lineTo(Math.round(points[k].x), Math.round(points[k].y));
      ctx.closePath();
      if (face.fill !== fill) { ctx.fillStyle = face.fill; fill = face.fill; }
      ctx.fill();
      if (face.stroke) {
        if (face.stroke !== stroke) { ctx.strokeStyle = face.stroke; stroke = face.stroke; }
        ctx.stroke();
      }
      let detail = face._detail;
      if (detail === undefined) {
        detail = face._detail = Number.isInteger(face.paperIndex) || Number.isInteger(face.libraryNoteIndex) ||
          Number.isInteger(face.wordPaperIndex) || Number.isInteger(face.answerPanelIndex) || Number.isInteger(face.libraryBookIndex);
      }
      if (detail) {
        this._drawFaceDetails(face, points, ctx);
        fill = null; stroke = null; ctx.lineWidth = 1;
      }
    }
    this._frameFaceCount = projectedFaces.length;
  }

  _drawOverlays() {
    const ctx = this.ctx, w = this.width, h = this.height;
    const visibleRoom = this.physicalRoomIndex ?? this._physicalRoomForX(this.camera.x);
    for (const lampData of this.lamps) {
      if (this._physicalRoomForX(lampData.x) !== visibleRoom) continue;
      const lamp = this._project(lampData.x, lampData.y, lampData.z);
      if (lamp && !this.dark) {
        ctx.beginPath();
        ctx.arc(lamp.x, lamp.y, Math.max(2, Math.min(7, lamp.scale * .07)), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,220,157,.75)';
        ctx.fill();
      }
    }
    const libraryArea = this.isInLibrary();
    const plaque = libraryArea
      ? this._project(this.roomOffsets[2],3.7,LIBRARY_WORLD_OFFSET_Z - 25.5 * 1.25)
      : this._project(this.roomOffsets[visibleRoom],3.48,-7.25);
    if (plaque) {
      const visibleKind = this.mapKinds[visibleRoom] || 'vocab';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = this.dark ? '#a38c69' : '#ecd4a8';
      ctx.fillText(libraryArea ? 'LIBRARY' : visibleKind === 'vocab' ? 'TICKET HALL' : visibleKind === 'reading' ? 'MUSEUM GALLERY' : 'STOREROOM', plaque.x, plaque.y);
    }

    this.projectedHotspots.length = 0;
    let projectedHotspotCount = 0;
    for (const point of this.hotspots) {
      if (point.libraryNote && this.collectedLibraryPapers.has(Number(String(point.id).split('-').pop()))) continue;
      const roomPaperMatch = /^paper-(\d)$/.exec(point.id || '');
      if (roomPaperMatch && this.collectedRoomPapers.has(`${point.roomIndex ?? this.roomIndex}:${Number(roomPaperMatch[1])}`)) continue;
      const pointLibrary = !!point.libraryNote;
      const sameArea = (pointLibrary || point.roomIndex === 3)
        ? libraryArea
        : (!libraryArea && this._physicalRoomForX(point.x) === visibleRoom);
      const worldDistance = Math.hypot(point.x-this.camera.x, point.y-this.camera.y, point.z-this.camera.z);
      if (!sameArea || worldDistance > (point.discoverRange || 8.5)) continue;
      const screen = this._project(point.x, point.y + ((pointLibrary || point.wordPaper) ? 0.02 : .35), point.z);
      // Shelf edges frequently intersect the projection of a note's nearby
      // interaction marker. Do not let that screen-space test flicker library
      // note markers; the paper itself is drawn in front of its own shelf.
      if (!screen || screen.depth > 24 || (!pointLibrary && !point.wordPaper && this._isScreenPointOccluded(screen.x, screen.y, screen.depth))) continue;
      const projected = this._projectedHotspotPool[projectedHotspotCount] || (this._projectedHotspotPool[projectedHotspotCount] = {});
      projected.id = point.id; projected.label = point.label; projected.x = screen.x; projected.y = screen.y;
      projected.depth = screen.depth; projected.worldDistance = worldDistance;
      this.projectedHotspots.push(projected);
      projectedHotspotCount++;
      // Loose word papers should be found by looking around, not by following
      // a glowing marker. Their hotspots remain active for E/tap interaction.
      if (!point.wordPaper && !point.libraryNote) {
        const radius = Math.max(5, Math.min(15, screen.scale * .10));
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius + 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(224,182,109,.10)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(236,199,133,.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#f1d9a9';
        ctx.beginPath(); ctx.arc(screen.x, screen.y, radius * .35, 0, Math.PI * 2); ctx.fill();
      }
    }

    if (this.pointerLocked) {
      this._focusCenter();
      const cx = w * .5, cy = h * .5;
      ctx.strokeStyle = this.focused ? 'rgba(255,214,145,.95)' : 'rgba(245,241,226,.8)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy); ctx.lineTo(cx - 3, cy);
      ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy - 3);
      ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + 8);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#f1d9a9'; ctx.fill();
    }


    if (this.dark && !this.torch) {
      ctx.fillStyle = 'rgba(0,0,0,.78)';
      ctx.fillRect(0,0,w,h);
    } else if (this.dark && this.torch) {
      const key = `torch:${w}:${h}`;
      let gradient = this._gradients[key];
      if (!gradient) {
        gradient = ctx.createRadialGradient(w*.5,h*.49,12,w*.5,h*.49,Math.max(w,h)*.55);
        gradient.addColorStop(0,'rgba(255,222,165,.12)');
        gradient.addColorStop(1,'rgba(0,0,0,.76)');
        this._gradients[key] = gradient;
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0,0,w,h);
    }
    this._drawEquippedPaper(ctx, w, h);
    // Omit the full-screen vignette pass; it adds a costly canvas fill every frame.
  }

  _drawEquippedPaper(ctx, w, h) {
    const paper = this.equippedPaper || this.equippedLibraryPaper;
    if (!paper) return;
    const compact = w < 680 || !!window.matchMedia?.('(pointer: coarse)').matches;
    const cardW = compact ? 148 : 206;
    const cardH = compact ? 184 : 258;
    const x = w - cardW - (compact ? 14 : 28);
    const y = h - cardH - (compact ? 226 : 96);
    ctx.save();
    ctx.translate(x + cardW * .5, y + cardH * .5);
    ctx.rotate(-.055);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(-cardW*.5+3, -cardH*.5+4, cardW, cardH);
    ctx.fillStyle = '#e8dfc9';
    ctx.fillRect(-cardW*.5, -cardH*.5, cardW, cardH);
    ctx.strokeStyle = '#8d7c60'; ctx.lineWidth = 1; ctx.strokeRect(-cardW*.5, -cardH*.5, cardW, cardH);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#6f5840';
    ctx.font = `800 ${compact ? 9 : 12}px system-ui,sans-serif`;
    ctx.fillText(String(paper.title).toUpperCase().slice(0, compact ? 22 : 28), -cardW*.5+9, -cardH*.5+10);
    ctx.strokeStyle = 'rgba(106,91,69,.35)'; ctx.lineWidth = .8;
    for (let line = 0; line < 3; line++) {
      const yy = -cardH*.5 + (compact ? 34 : 44) + line * (compact ? 11 : 15);
      ctx.beginPath(); ctx.moveTo(-cardW*.5+9, yy); ctx.lineTo(cardW*.5-9, yy); ctx.stroke();
    }
    ctx.fillStyle = '#4d483e';
    ctx.font = `${compact ? 9 : 12}px system-ui,sans-serif`;
    const words = String(paper.body || '').split(/\s+/);
    const maxWidth = cardW - 18;
    const lineHeight = compact ? 13 : 17;
    let line = '', row = 0;
    const startY = -cardH*.5 + (compact ? 72 : 92);
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const measuredWidth = ctx.measureText?.(candidate)?.width ?? candidate.length * (compact ? 4 : 5);
      if (measuredWidth > maxWidth && line) {
        if (row < (compact ? 7 : 8)) ctx.fillText(line, -cardW*.5+9, startY + row++ * lineHeight);
        line = word;
      } else line = candidate;
    }
    if (line && row < (compact ? 7 : 8)) ctx.fillText(line, -cardW*.5+9, startY + row * lineHeight);
    ctx.restore();
  }

  sitAtChair(localX, z, seatY = .72) {
    const x = this.roomOffsets[this.roomIndex] + localX * this.roomScaleX;
    z *= this.roomScaleZ;
    if (this.seated) return this.standUp();
    if (Math.hypot(this.camera.x - x, this.camera.z - z) > 2.6) return false;
    this._standingPosition = { x: this.camera.x, y: this.eyeHeight + this.jumpHeight, z: this.camera.z, yaw: this.yaw };
    this.camera.x = x;
    this.camera.z = z - .06;
    this.camera.y = Math.max(1.38, seatY + .78);
    this.yaw = 0;
    this.seated = true;
    this.jumpHeight = 0;
    this.jumpVelocity = 0;
    this.groundHeight = 0;
    this.setMovement(0, 0);
    this.invalidate();
    return true;
  }

  sitOnChair(chairIndex) {
    return this.sitAtChair(chairIndex === 0 ? -5.05 : 5.05, 2.8, .72);
  }

  sitOnGalleryChair(chairIndex) {
    const positions = [-5,-2.5,0,2.5,5];
    const localX = positions[Math.max(0, Math.min(4, Number(chairIndex) || 0))];
    return this.sitAtChair(localX, 1.1, .64);
  }

  standUp() {
    if (!this.seated) return false;
    const saved = this._standingPosition;
    if (saved) {
      this.camera.x = saved.x;
      this.camera.y = this.eyeHeight;
      this.groundHeight = 0;
      this.jumpHeight = 0;
      this.jumpVelocity = 0;
      this.camera.z = saved.z;
      this.yaw = saved.yaw;
    }
    this._standingPosition = null;
    this.seated = false;
    this.invalidate();
    return true;
  }

  jump() {
    if (this.seated) return this.standUp();
    if (this.jumpHeight > 0 || this.jumpVelocity > 0) return false;
    this.jumpVelocity = 7.2;
    this.invalidate();
    return true;
  }

  _stepJump(delta) {
    if (this.jumpVelocity === 0 && this.jumpHeight === 0) return false;
    const previous = this.jumpHeight;
    this.jumpVelocity -= 12.5 * delta;
    let next = this.jumpHeight + this.jumpVelocity * delta;

    // The room ceiling is solid. Reserve head clearance above the eye/camera
    // position so jumping from a table cannot push the player through the roof.
    const ceilingY = 4.5;
    const headClearance = 0.65;
    const maxJumpHeight = Math.max(0, ceilingY - headClearance - this.eyeHeight - this.groundHeight);
    if (next > maxJumpHeight) {
      next = maxJumpHeight;
      if (this.jumpVelocity > 0) this.jumpVelocity = 0;
    }

    // Land on the highest low prop crossed while descending. Colliders marked
    // platformable represent tables, desks and similar walkable surfaces.
    if (this.jumpVelocity < 0) {
      let landing = null;
      for (const box of this.colliders) {
        if (!box.platformable || box.height <= this.groundHeight + 0.08) continue;
        if (!this._circleHitsBox(this.camera.x, this.camera.z, box)) continue;
        const relativeTop = box.height - this.groundHeight;
        if (previous >= relativeTop - 0.02 && next <= relativeTop && (!landing || box.height > landing.height)) landing = box;
      }
      if (landing) {
        this.jumpHeight = 0;
        this.groundHeight = landing.height;
        this.jumpVelocity = 0;
        this.camera.y = this.eyeHeight + this.groundHeight;
        this._dirty = true;
        return true;
      }
    }

    this.jumpHeight = next;
    if (this.jumpHeight <= 0) {
      this.jumpHeight = 0;
      this.jumpVelocity = 0;
      this.groundHeight = 0;
    }
    const ceilingEyeLimit = 4.5 - 0.65;
    this.camera.y = Math.min(ceilingEyeLimit, this.eyeHeight + this.groundHeight + this.jumpHeight);
    // Keep jumpHeight and camera height coherent if a future platform is added
    // above the current clearance limit.
    this.jumpHeight = Math.min(this.jumpHeight, Math.max(0, ceilingEyeLimit - this.eyeHeight - this.groundHeight));
    this._dirty = true;
    return true;
  }

  setDark(enabled) {
    const next = !!enabled;
    if (next === this.dark) return;
    this.dark = next;
    // Lighting is a screen-space overlay; keep all static room/prop geometry intact.
    this.invalidate();
  }

  setTorch(enabled) {
    const next = !!enabled;
    if (next === this.torch) return;
    this.torch = next;
    this.invalidate();
  }

  render() {
    const ctx = this.ctx, w = this.width, h = this.height;
    const key = `background:${w}:${h}:${this.dark ? 1 : 0}:${this.roomKind}`;
    let background = this._gradients[key];
    if (!background) {
      background = ctx.createLinearGradient(0, 0, 0, h);
      background.addColorStop(0, this.dark ? '#070b10' : '#182733');
      background.addColorStop(0.55, this.dark ? '#0b1016' : '#33404a');
      background.addColorStop(1, this.dark ? '#080a0c' : '#17232b');
      this._gradients[key] = background;
    }
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    this._drawWorldGeometry();
    this._drawOverlays();
    this._drawGalleryOverlay();
  }

  dispose() {
    if (this._raf != null) cancelAnimationFrame(this._raf);
    if (this._wakeTimer != null) clearTimeout(this._wakeTimer);
    this._raf = null;
    this._wakeTimer = null;
    this._stopAmbientLoop();
    this.releasePointerLock();
    this.paintingOverlay?.remove?.();
    this.paintingOverlay = null;
    this.paintingOverlayCtx = null;
    this.effectOverlay?.remove?.();
    this.effectOverlay = null;
    this.effectOverlayCtx = null;
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    document.removeEventListener('pointerlockerror', this._onPointerLockError);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
  }
}

function shade(hex, factor) {
  const value = Number.parseInt(hex.replace('#',''),16);
  const r = Math.max(0,Math.min(255,Math.round(((value>>16)&255)*factor)));
  const g = Math.max(0,Math.min(255,Math.round(((value>>8)&255)*factor)));
  const b = Math.max(0,Math.min(255,Math.round((value&255)*factor)));
  return `rgb(${r},${g},${b})`;
}

window.CanvasMuseumScene = CanvasMuseumScene;

})();
