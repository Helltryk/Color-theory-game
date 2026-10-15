// ULTRAKILL-style player controller: fast accel, dash charges, slide, slide-jump,
// wall jumps, ground slam, coyote time, FOV kicks, camera roll, trauma shake hooks.
import * as THREE from 'three';
import type { InputManager } from './input';
import type { Collider } from './arena';
import { ARENA_HALF } from './arena';
import { audio } from './audio';
import { store } from './store';

const WALK_SPEED = 9.5;
const ACCEL = 70;
const AIR_ACCEL = 18;
const FRICTION = 9;
const GRAVITY = 26;
const JUMP_VEL = 19; // 4x the original jump height (h = v^2 / 2g)
const DASH_SPEED = 23;
const DASH_TIME = 0.16;
const DASH_MAX = 3;
const DASH_REGEN = 1.1;
const SLIDE_BOOST = 1.45;
const SLIDE_MIN_SPEED = 4;
const SLAM_VEL = -30;
const WALLRUN_MAX_TIME = 2.2;
const WALLRUN_MIN_SPEED = 5.5;
const WALLRUN_GRAVITY = 4.5; // reduced pull while riding a wall
const WALLRUN_MAX_SINK = -3.2;
const WALLRUN_STICK = 26; // inward accel keeping wall contact

const _move = new THREE.Vector3();
const _wish = new THREE.Vector3();

export class Player {
  pos = new THREE.Vector3(0, 0, 6);
  vel = new THREE.Vector3();
  yaw = Math.PI;
  pitch = 0;
  onGround = false;
  hp = 100;
  maxHp = 100;
  dashes = DASH_MAX;
  dashTimer = 0;
  dashRegen = 0;
  dashDir = new THREE.Vector3();
  sliding = false;
  slamming = false;
  crouchAmt = 0; // 0..1 camera lower
  coyote = 0;
  jumpBuffer = 0;
  fovKick = 0;
  roll = 0;
  landDip = 0;
  bobPhase = 0;
  bobAmt = 0;
  iframes = 0;
  lastWallNormal = new THREE.Vector3();
  wallTouchTimer = 0;
  wallrunning = false;
  wallrunT = 0;
  wallrunCd = 0;
  wallSide = 0; // -1 wall on left, +1 wall on right
  dead = false;
  eyeHeight = 1.62;
  private stepAccum = 0;

  reset() {
    this.pos.set(0, 0, 6);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.hp = this.maxHp;
    this.dashes = DASH_MAX;
    this.dashTimer = 0;
    this.dashRegen = 0;
    this.sliding = false;
    this.slamming = false;
    this.dead = false;
    this.iframes = 0;
    this.fovKick = 0;
    this.wallrunning = false;
    this.wallrunT = 0;
    this.wallrunCd = 0;
    this.wallSide = 0;
    this.wallTouchTimer = 0;
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    return out;
  }

  flatForward(out: THREE.Vector3): THREE.Vector3 {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return out;
  }

