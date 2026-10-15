import { useEffect, useState } from 'react';
import { store, useStore } from '../game/store';
import { audio } from '../game/audio';
import { game } from '../game/game';

const LORE_LINES = [
  'ARCHIVE — FINAL LOG OF E. VANCE, CHROMATIC ENGINEER',
  '',
  'The world did not lose its color in a war.',
  'It was rationed, then licensed, then forgotten.',
  'Gray was cheaper. Gray was safe. Gray was everything.',
  '',
  'I spent eleven years hoarding six colors.',
  'Six. That is all that is left in the spectrum vault.',
  '',
  'I am dying. The gray takes everyone eventually.',
  'So I built you — neither man nor woman, only purpose.',
  'My last act is pouring the six colors into your prism core.',
  '',
  'They will come for you. The palette wardens. The droids.',
  'You are the only color left.',
  '',
  '// VITALS FLATLINED 04:17:02',
  '// UNIT CHROMA-0: ONLINE',
];

export function StartScreen() {
  const s = useStore();
  const [intro, setIntro] = useState(false);
  const [lineCount, setLineCount] = useState(0);

  useEffect(() => {
    if (!intro) return;
    if (lineCount >= LORE_LINES.length) return;
    const t = setTimeout(() => setLineCount((c) => c + 1), lineCount === 0 ? 300 : 420);
    return () => clearTimeout(t);
  }, [intro, lineCount]);

  const begin = () => {
    audio.init();
    audio.resume();
    audio.uiSelect();
    setIntro(true);
  };

  const launch = () => {
    audio.uiSelect();
    game?.startRun();
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#101112]/85 scanlines px-6"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {!intro ? (
        <div className="flex flex-col items-center gap-8 fade-in max-w-xl w-full">
          <div className="text-center">
            <div className="text-[10px] tracking-[0.6em] text-neutral-500 mb-3">SPECTRUM VAULT // TERMINAL 0</div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-[0.18em] text-neutral-200 hud-text">
              GRAY<span className="text-neutral-500">SCALE</span>
            </h1>
            <div className="mt-3 text-[11px] tracking-[0.3em] text-neutral-500">THE ONLY COLOR LEFT</div>
            <div className="mt-1 flex justify-center gap-1">
              {['#ff2d2d', '#ffe02d', '#2dff5a', '#2dfff2', '#2d6bff', '#ff2de0'].map((c) => (
                <span key={c} className="inline-block w-3 h-1" style={{ background: c, opacity: 0.85 }} />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 w-64">
            <button className="btn-ghost px-6 py-3 text-sm" onClick={begin} onMouseEnter={() => audio.uiMove()}>
              INITIALIZE
            </button>
            <button className="btn-ghost px-6 py-3 text-sm" onClick={() => { audio.init(); audio.uiSelect(); store.setScreen('settings'); }} onMouseEnter={() => audio.uiMove()}>
              SETTINGS
            </button>
          </div>

          {s.highScore > 0 && (
            <div className="text-[10px] tracking-[0.3em] text-neutral-600">BEST SCORE — {s.highScore.toLocaleString()}</div>
          )}

          <div className="text-[10px] leading-5 text-neutral-600 text-center max-w-md">
            WASD move · SPACE jump · SHIFT dash · C slide/slam · E parry<br />
            LMB fire · 1/2/3 weapons · HOLD TAB color wheel (slows time)
          </div>
        </div>
      ) : (
        <div className="max-w-xl w-full fade-in">
          <div className="min-h-[46vh] text-[12px] md:text-sm leading-6 text-neutral-400 whitespace-pre-line font-mono">
            {LORE_LINES.slice(0, lineCount).join('\n')}
            {lineCount < LORE_LINES.length && <span className="blink">▊</span>}
          </div>
          <div className="mt-8 flex gap-4">
            {lineCount < LORE_LINES.length ? (
              <button className="btn-ghost px-6 py-3 text-sm" onClick={() => setLineCount(LORE_LINES.length)}>SKIP ▶▶</button>
            ) : (
              <button className="btn-ghost px-8 py-4 text-base blink" onClick={launch}>WAKE UP ▶</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
