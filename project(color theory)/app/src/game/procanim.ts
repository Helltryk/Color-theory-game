// Procedural skeletal animation for models without baked clips.
// Finds bones by name, stores rest pose, applies per-frame rotation offsets
// (rest * offset) so the rig's authored pose is always preserved.
import * as THREE from 'three';

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

// GLTFLoader sanitizes node names (dots etc. are stripped) — match on that form
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '');
}

export class ProcRig {
  private bones = new Map<string, { obj: THREE.Object3D; rest: THREE.Quaternion }>();

  constructor(root: THREE.Object3D, names: string[]) {
    const wanted = new Map(names.map((n) => [sanitize(n), n]));
    root.traverse((o) => {
      const key = sanitize(o.name);
      if (wanted.has(key) && !this.bones.has(key)) {
        this.bones.set(key, { obj: o, rest: o.quaternion.clone() });
      }
    });
  }

  has(name: string): boolean {
    return this.bones.has(sanitize(name));
  }

  // apply rest * eulerOffset to a bone (no-op if the bone doesn't exist)
  set(name: string, x: number, y: number, z: number) {
    const b = this.bones.get(sanitize(name));
    if (!b) return;
    _e.set(x, y, z);
    _q.setFromEuler(_e);
    b.obj.quaternion.copy(b.rest).multiply(_q);
  }

  resetPose() {
    for (const [, b] of this.bones) b.obj.quaternion.copy(b.rest);
  }
}

// Bone name sets for the two enemy models.
export const ROBOT_BONES = [
  'spine.001', 'spine.003', 'spine.006',
  'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R',
  'upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R',
];

export const DROID_BONES = [
  'stomache', 'chest', 'neck', 'head',
  'thighL', 'thighR', 'legL', 'legR', 'f1', 'f2',
  'sholdrL', 'sholdrR', 'uparmL', 'uparmR', 'BotarmL', 'BotarmR',
];

// ---- shared gait math ----
// phase: stride phase in radians; amt: 0..1 blend; lean: forward lean
export interface GaitPose {
  thighL: number; thighR: number;
  shinL: number; shinR: number;
  footL: number; footR: number;
  armL: number; armR: number;
  foreL: number; foreR: number;
  spineTwist: number; spineSway: number;
  headCounter: number;
}

const _gait: GaitPose = {
  thighL: 0, thighR: 0, shinL: 0, shinR: 0, footL: 0, footR: 0,
  armL: 0, armR: 0, foreL: 0, foreR: 0, spineTwist: 0, spineSway: 0, headCounter: 0,
};

export function gaitPose(phase: number, amt: number): GaitPose {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  _gait.thighL = s * 0.62 * amt;
  _gait.thighR = -s * 0.62 * amt;
  // knees bend while the leg swings through
  _gait.shinL = Math.max(0, Math.sin(phase + Math.PI * 0.6)) * 0.85 * amt;
  _gait.shinR = Math.max(0, Math.sin(phase + Math.PI * 1.6)) * 0.85 * amt;
  _gait.footL = -s * 0.25 * amt;
  _gait.footR = s * 0.25 * amt;
  // arms counter-swing
  _gait.armL = -s * 0.5 * amt;
  _gait.armR = s * 0.5 * amt;
  _gait.foreL = (-0.25 - Math.max(0, -s) * 0.3) * amt;
  _gait.foreR = (-0.25 - Math.max(0, s) * 0.3) * amt;
  _gait.spineTwist = s * 0.1 * amt;
  _gait.spineSway = c * 0.05 * amt;
  _gait.headCounter = -s * 0.06 * amt;
  return _gait;
}

export function applyGait(rig: ProcRig, names: 'robot' | 'droid', g: GaitPose) {
  if (names === 'robot') {
    rig.set('thigh.L', g.thighL, 0, 0);
    rig.set('thigh.R', g.thighR, 0, 0);
    rig.set('shin.L', g.shinL, 0, 0);
    rig.set('shin.R', g.shinR, 0, 0);
    rig.set('foot.L', g.footL, 0, 0);
    rig.set('foot.R', g.footR, 0, 0);
    rig.set('upper_arm.L', g.armL, 0, 0);
    rig.set('upper_arm.R', g.armR, 0, 0);
    rig.set('forearm.L', g.foreL, 0, 0);
    rig.set('forearm.R', g.foreR, 0, 0);
    rig.set('spine.003', 0, g.spineTwist, g.spineSway);
    rig.set('spine.006', 0, g.headCounter, 0);
  } else {
    rig.set('thighL', g.thighL, 0, 0);
    rig.set('thighR', g.thighR, 0, 0);
    rig.set('legL', g.shinL, 0, 0);
    rig.set('legR', g.shinR, 0, 0);
    rig.set('f1', g.footL, 0, 0);
    rig.set('f2', g.footR, 0, 0);
    rig.set('uparmL', g.armL, 0, 0);
    rig.set('uparmR', g.armR, 0, 0);
    rig.set('BotarmL', g.foreL, 0, 0);
    rig.set('BotarmR', g.foreR, 0, 0);
    rig.set('chest', 0, g.spineTwist, g.spineSway);
    rig.set('head', 0, g.headCounter, 0);
  }
}
