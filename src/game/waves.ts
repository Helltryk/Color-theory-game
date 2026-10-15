// Wave director: escalating fodder + elites, boss every 6th wave.
// A defeated boss joins the standard elite pool from the next wave on.
import * as THREE from 'three';
import type { EnemyManager } from './enemies';
import { audio } from './audio';
import { store } from './store';
import { ARENA_HALF } from './arena';

const _spawn = new THREE.Vector3();

export class WaveDirector {
  wave = 0;
  active = false;
  intermission = 0;
  pendingFodder = 0;
  pendingElites = 0;
  pendingBoss = false;
  bossUnlocked = false; // after first boss dies
  private spawnTimer = 0;
  private enemies!: EnemyManager;

  init(enemies: EnemyManager) {
    this.enemies = enemies;
  }

  reset() {
    this.wave = 0;
    this.active = false;
    this.intermission = 3;
    this.pendingFodder = 0;
    this.pendingElites = 0;
    this.pendingBoss = false;
    this.bossUnlocked = false;
    store.setHud({ wave: 0, enemiesLeft: 0, bossActive: false, isBossWave: false });
  }

  update(dt: number) {
    if (!this.active) {
      this.intermission -= dt;
      store.setHud({ intermission: Math.max(0, this.intermission) });
      if (this.intermission <= 0) this.startWave(this.wave + 1);
      return;
    }

    // trickle spawns
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.5;
      const alive = this.enemies.count();
      if (this.pendingBoss) {
        this.pendingBoss = false;
        this.enemies.spawnElite(this.randomSpawn(), this.wave, { boss: true, shield: 'prism' });
        store.setHud({ bossActive: true, bossHp: 1 });
      } else if (this.pendingElites > 0 && alive < 6) {
        this.pendingElites--;
        // after the first boss falls, PALADIN PRIME-class elites join regular waves
        const prime = this.bossUnlocked && Math.random() < 0.25;
        const shield = prime ? 'prism' : (this.bossUnlocked && Math.random() < 0.3 ? 'prism' : undefined);
        this.enemies.spawnElite(this.randomSpawn(), this.wave, { prime, ...(shield ? { shield } : {}) });
      } else if (this.pendingFodder > 0 && alive < 14) {
        this.pendingFodder--;
        this.enemies.spawnFodder(this.randomSpawn(), this.wave);
      }
    }

    const left = this.enemies.count() + this.pendingFodder + this.pendingElites + (this.pendingBoss ? 1 : 0);
    store.setHud({ enemiesLeft: left });

    if (left === 0) {
      // wave cleared
      this.active = false;
      this.intermission = 6;
      store.setHud({ message: `WAVE ${this.wave} CLEARED`, messageT: 2.5 });
      store.setHud({ score: store.hud.score + this.wave * 250 });
      audio.waveStart();
    }
  }

  private startWave(n: number) {
    this.wave = n;
    this.active = true;
    const isBossWave = n % 6 === 0;
    store.setHud({ wave: n, isBossWave });
    if (isBossWave) {
      this.pendingBoss = true;
      this.pendingFodder = 2 + Math.floor(n / 6);
      this.pendingElites = 0;
      store.setHud({ message: '⚠ PALADIN PRIME DETECTED ⚠', messageT: 3 });
    } else {
      this.pendingBoss = false;
      this.pendingFodder = Math.min(4 + n * 2, 26);
      this.pendingElites = n >= 3 ? Math.min(Math.floor((n - 1) / 2), 5) : 0;
      store.setHud({ message: `WAVE ${n}`, messageT: 2 });
    }
    audio.waveStart();
    if (isBossWave) audio.bossSting();
  }

  onKill(kind: string) {
    if (kind === 'boss') this.bossUnlocked = true;
  }

  private randomSpawn(): THREE.Vector3 {
    // ring spawn away from center
    const ang = Math.random() * Math.PI * 2;
    const r = ARENA_HALF * (0.55 + Math.random() * 0.35);
    _spawn.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    return _spawn;
  }
}
