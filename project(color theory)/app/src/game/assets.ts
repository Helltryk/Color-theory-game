// Asset loading: robot (fodder) + droid (elite), with grayscale material grading.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

export interface Assets {
  fodder: THREE.Group;
  elite: THREE.Group;
  eliteClips: THREE.AnimationClip[];
}

const grayCache = new Map<string, THREE.MeshStandardMaterial>();

// Convert a material to a dull gray variant, keeping its lightness so shading reads.
function grayMaterial(name: string, rough = 0.85, metal = 0.25, emissive?: number): THREE.MeshStandardMaterial {
  const key = `${name}|${rough}|${metal}|${emissive ?? 0}`;
  let m = grayCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.32, 0.33, 0.35),
      roughness: rough,
      metalness: metal,
    });
    if (emissive !== undefined) {
      m.emissive = new THREE.Color(emissive);
      m.emissiveIntensity = 0.6;
    }
    grayCache.set(key, m);
  }
  return m;
}

export function gradeModelGray(root: THREE.Object3D, opts?: { visorGlow?: boolean }) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mapped = mats.map((m) => {
        const n = (m.name ?? '').toLowerCase();
        if (opts?.visorGlow && (n.includes('visor') || n.includes('eye') || n.includes('glass'))) {
          // the only permitted glow on enemies: a dead, pale visor slit
          return grayMaterial('visor', 0.4, 0.1, 0x9aa0a6);
        }
        if (n.includes('metal') || n.includes('armor')) return grayMaterial('armor', 0.55, 0.75);
        return grayMaterial('body');
      });
      mesh.material = Array.isArray(mesh.material) ? mapped : mapped[0];
    }
  });
}

export async function loadAssets(): Promise<Assets> {
  const loader = new GLTFLoader();
  const [robotGltf, droidGltf] = await Promise.all([
    loader.loadAsync('models/fodder_robot/robot.glb'),
    loader.loadAsync('models/elite_droid/droid.glb'),
  ]);
  const fodder = robotGltf.scene;
  gradeModelGray(fodder, { visorGlow: true });
  // normalize scale against bounding-box height
  const rBox = new THREE.Box3().setFromObject(fodder);
  const rSize = new THREE.Vector3();
  rBox.getSize(rSize);
  const rScale = 1.9 / Math.max(rSize.y, 0.001);
  fodder.scale.setScalar(rScale);

  const elite = droidGltf.scene;
  gradeModelGray(elite, { visorGlow: true });
  const dBox = new THREE.Box3().setFromObject(elite);
  const dSize = new THREE.Vector3();
  dBox.getSize(dSize);
  const dScale = 2.0 / Math.max(dSize.y, 0.001);
  elite.scale.setScalar(dScale);

  return { fodder, elite, eliteClips: droidGltf.animations };
}

export function cloneRigged<T extends THREE.Object3D>(src: T): T {
  return skeletonClone(src) as T;
}
