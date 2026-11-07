(function () {

/* Native Canvas 2D perspective renderer. No WebGL or external dependencies. */
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
    this.equippedLibraryPaper = null;
    this.camera = { x: 0, y: 1.66, z: 4.15 };
    this.yaw = 0;
    this.pitch = 0;
    this.moveInput = { x: 0, y: 0 };
    this.playerRadius = 0.28;
    this.bounds = { minX: -8.35, maxX: 48.35, minZ: -35.5, maxZ: 7.1 };
    this.roomScaleX = 1.25;
    this.roomScaleZ = 1.25;
    this.roomOffsets = [0, 20, 40];
    this.mapKinds = ['vocab', 'reading', 'grammar'];
    this.doorOpen = [false, false];
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
    this._initPaintingOverlay();
    if (typeof Image !== 'undefined' && window.GALLERY_ART_DATA) {
      this.galleryImage = new Image();
      this.galleryImage.decoding = 'async';
      this.galleryImage.onload = () => this.invalidate();
      this.galleryImage.src = window.GALLERY_ART_DATA;
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
      const effectiveScale = Math.max(0.25, Math.min(this.renderScale, pixelBudgetScale, this.maxScale));
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
      } else this.invalidate();
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
    const focal = this.height * 0.90;
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
    const worldPoints = points.map(point => [point[0] * sx + offsetX, point[1], point[2] * sz]);
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
      let index = this._vertexMap.get(key);
      if (index === undefined) {
        index = this._vertices.length;
        this._vertexMap.set(key, index);
        this._vertices.push(point);
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
    return face;
  }

  _box(x, y, z, width, height, depth, color, accent = null) {
    const x0 = x - width / 2, x1 = x + width / 2;
    const y0 = y, y1 = y + height;
    const z0 = z - depth / 2, z1 = z + depth / 2;
    // Box faces are stored with consistent winding for stable projection; no winding-based culling is applied.
    this._poly([[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0]], shade(color, 0.62));
    this._poly([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], color, 'rgba(16,20,20,.4)');
    this._poly([[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]], shade(color, 1.2));
    this._poly([[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]], shade(color, 0.72));
    this._poly([[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]], shade(color, 0.84));
    if (accent) {
      this._poly([[x0,y1-0.07,z1+0.006],[x1,y1-0.07,z1+0.006],[x1,y1,z1+0.006],[x0,y1,z1+0.006]], accent);
    }
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
    for (const face of this._frameFaces) {
      if (!face.points) continue;
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
    if (!this.rendering) {
      if (this._raf != null) cancelAnimationFrame(this._raf);
      if (this._wakeTimer != null) clearTimeout(this._wakeTimer);
      this._raf = null;
      this._wakeTimer = null;
      this.setMovement(0, 0);
    } else {
      this.invalidate();
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
    const speed = (this.jumpHeight > 0.12 ? 4.0 : 2.7) * delta;
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

  _addCollider(x, z, width, depth, height = 4.5, platformable = height <= 2.2) {
    const sx = this.roomScaleX || 1, sz = this.roomScaleZ || 1;
    const worldX = x * sx + (this._worldOffsetX || 0);
    const worldZ = z * sz;
    this.colliders.push({
      minX: worldX - width * sx / 2, maxX: worldX + width * sx / 2,
      minZ: worldZ - depth * sz / 2, maxZ: worldZ + depth * sz / 2,
      height, platformable: !!platformable
    });
  }

  _buildColliders() {
    this.colliders = [];
    // All three progression rooms are solid from the start. Jump height is
    // considered by _canOccupy so low objects can be cleared in mid-air.
    for (let roomIndex = 0; roomIndex < 3; roomIndex++) {
      this.roomKind = this.mapKinds[roomIndex];
      this._worldOffsetX = this.roomOffsets[roomIndex];
      if (this.roomKind === 'vocab') {
        this._addCollider(-3.15, -2.2, 2.45, 1.25, 1.55);
        this._addCollider(0, -2.15, 1.45, 1.2, 1.2);
        this._addCollider(3.12, -2.17, 2.45, 1.2, 1.35);
        this._addCollider(-5, 1.45, 2.2, 0.6, .62);
      } else if (this.roomKind === 'reading') {
        this._addCollider(0, -2.45, 6.5, 1.0, .82);
        for (const x of [-5,-2.5,0,2.5,5]) this._addCollider(x, 1.1, 0.9, 0.9, 1.5, false);
      } else {
        this._addCollider(-3.7, -2.45, 2.7, 1.3, 2.15);
        this._addCollider(0, -2.35, 1.8, 1.5, 1.1);
        this._addCollider(3.45, -2.15, 2.8, 0.15, 1.45);
        this._addCollider(1.9, 0.25, 1.25, 1.1, .95);
        for (const x of [-5.7, 5.7]) this._addCollider(x, -1.0, 0.34, 1.35, 3.15);
      }
      this._addCollider(-5.05, 2.8, 0.78, 0.78, 1.55, false);
      this._addCollider(5.05, 2.8, 0.78, 0.78, 1.55, false);
      // Front/south perimeter wall closes the room behind the spawn side.
      // The player starts inside this wall; progression exits remain on east/west.
      this._addCollider(0, 6, 14, .28, 4.5);
      // Rear wall; the storeroom has a central open doorway into the library.
      if (roomIndex === 2) {
        this._addCollider(-4.25, -6, 5.5, .28, 4.5);
        this._addCollider(4.25, -6, 5.5, .28, 4.5);
      } else {
        this._addCollider(0, -6, 14, .28, 4.5);
      }
    }
    this._worldOffsetX = 0;
    // Outer west wall and east-west progression doors. Collider coordinates
    // are local to each room and scaled exactly like the rendered geometry.
    this._addCollider(-7, 0, .28, 12, 4.5);
    for (let i = 0; i < 2; i++) {
      this._worldOffsetX = this.roomOffsets[i];
      this._addCollider(7, -3.68, .28, 4.64, 4.5);
      this._addCollider(7, 3.68, .28, 4.64, 4.5);
      if (!this.doorOpen[i]) this._addCollider(7, 0, .34, 2.55, 3.15);
    }
    // West-side portal walls for the gallery and storeroom. Keep the opening
    // passable while preventing walking through the solid wall sections.
    for (let i = 1; i < 3; i++) {
      this._worldOffsetX = this.roomOffsets[i];
      this._addCollider(-7, -3.68, .28, 4.64, 4.5);
      this._addCollider(-7, 3.68, .28, 4.64, 4.5);
    }
    this._worldOffsetX = this.roomOffsets[2];
    this._addCollider(7, -3.68, .28, 4.64, 4.5);
    this._addCollider(7, 3.68, .28, 4.64, 4.5);
    if (!this.exitOpen) this._addCollider(7, 0, .34, 2.55, 3.15);

    // Library side room shell and doorway.
    this._worldOffsetX = this.roomOffsets[2];
    this._addCollider(-7, -20, .28, 16, 4.5);
    this._addCollider(7, -20, .28, 16, 4.5);
    this._addCollider(0, -28, 14, .28, 4.5);
    this._addCollider(-4.25, -12, 5.5, .28, 4.5);
    this._addCollider(4.25, -12, 5.5, .28, 4.5);
    // Side walls of the narrow connector between the storeroom and library.
    this._addCollider(-1.6, -9, .20, 6, 4.5);
    this._addCollider(1.6, -9, .20, 6, 4.5);
    // Twenty bookcases arranged as 4 rows x 5 columns. The full shelf height
    // blocks movement even while jumping.
    for (const rack of (this.libraryLayout?.racks || [])) {
      this._addCollider(rack.x, rack.z, 2.32, .86, 3.7);
    }
    this._worldOffsetX = 0;
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
    const previousKind = this.roomKind, previousOffset = this._worldOffsetX;
    const previousBuildingRoom = this._buildingRoomIndex, previousZone = this._activeZone;
    this.roomKind = 'library';
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
    this._poly([[-7,0,-28],[7,0,-28],[7,4.5,-28],[-7,4.5,-28]], wall);
    this._poly([[-7,4.5,-12],[-7,4.5,-28],[7,4.5,-28],[7,4.5,-12]], shade(wall,.55));
    this._poly([[-7,0,-12],[-7,0,-28],[-7,4.5,-28],[-7,4.5,-12]], shade(wall,.78));
    this._poly([[7,0,-28],[7,0,-12],[7,4.5,-12],[7,4.5,-28]], shade(wall,.72));
    // South wall frames an open doorway aligned with the connector from the storeroom.
    this._poly([[-7,0,-12],[-1.6,0,-12],[-1.6,4.5,-12],[-7,4.5,-12]], wall);
    this._poly([[1.6,0,-12],[7,0,-12],[7,4.5,-12],[1.6,4.5,-12]], wall);
    this._poly([[-1.6,3.15,-12],[1.6,3.15,-12],[1.6,4.5,-12],[-1.6,4.5,-12]], wall);
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
    // Ten papers are mounted flush to the aisle-facing shelf end plane with
    // only a tiny offset to prevent z-fighting against the wooden edge.
    this.libraryPaperLayout = [];
    this._activeLayer = 1;
    for (const note of this.libraryLayout.papers) {
      const cos = Math.cos(note.angle || 0), sin = Math.sin(note.angle || 0);
      const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sy]) => {
        const dx = sx * note.width * .5, dy = sy * note.height * .5;
        return [note.x + dx * cos - dy * sin, note.y + dx * sin + dy * cos, note.z];
      });
      const face = this._poly(corners, '#c9bea4', '#65563e', null, { libraryNoteIndex: note.id });
      this.libraryPaperLayout.push({ ...note, faceId: face.faceId });
    }
    this._activeLayer = 1;
    // Sign is on the library back wall.
    this._poly([[-2.2,3.72,-27.9],[2.2,3.72,-27.9],[2.2,4.18,-27.9],[-2.2,4.18,-27.9]], '#55432f', '#a17b4d');
    this.roomFaceGroups.push({ roomIndex: 3, faceStart, faceEnd: this._geometry.length, vertexStart, vertexEnd: this._vertices.length });
    this._buildingRoomIndex = previousBuildingRoom;
    this._activeZone = previousZone || 'room';
    this._worldOffsetX = previousOffset;
    this.roomKind = previousKind;
    this._syncGeometryBuffers();
  }

  setRoom(game, roomIndex = 0, menu = false) {
    this.dark = false;
    this.torch = false;
    this.mapKinds = (game?.rooms || []).map(room => room.kind || 'vocab');
    while (this.mapKinds.length < 3) this.mapKinds.push(['vocab','reading','grammar'][this.mapKinds.length]);
    this.roomScaleX = 1.25;
    this.roomScaleZ = 1.25;
    this.roomOffsets = [0, 20, 40];
    this.doorOpen = [false, false];
    this.exitOpen = false;
    this.paperByRoom = Object.create(null);
    this.collectedLibraryPapers = new Set();
    this.equippedLibraryPaper = null;
    this.libraryLayout = this._createLibraryLayout(game);
    this.camera = { x: 0, y: this.eyeHeight, z: 5.1875 };
    this.yaw = 0;
    this.pitch = 0;
    this.jumpHeight = 0;
    this.jumpVelocity = 0;
    this.groundHeight = 0;
    this.seated = false;
    this._standingPosition = null;
    this.bounds = { minX: -8.35, maxX: 48.35, minZ: -35.5, maxZ: 7.1 };
    this._buildColliders();
    this._buildRoomGeometry();
    this.setActiveRoom(game, roomIndex);
    this._lastArea = this._currentAreaId();
    this.invalidate();
  }

  setActiveRoom(game, roomIndex) {
    this.roomIndex = Math.max(0, Math.min(2, roomIndex));
    this.roomKind = this.mapKinds[this.roomIndex] || ['vocab','reading','grammar'][this.roomIndex];
    const offset = this.roomOffsets[this.roomIndex];
    this.hotspots = [];
    const savedPaperState = this.paperByRoom?.[this.roomIndex];
    this.paperCodes = game.rooms[this.roomIndex].code || [];
    this.paperSolved = savedPaperState?.solved?.slice() || [false,false,false];
    const add = (id, label, x, y, z, extra = {}) => this.hotspots.push({ id, label, x: x * this.roomScaleX + offset, y, z: z * this.roomScaleZ, ...extra });
    const lockAlreadyOpen = this.roomIndex === 2 ? this.exitOpen : !!this.doorOpen[this.roomIndex];
    if (!lockAlreadyOpen) add('lock', this.roomIndex === 2 ? 'Final exit lock' : 'Connecting door lock', 6.45, 1.45, 0);
    if (this.roomKind === 'vocab') {
      add('paper-0', 'Read clue paper 1', -3.15, 1.22, -2.2);
      add('paper-1', 'Read clue paper 2', 0, .87, -2.15);
      add('paper-2', 'Read clue paper 3', 3.12, 1.02, -2.17);
      add('key', game.rooms[0].keyObject, -2.12, 0.62, -0.68);
    } else if (this.roomKind === 'reading') {
      [-2.15,0,2.15].forEach((x,i) => add(`paper-${i}`, `Read gallery clue paper ${i+1}`, x, .49, -2.42));
      [-4.2,-1.8,1.8,4.2].forEach((x,i) => add(`photo-${i}`, 'Inspect gallery photograph', x, 1.8, -5.56));
      [-5,-2.5,0,2.5,5].forEach((x,i) => add(`gallery-chair-${i}`, 'Sit on gallery chair', x, .98, 1.1));
      add('key', game.rooms[1].keyObject, -4.5, 1.9, -4.82);
    } else {
      add('paper-0', 'Read storage clue paper 1', -3.65, 1.82, -2.2);
      add('paper-1', 'Read storage clue paper 2', .55, .77, -2.32);
      add('paper-2', 'Read storage clue paper 3', 3.45, 1.12, -2.0);
      add('key', game.rooms[2].keyObject, 1.9, 1.05, 0.25);
    }
    add('chair-0', 'Sit on the left chair', -5.05, 0.72, 2.8);
    add('chair-1', 'Sit on the right chair', 5.05, 0.72, 2.8);
    if (this.roomIndex === 2) {
      for (const note of (this.libraryLayout?.papers || [])) {
        add(`library-paper-${note.id}`, `Inspect archive paper ${note.id + 1}`, note.x, note.y, note.z + .02, { discoverRange: 4.6, libraryNote: true });
      }
    }
    this._setFocus(null);
    this.invalidate();
  }

  _currentAreaId() {
    return this.isInLibrary() ? 'library' : String(this._physicalRoomForX(this.camera.x));
  }

  _notifyAreaChanged() {
    const next = this._currentAreaId();
    if (this._lastArea == null) { this._lastArea = next; return; }
    if (next === this._lastArea) return;
    const previous = this._lastArea;
    this._lastArea = next;
    this.onAreaChange(next, previous);
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

  setEquippedLibraryPaper(paper) {
    this.equippedLibraryPaper = paper && typeof paper === 'object'
      ? { title: String(paper.title || 'Archive paper'), body: String(paper.body || '') }
      : null;
    this.invalidate();
  }

  setPaperState(code, solved) {
    const nextCodes = Array.isArray(code) ? code : this.paperCodes || [];
    const nextSolved = Array.isArray(solved) ? solved.slice(0,3) : [false,false,false];
    const changed = nextCodes.join('|') !== (this.paperCodes || []).join('|') ||
      nextSolved.some((value, index) => value !== this.paperSolved?.[index]);
    if (!changed) return;
    this.paperCodes = nextCodes;
    this.paperSolved = nextSolved;
    this.paperByRoom[this.roomIndex] = { codes: nextCodes.slice(), solved: nextSolved.slice() };
    this.invalidate();
  }

  openDoor(roomIndex) {
    if (roomIndex < 0 || roomIndex > 1 || this.doorOpen[roomIndex]) return;
    this.doorOpen[roomIndex] = true;
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
    const index = Math.max(0, Math.min(2, roomIndex));
    for (let i = 0; i < index; i++) this.doorOpen[i] = true;
    this._buildColliders();
    this.camera.x = this.roomOffsets[index];
    this.camera.y = this.eyeHeight;
    this.camera.z = 5.1875;
    this.yaw = 0;
    this.pitch = 0;
    this.setActiveRoom(game, index);
    this._buildRoomGeometry();
    this._notifyAreaChanged();
    this.invalidate();
  }

  _syncGeometryBuffers() {
    this.roomGeometry = this._geometry;
    this._shellFaces = this.roomGeometry.filter(face => face.layer === 0);
    this._propFaces = this.roomGeometry.filter(face => face.layer !== 0);
    this._renderFaces = this.roomGeometry;
    const count = this._vertices.length;
    this._camForward = new Float32Array(count);
    this._camLateral = new Float32Array(count);
    this._camVertical = new Float32Array(count);
    this._screenX = new Float32Array(count);
    this._screenY = new Float32Array(count);
  }

  _appendRoomGeometry(roomIndex) {
    if (this.roomFaceGroups.some(group => group.roomIndex === roomIndex)) return;
    const previousKind = this.roomKind;
    const previousOffset = this._worldOffsetX;
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
    this._worldOffsetX = previousOffset;
    this.roomKind = previousKind;
    this._syncGeometryBuffers();
  }

  _buildRoomGeometry() {
    // Rebuild is reserved for a new run or an explicit developer warp.
    // Door unlocks append one room through _appendRoomGeometry instead.
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
      this._poly([[-7,0,-6],[-1.6,0,-6],[-1.6,4.5,-6],[-7,4.5,-6]], this.dark ? '#10161b' : wall);
      this._poly([[1.6,0,-6],[7,0,-6],[7,4.5,-6],[1.6,4.5,-6]], this.dark ? '#10161b' : wall);
      this._poly([[-1.6,3.15,-6],[1.6,3.15,-6],[1.6,4.5,-6],[-1.6,4.5,-6]], this.dark ? '#10161b' : wall);
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
      this._poly([[x,0,-6],[x,0,-1.3],[x,4.5,-1.3],[x,4.5,-6]], sideColor);
      this._poly([[x,0,1.3],[x,0,6],[x,4.5,6],[x,4.5,1.3]], sideColor);
      this._poly([[x,3.15,-1.3],[x,3.15,1.3],[x,4.5,1.3],[x,4.5,-1.3]], sideColor);
      if (closed) {
        const door = outer ? '#49382a' : '#57412d';
        const previousBarrier = this._activeDoorBarrier;
        this._activeDoorBarrier = outer ? 'exit' : roomIndex;
        this._poly([[x-.035,0,-1.18],[x-.035,0,1.18],[x-.035,3.08,1.18],[x-.035,3.08,-1.18]], door, '#b28c59');
        this._poly([[x+.035,0,1.18],[x+.035,0,-1.18],[x+.035,3.08,-1.18],[x+.035,3.08,1.18]], shade(door,1.12), '#b28c59');
        this._activeDoorBarrier = previousBarrier;
      }
    };
    const roomZoneBeforeWalls = this._activeZone;
    this._activeZone = 'partition';
    if (roomIndex === 0) sideWall(-7, false, true, true);
    else sideWall(-7, true, false, false);
    const closing = roomIndex < 2 ? !this.doorOpen[roomIndex] : !this.exitOpen;
    sideWall(7, true, closing, roomIndex === 2);
    this._activeZone = roomZoneBeforeWalls || 'room';

    // Two-metre enclosed connector between adjacent room shells. The doorway
    // remains a real opening; these surfaces bridge the old gap without moving
    // the player or changing world coordinates.
    if (roomIndex < 2) {
      const corridorFloor = this.dark ? '#090d10' : shade(floor, .92);
      const corridorWall = this.dark ? '#0c1116' : shade(wall, .82);
      this._activeZone = 'connector';
      this._activeLayer = -1;
      this._poly([[7,0,-6],[9,0,-6],[9,0,6],[7,0,6]], corridorFloor, 'rgba(213,178,122,.12)');
      this._activeLayer = 0;
      this._poly([[7,4.5,6],[9,4.5,6],[9,4.5,-6],[7,4.5,-6]], this.dark ? '#090d11' : shade(wall,.48));
      this._poly([[7,0,-6],[7,4.5,-6],[9,4.5,-6],[9,0,-6]], corridorWall);
      this._poly([[9,0,6],[9,4.5,6],[7,4.5,6],[7,0,6]], corridorWall);
      this._activeZone = 'room';
    }
    if (roomIndex === 2) {
      const corridorFloor = this.dark ? '#090d10' : shade(floor,.9);
      const corridorWall = this.dark ? '#0c1116' : shade(wall,.78);
      this._activeZone = 'library-connector';
      this._activeLayer = -1;
      this._poly([[-1.6,0,-6],[1.6,0,-6],[1.6,0,-12],[-1.6,0,-12]], corridorFloor);
      this._activeLayer = 0;
      this._poly([[-1.6,4.5,-6],[1.6,4.5,-6],[1.6,4.5,-12],[-1.6,4.5,-12]], shade(wall,.48));
      this._poly([[-1.6,0,-6],[-1.6,0,-12],[-1.6,4.5,-12],[-1.6,4.5,-6]], corridorWall);
      this._poly([[1.6,0,-12],[1.6,0,-6],[1.6,4.5,-6],[1.6,4.5,-12]], corridorWall);
      this._activeZone = 'room';
    }

    this._activeLayer = 1;
    this._box(0,0,-5.68,2.1,3.05,.22,'#443326','#b38c54');
    if (this.roomKind === 'vocab') {
      this._box(-3.15,0,-2.2,2.45,1.55,1.25,'#64462f','#9d7547');
      this._box(0,0,-2.15,1.45,1.2,1.2,'#8b6742','#b18a56');
      this._box(3.12,0,-2.17,2.45,1.35,1.2,'#60462f','#a17b4a');
      this._box(-5,0,1.45,2.2,.62,.6,'#634b35');
    } else if (this.roomKind === 'reading') {
      this._box(0,0,-2.45,6.5,.82,1,'#56432f','#9b7747');
      for (const x of [-4.2,-1.8,1.8,4.2]) {
        this._box(x,1.4,-5.65,1.65,1.65,.12,'#9e8155','#c0a36f');
        // Front-facing picture surface sits just in front of the frame's +Z face.
        // The renderer maps the supplied photo across this intact four-sided surface.
        this._poly([
          [x-.58,1.56,-5.565], [x+.58,1.56,-5.565],
          [x+.58,2.72,-5.565], [x-.58,2.72,-5.565]
        ], '#594736', null, 'gallery-photo');
      }
      for (const x of [-5,-2.5,0,2.5,5]) this._buildChair(x, 1.1, .64);
    } else {
      this._box(-3.7,0,-2.45,2.7,2.15,1.3,'#58412d','#947044');
      this._box(0,0,-2.35,1.8,1.1,1.5,'#80603c','#a5814f');
      this._box(3.45,0,-2.15,2.8,1.45,.15,'#d0c2a2','#a17c4b');
      this._box(1.9,0,.25,1.25,.95,1.1,'#735337','#9b7547');
    }

    // Paper clues sit visibly on the tables. Their interaction hotspots are the
    // corresponding puzzle objects, so the paper is the physical clue target.
    const paper = (x, y, z, index, width=.62, depth=.42) => {
      // One quad, lifted well above the tabletop. Printed details are drawn
      // inside the same projected face to prevent coplanar-paper z-fighting.
      const top = y + .045;
      return this._poly([
        [x-width/2,top,z-depth/2], [x+width/2,top,z-depth/2],
        [x+width/2,top,z+depth/2], [x-width/2,top,z+depth/2]
      ], '#eee5d1', '#9b8a70', null, { paperIndex: index, paperRoom: roomIndex });
    };
    if (this.roomKind === 'vocab') {
      paper(-3.15, 1.56, -2.2, 0); paper(0, 1.21, -2.15, 1); paper(3.12, 1.36, -2.17, 2);
    } else if (this.roomKind === 'reading') {
      paper(-2.15, .83, -2.42, 0); paper(0, .83, -2.42, 1); paper(2.15, .83, -2.42, 2);
    } else {
      paper(-3.65, 2.16, -2.2, 0); paper(.55, 1.11, -2.32, 1); paper(3.45, 1.46, -2.0, 2);
    }
    // Seating exists in all three spaces. The pair is kept away from the doorway.
    this._buildChair(-5.05, 2.8, .72);
    this._buildChair(5.05, 2.8, .72);

    const trim = this.dark ? '#171b1e' : '#9b805d';
    this._activeLayer = -1;
    for (let z = -5; z <= 5; z += 1.5) {
      this._poly([[-6.8,0.012,z],[6.8,0.012,z],[6.8,0.018,z+0.025],[-6.8,0.018,z+0.025]], this.dark ? '#111518' : 'rgba(24,20,17,.22)');
    }
    this._activeLayer = 1;
    this._poly([[-6.8,.18,-5.94],[6.8,.18,-5.94],[6.8,.28,-5.94],[-6.8,.28,-5.94]], trim);
    this._poly([[-6.8,4.12,-5.94],[6.8,4.12,-5.94],[6.8,4.2,-5.94],[-6.8,4.2,-5.94]], trim);
    for (const x of [-5.6,-2.8,0,2.8,5.6]) this._box(x,4.25,-2.8,.12,.16,6.1, this.dark ? '#171c20' : '#6b6254');
    for (const x of [-3.8,0,3.8]) {
      this._box(x,4.1,-1.6,.42,.08,.42, this.dark ? '#282018' : '#c3a477');
      this.lamps.push({ x: x * this.roomScaleX + (this._worldOffsetX || 0), y: 3.96, z: -1.6 * this.roomScaleZ });
    }
    this._box(0,0,-5.84,2.38,3.18,.12, this.dark ? '#211d18' : '#715338');
    this._box(0,.08,-5.72,1.92,2.9,.10, this.dark ? '#211b16' : '#493628', this.dark ? '#443322' : '#b38c54');
    this._box(.69,1.35,-5.61,.055,.22,.06,'#c4a66e');
    // The keypad and its buttons are part of the door lock, so they vanish
    // together with the door panel when this room's code is accepted.
    this._activeLockBarrier = roomIndex < 2 ? roomIndex : 'exit';
    this._box(6.38, 1.03, 0, .18, .44, .28, '#242b2c', '#c49a61');
    for (const z of [-.075, 0, .075]) this._poly([[6.49,1.19,z-.025],[6.49,1.19,z+.025],[6.49,1.25,z+.025],[6.49,1.25,z-.025]], '#d8c49a');
    this._activeLockBarrier = null;
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

  _prepareVertexTransforms(groups = null) {
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
    const ranges = groups ? groups.map(group => [group.vertexStart, group.vertexEnd]) : [[0, vertices.length]];
    for (const [start, end] of ranges) for (let i = start; i < end; i++) {
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

  _physicalRoomForX(x) {
    return x < 10 ? 0 : x < 30 ? 1 : 2;
  }

  isInLibrary() {
    return this.camera.x >= this.roomOffsets[2] - 9 &&
      this.camera.x <= this.roomOffsets[2] + 9 && this.camera.z < -15.2;
  }

  _getLoadedRoomGroups() {
    // Keep all geometry resident, but render only the room the player occupies.
    // Adjacent room groups contribute only real enclosing perimeter walls and
    // connector architecture; neighbouring props and papers stay hidden.
    this.physicalRoomIndex = this._physicalRoomForX(this.camera.x);
    this.inLibrary = this.isInLibrary();
    const active = this.inLibrary ? 3 : this.physicalRoomIndex;
    this.renderRoomIndex = active;
    const groups = [];
    const add = index => {
      const group = this.roomFaceGroups.find(item => item.roomIndex === index);
      if (group && !groups.includes(group)) groups.push(group);
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

    face._depth = depth;
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
    if ((Number.isInteger(face.paperIndex) || Number.isInteger(face.libraryNoteIndex)) && points.length === 4) this._drawPaperDetails(face, points, ctx);
    if (Number.isInteger(face.libraryBookIndex) && points.length === 4) this._drawLibraryBookDetails(face, points, ctx);
  }

  _drawLibraryBookDetails(face, points, ctx) {
    const [a,b,c,d] = points;
    const lerp = (p,q,t) => ({ x:p.x+(q.x-p.x)*t, y:p.y+(q.y-p.y)*t });
    ctx.save();
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.lineTo(c.x,c.y); ctx.lineTo(d.x,d.y); ctx.closePath(); ctx.clip();
    ctx.strokeStyle = 'rgba(218,190,130,.62)';
    ctx.lineWidth = 1;
    for (const t of (face.bookBand ? [.16,.25,.82] : [.17,.82])) {
      const left = lerp(a,d,t), right = lerp(b,c,t);
      ctx.beginPath(); ctx.moveTo(left.x,left.y); ctx.lineTo(right.x,right.y); ctx.stroke();
    }
    ctx.restore();
  }

  _drawPaperDetails(face, points, ctx) {
    if (Number.isInteger(face.libraryNoteIndex)) {
      const p0 = points[0], p1 = points[1], p2 = points[2], p3 = points[3];
      const lerp = (a,b,t) => ({ x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t });
      const left = lerp(p0,p3,.52), right = lerp(p1,p2,.52);
      ctx.save();
      ctx.strokeStyle = 'rgba(48,39,28,.42)';
      ctx.lineWidth = .65;
      for (const t of [.32,.52,.72]) {
        const a=lerp(p0,p3,t), b=lerp(p1,p2,t);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,a.y+(b.y-a.y)*.12); ctx.stroke();
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
    ctx.strokeStyle = 'rgba(119,105,85,.62)'; ctx.lineWidth = .8;
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
    if (face.doorBarrier === 'exit' || face.lockBarrier === 'exit') return this.exitOpen;
    if (Number.isInteger(face.doorBarrier)) return !!this.doorOpen[face.doorBarrier];
    if (Number.isInteger(face.lockBarrier)) return !!this.doorOpen[face.lockBarrier];
    return false;
  }

  _drawGalleryOverlay() {
    const overlay = this.paintingOverlay;
    const ctx = this.paintingOverlayCtx;
    if (!overlay || !ctx || !this.galleryImage?.complete || !this.galleryImage?.naturalWidth) return;
    const photos = this._drawPrimitives.filter(item => item.type === 'texture' && item.points?.length === 4);
    if (!photos.length) {
      overlay.style.display = 'none';
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const photo of photos) for (const point of photo.points) {
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
    // Include enough margin for the interaction rings drawn over a painting.
    minX = Math.max(0, Math.floor(minX - 20));
    minY = Math.max(0, Math.floor(minY - 20));
    maxX = Math.min(this.width, Math.ceil(maxX + 20));
    maxY = Math.min(this.height, Math.ceil(maxY + 20));
    const cssWidth = maxX - minX, cssHeight = maxY - minY;
    if (!(cssWidth > 1 && cssHeight > 1)) {
      overlay.style.display = 'none';
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2.5);
    const pixelWidth = Math.max(1, Math.ceil(cssWidth * scale));
    const pixelHeight = Math.max(1, Math.ceil(cssHeight * scale));
    if (overlay.width !== pixelWidth) overlay.width = pixelWidth;
    if (overlay.height !== pixelHeight) overlay.height = pixelHeight;
    Object.assign(overlay.style, {
      display: 'block', left: `${rect.left + minX}px`, top: `${rect.top + minY}px`,
      width: `${cssWidth}px`, height: `${cssHeight}px`
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = this.dark ? (this.torch ? .62 : .16) : 1;
    for (const photo of photos) this._drawTexturedQuad(photo.face, photo.points, ctx);
    ctx.globalAlpha = 1;

    // The painting overlay sits above the low-resolution scene canvas. Erase
    // only regions covered by nearer scene faces so desks/frames still occlude it.
    ctx.globalCompositeOperation = 'destination-out';
    for (const photo of photos) {
      const photoDepth = photo.depth;
      for (const face of this._frameFaces) {
        if (face === photo.face || face.texture === 'gallery-photo' || face._depth >= photoDepth - .12) continue;
        const points = face._framePoints;
        if (!points || points.length < 3) continue;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // The overlay is above the low-resolution scene canvas. Redraw only the
    // small HUD markers that can sit on top of gallery artwork.
    for (const point of this.projectedHotspots) {
      if (point.x < minX - 4 || point.x > maxX + 4 || point.y < minY - 4 || point.y > maxY + 4) continue;
      const radius = Math.max(5, Math.min(15, (this.height * .90 / point.depth) * .10));
      ctx.beginPath(); ctx.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(224,182,109,.10)'; ctx.fill();
      ctx.strokeStyle = 'rgba(236,199,133,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(point.x, point.y, radius * .35, 0, Math.PI * 2);
      ctx.fillStyle = '#f1d9a9'; ctx.fill();
    }
    if (this.pointerLocked) {
      const cx = this.width * .5, cy = this.height * .5;
      if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
        ctx.strokeStyle = this.focused ? 'rgba(255,214,145,.95)' : 'rgba(245,241,226,.8)';
        ctx.lineWidth = 1.4; ctx.beginPath();
        ctx.moveTo(cx - 8, cy); ctx.lineTo(cx - 3, cy);
        ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 8, cy);
        ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy - 3);
        ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + 8); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#f1d9a9'; ctx.fill();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  _drawWorldGeometry() {
    const ctx = this.ctx;
    const loadedGroups = this._getLoadedRoomGroups();
    this._prepareVertexTransforms(loadedGroups);
    ctx.lineJoin = 'miter';

    // Draw the structural floor first, architecture second, then props.
    // Faces are conservatively culled only when fully outside the viewport or
    // wholly behind the near plane. Every surviving face is drawn as one polygon.
    const projectedFaces = this._frameFaces;
    projectedFaces.length = 0;
    const drawList = this._drawPrimitives;
    drawList.length = 0;
    let order = 0;
    for (const group of loadedGroups) {
      for (let i = group.faceStart; i < group.faceEnd; i++) {
        const face = this.roomGeometry[i];
        if (Number.isInteger(face.libraryNoteIndex) && this.collectedLibraryPapers.has(face.libraryNoteIndex)) continue;
        const activeRoom = this.renderRoomIndex ?? this.physicalRoomIndex ?? 0;
        if (face.roomIndex !== activeRoom) {
          if (activeRoom === 3) {
            if (face.roomIndex !== 2 || !['library-connector','partition'].includes(face.zone)) continue;
          } else {
            const nearConnector = Math.abs(this.camera.x - 10) < 1.28 || Math.abs(this.camera.x - 30) < 1.28;
            const allowedBoundary = face.zone === 'partition' ||
              (nearConnector && face.zone === 'connector');
            if (!allowedBoundary) continue;
          }
        }
        if (this._doorBarrierIsOpen(face)) continue;
        if (!this._projectFace(face)) continue;
        const points = face._framePoints;
        projectedFaces.push(face);
        drawList.push({
          face, points, depth: face._depth,
          layer: face.layer, order: order++,
          type: face.texture === 'gallery-photo' && points.length === 4 ? 'texture' : 'fill'
        });
      }
    }
    // Keep semantic layers stable and sort intact faces by average camera depth
    // only inside each layer. The large floor remains behind architecture/props.
    drawList.sort((a, b) => (a.layer - b.layer) || (b.depth - a.depth) || (a.order - b.order));
    for (let i = 0; i < drawList.length; i++) this._drawPrimitive(drawList[i], ctx);
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
      ? this._project(this.roomOffsets[2],3.7,-34.4)
      : this._project(this.roomOffsets[visibleRoom],3.48,-7.25);
    if (plaque) {
      const visibleKind = this.mapKinds[visibleRoom] || 'vocab';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = this.dark ? '#a38c69' : '#ecd4a8';
      ctx.fillText(libraryArea ? 'LIBRARY' : visibleKind === 'vocab' ? 'TICKET HALL' : visibleKind === 'reading' ? 'MUSEUM GALLERY' : 'STOREROOM', plaque.x, plaque.y);
    }

    this.projectedHotspots = [];
    for (const point of this.hotspots) {
      if (point.libraryNote && this.collectedLibraryPapers.has(Number(String(point.id).split('-').pop()))) continue;
      const pointLibrary = !!point.libraryNote;
      const sameArea = pointLibrary ? this.isInLibrary() : this._physicalRoomForX(point.x) === visibleRoom;
      const worldDistance = Math.hypot(point.x-this.camera.x, point.y-this.camera.y, point.z-this.camera.z);
      if (!sameArea || worldDistance > (point.discoverRange || 8.5)) continue;
      const screen = this._project(point.x, point.y + (pointLibrary ? 0 : .35), point.z);
      // Shelf edges frequently intersect the projection of a note's nearby
      // interaction marker. Do not let that screen-space test flicker library
      // note markers; the paper itself is drawn in front of its own shelf.
      if (!screen || screen.depth > 24 || (!pointLibrary && this._isScreenPointOccluded(screen.x, screen.y, screen.depth))) continue;
      this.projectedHotspots.push({ id: point.id, label: point.label, x: screen.x, y: screen.y, depth: screen.depth, worldDistance });
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
    const paper = this.equippedLibraryPaper;
    if (!paper || !this.isInLibrary()) return;
    const compact = w < 680 || !!window.matchMedia?.('(pointer: coarse)').matches;
    const cardW = compact ? 104 : 142;
    const cardH = compact ? 126 : 174;
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
    ctx.font = `700 ${compact ? 7 : 9}px system-ui,sans-serif`;
    ctx.fillText(String(paper.title).toUpperCase().slice(0, compact ? 22 : 28), -cardW*.5+9, -cardH*.5+10);
    ctx.strokeStyle = 'rgba(106,91,69,.35)'; ctx.lineWidth = .8;
    for (let line = 0; line < 3; line++) {
      const yy = -cardH*.5 + (compact ? 27 : 34) + line * (compact ? 8 : 11);
      ctx.beginPath(); ctx.moveTo(-cardW*.5+9, yy); ctx.lineTo(cardW*.5-9, yy); ctx.stroke();
    }
    ctx.fillStyle = '#4d483e';
    ctx.font = `${compact ? 7 : 9}px system-ui,sans-serif`;
    const words = String(paper.body || '').split(/\s+/);
    const maxWidth = cardW - 18;
    const lineHeight = compact ? 10 : 13;
    let line = '', row = 0;
    const startY = -cardH*.5 + (compact ? 56 : 72);
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const measuredWidth = ctx.measureText?.(candidate)?.width ?? candidate.length * (compact ? 4 : 5);
      if (measuredWidth > maxWidth && line) {
        if (row < (compact ? 6 : 7)) ctx.fillText(line, -cardW*.5+9, startY + row++ * lineHeight);
        line = word;
      } else line = candidate;
    }
    if (line && row < (compact ? 6 : 7)) ctx.fillText(line, -cardW*.5+9, startY + row * lineHeight);
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
    this.releasePointerLock();
    this.paintingOverlay?.remove?.();
    this.paintingOverlay = null;
    this.paintingOverlayCtx = null;
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
