// Enemies: fodder droids (user model), elite knight paladins (KayKit), boss variant.
// Shields: sphere (shotgun, matching color) / triangular prism (sniper, opposite color),
// each with its own raycastable hitbox mesh.
import * as THREE from 'three';
import { World, transforms, healths } from './ecs';
import type { Entity } from './ecs';
import type { Assets } from './assets';
import { cloneRigged } from './assets';
import type { Player } from './player';
import type { ParticlePool, RingPool, TracerPool, ProjectilePool } from './effects';
import type { Collider } from './arena';
import { ARENA_HALF } from './arena';
import { audio } from './audio';
import { store } from './store';
import type { ColorKey } from './colors';
import { colorToHex, oppositeColor, colorsEqual, randomColor } from './colors';
import { ProcRig, ROBOT_BONES, DROID_BONES, gaitPose, applyGait } from './procanim';

export type EnemyKind = 'fodder' | 'elite' | 'boss';
export type ShieldType = 'sphere' | 'prism';

export interface ShieldRec {
  type: ShieldType;
  color: ColorKey;
  hp: number;
  max: number;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  active: boolean;
}

export interface EnemyRec {
  kind: EnemyKind;
  group: THREE.Group;
  body: THREE.Mesh; // invisible body hitbox
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
  rig: ProcRig | null; // procedural skeletal animation
  state: 'chase' | 'windup' | 'strike' | 'stagger' | 'dead' | 'ranged' | 'dodge';
  stateT: number;
  speed: number;
  attackCd: number;
  hitRadius: number;
  shield: ShieldRec | null;
  isSpitter: boolean;
  parryableUntil: number;
  bobPhase: number;
  deadT: number;
  removeAt: number;
  // dodge AI (elites/bosses only)
  dodgeT: number;
  dodgeCd: number;
  dodgeDirX: number;
  dodgeDirZ: number;
  dodgeSide: number;
  aimT: number; // crosshair-pressure accumulator
}

export interface HitResult {
  outcome: 'kill' | 'hit' | 'shieldHit' | 'shieldBreak' | 'shieldWrong' | 'fodderImmune' | 'dead';
  entity: Entity;
  point: THREE.Vector3;
}

interface Ctx {
  scene: THREE.Scene;
  player: Player;
  particles: ParticlePool;
  rings: RingPool;
  tracers: TracerPool;
  projectiles: ProjectilePool;
  colliders: Collider[];
  addScore: (n: number) => void;
  onKill: (kind: EnemyKind) => void;
  shake: (n: number) => void;
  hitstop: (t: number) => void;
  addAmmo: (n: number) => void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _gray = new THREE.Color(0.55, 0.56, 0.58);
const _white = new THREE.Color(0.9, 0.92, 0.95);

// dodge tuning
const DODGE_TIME = 0.34;
const DODGE_CD_MIN = 2.2;
const DODGE_CD_VAR = 1.3;
const DODGE_SPEED = 15;
const DODGE_SPEED_BOSS = 10;
const DODGE_CHANCE = 0.5; // reaction to shotgun/sniper fire
const DODGE_CHANCE_BOSS = 0.3;
const AIM_DODGE_TIME = 0.45; // seconds under crosshair before a proactive dodge roll
const AIM_DODGE_CHANCE = 0.3;
const AIM_DODGE_CHANCE_BOSS = 0.14;

export class EnemyManager {
  world = new World();
  recs = new Map<Entity, EnemyRec>();
  pickups: { mesh: THREE.Mesh; pos: THREE.Vector3; t: number }[] = [];
  private ctx!: Ctx;
  private assets!: Assets;
  private pickupGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
  private pickupMat = new THREE.MeshBasicMaterial({ color: 0xdfe3e8 });
  bossEntity: Entity | null = null;

  init(ctx: Ctx, assets: Assets) {
    this.ctx = ctx;
    this.assets = assets;
  }

  count(): number {
    let n = 0;
    for (const [, r] of this.recs) if (r.state !== 'dead') n++;
    return n;
  }

  // ---------------- spawning ----------------
  spawnFodder(pos: THREE.Vector3, wave: number): Entity {
    const e = this.world.create();
    // root stays unscaled so hitboxes keep world size; the model is scaled inside
    const group = new THREE.Group();
    const model = cloneRigged(this.assets.fodder);
    group.add(model);
    group.position.copy(pos);
    group.rotation.y = Math.random() * Math.PI * 2;
    this.ctx.scene.add(group);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.9, 8), invisibleMat);
    body.position.y = 0.95;
    body.userData.eid = e;
    body.userData.part = 'body';
    group.add(body);

