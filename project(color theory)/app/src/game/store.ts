// Tiny pub/sub store bridging the game loop and React HUD/menus.
import { useSyncExternalStore } from 'react';
import type { ColorKey } from './colors';

export type ScreenState = 'menu' | 'intro' | 'playing' | 'paused' | 'settings' | 'dead';
export type WeaponId = 0 | 1 | 2; // AR, Shotgun, Sniper

export interface HudState {
  hp: number;
  maxHp: number;
  dashes: number;
  wave: number;
  enemiesLeft: number;
  score: number;
  kills: number;
  weapon: WeaponId;
  shotgunCd: number; // 0..1 (1 = ready)
  sniperAmmo: number;
  sniperMax: number;
  playerColor: ColorKey;
  hint: string; // shield hint text (bright green)
  hintKind: 'none' | 'shield' | 'warn';
  wheelOpen: boolean;
  wheelSel: ColorKey | null;
  wheelX: number;
  wheelY: number;
  bossActive: boolean;
  bossHp: number; // 0..1
  message: string; // big center announcements
  messageT: number;
  damageFlash: number;
  parryFlash: number;
  healFlash: number;
  intermission: number;
  isBossWave: boolean;
}

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  sensitivity: number;
  fov: number;
  shake: number;
  quality: 'low' | 'high';
}

const SETTINGS_KEY = 'grayscale.settings.v1';

export const defaultSettings: Settings = {
  master: 0.8, sfx: 1.0, music: 0.55, sensitivity: 1.0, fov: 95, shake: 1.0, quality: 'high',
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* ignore */ }
  return { ...defaultSettings };
}

export const initialHud: HudState = {
  hp: 100, maxHp: 100, dashes: 3, wave: 0, enemiesLeft: 0, score: 0, kills: 0,
  weapon: 0, shotgunCd: 1, sniperAmmo: 6, sniperMax: 12,
  playerColor: { base: 0, sat: 1, hue: 0 },
  hint: '', hintKind: 'none', wheelOpen: false, wheelSel: null, wheelX: 0, wheelY: 0,
  bossActive: false, bossHp: 1, message: '', messageT: 0,
  damageFlash: 0, parryFlash: 0, healFlash: 0, intermission: 0, isBossWave: false,
};

type Listener = () => void;

class Store {
  screen: ScreenState = 'menu';
  hud: HudState = { ...initialHud };
  settings: Settings = loadSettings();
  highScore = 0;
  private listeners = new Set<Listener>();
  private hudDirty = false;
  private version = 0;

  constructor() {
    try { this.highScore = Number(localStorage.getItem('grayscale.highscore') ?? 0) || 0; } catch { /* ignore */ }
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  setScreen(s: ScreenState) {
    this.screen = s;
    this.emit();
  }

  setHud(patch: Partial<HudState>) {
    Object.assign(this.hud, patch);
    this.hudDirty = true;
  }

  // called once per frame by the game loop; emits at most every frame
  flushHud() {
    if (this.hudDirty) { this.hudDirty = false; this.emit(); }
  }

  setSettings(patch: Partial<Settings>) {
    Object.assign(this.settings, patch);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    this.emit();
  }

  commitHighScore(v: number) {
    if (v > this.highScore) {
      this.highScore = v;
      try { localStorage.setItem('grayscale.highscore', String(v)); } catch { /* ignore */ }
    }
    this.emit();
  }

  getVersion = () => this.version;
}

export const store = new Store();

export function useStore(): Store {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}
