// Pooled visual effects: tracers, debris particles, shockwaves, enemy projectiles.
// Everything pre-allocated; no per-frame allocation.
import * as THREE from 'three';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// ---------------- Tracers ----------------
const TRACER_COUNT = 40;
interface Tracer { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; maxLife: number; }

export class TracerPool {
  private pool: Tracer[] = [];
  private idx = 0;
  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < TRACER_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.pool.push({ mesh, mat, life: 0, maxLife: 0.12 });
    }
  }

  fire(from: THREE.Vector3, to: THREE.Vector3, color: number, width = 0.05, life = 0.12) {
    const t = this.pool[this.idx];
    this.idx = (this.idx + 1) % TRACER_COUNT;
    _v1.addVectors(from, to).multiplyScalar(0.5);
    t.mesh.position.copy(_v1);
    _v2.subVectors(to, from);
    const len = _v2.length();
    if (len < 0.001) return;
    _v2.normalize();
    _q.setFromUnitVectors(UP, _v2);
    t.mesh.quaternion.copy(_q);
    t.mesh.scale.set(width, len, width);
    t.mat.color.setHex(color);
    t.mat.opacity = 0.95;
    t.mesh.visible = true;
    t.life = life;
    t.maxLife = life;
  }

  update(dt: number) {
    for (const t of this.pool) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      t.mat.opacity = 0.95 * (t.life / t.maxLife);
    }
  }
}

// ---------------- Debris particles (instanced) ----------------
const PARTICLE_COUNT = 200;
interface Particle { alive: boolean; pos: THREE.Vector3; vel: THREE.Vector3; life: number; maxLife: number; size: number; grav: number; }

export class ParticlePool {
  private mesh: THREE.InstancedMesh;
  private particles: Particle[] = [];
  private cursor = 0;
  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 1 });
    this.mesh = new THREE.InstancedMesh(geo, mat, PARTICLE_COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particles.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 0.05, grav: 1 });
      this.mesh.setColorAt(i, new THREE.Color(0.6, 0.6, 0.6));
    }
  }

  burst(origin: THREE.Vector3, color: THREE.Color, count: number, speed: number, opts?: { size?: number; life?: number; grav?: number; spread?: number }) {
    const size = opts?.size ?? 0.06;
    const life = opts?.life ?? 0.55;
    const grav = opts?.grav ?? 9;
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % PARTICLE_COUNT;
      p.alive = true;
      p.pos.copy(origin);
      p.vel.set((Math.random() - 0.5), Math.random() * 0.9 + 0.1, (Math.random() - 0.5)).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      p.life = life * (0.5 + Math.random() * 0.7);
      p.maxLife = p.life;
      p.size = size * (0.6 + Math.random() * 0.9);
      p.grav = grav;
      this.mesh.setColorAt(this.cursorIdx(this.cursor), color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private cursorIdx(c: number) { return (c - 1 + PARTICLE_COUNT) % PARTICLE_COUNT; }

  update(dt: number) {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.particles[i];
      if (!p.alive) {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); continue; }
      p.vel.y -= p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.02) { p.pos.y = 0.02; p.vel.y *= -0.35; p.vel.x *= 0.7; p.vel.z *= 0.7; }
      const k = (p.life / p.maxLife) * p.size;
      _s.set(k, k, k);
      _q.identity();
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------- Shockwave rings ----------------
const RING_COUNT = 8;
interface Ring { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; maxLife: number; maxR: number; }

export class RingPool {
  private pool: Ring[] = [];
  private idx = 0;
  constructor(scene: THREE.Scene) {
    const geo = new THREE.RingGeometry(0.85, 1, 40);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.pool.push({ mesh, mat, life: 0, maxLife: 0.5, maxR: 4 });
    }
  }

  spawn(pos: THREE.Vector3, color: number, maxR = 4, life = 0.45) {
    const r = this.pool[this.idx];
    this.idx = (this.idx + 1) % RING_COUNT;
    r.mesh.position.copy(pos);
    r.mesh.position.y = Math.max(0.05, pos.y * 0.3);
    r.mat.color.setHex(color);
    r.life = life;
    r.maxLife = life;
    r.maxR = maxR;
    r.mesh.visible = true;
  }

  update(dt: number) {
    for (const r of this.pool) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const t = 1 - r.life / r.maxLife;
      const s = 0.2 + t * r.maxR;
      r.mesh.scale.set(s, 1, s);
      r.mat.opacity = 0.8 * (1 - t);
    }
  }
}

// ---------------- Enemy projectiles (parryable) ----------------
export interface Projectile {
  active: boolean;
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  parried: boolean;
  damage: number;
  radius: number;
}

const PROJECTILE_COUNT = 26;

export class ProjectilePool {
  list: Projectile[] = [];
  constructor(scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(0.16, 10, 8);
    for (let i = 0; i < PROJECTILE_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xcfd2d6, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.list.push({ active: false, mesh, vel: new THREE.Vector3(), life: 0, parried: false, damage: 12, radius: 0.34 });
    }
  }

  fire(from: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number) {
    for (const p of this.list) {
      if (p.active) continue;
      p.active = true;
      p.parried = false;
      p.mesh.position.copy(from);
      p.vel.copy(dir).multiplyScalar(speed);
      p.life = 6;
      p.damage = damage;
      (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xcfd2d6);
      p.mesh.visible = true;
      return p;
    }
    return null;
  }

  update(dt: number) {
    for (const p of this.list) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; p.mesh.visible = false; continue; }
      p.mesh.position.addScaledVector(p.vel, dt);
      const s = 1 + Math.sin(performance.now() * 0.02) * 0.15;
      p.mesh.scale.setScalar(s);
    }
  }

  clearAll() {
    for (const p of this.list) { p.active = false; p.mesh.visible = false; }
  }
}

// ---------------- Screen shake (trauma) ----------------
export class Shake {
  trauma = 0;
  add(amount: number) { this.trauma = Math.min(1.2, this.trauma + amount); }
  update(dt: number) { this.trauma = Math.max(0, this.trauma - dt * 1.6); }
  offset(out: THREE.Vector3, scale: number) {
    const t = this.trauma * this.trauma * scale;
    const n = performance.now() * 0.045;
    out.set(
      Math.sin(n * 1.3) * t * 0.06,
      Math.cos(n * 1.7) * t * 0.05,
      0
    );
    return out;
  }
}
