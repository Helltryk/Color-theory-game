import { useEffect, useRef, useState } from 'react';
import { store, useStore } from './game/store';
import { Game, setGameInstance, game } from './game/game';
import { audio } from './game/audio';
import { StartScreen } from './ui/StartScreen';
import { SettingsMenu } from './ui/SettingsMenu';
import { HUD } from './ui/HUD';
import { ColorWheelUI } from './ui/ColorWheelUI';
import { TouchControls, isTouch } from './ui/TouchControls';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsFrom, setSettingsFrom] = useState<'menu' | 'paused'>('menu');
  const s = useStore();

  useEffect(() => {
    const h = (e: ErrorEvent) => setLoadError(`${e.message} @ ${e.filename}:${e.lineno}`);
    const h2 = (e: PromiseRejectionEvent) => setLoadError(`async: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`);
    window.addEventListener('error', h);
    window.addEventListener('unhandledrejection', h2);
    return () => { window.removeEventListener('error', h); window.removeEventListener('unhandledrejection', h2); };
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const g = new Game(canvasRef.current);
    setGameInstance(g);
    g.init()
      .then(() => setReady(true))
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      g.dispose();
      setGameInstance(null);
    };
  }, []);

  const screen = s.screen;

  // click canvas to re-lock pointer while playing
  const onCanvasClick = () => {
    if (screen === 'playing') game?.lockPointer();
  };

  return (
    <div className="fixed inset-0 bg-[#101112] overflow-hidden">
      <canvas ref={canvasRef} className="game-canvas" onClick={onCanvasClick} />

      {!ready && !loadError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#101112]">
          <div className="text-center">
            <div className="text-neutral-300 tracking-[0.4em] text-sm blink">LOADING SPECTRUM VAULT…</div>
          </div>
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#101112]">
          <div className="text-neutral-400 text-sm max-w-md text-center">
            FAILED TO LOAD: {loadError}
          </div>
        </div>
      )}

      {ready && screen === 'menu' && <StartScreen />}

      {ready && (screen === 'playing' || screen === 'paused') && (
        <>
          <HUD />
          <ColorWheelUI />
          {screen === 'playing' && <TouchControls />}
        </>
      )}

      {ready && screen === 'paused' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#101112]/80 scanlines">
          <div className="flex flex-col gap-3 w-64 fade-in">
            <h2 className="text-2xl tracking-[0.3em] text-neutral-200 text-center mb-4">PAUSED</h2>
            <button className="btn-ghost px-6 py-3 text-sm" onClick={() => { audio.uiSelect(); game?.resume(); }}>
              RESUME
            </button>
            <button className="btn-ghost px-6 py-3 text-sm" onClick={() => { audio.uiSelect(); setSettingsFrom('paused'); store.setScreen('settings'); }}>
              SETTINGS
            </button>
            <button className="btn-ghost px-6 py-3 text-sm" onClick={() => { audio.uiBack(); game?.quitToMenu(); }}>
              ABANDON RUN
            </button>
            {isTouch() && (
              <div className="text-[10px] text-neutral-500 text-center mt-2 tracking-[0.2em]">TOUCH MODE ACTIVE</div>
            )}
          </div>
        </div>
      )}

      {ready && screen === 'settings' && (
        <SettingsMenu onBack={() => {
          if (settingsFrom === 'paused') store.setScreen('paused');
          else store.setScreen('menu');
        }} />
      )}

      {ready && screen === 'dead' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#0c0d0e]/88 scanlines">
          <div className="flex flex-col items-center gap-6 fade-in px-6">
            <h2 className="text-4xl md:text-6xl font-bold tracking-[0.25em] text-neutral-200 hud-text text-center">SIGNAL LOST</h2>
            <div className="text-[11px] tracking-[0.3em] text-neutral-500 text-center leading-6">
              THE GRAY RECLAIMS ANOTHER<br />
              WAVE {s.hud.wave} — SCORE {s.hud.score.toLocaleString()} — KILLS {s.hud.kills}
              {s.hud.score >= s.highScore && s.hud.score > 0 && (
                <div className="text-neutral-300 mt-1">NEW BEST</div>
              )}
            </div>
            <div className="flex flex-col gap-3 w-64">
              <button className="btn-ghost px-6 py-3 text-sm" onClick={() => { audio.uiSelect(); game?.startRun(); }}>
                REBOOT CHROMA-0
              </button>
              <button className="btn-ghost px-6 py-3 text-sm" onClick={() => { audio.uiBack(); game?.quitToMenu(); }}>
                TERMINAL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
