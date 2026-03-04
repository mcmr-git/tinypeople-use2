/**
 * TinyNature - Pure Three.js Scene
 *
 * A lightweight, performant 3D nature scene with:
 * - GPU-instanced grass (80k blades) and flowers
 * - Procedural terrain with Perlin noise
 * - Animated fireflies with glow shaders
 * - Interactive character with click-to-move
 *
 * @version 2.3.0
 * @license MIT
 *
 * Changelog v2.3.0:
 * - MOBILE LOADING OPTIMIZATION: 10x faster grass positioning
 * - Replaced raycast with math-based height calculation for grass/flowers
 * - Async batch processing for grass (5k/frame on mobile, 10k on desktop)
 * - Deferred background loading (model loads first for faster interactivity)
 * - Scene is interactive before grass positioning completes
 *
 * Changelog v2.2.0:
 * - Shared Object3D pool to avoid repeated allocations
 * - Frozen CONFIG for V8 optimization and safety
 * - Visibility API: pauses rendering when tab is hidden (battery saver)
 * - Throttled pointerMove events (~60fps max)
 * - Deep dispose with full scene traversal
 * - Bound animation loop for proper cleanup
 * - forceContextLoss on dispose for GPU memory release
 *
 * Changelog v2.1.0:
 * - Antialiasing enabled on mobile devices
 * - Improved device detection (feature detection + user agent)
 * - Low-end device detection with aggressive optimizations
 * - Centralized renderer configuration
 * - WebGL context lost/restored handling
 * - Improved memory management and cleanup
 * - Passive event listeners for better scroll performance
 * - Proper event listener cleanup on dispose
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================================
// CONSTANTS
// ============================================================================
const DEBUG = false; // Set to true for verbose logging

// ============================================================================
// SHARED OBJECT POOL - Evita allocazioni ripetute
// ============================================================================
const SharedPool = {
  dummy: null, // Lazy init per Object3D condiviso
  getDummy() {
    if (!this.dummy) {
      this.dummy = new THREE.Object3D();
    }
    return this.dummy;
  }
};

// ============================================================================
// CONFIGURAZIONE CENTRALIZZATA
// ============================================================================
// Device detection migliorato con feature detection
const isMobile = (() => {
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth < 768;
  const userAgentMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  return (hasTouch && isSmallScreen) || userAgentMobile;
})();

// Detect low-end devices per ottimizzazioni aggressive
const isLowEnd = (() => {
  const memory = navigator.deviceMemory || 4; // GB, default 4 se non disponibile
  const cores = navigator.hardwareConcurrency || 4;
  return memory <= 2 || cores <= 2;
})();

const CONFIG = {
  assets: {
    model: 'https://storage.googleapis.com/tinynatureassets/MadreNatura.glb',
    background: 'https://storage.googleapis.com/tinynatureassets/TINYBACKGROUND%20light.png',
    whatsapp: 'https://wa.me/14242421336'
  },
  camera: {
    position: [-10, 25, 38],
    lookAt: [-10, 7, 0],
    fov: 80,
    near: 0.1,
    far: 500
  },
  renderer: {
    antialias: true, // Abilitato anche su mobile
    // Pixel ratio più alto su mobile per migliore qualità (era 1.5)
    pixelRatio: isLowEnd ? 1 : Math.min(devicePixelRatio, isMobile ? 2 : 2),
    shadowMapSize: isLowEnd ? 256 : (isMobile ? 512 : 1024),
    powerPreference: 'high-performance'
  },
  terrain: {
    color: 0x7CB342,
    radius: 71.25,
    segments: isMobile ? 48 : 64
  },
  grass: {
    count: isLowEnd ? 20000 : (isMobile ? 30000 : 80000),
    bladeWidth: 0.025,
    bladeHeight: 0.9,
    scaleMin: 0.8,
    scaleMax: 2.0
  },
  flowers: {
    count: isLowEnd ? 400 : (isMobile ? 600 : 1500),
    stemColor: 0x4A7023,
    headColor: 0xFFFFFF
  },
  fireflies: {
    count: isLowEnd ? 15 : (isMobile ? 25 : 50)
  },
  character: {
    height: 5.2,
    speed: 2.5,
    hitboxRadius: 1.5
  },
  sky: {
    topColor: 0x4A90D9,
    bottomColor: 0x87CEEB,
    radius: 200
  },
  lighting: {
    ambient: { color: 0xffffff, intensity: 0.5 },
    hemisphere: { skyColor: 0x87CEEB, groundColor: 0x7CB342, intensity: 0.6 },
    sun: { color: 0xffffff, intensity: 1.2, position: [50, 80, 50] }
  },
  background: {
    width: 300,
    curveIntensity: 45,
    position: [-10, -10, -80]
  },
  isMobile,
  isLowEnd
};

// Freeze config per prevenire modifiche accidentali e ottimizzare V8
Object.freeze(CONFIG);
Object.freeze(CONFIG.assets);
Object.freeze(CONFIG.camera);
Object.freeze(CONFIG.renderer);
Object.freeze(CONFIG.terrain);
Object.freeze(CONFIG.grass);
Object.freeze(CONFIG.flowers);
Object.freeze(CONFIG.fireflies);
Object.freeze(CONFIG.character);
Object.freeze(CONFIG.sky);
Object.freeze(CONFIG.lighting);
Object.freeze(CONFIG.background);

// ============================================================================
// EVENT BUS - Sistema di comunicazione decoupled
// ============================================================================
class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => callback(data));
    }
  }
}

// ============================================================================
// PERFORMANCE PROFILER
// ============================================================================
class Profiler {
  constructor() {
    this.timers = {};
    this.results = {};
    this.startTime = performance.now();
  }

  start(label) {
    this.timers[label] = performance.now();
  }

  end(label) {
    const elapsed = (performance.now() - this.timers[label]).toFixed(2);
    this.results[label] = parseFloat(elapsed);
    delete this.timers[label];
    return this.results[label];
  }

  getResults() {
    return this.results;
  }

  printReport() {
    const totalTime = (performance.now() - this.startTime).toFixed(2);

    console.log('%c TinyNature Performance Report ', 'background: #7CB342; color: white; font-size: 14px; font-weight: bold; padding: 4px 8px; border-radius: 4px;');
    console.log('%c─────────────────────────────────', 'color: #7CB342;');

    const entries = Object.entries(this.results).sort((a, b) => b[1] - a[1]);

    entries.forEach(([label, time]) => {
      const bar = '█'.repeat(Math.min(Math.round(time / 20), 30));
      const color = time > 500 ? '#e53935' : time > 200 ? '#fb8c00' : '#43a047';
      console.log(`%c${label.padEnd(25)} %c${time.toString().padStart(8)}ms %c${bar}`,
        'color: #666; font-family: monospace;',
        `color: ${color}; font-weight: bold; font-family: monospace;`,
        `color: ${color};`
      );
    });

    console.log('%c─────────────────────────────────', 'color: #7CB342;');
    console.log(`%cTotal Load Time: %c${totalTime}ms`,
      'color: #666; font-family: monospace;',
      'color: #1976d2; font-weight: bold; font-size: 12px;'
    );
    console.log(`%cDevice: %c${CONFIG.isMobile ? 'Mobile' : 'Desktop'}${CONFIG.isLowEnd ? ' (Low-End)' : ''}`,
      'color: #666; font-family: monospace;',
      'color: #7CB342; font-weight: bold;'
    );
    console.log(`%cPixel Ratio: %c${CONFIG.renderer.pixelRatio.toFixed(2)}`,
      'color: #666; font-family: monospace;',
      'color: #7CB342; font-weight: bold;'
    );
    console.log(`%cGrass Blades: %c${CONFIG.grass.count.toLocaleString()}`,
      'color: #666; font-family: monospace;',
      'color: #7CB342; font-weight: bold;'
    );
    console.log(`%cFlowers: %c${CONFIG.flowers.count.toLocaleString()}`,
      'color: #666; font-family: monospace;',
      'color: #7CB342; font-weight: bold;'
    );
    console.log(`%cShadow Map: %c${CONFIG.renderer.shadowMapSize}px`,
      'color: #666; font-family: monospace;',
      'color: #7CB342; font-weight: bold;'
    );
    console.log('%c─────────────────────────────────', 'color: #7CB342;');
  }
}

// ============================================================================
// PERLIN NOISE GENERATOR
// ============================================================================
class PerlinNoise {
  constructor(seed = 12345) {
    this.perm = new Uint8Array(512);
    this._initPermutation(seed);
  }

  _initPermutation(seed) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor((seed = (seed * 16807) % 2147483647) / 2147483647 * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  _fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  _lerp(t, a, b) {
    return a + t * (b - a);
  }

  _grad(h, x, y, z) {
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }

  noise(x, y, z = 0) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = this._fade(x);
    const v = this._fade(y);
    const w = this._fade(z);

    const A = this.perm[X] + Y;
    const B = this.perm[X + 1] + Y;
    const AA = this.perm[A] + Z;
    const AB = this.perm[A + 1] + Z;
    const BA = this.perm[B] + Z;
    const BB = this.perm[B + 1] + Z;

    return this._lerp(w,
      this._lerp(v,
        this._lerp(u, this._grad(this.perm[AA] & 15, x, y, z), this._grad(this.perm[BA] & 15, x - 1, y, z)),
        this._lerp(u, this._grad(this.perm[AB] & 15, x, y - 1, z), this._grad(this.perm[BB] & 15, x - 1, y - 1, z))
      ),
      this._lerp(v,
        this._lerp(u, this._grad(this.perm[AA + 1] & 15, x, y, z - 1), this._grad(this.perm[BA + 1] & 15, x - 1, y, z - 1)),
        this._lerp(u, this._grad(this.perm[AB + 1] & 15, x, y - 1, z - 1), this._grad(this.perm[BB + 1] & 15, x - 1, y - 1, z - 1))
      )
    );
  }
}

// ============================================================================
// TERRAIN SYSTEM
// ============================================================================
class TerrainSystem {
  constructor(engine) {
    this.engine = engine;
    this.mesh = null;
    this.noise = new PerlinNoise();
    // Raycaster riutilizzabile per evitare allocazioni
    this._raycaster = new THREE.Raycaster();
    this._rayOrigin = new THREE.Vector3();
    this._rayDirection = new THREE.Vector3(0, -1, 0);
  }

  getHeight(x, z) {
    const d = Math.sqrt(x * x + z * z) / CONFIG.terrain.radius;
    const bowl = (1 - Math.pow(1 - d, 2)) * 10;
    const edgeFalloff = d > 0.85 ? -Math.pow(d - 0.85, 2) * 50 : 0;
    const hills = this.noise.noise(x * 0.012, z * 0.012) * 6;
    const medium = this.noise.noise(x * 0.03, z * 0.03) * 3;
    const detail = this.noise.noise(x * 0.08, z * 0.08) * 1;
    return bowl + edgeFalloff + hills + medium + detail;
  }

  getGroundHeight(x, z) {
    if (!this.mesh) return 0;

    this._rayOrigin.set(x, 100, z);
    this._raycaster.set(this._rayOrigin, this._rayDirection);

    const hits = this._raycaster.intersectObject(this.mesh);
    return hits.length > 0 ? hits[0].point.y : this.getHeight(x, -z);
  }

  init() {
    this.engine.profiler.start('Terrain Setup');

    const geometry = new THREE.CircleGeometry(CONFIG.terrain.radius, CONFIG.terrain.segments);
    const positions = geometry.attributes.position;

    for (let i = 0; i < positions.count; i++) {
      positions.setZ(i, this.getHeight(positions.getX(i), positions.getY(i)));
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({ color: CONFIG.terrain.color });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.receiveShadow = true;

    this.engine.scene.add(this.mesh);
    this.mesh.updateMatrixWorld(true);

    this.engine.profiler.end('Terrain Setup');
    this.engine.events.emit('terrain:ready', this.mesh);
  }

  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.engine.scene.remove(this.mesh);
    }
  }
}

// ============================================================================
// SKY SYSTEM
// ============================================================================
class SkySystem {
  constructor(engine) {
    this.engine = engine;
    this.mesh = null;
  }

  init() {
    const geometry = new THREE.SphereGeometry(CONFIG.sky.radius, 16, 16);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(CONFIG.sky.topColor) },
        bot: { value: new THREE.Color(CONFIG.sky.bottomColor) }
      },
      vertexShader: `
        varying float vY;
        void main() {
          vY = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 top, bot;
        varying float vY;
        void main() {
          gl_FragColor = vec4(mix(bot, top, max(0.0, vY)), 1.0);
        }
      `
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.engine.scene.add(this.mesh);
  }

  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.engine.scene.remove(this.mesh);
    }
  }
}

// ============================================================================
// LIGHTING SYSTEM
// ============================================================================
class LightingSystem {
  constructor(engine) {
    this.engine = engine;
    this.lights = [];
  }

  init() {
    // Ambient Light
    const ambient = new THREE.AmbientLight(
      CONFIG.lighting.ambient.color,
      CONFIG.lighting.ambient.intensity
    );
    this.lights.push(ambient);

    // Hemisphere Light
    const hemisphere = new THREE.HemisphereLight(
      CONFIG.lighting.hemisphere.skyColor,
      CONFIG.lighting.hemisphere.groundColor,
      CONFIG.lighting.hemisphere.intensity
    );
    this.lights.push(hemisphere);

    // Directional Light (Sun)
    const sun = new THREE.DirectionalLight(
      CONFIG.lighting.sun.color,
      CONFIG.lighting.sun.intensity
    );
    sun.position.set(...CONFIG.lighting.sun.position);
    sun.castShadow = true;
    // Shadow map size da configurazione
    sun.shadow.mapSize.setScalar(CONFIG.renderer.shadowMapSize);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = CONFIG.terrain.radius + 50;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -80;
    sun.shadow.camera.right = sun.shadow.camera.top = 80;
    this.lights.push(sun);

    this.lights.forEach(light => this.engine.scene.add(light));
  }

  dispose() {
    this.lights.forEach(light => {
      this.engine.scene.remove(light);
      light.dispose?.();
    });
    this.lights = [];
  }
}

// ============================================================================
// GRASS SYSTEM - GPU Instanced
// ============================================================================
class GrassSystem {
  constructor(engine) {
    this.engine = engine;
    this.mesh = null;
    this.pendingPositions = null;
  }

  init() {
    this.engine.profiler.start('Grass Setup (no raycast)');

    // Blade geometry
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      -CONFIG.grass.bladeWidth, 0, 0,
       CONFIG.grass.bladeWidth, 0, 0,
       0, CONFIG.grass.bladeHeight, 0
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    // Shader material with wind animation
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: this.engine.uniforms.uTime },
      vertexShader: `
        uniform float uTime;
        varying float vHeight;
        void main() {
          vHeight = position.y;
          vec4 worldPos = instanceMatrix * vec4(position, 1.0);
          float wind = sin(uTime * 1.5 + worldPos.x * 0.1 + worldPos.z * 0.1) * 0.15;
          worldPos.x += wind * position.y;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying float vHeight;
        void main() {
          vec3 baseColor = vec3(0.3, 0.5, 0.15);
          vec3 tipColor = vec3(0.6, 0.8, 0.3);
          vec3 color = mix(baseColor, tipColor, vHeight * 2.0);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, CONFIG.grass.count);

    // Generate positions (height calculated later via raycast)
    const maxR = CONFIG.terrain.radius - 5;
    this.pendingPositions = [];

    for (let i = 0; i < CONFIG.grass.count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * maxR;
      this.pendingPositions.push({
        x: Math.cos(angle) * r,
        z: Math.sin(angle) * r,
        rotY: Math.random() * Math.PI * 2,
        scale: CONFIG.grass.scaleMin + Math.random() * (CONFIG.grass.scaleMax - CONFIG.grass.scaleMin)
      });
    }

    this.mesh.count = CONFIG.grass.count;
    this.mesh.frustumCulled = false;
    this.engine.scene.add(this.mesh);

    this.engine.profiler.end('Grass Setup (no raycast)');
  }

  finalizePositions() {
    if (!this.mesh || !this.pendingPositions) return;

    this.engine.profiler.start('Grass Position');

    const dummy = SharedPool.getDummy();
    const terrain = this.engine.terrain;
    const totalPositions = this.pendingPositions.length;
    const batchSize = CONFIG.isMobile ? 10000 : 20000; // Batch più grandi per caricamento veloce
    let currentIndex = 0;

    const processBatch = () => {
      const endIndex = Math.min(currentIndex + batchSize, totalPositions);

      for (let i = currentIndex; i < endIndex; i++) {
        const p = this.pendingPositions[i];
        // Usa getHeight (calcolo matematico) invece di raycast - 10x più veloce
        const y = terrain.getHeight(p.x, p.z);

        dummy.position.set(p.x, y, p.z);
        dummy.rotation.y = p.rotY;
        dummy.scale.set(1, p.scale, 1);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
      }

      this.mesh.instanceMatrix.needsUpdate = true;
      currentIndex = endIndex;

      // Aggiorna progresso: 70% (model) + 30% (grass) = 100%
      const grassProgress = (currentIndex / totalPositions) * 30;
      window.setLoadingProgress?.(70 + grassProgress);

      if (currentIndex < totalPositions) {
        // Processa il prossimo batch nel prossimo frame
        requestAnimationFrame(processBatch);
      } else {
        // Completato
        this.pendingPositions = null;
        this.engine.profiler.end('Grass Position');
      }
    };

    // Avvia il primo batch
    processBatch();
  }

  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.engine.scene.remove(this.mesh);
    }
  }
}

// ============================================================================
// FLOWER SYSTEM
// ============================================================================
class FlowerSystem {
  constructor(engine) {
    this.engine = engine;
    this.stems = null;
    this.heads = null;
  }

  init() {
    const terrain = this.engine.terrain;

    // Stem geometry and material
    const stemGeo = new THREE.CylinderGeometry(0.02, 0.025, 1, 4);
    stemGeo.translate(0, 0.5, 0);
    const stemMat = new THREE.MeshLambertMaterial({ color: CONFIG.flowers.stemColor });
    this.stems = new THREE.InstancedMesh(stemGeo, stemMat, CONFIG.flowers.count);

    // Head geometry and material
    const headGeo = new THREE.SphereGeometry(0.12, 6, 4);
    headGeo.scale(1, 0.5, 1);
    const headMat = new THREE.MeshBasicMaterial({ color: CONFIG.flowers.headColor });
    this.heads = new THREE.InstancedMesh(headGeo, headMat, CONFIG.flowers.count);

    const dummy = SharedPool.getDummy();
    const maxR = CONFIG.terrain.radius - 5;
    let n = 0;

    for (let i = 0; n < CONFIG.flowers.count && i < CONFIG.flowers.count * 2; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * maxR;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      if (x * x + z * z > maxR * maxR) continue;

      // Usa getHeight (calcolo matematico) invece di raycast
      const groundY = terrain.getHeight(x, z);
      const stemHeight = 0.25 + Math.random() * 0.35;

      // Stem
      dummy.position.set(x, groundY, z);
      dummy.rotation.set(
        (Math.random() - 0.5) * 0.3,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.3
      );
      dummy.scale.set(1, stemHeight, 1);
      dummy.updateMatrix();
      this.stems.setMatrixAt(n, dummy.matrix);

      // Head
      dummy.position.set(x, groundY + stemHeight, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      const headScale = 0.7 + Math.random() * 0.6;
      dummy.scale.set(headScale, headScale, headScale);
      dummy.updateMatrix();
      this.heads.setMatrixAt(n, dummy.matrix);

      n++;
    }

    this.stems.count = n;
    this.heads.count = n;
    this.stems.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;

    this.engine.scene.add(this.stems);
    this.engine.scene.add(this.heads);
  }

  dispose() {
    [this.stems, this.heads].forEach(mesh => {
      if (mesh) {
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.engine.scene.remove(mesh);
      }
    });
  }
}

// ============================================================================
// FIREFLY SYSTEM
// ============================================================================
class FireflySystem {
  constructor(engine) {
    this.engine = engine;
    this.points = null;
    this.data = [];
  }

  init() {
    const terrain = this.engine.terrain;
    const count = CONFIG.fireflies.count;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 80;
      const z = (Math.random() - 0.5) * 80;
      const groundY = terrain.getHeight(x, -z);
      const y = groundY + 0.5 + Math.random() * 4;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      sizes[i] = 0.8 + Math.random() * 0.6;

      this.data.push({
        baseX: x, baseY: y, baseZ: z,
        phase: Math.random() * Math.PI * 2,
        floatSpeed: 0.3 + Math.random() * 0.5,
        wanderRadius: 1 + Math.random() * 2
      });
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: this.engine.uniforms.uTime },
      vertexShader: `
        attribute float size;
        uniform float uTime;
        varying float vPulse;
        void main() {
          vPulse = 0.6 + 0.4 * sin(uTime * 2.0 + position.x * 0.5);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (350.0 / -mvPosition.z) * vPulse;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vPulse;
        void main() {
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          vec3 coreColor = vec3(1.0, 0.95, 0.3);
          vec3 glowColor = vec3(1.0, 0.85, 0.1);
          float core = smoothstep(0.15, 0.0, dist);
          float glow = exp(-dist * 4.0) * 0.8;
          vec3 finalColor = mix(glowColor, coreColor, core);
          float alpha = (core + glow) * vPulse;
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geometry, material);
    this.engine.scene.add(this.points);
  }

  update(dt) {
    if (!this.points) return;

    const positions = this.points.geometry.attributes.position.array;
    const time = this.engine.uniforms.uTime.value;

    for (let i = 0; i < this.data.length; i++) {
      const d = this.data[i];
      const i3 = i * 3;

      positions[i3] = d.baseX + Math.sin(time * d.floatSpeed + d.phase) * d.wanderRadius;
      positions[i3 + 1] = d.baseY + Math.sin(time * d.floatSpeed * 1.3 + d.phase * 2) * 0.5;
      positions[i3 + 2] = d.baseZ + Math.cos(time * d.floatSpeed * 0.7 + d.phase) * d.wanderRadius;
    }

    this.points.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    if (this.points) {
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.engine.scene.remove(this.points);
    }
  }
}

// ============================================================================
// WHATSAPP TOOLTIP
// ============================================================================
class WhatsAppTooltip {
  constructor(engine) {
    this.engine = engine;
    this.sprite = null;
    this.visible = false;
    this.animationProgress = 0;
    this.targetProgress = 0;
  }

  init() {
    // Crea canvas per disegnare il tooltip
    const canvas = document.createElement('canvas');
    const size = 512;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Dimensioni del popup (in pixel del canvas)
    const popupWidth = 420;
    const popupHeight = 300;
    const borderRadius = 50;
    const arrowHeight = 40;
    const arrowWidth = 70;

    // Centra il popup nel canvas
    const offsetX = (size - popupWidth) / 2;
    const offsetY = (size - popupHeight - arrowHeight) / 2 - 20;

    // Pulisci canvas
    ctx.clearRect(0, 0, size, size);

    // Disegna ombra
    ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
    ctx.shadowBlur = 25;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 10;

    // Disegna il popup con freccia
    ctx.beginPath();
    ctx.moveTo(offsetX + borderRadius, offsetY);
    ctx.lineTo(offsetX + popupWidth - borderRadius, offsetY);
    ctx.quadraticCurveTo(offsetX + popupWidth, offsetY, offsetX + popupWidth, offsetY + borderRadius);
    ctx.lineTo(offsetX + popupWidth, offsetY + popupHeight - borderRadius);
    ctx.quadraticCurveTo(offsetX + popupWidth, offsetY + popupHeight, offsetX + popupWidth - borderRadius, offsetY + popupHeight);
    ctx.lineTo(offsetX + popupWidth / 2 + arrowWidth / 2, offsetY + popupHeight);
    ctx.lineTo(offsetX + popupWidth / 2, offsetY + popupHeight + arrowHeight);
    ctx.lineTo(offsetX + popupWidth / 2 - arrowWidth / 2, offsetY + popupHeight);
    ctx.lineTo(offsetX + borderRadius, offsetY + popupHeight);
    ctx.quadraticCurveTo(offsetX, offsetY + popupHeight, offsetX, offsetY + popupHeight - borderRadius);
    ctx.lineTo(offsetX, offsetY + borderRadius);
    ctx.quadraticCurveTo(offsetX, offsetY, offsetX + borderRadius, offsetY);
    ctx.closePath();

    // Riempimento con effetto glass (semi-trasparente)
    ctx.fillStyle = 'rgba(213, 237, 229, 0.75)';
    ctx.fill();

    // Bordo sottile per definire meglio il glassmorphism
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Logo WhatsApp - SVG originale completo
    const iconX = size / 2;
    const iconY = offsetY + popupHeight / 2 + 10;

    ctx.save();
    ctx.translate(iconX, iconY);

    const svgScale = 0.35;
    ctx.scale(svgScale, svgScale);

    ctx.translate(-310.8, -312.5);

    // Ombra
    ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 8;

    // Verde - transform="matrix(1 0 0 -1 41.304 577.504)"
    ctx.save();
    ctx.transform(1, 0, 0, -1, 41.304, 577.504);
    ctx.fillStyle = '#25D366';
    const green = new Path2D('M2.325 274.421c-.014-47.29 12.342-93.466 35.839-134.166L.077 1.187l142.314 37.316C181.6 17.133 225.745 5.856 270.673 5.84h.12c147.95 0 268.386 120.396 268.447 268.372.03 71.707-27.87 139.132-78.559 189.858-50.68 50.726-118.084 78.676-189.898 78.708-147.968 0-268.398-120.386-268.458-268.358');
    ctx.fill(green);
    ctx.restore();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // Bianco - transform="matrix(1 0 0 -1 31.637 586.837)"
    ctx.save();
    ctx.transform(1, 0, 0, -1, 31.637, 586.837);
    ctx.fillStyle = '#ffffff';
    const white = new Path2D('M2.407 283.847c-.018-48.996 12.784-96.824 37.117-138.983L.072.814l147.419 38.654c40.616-22.15 86.346-33.824 132.885-33.841h.12c153.26 0 278.02 124.724 278.085 277.994.026 74.286-28.874 144.132-81.374 196.678-52.507 52.544-122.326 81.494-196.711 81.528-153.285 0-278.028-124.704-278.09-277.98zm87.789-131.724l-5.503 8.74C61.555 197.653 49.34 240.17 49.36 283.828c.049 127.399 103.73 231.044 231.224 231.044 61.74-.025 119.765-24.09 163.409-67.763 43.639-43.67 67.653-101.726 67.635-163.469-.054-127.403-103.739-231.063-231.131-231.063h-.09c-41.482.022-82.162 11.159-117.642 32.214l-8.444 5.004L66.84 66.86z');
    ctx.fill(white);
    ctx.restore();

    // Cornetta - nessun transform
    ctx.fillStyle = '#ffffff';
    const phone = new Path2D('M242.63 186.78c-5.205-11.57-10.684-11.803-15.636-12.006-4.05-.173-8.687-.162-13.316-.162-4.632 0-12.161 1.74-18.527 8.693-6.37 6.953-24.322 23.761-24.322 57.947 0 34.19 24.901 67.222 28.372 71.862 3.474 4.634 48.07 77.028 118.694 104.88 58.696 23.146 70.64 18.542 83.38 17.384 12.74-1.158 41.11-16.805 46.9-33.03 5.791-16.223 5.791-30.128 4.054-33.035-1.738-2.896-6.37-4.633-13.319-8.108-6.95-3.475-41.11-20.287-47.48-22.603-6.37-2.316-11.003-3.474-15.635 3.482-4.633 6.95-17.94 22.596-21.996 27.23-4.053 4.643-8.106 5.222-15.056 1.747-6.949-3.485-29.328-10.815-55.876-34.485-20.656-18.416-34.6-41.16-38.656-48.116-4.053-6.95-.433-10.714 3.052-14.178 3.12-3.113 6.95-8.11 10.424-12.168 3.467-4.057 4.626-6.953 6.942-11.586 2.316-4.64 1.158-8.698-.579-12.172-1.737-3.475-15.241-37.838-21.42-51.576');
    ctx.fill(phone);

    ctx.restore();

    // Crea texture dal canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    // Crea sprite material
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      depthTest: true,
      depthWrite: false
    });

    // Crea sprite
    this.sprite = new THREE.Sprite(material);
    this.sprite.scale.set(6, 6, 1);
    this.sprite.visible = false;
    this.engine.scene.add(this.sprite);
  }

  show() {
    if (!this.sprite) return;
    this.targetProgress = 1;
    this.sprite.visible = true;
  }

  hide() {
    this.targetProgress = 0;
  }

  update(deltaTime) {
    if (!this.sprite) return;

    const character = this.engine.character;
    if (!character.model) return;

    // Posiziona sopra la testa del personaggio
    const headOffset = CONFIG.character.height + 2.5;
    this.sprite.position.copy(character.model.position);
    this.sprite.position.y += headOffset;

    // Animazione smooth show/hide
    const speed = 8;
    if (this.animationProgress < this.targetProgress) {
      this.animationProgress = Math.min(1, this.animationProgress + deltaTime * speed);
    } else if (this.animationProgress > this.targetProgress) {
      this.animationProgress = Math.max(0, this.animationProgress - deltaTime * speed);
    }

    // Nascondi sprite quando animazione completa
    if (this.animationProgress === 0) {
      this.sprite.visible = false;
    }

    // Applica animazione con ease-out
    const eased = 1 - Math.pow(1 - this.animationProgress, 3);

    // Scale con bounce
    const scale = 0.8 + eased * 0.2;
    this.sprite.scale.set(6 * scale, 6 * scale, 1);

    // Opacity
    this.sprite.material.opacity = this.animationProgress;
  }

  dispose() {
    if (this.sprite) {
      this.sprite.material.map.dispose();
      this.sprite.material.dispose();
      this.engine.scene.remove(this.sprite);
    }
  }
}

// ============================================================================
// CHARACTER CONTROLLER
// ============================================================================
class CharacterController {
  constructor(engine) {
    this.engine = engine;
    this.model = null;
    this.mixer = null;
    this.hitbox = null;

    // Nota: position usa Vector2 dove x=X mondo, y=Z mondo (piano XZ)
    this.state = {
      position: new THREE.Vector2(-10, 0), // x, z nel mondo 3D
      angle: 0,
      targetAngle: 0,
      timer: 4 + Math.random() * 4,
      target: null,  // Vector2(x, z) target
      targetTimer: 0
    };
    // Vettori temporanei riutilizzabili per evitare allocazioni
    this._tempVec2 = new THREE.Vector2();
  }

  setModel(gltf) {
    this.model = gltf.scene;

    // Scale model
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    this.model.scale.setScalar(CONFIG.character.height / size.y);

    // Enable shadows
    this.model.traverse(child => {
      if (child.isMesh) child.castShadow = true;
    });

    this.engine.scene.add(this.model);

    // Create hitbox
    const hitboxGeo = new THREE.CapsuleGeometry(CONFIG.character.hitboxRadius, CONFIG.character.height, 4, 8);
    const hitboxMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    this.hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    this.hitbox.name = 'character-hitbox';
    this.engine.scene.add(this.hitbox);

    // Setup animation
    if (gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(this.model);
      this.mixer.clipAction(gltf.animations[0]).play();
    }

    this.updatePosition();
    this.engine.events.emit('character:ready', this);
  }

  updatePosition() {
    if (!this.model) return;

    const terrain = this.engine.terrain;
    const groundY = terrain.getGroundHeight(this.state.position.x, this.state.position.y);

    this.model.position.set(this.state.position.x, groundY, this.state.position.y);

    if (this.hitbox) {
      this.hitbox.position.set(
        this.state.position.x,
        groundY + CONFIG.character.height / 2,
        this.state.position.y
      );
    }
  }

  setTarget(target) {
    this.state.target = target;
    this.state.targetTimer = 0;
  }

  update(dt) {
    if (!this.model) return;

    this.mixer?.update(dt);
    this.state.timer -= dt;

    // Target-based movement
    if (this.state.target) {
      this.state.targetTimer += dt;
      if (this.state.target.distanceTo(this.state.position) < 1 || this.state.targetTimer > 12) {
        this.state.target = null;
        this.state.timer = 2 + Math.random() * 3;
      } else {
        // Riusa vettore temporaneo invece di clone()
        this._tempVec2.copy(this.state.target).sub(this.state.position).normalize();
        this.state.targetAngle = Math.atan2(this._tempVec2.x, this._tempVec2.y);
      }
    }
    // Random wandering
    else if (this.state.timer <= 0) {
      this.state.timer = 4 + Math.random() * 4;
      this._tempVec2.set(-10 + (Math.random() - 0.5) * 35, (Math.random() - 0.5) * 25)
        .sub(this.state.position).normalize();
      this.state.targetAngle = Math.atan2(this._tempVec2.x, this._tempVec2.y);
    }

    // Smooth rotation
    let diff = this.state.targetAngle - this.state.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.state.angle += diff * dt * 4;

    // Movement
    const nx = this.state.position.x + Math.sin(this.state.angle) * dt * CONFIG.character.speed;
    const nz = this.state.position.y + Math.cos(this.state.angle) * dt * CONFIG.character.speed;

    if (Math.sqrt(nx * nx + nz * nz) < CONFIG.terrain.radius - 5) {
      this.state.position.set(nx, nz);
    } else {
      this.state.target = null;
      this.state.timer = 0;
    }

    this.updatePosition();
    this.model.rotation.y = this.state.angle;
  }

  dispose() {
    if (this.model) this.engine.scene.remove(this.model);
    if (this.hitbox) {
      this.hitbox.geometry.dispose();
      this.hitbox.material.dispose();
      this.engine.scene.remove(this.hitbox);
    }
  }
}

// ============================================================================
// ASSET LOADER
// ============================================================================
class AssetLoader {
  constructor(engine) {
    this.engine = engine;
    // Manager solo per il modello (asset critico)
    this.manager = new THREE.LoadingManager();

    this.manager.onProgress = (url, loaded, total) => {
      // Modello = 0-70% del progresso totale
      const progress = (loaded / total) * 70;
      window.setLoadingProgress?.(progress);
    };

    this.manager.onLoad = () => {
      // Modello caricato = 70%
      window.setLoadingProgress?.(70);
      this.engine.events.emit('assets:loaded');
    };

    this.manager.onError = (url) => {
      if (DEBUG) console.error('Error loading:', url);
    };
  }

  loadAll() {
    const gltfLoader = new GLTFLoader(this.manager);

    // Model - PRIORITÀ ALTA (sblocca interazione)
    this.engine.profiler.start('Model Load');
    gltfLoader.load(
      CONFIG.assets.model,
      (gltf) => {
        this.engine.profiler.end('Model Load');
        this.engine.character.setModel(gltf);
      }
    );

    // Background - PRIORITÀ BASSA (caricato separatamente, non blocca)
    // Usa un loader separato per non ritardare assets:loaded
    this._loadBackgroundDeferred();
  }

  _loadBackgroundDeferred() {
    // Carica il background dopo un breve delay per dare priorità al modello
    setTimeout(() => {
      const textureLoader = new THREE.TextureLoader();
      this.engine.profiler.start('Background Load');
      textureLoader.load(CONFIG.assets.background, (texture) => {
        this.engine.profiler.end('Background Load');
        texture.colorSpace = THREE.SRGBColorSpace;

        const imgAspect = texture.image.width / texture.image.height;
        const w = CONFIG.background.width;
        const h = w / imgAspect;

        const geometry = new THREE.PlaneGeometry(w, h, 32, 1);
        const positions = geometry.attributes.position;

        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i) / (w / 2);
          positions.setZ(i, x * x * CONFIG.background.curveIntensity);
        }
        geometry.computeVertexNormals();

        const material = new THREE.MeshBasicMaterial({
          map: texture, transparent: true, depthWrite: false
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...CONFIG.background.position);
        mesh.renderOrder = -1;
        this.engine.scene.add(mesh);
      });
    }, 100);
  }
}

// ============================================================================
// INPUT HANDLER
// ============================================================================
class InputHandler {
  constructor(engine) {
    this.engine = engine;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._targetVec2 = new THREE.Vector2(); // Riusabile per click target
    this._lastPointerMoveTime = 0;
    this._pointerMoveThrottle = 16; // ~60fps max per hover checks

    // Mobile: stato tooltip per doppio tap (primo tap mostra tooltip, secondo apre link)
    this._mobileTooltipVisible = false;

    // Bound handlers per corretta rimozione
    this._boundResize = this._onResize.bind(this);
    this._boundPointerDown = this._onPointerDown.bind(this);
    this._boundPointerMove = this._onPointerMove.bind(this);
  }

  init() {
    window.addEventListener('resize', this._boundResize, { passive: true });
    window.addEventListener('pointerdown', this._boundPointerDown, { passive: false });
    window.addEventListener('pointermove', this._boundPointerMove, { passive: true });
  }

  _onResize() {
    const { camera, renderer } = this.engine;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }

  _onPointerDown(e) {
    if (window.controlsDisabled) return;

    const { character, terrain } = this.engine;
    if (!terrain.mesh || !character.model || !character.hitbox) return;

    this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.engine.camera);

    // Check character click
    const hitboxHit = this.raycaster.intersectObject(character.hitbox);
    const tooltipSprite = this.engine.whatsappTooltip.sprite;
    const tooltipHit = tooltipSprite && tooltipSprite.visible
      ? this.raycaster.intersectObject(tooltipSprite)
      : [];
    const hitCharacterArea = hitboxHit.length > 0 || tooltipHit.length > 0;

    if (hitCharacterArea) {
      if (isMobile) {
        // Mobile: primo tap mostra tooltip, secondo tap apre WhatsApp
        if (this._mobileTooltipVisible) {
          window.open(CONFIG.assets.whatsapp, '_blank');
          this._mobileTooltipVisible = false;
          this.engine.whatsappTooltip.hide();
        } else {
          this.engine.whatsappTooltip.show();
          this._mobileTooltipVisible = true;
        }
      } else {
        // Desktop: click diretto apre WhatsApp
        window.open(CONFIG.assets.whatsapp, '_blank');
      }
      return;
    }

    // Tap fuori dal character su mobile: nascondi tooltip
    if (isMobile && this._mobileTooltipVisible) {
      this.engine.whatsappTooltip.hide();
      this._mobileTooltipVisible = false;
    }

    // Check terrain click - muove il personaggio
    const terrainHit = this.raycaster.intersectObject(terrain.mesh)[0];
    if (terrainHit && Math.sqrt(terrainHit.point.x ** 2 + terrainHit.point.z ** 2) < CONFIG.terrain.radius - 5) {
      this._targetVec2.set(terrainHit.point.x, terrainHit.point.z);
      character.setTarget(this._targetVec2.clone());
    }
  }

  _onPointerMove(e) {
    // Throttle pointer move per ridurre calcoli raycast
    const now = performance.now();
    if (now - this._lastPointerMoveTime < this._pointerMoveThrottle) return;
    this._lastPointerMoveTime = now;

    if (window.controlsDisabled) return;

    const { character } = this.engine;
    if (!character.model || !character.hitbox) return;

    this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.engine.camera);

    const hitboxHit = this.raycaster.intersectObject(character.hitbox);
    const hover = hitboxHit.length > 0;

    // Cambia cursore su hover del personaggio
    document.body.style.cursor = hover ? 'pointer' : 'auto';

    // Mostra/nascondi tooltip WhatsApp su hover
    if (hover) {
      this.engine.whatsappTooltip.show();
    } else {
      this.engine.whatsappTooltip.hide();
    }
  }

  dispose() {
    window.removeEventListener('resize', this._boundResize);
    window.removeEventListener('pointerdown', this._boundPointerDown);
    window.removeEventListener('pointermove', this._boundPointerMove);
  }
}

// ============================================================================
// ENGINE - Main Orchestrator
// ============================================================================
class Engine {
  constructor(rootElement) {
    this.root = rootElement;
    this.events = new EventBus();
    this.profiler = new Profiler();
    this.uniforms = { uTime: { value: 0 } };
    this.clock = new THREE.Clock();

    // Three.js core
    this.scene = null;
    this.camera = null;
    this.renderer = null;

    // Systems
    this.terrain = null;
    this.sky = null;
    this.lighting = null;
    this.grass = null;
    this.flowers = null;
    this.fireflies = null;
    this.character = null;
    this.whatsappTooltip = null;
    this.assetLoader = null;
    this.input = null;

    // Render state
    this._isVisible = true;
    this._animationId = null;
    this._boundAnimate = this._animate.bind(this);
    this._boundVisibilityChange = this._onVisibilityChange.bind(this);
  }

  init() {
    this.profiler.start('Total Init');

    // Inizia progresso caricamento
    this.events.emit('loading:progress', 5);

    // Renderer - configurazione centralizzata
    this.renderer = new THREE.WebGLRenderer({
      antialias: CONFIG.renderer.antialias,
      powerPreference: CONFIG.renderer.powerPreference,
      stencil: false, // Non usato, risparmia memoria
      depth: true
    });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(CONFIG.renderer.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.root.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camera.fov,
      innerWidth / innerHeight,
      CONFIG.camera.near,
      CONFIG.camera.far
    );
    this.camera.position.set(...CONFIG.camera.position);
    this.camera.lookAt(...CONFIG.camera.lookAt);

    // Initialize systems
    this.terrain = new TerrainSystem(this);
    this.sky = new SkySystem(this);
    this.lighting = new LightingSystem(this);
    this.grass = new GrassSystem(this);
    this.flowers = new FlowerSystem(this);
    this.fireflies = new FireflySystem(this);
    this.character = new CharacterController(this);
    this.whatsappTooltip = new WhatsAppTooltip(this);
    this.assetLoader = new AssetLoader(this);
    this.input = new InputHandler(this);

    // Setup systems
    this.lighting.init();
    this.sky.init();
    this.terrain.init();
    this.grass.init();
    this.input.init();

    // Event listeners
    this.events.on('assets:loaded', () => {
      this.fireflies.init();
      this.flowers.init();
      this.grass.finalizePositions();
      this.profiler.end('Total Init');

      // Stampa report performance in console
      this.profiler.printReport();
    });

    this.events.on('character:ready', () => {
      this.whatsappTooltip.init();
      window.enableControls?.();
      window.sceneLoaded = true;
    });

    // Load assets
    this.assetLoader.loadAll();

    // Visibility API - pausa rendering quando tab non visibile
    document.addEventListener('visibilitychange', this._boundVisibilityChange);

    // Start render loop
    this._animate();
  }

  _onVisibilityChange() {
    this._isVisible = !document.hidden;
    if (this._isVisible) {
      // Reset clock per evitare salti di delta time
      this.clock.getDelta();
      if (!this._animationId) {
        this._animate();
      }
    }
  }

  _animate() {
    // Stop loop se non visibile (risparmia CPU/batteria)
    if (!this._isVisible) {
      this._animationId = null;
      return;
    }

    this._animationId = requestAnimationFrame(this._boundAnimate);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.uniforms.uTime.value += dt;

    this.character.update(dt);
    this.fireflies.update(dt);
    this.whatsappTooltip.update(dt);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    // Stop render loop
    if (this._animationId) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }

    // Remove visibility listener
    document.removeEventListener('visibilitychange', this._boundVisibilityChange);

    // Dispose all systems
    this.terrain?.dispose();
    this.sky?.dispose();
    this.lighting?.dispose();
    this.grass?.dispose();
    this.flowers?.dispose();
    this.fireflies?.dispose();
    this.character?.dispose();
    this.whatsappTooltip?.dispose();
    this.input?.dispose();

    // Deep dispose scene (catch any remaining objects)
    if (this.scene) {
      this.scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => {
              m.map?.dispose();
              m.dispose();
            });
          } else {
            obj.material.map?.dispose();
            obj.material.dispose();
          }
        }
      });
      this.scene.clear();
    }

    // Dispose renderer
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();

    // Clear references
    this.scene = null;
    this.camera = null;
    this.renderer = null;
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

// Check WebGL support
function checkWebGLSupport() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) {
      return { supported: false, error: 'WebGL not supported' };
    }
    return { supported: true, version: canvas.getContext('webgl2') ? 2 : 1 };
  } catch (e) {
    return { supported: false, error: e.message };
  }
}

function showError(message) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                  font-family:system-ui;color:#666;text-align:center;padding:20px;">
        <div>
          <h2 style="color:#e53935;margin-bottom:16px;">Unable to load 3D scene</h2>
          <p>${message}</p>
        </div>
      </div>
    `;
  }
}

function init() {
  const root = document.getElementById('root');
  if (!root) return;

  // Verify WebGL support
  const webgl = checkWebGLSupport();
  if (!webgl.supported) {
    showError('Your browser does not support WebGL. Please try a modern browser.');
    return;
  }

  try {
    const engine = new Engine(root);
    engine.init();

    // Handle WebGL context lost
    engine.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost. Attempting recovery...');
    }, false);

    engine.renderer.domElement.addEventListener('webglcontextrestored', () => {
      console.log('WebGL context restored. Reinitializing...');
      window.location.reload(); // Safest approach for full recovery
    }, false);

    // Expose for debugging
    window.engine = engine;

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      engine.dispose();
    }, { once: true });

  } catch (error) {
    console.error('Engine initialization failed:', error);
    showError('Failed to initialize 3D engine. Please refresh the page.');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
