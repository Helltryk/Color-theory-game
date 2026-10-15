// Weapons: colorless assault rifle (infinite), prism shotgun (3s cooldown),
// mono-lance sniper (limited ammo). Procedural viewmodels, recoil, tracers,
// shield hint raycast.
import * as THREE from 'three';
import type { InputManager } from './input';
import type { Player } from './player';
import type { EnemyManager } from './enemies';
import type { TracerPool, ParticlePool, RingPool } from './effects';
import type { Collider } from './arena';
import { audio } from './audio';
import { store } from './store';
import type { ColorKey } from './colors';
import { colorToHex, colorName, oppositeColor } from './colors';

const AR_INTERVAL = 1 / 11;
const AR_DAMAGE = 12;
const SHOTGUN_COOLDOWN = 3.0;
const SHOTGUN_PELLETS = 10;
const SHOTGUN_PELLET_DMG = 14;
const SHOTGUN_SHIELD_DMG = 30;
const SNIPER_INTERVAL = 1.1;
const SNIPER_DAMAGE = 200;
const SNIPER_SHIELD_DMG = 150;

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();
const _right = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _targets: THREE.Object3D[] = [];
const _wallRay = new THREE.Ray();
const _hitPoint = new THREE.Vector3();
const _tmpBox = new THREE.Box3();

interface Ctx {
  camera: THREE.PerspectiveCamera;
  player: Player;
  enemies: EnemyManager;
  tracers: TracerPool;
  particles: ParticlePool;
  rings: RingPool;
  colliders: Collider[];
  shake: (n: number) => void;
  hitstop: (t: number) => void;
}

export class WeaponSystem {
  weapon: 0 | 1 | 2 = 0;
  playerColor: ColorKey = { base: 0, sat: 1, hue: 0 };
  sniperAmmo = 6;
  readonly sniperMax = 12;
  private arTimer = 0;
  private shotgunTimer = 0;
  private sniperTimer = 0;
  private switchT = 0; // >0 while raising
  private kick = 0; // viewmodel recoil
  private viewRoot!: THREE.Group;
  private models: THREE.Group[] = [];
  private muzzleLight!: THREE.PointLight;
  private muzzleFlash = 0;
  private ctx!: Ctx;
  private colorStrip!: THREE.Mesh;
  private hintTimer = 0;

  init(ctx: Ctx, scene: THREE.Scene) {
    this.ctx = ctx;
    this.viewRoot = new THREE.Group();
    ctx.camera.add(this.viewRoot);
    scene.add(ctx.camera);

    const gunMat = new THREE.MeshStandardMaterial({ color: 0x6a6d73, roughness: 0.45, metalness: 0.8, emissive: 0x141518, emissiveIntensity: 1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x43454a, roughness: 0.55, metalness: 0.7, emissive: 0x0c0d0f, emissiveIntensity: 1 });

    // AR: boxy rifle
    const ar = new THREE.Group();
    ar.add(box(0.09, 0.14, 0.55, gunMat, 0, 0, -0.1));
    ar.add(box(0.05, 0.05, 0.4, darkMat, 0, 0.045, -0.5));
    ar.add(box(0.07, 0.16, 0.12, darkMat, 0, -0.12, 0.05));
    ar.add(box(0.03, 0.08, 0.2, gunMat, 0, 0.12, -0.28));
    this.models.push(ar);

    // Shotgun: wide twin bore
    const sg = new THREE.Group();
    sg.add(box(0.14, 0.13, 0.5, gunMat, 0, 0, -0.08));
    sg.add(box(0.055, 0.055, 0.42, darkMat, -0.04, 0.05, -0.42));
    sg.add(box(0.055, 0.055, 0.42, darkMat, 0.04, 0.05, -0.42));
    sg.add(box(0.12, 0.14, 0.14, darkMat, 0, -0.11, 0.08));
    this.models.push(sg);

    // Sniper: long lance
    const sn = new THREE.Group();
    sn.add(box(0.07, 0.11, 0.6, gunMat, 0, 0, -0.05));
    sn.add(box(0.035, 0.035, 0.75, darkMat, 0, 0.03, -0.65));
    sn.add(box(0.05, 0.1, 0.22, darkMat, 0, 0.11, -0.15)); // scope
    sn.add(box(0.06, 0.15, 0.12, darkMat, 0, -0.11, 0.1));
    this.models.push(sn);

    // color strip on shotgun + sniper (shows loaded color)
    this.colorStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.145, 0.02, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );

    for (const g of this.models) {
      g.visible = false;
      this.viewRoot.add(g);
    }
    this.models[1].add(this.colorStrip);
    const sniperStrip = this.colorStrip.clone();
    sniperStrip.position.set(0, 0.075, -0.2);
    this.models[2].add(sniperStrip);
    this.colorStrip.position.set(0, 0.085, -0.15);
    this.strips = [this.colorStrip, sniperStrip];

    this.viewRoot.position.set(0.28, -0.26, -0.45);

    this.muzzleLight = new THREE.PointLight(0xffffff, 0, 9);
    scene.add(this.muzzleLight);

    this.setWeapon(0);
  }

  private strips: THREE.Mesh[] = [];

  setWeapon(w: 0 | 1 | 2) {
    if (w === this.weapon && this.models[w].visible) return;
    this.weapon = w;
    this.switchT = 0.22;
    this.models.forEach((g, i) => { g.visible = i === w; });
    store.setHud({ weapon: w });
    audio.uiBack();
  }

  setColor(c: ColorKey) {
    this.playerColor = { ...c };
    const hex = colorToHex(c);
    for (const s of this.strips) (s.material as THREE.MeshBasicMaterial).color.setHex(hex);
    store.setHud({ playerColor: { ...c } });
  }

  reset() {
    this.sniperAmmo = 6;
    this.shotgunTimer = 0;
    this.sniperTimer = 0;
    this.arTimer = 0;
    this.setWeapon(0);
    store.setHud({ sniperAmmo: this.sniperAmmo, shotgunCd: 1 });
  }

  update(dt: number, input: InputManager, canAct: boolean) {
    this.arTimer = Math.max(0, this.arTimer - dt);
    const wasCd = this.shotgunTimer;
    this.shotgunTimer = Math.max(0, this.shotgunTimer - dt);
    if (wasCd > 0 && this.shotgunTimer === 0 && this.weapon === 1) audio.cooldownReady();
    this.sniperTimer = Math.max(0, this.sniperTimer - dt);
    this.switchT = Math.max(0, this.switchT - dt);
    this.kick = Math.max(0, this.kick - dt * 3.2);
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 14);
    this.muzzleLight.intensity = this.muzzleFlash * 30;

    // hud cooldown
    store.setHud({ shotgunCd: 1 - this.shotgunTimer / SHOTGUN_COOLDOWN });

    if (canAct) {
      if (input.wasPressed('weapon1')) this.setWeapon(0);
      if (input.wasPressed('weapon2')) this.setWeapon(1);
      if (input.wasPressed('weapon3')) this.setWeapon(2);

      if (input.isDown('fire') && this.switchT <= 0) {
        if (this.weapon === 0) this.fireAR();
        else if (this.weapon === 1) this.fireShotgun();
        else this.fireSniper();
      }
    }

    // viewmodel motion: sway + recoil + raise
    const raise = this.switchT > 0 ? (this.switchT / 0.22) : 0;
    const p = this.ctx.player;
    const swayX = Math.sin(p.bobPhase) * 0.008 * p.bobAmt;
    const swayY = -Math.abs(Math.cos(p.bobPhase)) * 0.008 * p.bobAmt;
    this.viewRoot.position.set(
      0.28 + swayX,
      -0.26 + swayY - raise * 0.3 + this.kick * 0.05,
      -0.45 + this.kick * 0.12
    );
    this.viewRoot.rotation.set(this.kick * 0.3 + raise * 0.6, swayX * 2, 0);

    // hint raycast at ~15Hz
    this.hintTimer -= dt;
    if (this.hintTimer <= 0) {
      this.hintTimer = 1 / 15;
      this.computeHint();
    }
  }

  private rayFromCamera(): { origin: THREE.Vector3; dir: THREE.Vector3 } {
    const cam = this.ctx.camera;
    cam.getWorldPosition(_origin);
    cam.getWorldDirection(_dir);
    return { origin: _origin, dir: _dir };
  }

  // distance to nearest wall/obstacle along ray (caps tracer length)
  private wallDist(origin: THREE.Vector3, dir: THREE.Vector3, max: number): number {
    _wallRay.origin.copy(origin);
    _wallRay.direction.copy(dir);
    let best = max;
    // ground plane y=0
    if (dir.y < -0.0001) {
      const t = -origin.y / dir.y;
      if (t > 0 && t < best) best = t;
    }
    for (const c of this.ctx.colliders) {
      _tmpBox.min.copy(c.min);
      _tmpBox.max.copy(c.max);
      const p = _wallRay.intersectBox(_tmpBox, _hitPoint);
      if (p) {
        const d = origin.distanceTo(p);
        if (d < best) best = d;
      }
    }
    return best;
  }

  private muzzlePos(out: THREE.Vector3): THREE.Vector3 {
    const cam = this.ctx.camera;
    cam.getWorldPosition(out);
    cam.getWorldDirection(_dir);
    _right.crossVectors(_dir, cam.up).normalize();
    out.addScaledVector(_dir, 0.6).addScaledVector(_right, 0.22);
    out.y -= 0.16;
    return out;
  }

  private flashAtMuzzle(color: number) {
    this.muzzlePos(_muzzle);
    this.muzzleLight.position.copy(_muzzle);
    this.muzzleLight.color.setHex(color);
    this.muzzleFlash = 1;
  }

  private fireAR() {
    if (this.arTimer > 0) return;
    this.arTimer = AR_INTERVAL;
    const ctx = this.ctx;
    audio.shotAR();
    this.kick = Math.min(1, this.kick + 0.22);
    ctx.player.pitch += 0.0035;
    ctx.shake(0.05);
    this.flashAtMuzzle(0xd8dbe0);

    const { origin, dir } = this.rayFromCamera();
    // slight spread
    dir.x += (Math.random() - 0.5) * 0.02;
    dir.y += (Math.random() - 0.5) * 0.02;
    dir.z += (Math.random() - 0.5) * 0.02;
    dir.normalize();

    const hit = this.raycastEnemies(origin, dir, 120);
    const maxD = this.wallDist(origin, dir, 120);
    if (hit && hit.distance < maxD) {
      _end.copy(hit.point);
      const res = ctx.enemies.applyHit(hit.eid, hit.part, 0, null, AR_DAMAGE, hit.point);
      this.onHitFeedback(res);
    } else {
      _end.copy(origin).addScaledVector(dir, maxD);
      if (maxD < 119) ctx.particles.burst(_end, grayColor, 3, 2, { life: 0.3, grav: 5 });
    }
    this.muzzlePos(_muzzle);
    ctx.tracers.fire(_muzzle, _end, 0xbfc3c9, 0.02, 0.07);
  }

  private fireShotgun() {
    if (this.shotgunTimer > 0) { if (this.shotgunTimer < SHOTGUN_COOLDOWN - 0.15) audio.dryFire(); return; }
    this.shotgunTimer = SHOTGUN_COOLDOWN;
    const ctx = this.ctx;
    audio.shotShotgun();
    this.kick = Math.min(1.6, this.kick + 1.0);
    ctx.player.pitch += 0.02;
    ctx.shake(0.45);
    const hex = colorToHex(this.playerColor);
    this.flashAtMuzzle(hex);
    this.muzzlePos(_muzzle);

    // warn elites before pellets resolve — they may reaction-dodge
    {
      const { origin, dir } = this.rayFromCamera();
      ctx.enemies.notifyShot(origin, dir, 1);
    }

    for (let i = 0; i < SHOTGUN_PELLETS; i++) {
      const { origin, dir } = this.rayFromCamera();
      dir.x += (Math.random() - 0.5) * 0.14;
      dir.y += (Math.random() - 0.5) * 0.14;
      dir.z += (Math.random() - 0.5) * 0.14;
      dir.normalize();
      const hit = this.raycastEnemies(origin, dir, 60);
      const maxD = this.wallDist(origin, dir, 60);
      if (hit && hit.distance < maxD) {
        _end.copy(hit.point);
        const dmg = hit.part === 'shield' ? SHOTGUN_SHIELD_DMG : SHOTGUN_PELLET_DMG;
        const res = ctx.enemies.applyHit(hit.eid, hit.part, 1, this.playerColor, dmg, hit.point);
        this.onHitFeedback(res);
      } else {
        _end.copy(origin).addScaledVector(dir, Math.min(maxD, 26));
      }
      ctx.tracers.fire(_muzzle, _end, hex, 0.035, 0.14);
    }
    store.setHud({ shotgunCd: 0 });
  }

  private fireSniper() {
    if (this.sniperTimer > 0) return;
    if (this.sniperAmmo <= 0) { audio.dryFire(); return; }
    this.sniperTimer = SNIPER_INTERVAL;
    this.sniperAmmo--;
    store.setHud({ sniperAmmo: this.sniperAmmo });
    const ctx = this.ctx;
    audio.shotSniper();
    this.kick = Math.min(1.8, this.kick + 1.3);
    ctx.player.pitch += 0.028;
    ctx.shake(0.5);
    const hex = colorToHex(this.playerColor);
    this.flashAtMuzzle(hex);
    this.muzzlePos(_muzzle);

    const { origin, dir } = this.rayFromCamera();
    // elites react to the sniper report — dodge before/at the shot
    ctx.enemies.notifyShot(origin, dir, 2);
    const hit = this.raycastEnemies(origin, dir, 200);
    const maxD = this.wallDist(origin, dir, 200);
    if (hit && hit.distance < maxD) {
      _end.copy(hit.point);
      const dmg = hit.part === 'shield' ? SNIPER_SHIELD_DMG : SNIPER_DAMAGE;
      const res = ctx.enemies.applyHit(hit.eid, hit.part, 2, this.playerColor, dmg, hit.point);
      this.onHitFeedback(res);
    } else {
      _end.copy(origin).addScaledVector(dir, maxD);
      if (maxD < 199) ctx.particles.burst(_end, grayColor, 6, 3, { life: 0.4, grav: 5 });
    }
    ctx.tracers.fire(_muzzle, _end, hex, 0.07, 0.3);
    ctx.tracers.fire(_muzzle, _end, 0xffffff, 0.02, 0.22);
  }

  private onHitFeedback(res: { outcome: string }) {
    if (res.outcome === 'shieldBreak') {
      store.setHud({ message: 'SHIELD SHATTERED', messageT: 1.2 });
    } else if (res.outcome === 'shieldWrong') {
      store.setHud({ hint: 'WRONG FREQUENCY', hintKind: 'warn' });
    } else if (res.outcome === 'fodderImmune') {
      store.setHud({ hint: 'COLORLESS SHELL — USE THE ASSAULT RIFLE', hintKind: 'warn' });
    } else if (res.outcome === 'kill') {
      store.setHud({ kills: store.hud.kills + 1 });
    }
  }

  private raycastEnemies(origin: THREE.Vector3, dir: THREE.Vector3, far: number): { eid: number; part: string; point: THREE.Vector3; distance: number } | null {
    _targets.length = 0;
    this.ctx.enemies.collectTargets(_targets);
    if (_targets.length === 0) return null;
    _ray.set(origin, dir);
    _ray.far = far;
    const hits = _ray.intersectObjects(_targets, false);
    if (hits.length === 0) return null;
    const h = hits[0];
    return {
      eid: h.object.userData.eid as number,
      part: h.object.userData.part as string,
      point: h.point,
      distance: h.distance,
    };
  }

  // center-screen hint: what does the shield under the crosshair need?
  private computeHint() {
    if (store.hud.hintKind === 'warn') {
      // transient warning; clear shortly
      store.setHud({ hint: '', hintKind: 'none' });
      return;
    }
    const { origin, dir } = this.rayFromCamera();
    const hit = this.raycastEnemies(origin, dir, 80);
    if (hit && hit.part === 'shield') {
      const r = this.ctx.enemies.recs.get(hit.eid);
      if (r?.shield?.active) {
        const s = r.shield;
        if (s.type === 'sphere') {
          store.setHud({ hint: `SPHERE LOCK ⟢ SHOTGUN: ${colorName(s.color)}`, hintKind: 'shield' });
        } else {
          store.setHud({ hint: `PRISM LOCK ⟢ SNIPER: ${colorName(oppositeColor(s.color))}`, hintKind: 'shield' });
        }
        return;
      }
    }
    if (store.hud.hintKind !== 'none') store.setHud({ hint: '', hintKind: 'none' });
  }
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

const grayColor = new THREE.Color(0.5, 0.51, 0.53);