    const isSpitter = Math.random() < 0.3;
    const hp = 40 + wave * 3;
    transforms.set(e, { x: pos.x, y: pos.y, z: pos.z, yaw: 0 });
    healths.set(e, { hp, max: hp });
    this.recs.set(e, {
      kind: 'fodder', group, body, mixer: null, actions: new Map(), current: '',
      rig: new ProcRig(model, ROBOT_BONES),
      state: 'chase', stateT: 0, speed: 4.2 + Math.min(2.5, wave * 0.15) + Math.random() * 0.8,
      attackCd: 1 + Math.random(), hitRadius: 0.85, shield: null, isSpitter,
      parryableUntil: 0, bobPhase: Math.random() * 10, deadT: 0, removeAt: 0,
      dodgeT: 0, dodgeCd: 0, dodgeDirX: 0, dodgeDirZ: 0, dodgeSide: 1, aimT: 0,
    });
    return e;
  }

  spawnElite(pos: THREE.Vector3, wave: number, opts?: { boss?: boolean; shield?: ShieldType; prime?: boolean }): Entity {
    const e = this.world.create();
    const isBoss = opts?.boss ?? false;
    const isPrime = opts?.prime ?? false;
    const group = new THREE.Group();
    const model = cloneRigged(this.assets.elite);
    if (isBoss) model.scale.multiplyScalar(1.6);
    else if (isPrime) model.scale.multiplyScalar(1.28);
    group.add(model);
    group.position.copy(pos);
    this.ctx.scene.add(group);
    const rig = new ProcRig(model, DROID_BONES);

    const h = isBoss ? 3.1 : isPrime ? 2.5 : 2.0;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(isBoss ? 0.85 : 0.6, isBoss ? 0.85 : 0.6, h, 8), invisibleMat);
    body.position.y = h / 2;
    body.userData.eid = e;
    body.userData.part = 'body';
    group.add(body);

    const mixer = new THREE.AnimationMixer(group);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of this.assets.eliteClips) {
      actions.set(clip.name, mixer.clipAction(clip));
    }

    // shield
    const shieldType: ShieldType = opts?.shield ?? (Math.random() < 0.72 ? 'sphere' : 'prism');
    const color = randomColor();
    const hex = colorToHex(color);
    const shieldGroup = new THREE.Group();
    const meshes: THREE.Mesh[] = [];
    if (shieldType === 'sphere') {
      const r = isBoss ? 2.5 : 1.75;
      const geo = new THREE.SphereGeometry(r, 24, 16);
      const fill = new THREE.Mesh(geo, shieldFillMat(hex));
      const wire = new THREE.Mesh(geo, shieldWireMat(hex));
      wire.scale.setScalar(1.01);
      fill.userData = { eid: e, part: 'shield' };
      wire.userData = { eid: e, part: 'shield' };
      fill.position.y = h * 0.55; wire.position.y = h * 0.55;
      shieldGroup.add(fill, wire);
      meshes.push(fill, wire);
    } else {
      // triangular prism enclosure
      const r = isBoss ? 2.3 : 1.7;
      const geo = new THREE.CylinderGeometry(r, r, h + 1.0, 3, 1, false);
      const fill = new THREE.Mesh(geo, shieldFillMat(hex));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.9 }));
      fill.userData = { eid: e, part: 'shield' };
      fill.position.y = (h + 1.0) / 2 - 0.1;
      edges.position.copy(fill.position);
      shieldGroup.add(fill, edges);
      meshes.push(fill);
    }
    group.add(shieldGroup);

    const shieldHp = shieldType === 'sphere' ? (isPrime ? 140 : 90) : (isBoss ? 300 : 150);
    const hp = isBoss ? 1400 + wave * 40 : isPrime ? 520 + wave * 24 : 260 + wave * 12;
    transforms.set(e, { x: pos.x, y: pos.y, z: pos.z, yaw: 0 });
    healths.set(e, { hp, max: hp });
    this.recs.set(e, {
      kind: isBoss ? 'boss' : 'elite', group, body, mixer, actions, current: '',
      rig,
      state: 'chase', stateT: 0, speed: isBoss ? 5.2 : 3.6 + Math.min(1.4, wave * 0.08),
      attackCd: 2, hitRadius: isBoss ? 1.3 : 0.95,
      shield: { type: shieldType, color, hp: shieldHp, max: shieldHp, group: shieldGroup, meshes, active: true },
      isSpitter: false, parryableUntil: 0, bobPhase: Math.random() * 10, deadT: 0, removeAt: 0,
      dodgeT: 0, dodgeCd: 1.5 + Math.random() * 1.5, dodgeDirX: 0, dodgeDirZ: 0, dodgeSide: 1, aimT: 0,
    });
    if (isBoss) {
      this.bossEntity = e;
      audio.bossSting();
    }
    return e;
  }

  private play(r: EnemyRec, name: string, fade = 0.18, once = false) {
    if (r.current === name || !r.actions.has(name)) return;
    const next = r.actions.get(name)!;
    const prev = r.current ? r.actions.get(r.current) : undefined;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    if (prev) { next.crossFadeFrom(prev, fade, false); }
    next.play();
    r.current = name;
  }

  // ---------------- dodge ----------------
  // sideways burst; perpendicular to the threat line, random side
  private startDodge(e: Entity, r: EnemyRec, threatX: number, threatZ: number) {
    const t = transforms.get(e);
    if (!t) return;
    const dx = t.x - threatX;
    const dz = t.z - threatZ;
    const len = Math.hypot(dx, dz) || 1;
    const side = Math.random() < 0.5 ? 1 : -1;
    r.dodgeDirX = (-dz / len) * side;
    r.dodgeDirZ = (dx / len) * side;
    r.dodgeSide = side;
    r.state = 'dodge';
    r.stateT = DODGE_TIME;
    r.dodgeT = DODGE_TIME;
    r.dodgeCd = DODGE_CD_MIN + Math.random() * DODGE_CD_VAR;
    r.aimT = 0;
    audio.dodge();
    this.ctx.particles.burst(r.group.position, _gray, 6, 2.5, { life: 0.3, grav: 1 });
  }

  // called by weapons when the player fires shotgun/sniper — elites may reaction-dodge
  notifyShot(origin: THREE.Vector3, dir: THREE.Vector3, weaponId: number) {
    if (weaponId === 0) return; // fodder-grade fire doesn't scare elites
    for (const [e, r] of this.recs) {
      if (r.kind === 'fodder' || r.state === 'dead' || r.state === 'dodge' || r.state === 'stagger') continue;
      if (r.dodgeCd > 0) continue;
      const t = transforms.get(e)!;
      _v.set(t.x - origin.x, 1.2 - origin.y, t.z - origin.z);
      const dist = _v.length();
      if (dist > 38) continue;
      _v.normalize();
      if (_v.dot(dir) < 0.968) continue; // ~14.5 deg: only if actually targeted
      const chance = r.kind === 'boss' ? DODGE_CHANCE_BOSS : DODGE_CHANCE;
      if (Math.random() < chance) this.startDodge(e, r, origin.x, origin.z);
    }
  }

  // ---------------- per-frame update ----------------
  update(dt: number, now: number) {
    const ctx = this.ctx;
    const player = ctx.player;
    const px = player.pos.x, pz = player.pos.z;

    // separation accumulator is O(n^2) but n <= ~20
    for (const [e, r] of this.recs) {
      const t = transforms.get(e)!;
      const h = healths.get(e)!;

      if (r.state === 'dead') {
        r.deadT += dt;
        if (r.mixer) r.mixer.update(dt);
        if (r.deadT > 0.3) {
          r.group.position.y = t.y - (r.deadT - 0.3) * 0.6;
          r.group.rotation.x = Math.min(Math.PI / 2, (r.deadT - 0.3) * 1.4);
        }
        if (r.deadT >= r.removeAt) this.despawn(e);
        continue;
      }

      const dx = px - t.x;
      const dz = pz - t.z;
      const dist = Math.hypot(dx, dz);
      const targetYaw = Math.atan2(dx, dz);
      // smooth turn
      let dy = targetYaw - t.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      t.yaw += dy * Math.min(1, dt * 8);
      r.group.rotation.y = t.yaw;

      r.attackCd -= dt;
      r.stateT -= dt;

      // shield visual pulse + faces player slightly
      if (r.shield?.active) {
        const pulse = 1 + Math.sin(now * 3 + r.bobPhase) * 0.02;
        r.shield.group.scale.setScalar(pulse);
        if (r.shield.type === 'prism') r.shield.group.rotation.y = -t.yaw + Math.sin(now * 0.8) * 0.3;
      }

      if (r.kind === 'fodder') {
        this.updateFodder(e, r, t, dist, dx, dz, dt, now);
      } else {
        this.updateElite(e, r, t, h, dist, dx, dz, dt, now);
      }

      // separation from other enemies
      for (const [e2, r2] of this.recs) {
        if (e2 === e || r2.state === 'dead') continue;
        const t2 = transforms.get(e2)!;
        const sx = t.x - t2.x;
        const sz = t.z - t2.z;
        const d = Math.hypot(sx, sz);
        const minD = r.hitRadius + r2.hitRadius + 0.3;
        if (d > 0.001 && d < minD) {
          const push = (minD - d) * 0.5;
          t.x += (sx / d) * push;
          t.z += (sz / d) * push;
        }
      }

      // keep out of obstacles + bounds
      this.collide(t, r.hitRadius);

      r.group.position.set(t.x, t.y, t.z);
      if (r.mixer) r.mixer.update(dt);
    }

    // pickups (sniper ammo)
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.mesh.rotation.y += dt * 2.4;
      p.mesh.position.y = 0.5 + Math.sin(p.t * 3) * 0.15;
      const d = Math.hypot(px - p.pos.x, pz - p.pos.z);
      if (d < 1.6) {
        this.ctx.addAmmo(3);
        audio.pickup();
        ctx.particles.burst(p.mesh.position, _white, 10, 3, { life: 0.4, grav: 2 });
        ctx.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }

  private updateFodder(e: Entity, r: EnemyRec, t: { x: number; y: number; z: number; yaw: number }, dist: number, dx: number, dz: number, dt: number, now: number) {
    const ctx = this.ctx;
    r.bobPhase += dt * (r.state === 'chase' ? 9.5 : 3);
    const rig = r.rig;

    // skeletal gait; small root bob on top
    t.y = Math.abs(Math.sin(r.bobPhase)) * 0.05;
    r.group.rotation.z = Math.sin(r.bobPhase * 0.5) * 0.03;

    if (r.state === 'windup') {
      // telegraphed, parryable melee — both arms raise overhead
      const k = 1 - Math.max(0, r.stateT) / 0.55;
      if (rig) {
        rig.set('upper_arm.L', 0, 0, 2.4 * k);
        rig.set('upper_arm.R', 0, 0, -2.4 * k);
        rig.set('forearm.L', 0, 0, 0.7 * k);
        rig.set('forearm.R', 0, 0, -0.7 * k);
        rig.set('spine.003', -0.25 * k, 0, 0);
      }
      r.group.rotation.x = -0.18 * k;
      if (r.stateT <= 0) {
        r.state = 'strike';
        r.stateT = 0.18;
        if (rig) {
          rig.set('upper_arm.L', 0.9, 0, 0.6);
          rig.set('upper_arm.R', 0.9, 0, -0.6);
          rig.set('spine.003', 0.3, 0, 0);
        }
        r.group.rotation.x = 0.22;
        if (dist < 2.6) {
          const died = ctx.player.damage(14);
          ctx.shake(0.4);
          if (died) return;
        }
      }
      return;
    }
    if (r.state === 'strike') {
      if (r.stateT <= 0) { r.state = 'chase'; r.attackCd = 1.4 + Math.random() * 0.8; r.group.rotation.x = 0; }
      return;
    }

    if (rig) {
      const chasing = r.state === 'chase' && !r.isSpitter;
      const moving = r.state === 'chase';
      applyGait(rig, 'robot', gaitPose(r.bobPhase, moving ? 1 : 0));
      if (!moving) {
        // idle sway
        rig.set('spine.001', 0.03 * Math.sin(now * 1.7 + r.bobPhase), 0, 0.03 * Math.cos(now * 1.3));
        rig.set('upper_arm.L', 0, 0, 0.06 + 0.03 * Math.sin(now * 1.9));
        rig.set('upper_arm.R', 0, 0, -0.06 - 0.03 * Math.sin(now * 1.9));
      } else {
        rig.set('spine.001', chasing ? 0.14 : 0.06, 0, 0);
      }
    }
    r.group.rotation.x = r.state === 'chase' ? 0.08 : 0;

    if (r.isSpitter && dist < 26 && dist > 7 && r.attackCd <= 0) {
      r.attackCd = 2.6 + Math.random();
      _v.set(t.x, 1.3, t.z);
      _v2.set(dx, (ctx.player.pos.y + 1.1) - 1.3, dz).normalize();
      ctx.projectiles.fire(_v, _v2, 10.5, 12);
      audio.enemyShoot();
      return;
    }

    const desired = r.isSpitter ? 11 : 1.9;
    if (dist > desired) {
      const inv = 1 / Math.max(dist, 0.001);
      t.x += dx * inv * r.speed * dt;
      t.z += dz * inv * r.speed * dt;
    } else if (r.isSpitter && dist < desired - 3) {
      const inv = 1 / Math.max(dist, 0.001);
      t.x -= dx * inv * r.speed * 0.6 * dt;
      t.z -= dz * inv * r.speed * 0.6 * dt;
    }

    if (!r.isSpitter && dist < 2.4 && r.attackCd <= 0) {
      r.state = 'windup';
      r.stateT = 0.55;
      r.parryableUntil = now + 0.55 + 0.15; // active through the strike
      audio.enemyShoot();
    }
    void e;
  }

  private updateElite(e: Entity, r: EnemyRec, t: { x: number; y: number; z: number; yaw: number }, h: { hp: number; max: number }, dist: number, dx: number, dz: number, dt: number, now: number) {
    const ctx = this.ctx;
    const shielded = r.shield?.active ?? false;
    const rig = r.rig;
    r.dodgeCd = Math.max(0, r.dodgeCd - dt);

    // ---- dodge state: fast lateral burst, committed ----
    if (r.state === 'dodge') {
      const spd = r.kind === 'boss' ? DODGE_SPEED_BOSS : DODGE_SPEED;
      t.x += r.dodgeDirX * spd * dt;
      t.z += r.dodgeDirZ * spd * dt;
      r.bobPhase += dt * 14;
      if (rig) {
        const g = gaitPose(r.bobPhase, 1.15);
        applyGait(rig, 'droid', g);
        // lean hard into the dodge, arms trailing
        rig.set('chest', 0.1, 0, -0.4 * r.dodgeSide);
        rig.set('stomache', 0, 0, -0.2 * r.dodgeSide);
        rig.set('uparmL', 0, 0, 0.7);
        rig.set('uparmR', 0, 0, -0.7);
        rig.set('head', 0, 0, 0.25 * r.dodgeSide);
      }
      r.group.rotation.x = 0.15;
      if (r.stateT <= 0) {
        r.state = 'chase';
        r.group.rotation.x = 0;
        r.attackCd = Math.max(r.attackCd, 0.5);
      }
      return;
    }

    // ---- crosshair pressure: holding aim on an elite may provoke a dodge ----
    if (r.state === 'chase' && r.dodgeCd <= 0) {
      ctx.player.forward(_v2);
      _v.set(t.x - ctx.player.pos.x, (t.y + 1.2) - (ctx.player.pos.y + 1.6), t.z - ctx.player.pos.z);
      const d = _v.length();
      if (d < 42) {
        _v.normalize();
        if (_v.dot(_v2) > 0.9975) { // ~4 deg cone
          r.aimT += dt;
          if (r.aimT > AIM_DODGE_TIME) {
            r.aimT = 0;
            const chance = r.kind === 'boss' ? AIM_DODGE_CHANCE_BOSS : AIM_DODGE_CHANCE;
            if (Math.random() < chance) { this.startDodge(e, r, ctx.player.pos.x, ctx.player.pos.z); return; }
            r.dodgeCd = 0.9; // didn't take the bait; brief grace before next roll
          }
        } else {
          r.aimT = Math.max(0, r.aimT - dt * 2.5);
        }
      } else {
        r.aimT = 0;
      }
    }

    if (r.state === 'stagger') {
      this.play(r, 'Hit_A', 0.1, true);
      if (rig) {
        rig.set('chest', -0.3, 0, Math.sin(now * 22) * 0.1);
        rig.set('stomache', -0.15, 0, 0);
        rig.set('head', -0.3, Math.sin(now * 17) * 0.2, 0);
        rig.set('uparmL', 0, 0, 0.5);
        rig.set('uparmR', 0, 0, -0.5);
      }
      if (r.stateT <= 0) { r.state = 'chase'; r.attackCd = 0.8; }
      return;
    }
    if (r.state === 'windup') {
      this.play(r, r.kind === 'boss' ? '2H_Melee_Attack_Spin' : '2H_Melee_Attack_Slice', 0.12, true);
      // rear back with both arms raised — parryable telegraph
      const total = r.kind === 'boss' ? 0.7 : 0.6;
      const k = 1 - Math.max(0, r.stateT) / total;
      if (rig) {
        rig.set('uparmL', 0, 0, 2.3 * k);
        rig.set('uparmR', 0, 0, -2.3 * k);
        rig.set('BotarmL', 0, 0, 0.6 * k);
        rig.set('BotarmR', 0, 0, -0.6 * k);
        rig.set('chest', -0.3 * k, 0, 0);
        rig.set('head', 0.15 * k, 0, 0);
      }
      r.group.rotation.x = -0.2 * k;
      if (r.stateT <= 0) {
        r.state = 'strike';
        r.stateT = 0.25;
        if (rig) {
          rig.set('uparmL', 1.1, 0, 0.4);
          rig.set('uparmR', 1.1, 0, -0.4);
          rig.set('chest', 0.35, 0, 0);
        }
        r.group.rotation.x = 0.3;
        if (dist < (r.kind === 'boss' ? 4.6 : 3.6)) {
          const died = ctx.player.damage(r.kind === 'boss' ? 30 : 22);
          ctx.shake(0.55);
          if (died) return;
        }
      }
      return;
    }
    if (r.state === 'strike') {
      if (r.stateT <= 0) {
        r.state = 'chase';
        r.attackCd = r.kind === 'boss' ? 1.6 : 2.1;
        r.group.rotation.x = 0;
      }
      return;
    }

    // chase
    const desired = r.kind === 'boss' ? 3.6 : 2.8;
    const moving = dist > desired;
    if (moving) {
      const inv = 1 / Math.max(dist, 0.001);
      const spd = r.speed * (shielded ? 1 : 1.35);
      t.x += dx * inv * spd * dt;
      t.z += dz * inv * spd * dt;
      this.play(r, 'Running_A');
      r.bobPhase += dt * 8;
      if (rig) {
        applyGait(rig, 'droid', gaitPose(r.bobPhase, 1));
        rig.set('stomache', 0.12, 0, 0);
      }
      t.y = Math.abs(Math.sin(r.bobPhase)) * 0.05;
      r.group.rotation.x = 0.1;
    } else {
      this.play(r, '2H_Melee_Idle');
      r.bobPhase += dt * 2;
      if (rig) {
        applyGait(rig, 'droid', gaitPose(r.bobPhase, 0.12));
        // menace: slow arm sway while waiting to strike
        rig.set('uparmL', 0, 0, 0.18 + Math.sin(now * 1.6) * 0.05);
        rig.set('uparmR', 0, 0, -0.18 - Math.sin(now * 1.6) * 0.05);
        rig.set('head', Math.sin(now * 0.9) * 0.06, 0, 0);
      }
      t.y = Math.abs(Math.sin(r.bobPhase)) * 0.02;
      r.group.rotation.x = 0;
      if (r.attackCd <= 0) {
        r.state = 'windup';
        r.stateT = r.kind === 'boss' ? 0.7 : 0.6;
        r.parryableUntil = now + r.stateT + 0.15;
        audio.enemyShoot();
      }
    }

    // boss periodically summons fodder
    if (r.kind === 'boss' && r.attackCd > 0.4 && Math.random() < dt * 0.12 && this.count() < 10) {
      _v.set(t.x + (Math.random() - 0.5) * 6, 0, t.z + (Math.random() - 0.5) * 6);
      this.spawnFodder(_v, 6);
    }

    // store boss hp for HUD
    if (r.kind === 'boss') store.setHud({ bossHp: Math.max(0, h.hp / h.max) });
  }

  private collide(t: { x: number; z: number }, radius: number) {
    for (const c of this.ctx.colliders) {
      if (t.x + radius < c.min.x || t.x - radius > c.max.x) continue;
      if (t.z + radius < c.min.z || t.z - radius > c.max.z) continue;
      // push out along smallest axis
      const pushLeft = (t.x + radius) - c.min.x;
      const pushRight = c.max.x - (t.x - radius);
      const pushBack = (t.z + radius) - c.min.z;
      const pushFwd = c.max.z - (t.z - radius);
      const m = Math.min(pushLeft, pushRight, pushBack, pushFwd);
      if (m === pushLeft) t.x = c.min.x - radius;
      else if (m === pushRight) t.x = c.max.x + radius;
      else if (m === pushBack) t.z = c.min.z - radius;
      else t.z = c.max.z + radius;
    }
    const b = ARENA_HALF - radius;
    t.x = Math.max(-b, Math.min(b, t.x));
    t.z = Math.max(-b, Math.min(b, t.z));
  }

  // ---------------- combat resolution ----------------
  // weaponId: 0 = AR (colorless), 1 = shotgun, 2 = sniper
  applyHit(e: Entity, part: string, weaponId: number, color: ColorKey | null, dmg: number, point: THREE.Vector3, bypassShield = false): HitResult {
    const r = this.recs.get(e);
    if (!r || r.state === 'dead') return { outcome: 'dead', entity: e, point };

    // shield interaction
    if (part === 'shield' && r.shield?.active) {
      const s = r.shield;
      if (s.type === 'sphere') {
        if (weaponId === 1 && color && colorsEqual(color, s.color)) {
          s.hp -= dmg;
          audio.shieldHit();
          this.ctx.particles.burst(point, new THREE.Color(colorToHex(s.color)), 4, 3, { life: 0.3, grav: 1 });
          if (s.hp <= 0) return this.breakShield(e, r, point);
          return { outcome: 'shieldHit', entity: e, point };
        }
        audio.shieldWrong();
        this.ctx.particles.burst(point, _gray, 3, 2, { life: 0.25, grav: 4 });
        return { outcome: 'shieldWrong', entity: e, point };
      } else {
        const needed = oppositeColor(s.color);
        if (weaponId === 2 && color && colorsEqual(color, needed)) {
          s.hp -= dmg;
          audio.shieldHit();
          this.ctx.particles.burst(point, new THREE.Color(colorToHex(needed)), 6, 4, { life: 0.35, grav: 1 });
          if (s.hp <= 0) return this.breakShield(e, r, point);
          return { outcome: 'shieldHit', entity: e, point };
        }
        audio.shieldWrong();
        this.ctx.particles.burst(point, _gray, 3, 2, { life: 0.25, grav: 4 });
        return { outcome: 'shieldWrong', entity: e, point };
      }
    }

    // body interaction — shield still blocks body shots while active
    if (r.shield?.active && !bypassShield) {
      audio.shieldWrong();
      this.ctx.particles.burst(point, _gray, 2, 2, { life: 0.2, grav: 4 });
      return { outcome: 'shieldWrong', entity: e, point };
    }

    if (r.kind === 'fodder' && weaponId !== 0) {
      // fodder flesh is colorless — only the colorless rifle harms it
      this.ctx.particles.burst(point, _gray, 3, 2.5, { life: 0.25, grav: 5 });
      audio.shieldWrong();
      return { outcome: 'fodderImmune', entity: e, point };
    }

    const h = healths.get(e)!;
    h.hp -= dmg;
    audio.hitmarker();
    this.ctx.particles.burst(point, r.kind === 'fodder' ? _gray : _white, 5, 3.5, { life: 0.35, grav: 6 });

    if (h.hp <= 0) {
      this.kill(e, r);
      return { outcome: 'kill', entity: e, point };
    }
    return { outcome: 'hit', entity: e, point };
  }

  private breakShield(e: Entity, r: EnemyRec, point: THREE.Vector3): HitResult {
    const s = r.shield!;
    s.active = false;
    s.group.visible = false;
    const hex = colorToHex(s.color);
    audio.shieldBreak();
    this.ctx.particles.burst(point, new THREE.Color(hex), 30, 7, { life: 0.8, grav: 2, size: 0.08 });
    this.ctx.rings.spawn(r.group.position, hex, 5, 0.5);
    this.ctx.shake(0.35);
    this.ctx.hitstop(0.05);
    // stagger the elite when its shield shatters
    if (r.kind !== 'fodder') {
      r.state = 'stagger';
      r.stateT = 1.1;
    }
    void e;
    return { outcome: 'shieldBreak', entity: e, point };
  }

  private kill(_e: Entity, r: EnemyRec) {
    r.state = 'dead';
    r.deadT = 0;
    r.removeAt = r.kind === 'fodder' ? 0.8 : 1.6;
    if (r.shield) { r.shield.active = false; r.shield.group.visible = false; }
    const pos = r.group.position.clone();
    pos.y += 1;
    audio.kill();
    audio.explosion();
    const hex = r.shield ? colorToHex(r.shield.color) : 0x8a8d91;
    this.ctx.particles.burst(pos, new THREE.Color(hex), r.kind === 'fodder' ? 16 : 34, r.kind === 'boss' ? 10 : 6, { life: 0.9, grav: 7, size: 0.09 });
    this.ctx.rings.spawn(pos, r.kind === 'fodder' ? 0x777a7e : hex, r.kind === 'boss' ? 9 : 4, 0.5);
    this.ctx.shake(r.kind === 'boss' ? 0.9 : r.kind === 'elite' ? 0.4 : 0.2);
    this.ctx.hitstop(r.kind === 'fodder' ? 0.02 : 0.06);

    if (r.kind !== 'fodder' && r.mixer) {
      this.play(r, 'Death_A', 0.1, true);
      // sphere-shield elites drop sniper ammo
      if (r.shield?.type === 'sphere') this.dropAmmo(r.group.position);
    }
    if (r.kind === 'boss') {
      this.bossEntity = null;
      store.setHud({ bossActive: false });
    }
    this.ctx.addScore(r.kind === 'boss' ? 2500 : r.kind === 'elite' ? 400 : 100);
    this.ctx.onKill(r.kind);
  }

  private dropAmmo(pos: THREE.Vector3) {
    const mesh = new THREE.Mesh(this.pickupGeo, this.pickupMat);
    mesh.position.set(pos.x, 0.5, pos.z);
    this.ctx.scene.add(mesh);
    this.pickups.push({ mesh, pos: new THREE.Vector3(pos.x, 0, pos.z), t: 0 });
  }

  // ---------------- parry support ----------------
  // returns true if a parry connected
  tryParry(playerPos: THREE.Vector3, forward: THREE.Vector3, now: number): { success: boolean; healed: boolean } {
    const ctx = this.ctx;
    let success = false;
    // 1) projectiles in a wide cone
    for (const p of ctx.projectiles.list) {
      if (!p.active || p.parried) continue;
      _v.subVectors(p.mesh.position, playerPos);
      const dist = _v.length();
      if (dist > 6) continue;
      _v.normalize();
      if (_v.dot(forward) > 0.35) { // ~69 deg half-angle: wide cone
        p.parried = true;
        p.damage = 90;
        (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
        // send it back at nearest live enemy
        let best: Entity | null = null;
        let bestD = Infinity;
        for (const [e2, r2] of this.recs) {
          if (r2.state === 'dead') continue;
          const t2 = transforms.get(e2)!;
          const d = (t2.x - p.mesh.position.x) ** 2 + (t2.z - p.mesh.position.z) ** 2;
          if (d < bestD) { bestD = d; best = e2; }
        }
        if (best !== null) {
          const t2 = transforms.get(best)!;
          _v2.set(t2.x - p.mesh.position.x, 1.0 - p.mesh.position.y, t2.z - p.mesh.position.z).normalize();
          p.vel.copy(_v2).multiplyScalar(34);
          // smart targets may sidestep the reflected orb mid-flight
          const tr = this.recs.get(best);
          if (tr && tr.kind !== 'fodder' && tr.state !== 'dodge' && tr.dodgeCd <= 0 && Math.random() < 0.4) {
            this.startDodge(best, tr, p.mesh.position.x, p.mesh.position.z);
          }
        } else {
          p.vel.copy(forward).multiplyScalar(34);
        }
        success = true;
      }
    }
    // 2) melee windups in range
    for (const [e, r] of this.recs) {
      if (r.state === 'dead') continue;
      const t = transforms.get(e)!;
      _v.set(t.x - playerPos.x, 0, t.z - playerPos.z);
      const dist = _v.length();
      if (dist > 4.6 + r.hitRadius) continue;
      _v.normalize();
      _v2.set(forward.x, 0, forward.z).normalize();
      if (_v.dot(_v2) > 0.35) {
        if (r.parryableUntil > now) {
          // TRUE PARRY: stagger, damage, full heal — ULTRAKILL style
          r.parryableUntil = 0;
          r.state = 'stagger';
          r.stateT = 1.6;
          const h = healths.get(e)!;
          h.hp -= r.kind === 'fodder' ? 40 : 60;
          _v.set(t.x, 1.2, t.z);
          ctx.particles.burst(_v, _white, 24, 8, { life: 0.5, grav: 3 });
          ctx.rings.spawn(playerPos, 0xffffff, 6, 0.4);
          if (h.hp <= 0) this.kill(e, r);
          success = true;
        } else if (r.kind === 'fodder') {
          // regular punch
          const h = healths.get(e)!;
          h.hp -= 20;
          _v.set(t.x, 1.1, t.z);
          ctx.particles.burst(_v, _gray, 8, 5, { life: 0.35, grav: 5 });
          const t2 = transforms.get(e)!;
          t2.x += _v2.x * 1.2;
          t2.z += _v2.z * 1.2;
          audio.hitmarker();
          if (h.hp <= 0) this.kill(e, r);
          success = true;
        }
      }
    }
    if (success) {
      ctx.player.heal(35);
      ctx.shake(0.5);
      ctx.hitstop(0.09);
      audio.parry();
    }
    return { success, healed: success };
  }

  // raycast targets: body hitboxes + active shield meshes
  collectTargets(out: THREE.Object3D[]) {
    for (const [, r] of this.recs) {
      if (r.state === 'dead') continue;
      r.body.userData.part = 'body';
      out.push(r.body);
      if (r.shield?.active) for (const m of r.shield.meshes) out.push(m);
    }
  }

  findParriedHits() {
    // handled in game loop via projectile positions vs enemy transforms
  }

  despawn(e: Entity) {
    const r = this.recs.get(e);
    if (!r) return;
    this.ctx.scene.remove(r.group);
    this.recs.delete(e);
    transforms.delete(e);
    healths.delete(e);
    this.world.destroy(e);
  }

  clearAll() {
    for (const [e] of this.recs) this.despawn(e);
    for (const p of this.pickups) this.ctx.scene.remove(p.mesh);
    this.pickups = [];
    this.bossEntity = null;
  }
}

const invisibleMat = new THREE.MeshBasicMaterial({ visible: false });

function shieldFillMat(hex: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: hex, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}

function shieldWireMat(hex: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: hex, transparent: true, opacity: 0.5, wireframe: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}
