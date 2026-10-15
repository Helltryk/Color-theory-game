import { useEffect, useState } from 'react';
import { store, useStore } from '../game/store';
import { audio } from '../game/audio';
import { game } from '../game/game';
import { ACTION_LABELS, codeLabel } from '../game/input';
import type { Action } from '../game/input';

const ALL_ACTIONS = Object.keys(ACTION_LABELS) as Action[];

export function SettingsMenu({ onBack }: { onBack: () => void }) {
  const s = useStore();
  const [capturing, setCapturing] = useState<Action | null>(null);

  // capture next key/mouse press for rebinding
  useEffect(() => {
    if (!capturing) return;
    if (game) game.input.enabled = false;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        game?.input.rebind(capturing, e.code);
        audio.uiSelect();
      }
      setCapturing(null);
    };
    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      game?.input.rebind(capturing, `Mouse${e.button}`);
      audio.uiSelect();
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      if (game && store.screen === 'playing') game.input.enabled = true;
    };
  }, [capturing]);

  // force rerender when bindings change: piggyback on store emit via capturing state
  const [, force] = useState(0);
  useEffect(() => {
    if (!capturing) force((n) => n + 1);
  }, [capturing]);

  const setNum = (key: 'master' | 'sfx' | 'music' | 'sensitivity' | 'fov' | 'shake', v: number) => {
    store.setSettings({ [key]: v });
    audio.applyVolumes();
  };

  const bindings = game?.input.bindings;

  return (
    <div className="absolute inset-0 z-40 bg-[#101112]/92 scanlines overflow-y-auto"
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div className="max-w-2xl mx-auto px-6 py-8 fade-in">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl tracking-[0.3em] text-neutral-200">SETTINGS</h2>
          <button className="btn-ghost px-4 py-2 text-xs" onClick={() => { audio.uiBack(); onBack(); }}>◀ BACK</button>
        </div>

        <section className="mb-8">
          <h3 className="text-[11px] tracking-[0.35em] text-neutral-500 mb-3">AUDIO</h3>
          <Slider label="MASTER" value={s.settings.master} onChange={(v) => setNum('master', v)} />
          <Slider label="EFFECTS" value={s.settings.sfx} onChange={(v) => setNum('sfx', v)} />
          <Slider label="AMBIENCE" value={s.settings.music} onChange={(v) => setNum('music', v)} />
        </section>

        <section className="mb-8">
          <h3 className="text-[11px] tracking-[0.35em] text-neutral-500 mb-3">VIDEO / FEEL</h3>
          <Slider label="SENSITIVITY" value={s.settings.sensitivity} min={0.2} max={3} onChange={(v) => setNum('sensitivity', v)} />
          <Slider label="FIELD OF VIEW" value={s.settings.fov} min={70} max={120} step={1} onChange={(v) => setNum('fov', v)} />
          <Slider label="SCREEN SHAKE" value={s.settings.shake} min={0} max={1.5} onChange={(v) => setNum('shake', v)} />
          <div className="flex items-center justify-between py-2 border-b border-neutral-800">
            <span className="text-xs tracking-[0.2em] text-neutral-300">QUALITY</span>
            <button
              className="btn-ghost px-3 py-1.5 text-xs"
              onClick={() => store.setSettings({ quality: s.settings.quality === 'high' ? 'low' : 'high' })}
            >
              {s.settings.quality.toUpperCase()} (applies on restart)
            </button>
          </div>
        </section>

        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] tracking-[0.35em] text-neutral-500">CONTROLS — CLICK TO REBIND</h3>
            <button className="btn-ghost px-3 py-1 text-[10px]" onClick={() => { game?.input.resetDefaults(); force((n) => n + 1); }}>
              RESET
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {ALL_ACTIONS.map((a) => (
              <button
                key={a}
                className={`flex items-center justify-between py-2 px-2 border-b border-neutral-800 text-left ${capturing === a ? 'bg-neutral-700/40' : 'hover:bg-neutral-800/40'}`}
                onClick={() => { setCapturing(a); audio.uiMove(); }}
              >
                <span className="text-[11px] tracking-[0.15em] text-neutral-300">{ACTION_LABELS[a]}</span>
                <span className={`text-[11px] px-2 py-0.5 border ${capturing === a ? 'border-neutral-200 text-neutral-100 blink' : 'border-neutral-700 text-neutral-400'}`}>
                  {capturing === a ? 'PRESS KEY…' : codeLabel(bindings?.[a] ?? '')}
                </span>
              </button>
            ))}
          </div>
          {capturing && <div className="mt-3 text-[10px] text-neutral-500 tracking-[0.2em]">ESC CANCELS · ANY KEY OR MOUSE BUTTON BINDS</div>}
        </section>
      </div>
    </div>
  );
}

function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2 border-b border-neutral-800">
      <span className="text-xs tracking-[0.2em] text-neutral-300 shrink-0">{label}</span>
      <input
        type="range"
        className="w-48 accent-neutral-300"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="text-[10px] text-neutral-500 w-10 text-right">{Math.round(value * 100) / (max > 10 ? 1 : 100)}{max > 10 ? '' : '%'}</span>
    </label>
  );
}
