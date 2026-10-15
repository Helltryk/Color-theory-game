import { useStore } from '../game/store';
import { colorToCss, colorName } from '../game/colors';

const WEAPON_NAMES = ['PALE REPEATER', 'PRISM MAW', 'MONO LANCE'];
const WEAPON_KINDS = ['ASSAULT RIFLE — COLORLESS', 'SHOTGUN — 3S CYCLE', 'SNIPER — SCARCE AMMO'];
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function HUD() {
  const s = useStore();
  const h = s.hud;
  // keep HUD clear of the touch controls
  const bottomOffset = TOUCH ? 'calc(max(1rem, env(safe-area-inset-bottom)) + 220px)' : 'max(1rem, env(safe-area-inset-bottom))';

  return (
    <div className="absolute inset-0 z-20 pointer-events-none scanlines">
      {/* damage / parry / heal flashes */}
      {h.damageFlash > 0 && (
        <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 120px 40px rgba(200,40,40,${h.damageFlash * 0.45})` }} />
      )}
      {h.parryFlash > 0 && (
        <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 140px 50px rgba(255,255,255,${h.parryFlash * 0.5})` }} />
      )}
      {h.healFlash > 0 && (
        <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 120px 40px rgba(57,255,90,${h.healFlash * 0.2})` }} />
      )}
      {/* vignette */}
      <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 180px 30px rgba(0,0,0,0.55)' }} />

      {/* crosshair */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="w-1.5 h-1.5 bg-neutral-200/90" style={{ transform: 'rotate(45deg)' }} />
      </div>

      {/* shield hint — bright green, black outline */}
      {h.hint && (
        <div className={`absolute left-1/2 top-[56%] -translate-x-1/2 text-center text-sm md:text-base tracking-[0.15em] whitespace-nowrap ${h.hintKind === 'shield' ? 'shield-hint' : 'warn-hint'}`}>
          {h.hint}
        </div>
      )}

      {/* center message */}
      {h.messageT > 0 && h.message && (
        <div className="absolute left-1/2 top-[24%] -translate-x-1/2 text-2xl md:text-4xl font-bold tracking-[0.3em] text-neutral-100 hud-text text-center">
          {h.message}
        </div>
      )}

      {/* top bar: wave / enemies / score */}
      <div className="absolute top-0 inset-x-0 flex justify-between items-start px-4 md:px-8 pt-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <div className="hud-text text-neutral-300">
          <div className="text-[10px] tracking-[0.3em] text-neutral-500">WAVE</div>
          <div className="text-3xl font-bold">{h.wave || '—'}</div>
          {h.isBossWave && <div className="text-[10px] tracking-[0.3em] text-neutral-400 mt-1 blink">BOSS PROTOCOL</div>}
        </div>
        <div className="text-center hud-text">
          {h.intermission > 0 && !h.bossActive && (
            <div className="text-xs tracking-[0.3em] text-neutral-400">
              NEXT WAVE IN <span className="text-neutral-100 text-lg">{Math.ceil(h.intermission)}</span>
            </div>
          )}
          {h.enemiesLeft > 0 && (
            <div className="text-[11px] tracking-[0.3em] text-neutral-400 mt-1">HOSTILES: <span className="text-neutral-100">{h.enemiesLeft}</span></div>
          )}
          {h.bossActive && (
            <div className="mt-2 w-56 md:w-80">
              <div className="text-[10px] tracking-[0.35em] text-neutral-400 mb-1">PALADIN PRIME</div>
              <div className="h-2 bg-neutral-800 border border-neutral-700">
                <div className="h-full bg-neutral-200 transition-all duration-150" style={{ width: `${h.bossHp * 100}%` }} />
              </div>
            </div>
          )}
        </div>
        <div className="text-right hud-text text-neutral-300">
          <div className="text-[10px] tracking-[0.3em] text-neutral-500">SCORE</div>
          <div className="text-2xl font-bold">{h.score.toLocaleString()}</div>
          <div className="text-[10px] tracking-[0.3em] text-neutral-500 mt-1">KILLS {h.kills}</div>
        </div>
      </div>

      {/* bottom left: health + dashes */}
      <div className="absolute bottom-0 left-0 p-4 md:p-8 hud-text" style={{ paddingBottom: bottomOffset }}>
        <div className="text-[10px] tracking-[0.3em] text-neutral-500 mb-1">INTEGRITY</div>
        <div className="w-44 md:w-64 h-3 bg-neutral-800 border border-neutral-700">
          <div
            className={`h-full transition-all duration-150 ${h.hp < 30 ? 'bg-red-400 blink' : 'bg-neutral-200'}`}
            style={{ width: `${(h.hp / h.maxHp) * 100}%` }}
          />
        </div>
        <div className="text-xs text-neutral-400 mt-1">{Math.ceil(h.hp)} / {h.maxHp}</div>
        <div className="flex gap-1.5 mt-3 items-center">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`w-8 h-2 border ${i < h.dashes ? 'bg-neutral-200 border-neutral-300' : 'bg-transparent border-neutral-700'}`} />
          ))}
          <span className="text-[9px] tracking-[0.25em] text-neutral-600 ml-2">DASH</span>
        </div>
      </div>

      {/* bottom right: weapon */}
      <div className="absolute bottom-0 right-0 p-4 md:p-8 text-right hud-text" style={{ paddingBottom: bottomOffset }}>
        <div className="text-[10px] tracking-[0.3em] text-neutral-500">{WEAPON_KINDS[h.weapon]}</div>
        <div className="text-xl md:text-2xl font-bold text-neutral-200 tracking-[0.15em]">{WEAPON_NAMES[h.weapon]}</div>
        {h.weapon === 0 && <div className="text-[10px] tracking-[0.3em] text-neutral-500 mt-1">AMMO ∞</div>}
        {h.weapon === 1 && (
          <div className="mt-1">
            <div className="w-36 md:w-48 h-2 bg-neutral-800 border border-neutral-700 ml-auto">
              <div className="h-full transition-all duration-100" style={{ width: `${h.shotgunCd * 100}%`, background: colorToCss(h.playerColor) }} />
            </div>
            <div className="text-[9px] tracking-[0.25em] text-neutral-500 mt-1">
              {h.shotgunCd >= 1 ? 'CHARGED' : 'CYCLING…'} — {colorName(h.playerColor)}
            </div>
          </div>
        )}
        {h.weapon === 2 && (
          <div className="mt-1">
            <div className="text-2xl font-bold" style={{ color: h.sniperAmmo > 0 ? '#e5e7ea' : '#666' }}>{h.sniperAmmo} <span className="text-xs text-neutral-500">/ {h.sniperMax}</span></div>
            <div className="text-[9px] tracking-[0.25em] text-neutral-500">{colorName(h.playerColor)}</div>
          </div>
        )}
        {(h.weapon === 1 || h.weapon === 2) && (
          <div className="mt-2 flex items-center justify-end gap-2">
            <span className="text-[9px] tracking-[0.2em] text-neutral-500">LOADED</span>
            <span className="inline-block w-4 h-4 border border-black" style={{ background: colorToCss(h.playerColor) }} />
          </div>
        )}
      </div>
    </div>
  );
}
