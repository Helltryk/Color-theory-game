// Game orchestrator: renderer, loop, time dilation, pointer lock, color wheel,
// parry, projectile collisions, camera feel, screen state.
import * as THREE from 'three';
import { World, transforms, healths } from './ecs';
import { buildArena } from './arena';
import type { Collider } from './arena';
import { loadAssets } from './assets';
import type { Assets } from './assets';
import { Player } from './player';
import { InputManager } from './input';
import { WeaponSystem } from './weapons';
import { EnemyManager } from './enemies';
import { WaveDirector } from './waves';
import { TracerPool, ParticlePool, RingPool, ProjectilePool, Shake } from './effects';
import { audio } from './audio';
import { store } from './store';
import type { ColorKey } from './colors';

const _eye = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _shakeOff = new THREE.Vector3();
const _v = new THREE.Vector3();

export class Game {
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  input = new InputManager();
  player = new Player();
  weapons = new WeaponSystem();
  enemies = new EnemyManager();
  waves = new WaveDirector();
  tracers!: TracerPool;
  particles!: ParticlePool;
  rings!: RingPool;
  projectiles!: ProjectilePool;
  shake = new Shake();
  world = new World();
  assets: Assets | null = null;
  colliders: Collider[] = [];
  ready = false;
  private canvas: HTMLCanvasElement;
  private last = 0;
  private raf = 0;
  private hitstopT = 0;
  private parryCd = 0;
  wheelOpen = false;
  private wheelCX = 0;
  private wheelCY = 0;
  private disposed = false;
  private onKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init() {
    const quality = store.settings.quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: quality === 'high',
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(quality === 'high' ? Math.min(devicePixelRatio, 2) : 1);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(store.settings.fov, innerWidth / innerHeight, 0.05, 300);
    this.camera.rotation.order = 'YXZ';

    const built = buildArena(this.scene, quality);
    this.colliders = built.colliders;

    this.tracers = new TracerPool(this.scene);
    this.particles = new ParticlePool(this.scene);
    this.rings = new RingPool(this.scene);
    this.projectiles = new ProjectilePool(this.scene);

    this.world.register(transforms);
    this.world.register(healths);

    this.enemies.init({
      scene: this.scene,
      player: this.player,
      particles: this.particles,
      rings: this.rings,
      tracers: this.tracers,
      projectiles: this.projectiles,
      colliders: this.colliders,
      addScore: (n) => store.setHud({ score: store.hud.score + n }),
      onKill: (kind) => this.waves.onKill(kind),
      shake: (n) => this.shake.add(n * store.settings.shake),
      hitstop: (t) => { this.hitstopT = Math.max(this.hitstopT, t); },
      addAmmo: (n) => {
        this.weapons.sniperAmmo = Math.min(this.weapons.sniperMax, this.weapons.sniperAmmo + n);
        store.setHud({ sniperAmmo: this.weapons.sniperAmmo });
      },
    }, await loadAssets().then((a) => { this.assets = a; return a; }));

    this.weapons.init({
      camera: this.camera,
      player: this.player,
      enemies: this.enemies,
      tracers: this.tracers,
      particles: this.particles,
      rings: this.rings,
      colliders: this.colliders,
      shake: (n) => this.shake.add(n * store.settings.shake),
      hitstop: (t) => { this.hitstopT = Math.max(this.hitstopT, t); },
    }, this.scene);

    this.waves.init(this.enemies);

    this.input.attach(this.canvas);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onLockChange);
    // rebind capture support: when settings is capturing, input.enabled is false
    this.onKeyHandler = (e: KeyboardEvent) => {
      if (e.code === 'Tab') e.preventDefault();
    };
    window.addEventListener('keydown', this.onKeyHandler);

