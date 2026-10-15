// The arena: a dead gray world. Geometry is dull; color is astronomically rare.
import * as THREE from 'three';

export interface Collider {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export const ARENA_HALF = 44;

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a3c40';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#4a4d52';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = '#424449';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(ARENA_HALF, ARENA_HALF);
  tex.anisotropy = 4;
  return tex;
}

export function buildArena(scene: THREE.Scene, quality: 'low' | 'high'): { colliders: Collider[] } {
  const colliders: Collider[] = [];

  scene.fog = new THREE.FogExp2(0x232527, 0.015);
  scene.background = new THREE.Color(0x232527);

  // lighting: cold, flat, overcast
  const hemi = new THREE.HemisphereLight(0x777d85, 0x232426, 2.1);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0x3a3d42, 0.9);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xb8bec6, quality === 'high' ? 2.2 : 1.6);
  dir.position.set(18, 34, 12);
  if (quality === 'high') {
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    const s = 40;
    dir.shadow.camera.left = -s; dir.shadow.camera.right = s;
    dir.shadow.camera.top = s; dir.shadow.camera.bottom = -s;
    dir.shadow.camera.far = 90;
    dir.shadow.bias = -0.0015;
  }
  scene.add(dir);

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
    new THREE.MeshStandardMaterial({ map: gridTexture(), color: 0x8a8d91, roughness: 0.95, metalness: 0.05 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = quality === 'high';
  scene.add(ground);

  // perimeter walls
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x54575c, roughness: 0.9, metalness: 0.15 });
  const wallGeoH = new THREE.BoxGeometry(ARENA_HALF * 2 + 2, 7, 2);
  const wallGeoV = new THREE.BoxGeometry(2, 7, ARENA_HALF * 2 + 2);
  const wallDefs: [THREE.BufferGeometry, number, number][] = [
    [wallGeoH, 0, -ARENA_HALF - 1], [wallGeoH, 0, ARENA_HALF + 1],
  ];
  for (const [geo, x, z] of wallDefs) {
    const w = new THREE.Mesh(geo, wallMat);
    w.position.set(x, 3.5, z);
    w.castShadow = quality === 'high';
    w.receiveShadow = true;
    scene.add(w);
  }
  for (const x of [-ARENA_HALF - 1, ARENA_HALF + 1]) {
    const w = new THREE.Mesh(wallGeoV, wallMat);
    w.position.set(x, 3.5, 0);
    w.castShadow = quality === 'high';
    w.receiveShadow = true;
    scene.add(w);
  }

  // scattered monoliths / cover blocks — brutalist gray
  const blockMats = [
    new THREE.MeshStandardMaterial({ color: 0x5c5f64, roughness: 0.9, metalness: 0.2 }),
    new THREE.MeshStandardMaterial({ color: 0x4e5054, roughness: 0.95, metalness: 0.1 }),
    new THREE.MeshStandardMaterial({ color: 0x67696e, roughness: 0.85, metalness: 0.25 }),
  ];
  const rng = mulberry(1337);
  const placements: [number, number, number, number, number][] = []; // x,z,w,h,d
  for (let i = 0; i < 16; i++) {
    const x = (rng() * 2 - 1) * (ARENA_HALF - 10);
    const z = (rng() * 2 - 1) * (ARENA_HALF - 10);
    if (Math.hypot(x, z) < 9) continue; // keep spawn center clear
    const w = 2 + rng() * 5;
    const d = 2 + rng() * 5;
    const h = 2.5 + rng() * 6;
    placements.push([x, z, w, h, d]);
  }
  // some deterministic cover near mid
  placements.push([10, 8, 4, 3.2, 4], [-12, -6, 5, 2.6, 3], [-6, 14, 3, 4.5, 3], [14, -14, 4, 3.8, 5]);
  for (const [x, z, w, h, d] of placements) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), blockMats[Math.floor(rng() * blockMats.length)]);
    m.position.set(x, h / 2, z);
    m.rotation.y = (rng() - 0.5) * 0.6;
    m.castShadow = quality === 'high';
    m.receiveShadow = true;
    scene.add(m);
    // conservative AABB around rotated box
    const cos = Math.abs(Math.cos(m.rotation.y));
    const sin = Math.abs(Math.sin(m.rotation.y));
    const ew = (w * cos + d * sin) / 2;
    const ed = (w * sin + d * cos) / 2;
    colliders.push({
      min: new THREE.Vector3(x - ew, 0, z - ed),
      max: new THREE.Vector3(x + ew, h, z + ed),
    });
  }

  // dead sky monolith silhouettes outside walls for depth
  const farMat = new THREE.MeshBasicMaterial({ color: 0x333539, fog: true });
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2;
    const r = 70 + rng() * 60;
    const h = 15 + rng() * 45;
    const m = new THREE.Mesh(new THREE.BoxGeometry(6 + rng() * 10, h, 6 + rng() * 10), farMat);
    m.position.set(Math.cos(ang) * r, h / 2 - 2, Math.sin(ang) * r);
    scene.add(m);
  }

  return { colliders };
}

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