  eyePos(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.pos);
    out.y += this.eyeHeight - this.crouchAmt * 0.55 - this.landDip;
    return out;
  }

  update(dt: number, input: InputManager, colliders: Collider[], onSlamLand: (pos: THREE.Vector3) => void, cameraLocked: boolean) {
    if (this.dead) return;
    const sens = 0.0021 * store.settings.sensitivity;

    // ---- look ----
    if (!cameraLocked) {
      const look = input.consumeLook();
      this.yaw -= look.x * sens;
      this.pitch -= look.y * sens;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    } else {
      input.consumeLook(); // discard camera movement while color wheel is open
    }

    // ---- wish direction ----
    const mv = input.moveVec();
    _wish.set(mv.x, 0, mv.y);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // rotate wish dir by yaw (wish.x = strafe, wish.z = forward/back)
    _move.set(
      _wish.x * cos + _wish.z * sin,
      0,
      -_wish.x * sin + _wish.z * cos
    );
    const hasInput = _move.lengthSq() > 0.001;

    // ---- timers ----
    this.coyote = this.onGround ? 0.12 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (input.wasPressed('jump')) this.jumpBuffer = 0.12;
    this.iframes = Math.max(0, this.iframes - dt);
    this.wallTouchTimer = Math.max(0, this.wallTouchTimer - dt);
    this.wallrunCd = Math.max(0, this.wallrunCd - dt);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    if (this.dashes < DASH_MAX) {
      this.dashRegen += dt;
      if (this.dashRegen >= DASH_REGEN) { this.dashRegen = 0; this.dashes++; }
    }

    // ---- dash ----
    if (input.wasPressed('dash') && this.dashes > 0 && this.dashTimer <= 0) {
      this.dashes--;
      this.dashTimer = DASH_TIME;
      this.iframes = Math.max(this.iframes, DASH_TIME + 0.08);
      if (hasInput) this.dashDir.copy(_move).normalize();
      else this.flatForward(this.dashDir);
      this.vel.y = Math.max(this.vel.y, 0);
      this.fovKick = Math.min(14, this.fovKick + 11);
      audio.dash();
    }

    // ---- slide / slam ----
    const wantSlide = input.isDown('slide');
    const horizontalSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (wantSlide && !this.onGround && !this.slamming && this.vel.y < 8) {
      // ground slam
      this.slamming = true;
      this.sliding = false;
      this.wallrunning = false;
      this.vel.x = 0; this.vel.z = 0;
      this.vel.y = SLAM_VEL;
    } else if (wantSlide && this.onGround && !this.sliding && horizontalSpeed > SLIDE_MIN_SPEED) {
      this.sliding = true;
      const boost = Math.max(horizontalSpeed * SLIDE_BOOST, WALK_SPEED * 1.15);
      const inv = boost / Math.max(horizontalSpeed, 0.001);
      this.vel.x *= inv; this.vel.z *= inv;
      this.fovKick = Math.min(12, this.fovKick + 7);
      audio.slide();
    } else if (!wantSlide) {
      this.sliding = false;
    }

    // ---- wallrun ----
    // enter: airborne, recent wall contact, fast enough, steering somewhere
    if (!this.wallrunning && !this.onGround && !this.slamming && this.dashTimer <= 0
        && this.wallTouchTimer > 0 && this.wallrunCd <= 0
        && horizontalSpeed > WALLRUN_MIN_SPEED && hasInput && this.vel.y < 8) {
      this.wallrunning = true;
      this.wallrunT = 0;
      // right vector = (cos(yaw), 0, -sin(yaw)); normal pointing right => wall on the left
      const rn = cos * this.lastWallNormal.x - sin * this.lastWallNormal.z;
      this.wallSide = rn > 0 ? -1 : 1;
      this.sliding = false;
      this.fovKick = Math.min(12, this.fovKick + 5);
      audio.slide();
    }
    if (this.wallrunning) {
      this.wallrunT += dt;
      // press into the wall so contact persists through the run
      this.vel.x -= this.lastWallNormal.x * WALLRUN_STICK * dt;
      this.vel.z -= this.lastWallNormal.z * WALLRUN_STICK * dt;
      if (this.onGround || this.slamming || this.wallTouchTimer <= 0
          || this.wallrunT > WALLRUN_MAX_TIME || horizontalSpeed < WALLRUN_MIN_SPEED * 0.55) {
        this.wallrunning = false;
        this.wallrunCd = 0.25;
      }
    }

    // ---- movement physics ----
    if (this.dashTimer > 0) {
      this.vel.x = this.dashDir.x * DASH_SPEED;
      this.vel.z = this.dashDir.z * DASH_SPEED;
      this.vel.y = 0;
    } else if (this.sliding && this.onGround) {
      // low friction slide, steerable slightly
      this.vel.x *= (1 - 0.9 * dt);
      this.vel.z *= (1 - 0.9 * dt);
      if (hasInput) {
        this.vel.x += _move.x * 10 * dt;
        this.vel.z += _move.z * 10 * dt;
      }
    } else {
      const accel = this.onGround ? ACCEL : AIR_ACCEL;
      if (hasInput) {
        this.vel.x += _move.x * accel * dt;
        this.vel.z += _move.z * accel * dt;
      }
      if (this.onGround) {
        // friction
        const f = Math.max(0, 1 - FRICTION * dt);
        if (!hasInput) { this.vel.x *= f; this.vel.z *= f; }
      }
      // clamp horizontal speed (soft)
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const maxSpeed = this.onGround ? WALK_SPEED : Math.max(WALK_SPEED, hs);
      if (this.onGround && hs > maxSpeed) {
        const k = maxSpeed / hs;
        this.vel.x *= k; this.vel.z *= k;
      }
    }

    // gravity
    if (this.wallrunning) {
      // wallrun: barely sink, most of the pull is negated
      this.vel.y -= WALLRUN_GRAVITY * dt;
      if (this.vel.y < WALLRUN_MAX_SINK) this.vel.y = WALLRUN_MAX_SINK;
    } else if (!this.onGround || this.vel.y > 0) this.vel.y -= GRAVITY * dt;

    // ---- jumping ----
    if (this.jumpBuffer > 0 && (this.coyote > 0 || this.wallTouchTimer > 0)) {
      this.jumpBuffer = 0;
      if (this.coyote > 0) {
        this.vel.y = JUMP_VEL;
        this.onGround = false;
        this.coyote = 0;
        if (this.sliding) { this.sliding = false; this.fovKick = Math.min(14, this.fovKick + 6); }
        audio.jump();
      } else if (this.wallTouchTimer > 0) {
        // wall jump: cancel into-wall motion, launch off + up, keep tangential speed
        const n = this.lastWallNormal;
        const into = this.vel.x * n.x + this.vel.z * n.z;
        if (into < 0) { this.vel.x -= n.x * into; this.vel.z -= n.z * into; }
        const push = this.wallrunning ? WALK_SPEED * 1.25 : WALK_SPEED * 1.05;
        this.vel.x += n.x * push;
        this.vel.z += n.z * push;
        this.vel.y = JUMP_VEL * (this.wallrunning ? 1.0 : 0.92);
        this.wallrunning = false;
        this.wallrunCd = 0.3;
        this.wallTouchTimer = 0;
        this.fovKick = Math.min(14, this.fovKick + 9);
        audio.jump();
      }
    }

    // ---- integrate + collide ----
    const wasGround = this.onGround;
    const fallSpeed = this.vel.y;
    this.moveCollide(dt, colliders);

    if (!wasGround && this.onGround) {
      // landing
      this.landDip = Math.min(0.32, Math.abs(fallSpeed) * 0.012);
      if (this.slamming) {
        this.slamming = false;
        this.sliding = wantSlide;
        onSlamLand(this.pos);
        audio.slam();
      }
    }
    if (this.onGround) this.slamming = this.slamming && this.vel.y < 0;

    // ---- camera feel ----
    this.crouchAmt += ((this.sliding ? 1 : 0) - this.crouchAmt) * Math.min(1, dt * 10);
    this.landDip = Math.max(0, this.landDip - dt * 0.9);
    this.fovKick = Math.max(0, this.fovKick - dt * 26);
    const targetRoll = (mv.x !== 0 ? -mv.x * 1.6 : 0) + (this.sliding ? -3 : 0) + (this.wallrunning ? -this.wallSide * 13 : 0);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && speed > 1) {
      this.bobPhase += dt * speed * 1.35;
      this.bobAmt = Math.min(1, this.bobAmt + dt * 6);
      this.stepAccum += dt * speed;
      if (this.stepAccum > 3.4) { this.stepAccum = 0; }
    } else {
      this.bobAmt = Math.max(0, this.bobAmt - dt * 6);
    }
  }

  private moveCollide(dt: number, colliders: Collider[]) {
    const r = 0.36;
    const height = 1.7 - this.crouchAmt * 0.6;
    this.onGround = false;

    // Y axis
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    }
    for (const c of colliders) {
      if (this.pos.x + r < c.min.x || this.pos.x - r > c.max.x) continue;
      if (this.pos.z + r < c.min.z || this.pos.z - r > c.max.z) continue;
      if (this.pos.y < c.max.y && this.pos.y + height > c.min.y) {
        if (this.vel.y <= 0 && this.pos.y > c.max.y - 0.6) {
          this.pos.y = c.max.y;
          this.vel.y = 0;
          this.onGround = true;
        } else if (this.vel.y > 0) {
          this.pos.y = c.min.y - height;
          this.vel.y = 0;
        }
      }
    }

    // X axis
    this.pos.x += this.vel.x * dt;
    for (const c of colliders) {
      if (this.pos.y >= c.max.y || this.pos.y + height <= c.min.y) continue;
      if (this.pos.z + r < c.min.z || this.pos.z - r > c.max.z) continue;
      if (this.pos.x + r > c.min.x && this.pos.x - r < c.max.x) {
        if (this.vel.x > 0) { this.pos.x = c.min.x - r; this.lastWallNormal.set(-1, 0, 0); }
        else if (this.vel.x < 0) { this.pos.x = c.max.x + r; this.lastWallNormal.set(1, 0, 0); }
        if (!this.onGround && Math.abs(this.vel.x) > 2) this.wallTouchTimer = 0.14;
        this.vel.x = 0;
      }
    }
    // arena bounds X
    if (this.pos.x < -ARENA_HALF + r) { this.pos.x = -ARENA_HALF + r; this.lastWallNormal.set(1, 0, 0); if (!this.onGround) this.wallTouchTimer = 0.14; this.vel.x = Math.max(0, this.vel.x); }
    if (this.pos.x > ARENA_HALF - r) { this.pos.x = ARENA_HALF - r; this.lastWallNormal.set(-1, 0, 0); if (!this.onGround) this.wallTouchTimer = 0.14; this.vel.x = Math.min(0, this.vel.x); }

    // Z axis
    this.pos.z += this.vel.z * dt;
    for (const c of colliders) {
      if (this.pos.y >= c.max.y || this.pos.y + height <= c.min.y) continue;
      if (this.pos.x + r < c.min.x || this.pos.x - r > c.max.x) continue;
      if (this.pos.z + r > c.min.z && this.pos.z - r < c.max.z) {
        if (this.vel.z > 0) { this.pos.z = c.min.z - r; this.lastWallNormal.set(0, 0, -1); }
        else if (this.vel.z < 0) { this.pos.z = c.max.z + r; this.lastWallNormal.set(0, 0, 1); }
        if (!this.onGround && Math.abs(this.vel.z) > 2) this.wallTouchTimer = 0.14;
        this.vel.z = 0;
      }
    }
    if (this.pos.z < -ARENA_HALF + r) { this.pos.z = -ARENA_HALF + r; this.lastWallNormal.set(0, 0, 1); if (!this.onGround) this.wallTouchTimer = 0.14; this.vel.z = Math.max(0, this.vel.z); }
    if (this.pos.z > ARENA_HALF - r) { this.pos.z = ARENA_HALF - r; this.lastWallNormal.set(0, 0, -1); if (!this.onGround) this.wallTouchTimer = 0.14; this.vel.z = Math.min(0, this.vel.z); }
  }

  damage(amount: number): boolean {
    if (this.dead || this.iframes > 0) return false;
    this.hp -= amount;
    this.iframes = 0.25;
    audio.hurt();
    store.setHud({ hp: Math.max(0, this.hp), damageFlash: 1 });
    if (this.hp <= 0) {
      this.dead = true;
      return true;
    }
    return false;
  }

  heal(amount: number) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
    store.setHud({ hp: this.hp, healFlash: 1 });
  }
}