    this.ready = true;
    this.last = performance.now();
    this.loop();
  }

  private onResize = () => {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  };

  private onLockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    if (!locked && store.screen === 'playing') {
      this.pause();
    }
  };

  // ---------------- state control ----------------
  startRun() {
    // full reset
    this.enemies.clearAll();
    this.projectiles.clearAll();
    this.world.clearAll();
    this.player.reset();
    this.weapons.reset();
    this.waves.reset();
    this.wheelOpen = false;
    this.hitstopT = 0;
    this.parryCd = 0;
    store.setHud({
      hp: 100, dashes: 3, score: 0, kills: 0, message: '', messageT: 0,
      bossActive: false, hint: '', hintKind: 'none', wheelOpen: false, damageFlash: 0,
      parryFlash: 0, healFlash: 0,
    });
    store.setScreen('playing');
    this.input.enabled = true;
    audio.startDrone();
    this.lockPointer();
  }

  lockPointer() {
    if (!('ontouchstart' in window) || matchMedia('(pointer: fine)').matches) {
      this.canvas.requestPointerLock?.();
    }
  }

  pause() {
    if (store.screen !== 'playing') return;
    store.setScreen('paused');
    this.input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resume() {
    store.setScreen('playing');
    this.input.enabled = true;
    this.lockPointer();
  }

  quitToMenu() {
    store.setScreen('menu');
    this.input.enabled = false;
    audio.stopDrone();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  applyWheelSelection(c: ColorKey) {
    this.weapons.setColor(c);
    audio.wheelSelect();
  }

  // touch support: toggle wheel + direct cell tap
  toggleWheelTouch() {
    if (this.wheelOpen) {
      this.wheelTouchHold = false;
      this.closeWheel(true);
    } else {
      this.wheelTouchHold = true;
      this.openWheel();
    }
  }

  tapWheelCell(c: ColorKey) {
    this.applyWheelSelection(c);
    if (this.wheelTouchHold) {
      this.wheelTouchHold = false;
      this.closeWheel(false);
    }
  }

  // ---------------- color wheel ----------------
  private openWheel() {
    this.wheelOpen = true;
    this.wheelCX = 0;
    this.wheelCY = -0.7; // start pointing at current-ish area
    audio.wheelOpen();
    store.setHud({ wheelOpen: true, wheelSel: { ...this.weapons.playerColor }, wheelX: 0, wheelY: -0.7 });
  }

  private closeWheel(apply: boolean) {
    if (!this.wheelOpen) return;
    this.wheelOpen = false;
    if (apply) {
      const sel = this.wheelPick();
      if (sel) this.applyWheelSelection(sel);
    }
    store.setHud({ wheelOpen: false, wheelSel: null });
  }

  // map virtual cursor (-1..1) to a ColorKey cell
  private wheelPick(): ColorKey | null {
    const r = Math.hypot(this.wheelCX, this.wheelCY);
    if (r < 0.32) return null; // dead zone
    let ang = Math.atan2(this.wheelCX, -this.wheelCY); // 0 = up, clockwise
    if (ang < 0) ang += Math.PI * 2;
    const seg = Math.floor(ang / (Math.PI / 3)) % 6; // 6 base colors
    const within = (ang % (Math.PI / 3)) / (Math.PI / 3);
    const hueLevel = within < 0.5 ? 0 : 1;
    const sat = r > 0.68 ? 1 : 0;
    return { base: seg, sat, hue: hueLevel };
  }

  private updateWheel() {
    const look = this.input.consumeLook();
    this.wheelCX = Math.max(-1, Math.min(1, this.wheelCX + look.x * 0.006));
    this.wheelCY = Math.max(-1, Math.min(1, this.wheelCY + look.y * 0.006));
    const sel = this.wheelPick();
    store.setHud({
      wheelX: this.wheelCX,
      wheelY: this.wheelCY,
      wheelSel: sel ?? { ...this.weapons.playerColor },
    });
  }

  // ---------------- main loop ----------------
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    let rawDt = (now - this.last) / 1000;
    this.last = now;
    rawDt = Math.min(rawDt, 0.05);
    this.tick(rawDt, performance.now() / 1000);
    this.renderer.render(this.scene, this.camera);
  };

  // headless test hook: advance simulation without rendering
  debugStep(seconds: number, dt = 1 / 60) {
    let t = performance.now() / 1000;
    for (let i = 0; i < seconds / dt; i++) {
      t += dt;
      this.tick(dt, t);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private tick(rawDt: number, nowSec: number) {
    const now = nowSec * 1000;

    const playing = store.screen === 'playing';

    if (playing) {
      // pause key
      if (this.input.wasPressed('pause')) {
        this.pause();
        this.input.endFrame();
        return;
      }

      // color wheel hold (keyboard) — touch toggles via UI button
      const wheelHeld = this.input.isDown('colorWheel');
      if (wheelHeld && !this.wheelOpen) this.openWheel();
      if (!wheelHeld && this.wheelOpen && !this.wheelTouchHold) this.closeWheel(true);
      if (this.wheelOpen) this.updateWheel();

      const timeScale = this.wheelOpen ? 0.12 : 1;
      this.hitstopT = Math.max(0, this.hitstopT - rawDt);
      const worldDt = this.hitstopT > 0 ? 0 : rawDt * timeScale;
      this.parryCd = Math.max(0, this.parryCd - rawDt);

      // player
      this.player.update(worldDt, this.input, this.colliders, (pos) => {
        // slam landing shockwave
        this.rings.spawn(pos, 0x9a9da2, 7, 0.5);
        this.shake.add(0.5 * store.settings.shake);
        for (const [e, r] of this.enemies.recs) {
          if (r.state === 'dead') continue;
          const t = transforms.get(e)!;
          const d = Math.hypot(t.x - pos.x, t.z - pos.z);
          if (d < 4.5) {
            const h = healths.get(e)!;
            h.hp -= 30;
            _v.set(t.x, 1, t.z);
            this.particles.burst(_v, new THREE.Color(0.6, 0.6, 0.62), 6, 4, { life: 0.4 });
            if (h.hp <= 0 && r.shield?.active !== true) this.enemies.applyHit(e, 'body', 0, null, 1, _v);
          }
        }
      }, this.wheelOpen);

      // weapons (cooldowns tick in world time; input always)
      this.weapons.update(worldDt, this.input, !this.wheelOpen);

      // parry
      if (this.input.wasPressed('parry') && this.parryCd <= 0 && !this.wheelOpen) {
        this.parryCd = 0.45;
        this.player.flatForward(_fwd);
        this.player.eyePos(_eye);
        const res = this.enemies.tryParry(_eye, _fwd, now / 1000);
        store.setHud({ parryFlash: res.success ? 1 : 0.35 });
        if (!res.success) audio.parryFail();
      }

      // world systems
      this.enemies.update(worldDt, now / 1000);
      this.waves.update(worldDt);
      this.projectiles.update(worldDt);
      this.collideProjectiles();

      store.setHud({ dashes: this.player.dashes, hp: this.player.hp });

      if (this.player.dead) {
        this.gameOver();
      }
    }

    // effects always tick (menus show idle world)
    this.tracers.update(rawDt);
    this.particles.update(rawDt);
    this.rings.update(rawDt);
    this.shake.update(rawDt);

    // camera
    this.updateCamera(rawDt, playing);

    // hud decay + flush
    const h = store.hud;
    const decay: Partial<typeof h> = {};
    if (h.messageT > 0) decay.messageT = Math.max(0, h.messageT - rawDt);
    if (h.damageFlash > 0) decay.damageFlash = Math.max(0, h.damageFlash - rawDt * 2.2);
    if (h.parryFlash > 0) decay.parryFlash = Math.max(0, h.parryFlash - rawDt * 3);
    if (h.healFlash > 0) decay.healFlash = Math.max(0, h.healFlash - rawDt * 2);
    store.setHud(decay);
    store.flushHud();

    this.input.endFrame();
  }

  wheelTouchHold = false;

  private collideProjectiles() {
    for (const p of this.projectiles.list) {
      if (!p.active) continue;
      const pp = p.mesh.position;
      if (pp.y < 0.05 || Math.abs(pp.x) > 46 || Math.abs(pp.z) > 46) {
        p.active = false; p.mesh.visible = false;
        this.particles.burst(pp, new THREE.Color(0.7, 0.7, 0.72), 4, 2, { life: 0.3 });
        continue;
      }
      if (p.parried) {
        // vs enemies
        for (const [e, r] of this.enemies.recs) {
          if (r.state === 'dead') continue;
          const t = transforms.get(e)!;
          const d = Math.hypot(t.x - pp.x, (t.y + 1) - pp.y, t.z - pp.z);
          if (d < r.hitRadius + 0.5) {
            p.active = false; p.mesh.visible = false;
            this.enemies.applyHit(e, 'body', 0, null, p.damage, pp, true);
            this.particles.burst(pp, new THREE.Color(1, 1, 1), 12, 6, { life: 0.4 });
            break;
          }
        }
      } else {
        // vs player
        const d = Math.hypot(this.player.pos.x - pp.x, (this.player.pos.y + 1.1) - pp.y, this.player.pos.z - pp.z);
        if (d < 0.85) {
          p.active = false; p.mesh.visible = false;
          const died = this.player.damage(p.damage);
          this.shake.add(0.4 * store.settings.shake);
          if (died) this.gameOver();
        }
      }
    }
  }

  private updateCamera(dt: number, playing: boolean) {
    const p = this.player;
    p.eyePos(_eye);
    // subtle bob
    const bobY = Math.sin(p.bobPhase * 2) * 0.025 * p.bobAmt;
    this.camera.position.set(_eye.x, _eye.y + bobY, _eye.z);

    // shake
    this.shake.offset(_shakeOff, playing ? 1 : 0);
    this.camera.rotation.y = p.yaw;
    this.camera.rotation.x = p.pitch;
    this.camera.rotation.z = (p.roll * Math.PI) / 180 + _shakeOff.x * 0.4;
    this.camera.position.x += _shakeOff.x;
    this.camera.position.y += _shakeOff.y;

    // dynamic fov
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const targetFov = store.settings.fov + p.fovKick + Math.min(9, Math.max(0, speed - 10) * 0.5);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
      this.camera.updateProjectionMatrix();
    }
  }

  private gameOver() {
    if (store.screen !== 'playing') return;
    audio.gameOver();
    audio.stopDrone();
    store.commitHighScore(store.hud.score);
    store.setScreen('dead');
    this.input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    if (this.onKeyHandler) window.removeEventListener('keydown', this.onKeyHandler);
    this.input.detach();
    audio.stopDrone();
    this.renderer.dispose();
  }
}

export let game: Game | null = null;
export function setGameInstance(g: Game | null) {
  game = g;
  (window as unknown as { __game: Game | null }).__game = g;
}
