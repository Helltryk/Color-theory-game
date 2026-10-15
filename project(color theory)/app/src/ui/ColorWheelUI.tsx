import { useMemo } from 'react';
import { useStore } from '../game/store';
import { colorToCss, colorName, colorsEqual } from '../game/colors';
import type { ColorKey } from '../game/colors';
import { game } from '../game/game';
import { codeLabel } from '../game/input';

const CX = 170, CY = 170;
const DEAD = 52, MID = 104, OUT = 158;

function polar(r: number, thetaDeg: number): [number, number] {
  const t = (thetaDeg * Math.PI) / 180;
  return [CX + r * Math.sin(t), CY - r * Math.cos(t)];
}

function wedge(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  return `M ${x0} ${y0} A ${r1} ${r1} 0 0 1 ${x1} ${y1} L ${x2} ${y2} A ${r0} ${r0} 0 0 0 ${x3} ${y3} Z`;
}

interface Cell { key: ColorKey; d: string; }

export function ColorWheelUI() {
  const s = useStore();
  const h = s.hud;

  const cells = useMemo<Cell[]>(() => {
    const out: Cell[] = [];
    for (let base = 0; base < 6; base++) {
      for (let hue = 0; hue < 2; hue++) {
        for (let sat = 0; sat < 2; sat++) {
          const a0 = base * 60 + hue * 30 + 1.2;
          const a1 = base * 60 + hue * 30 + 28.8;
          const r0 = sat === 0 ? DEAD + 2 : MID + 2;
          const r1 = sat === 0 ? MID - 2 : OUT - 2;
          out.push({ key: { base, sat, hue }, d: wedge(r0, r1, a0, a1) });
        }
      }
    }
    return out;
  }, []);

  if (!h.wheelOpen) return null;

  const sel = h.wheelSel;
  const loaded = h.playerColor;
  const cursorR = Math.min(1, Math.hypot(h.wheelX, h.wheelY));
  const cursorAng = Math.atan2(h.wheelX, -h.wheelY);
  const [cxp, cyp] = polar(cursorR * OUT, (cursorAng * 180) / Math.PI);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
      <div className="relative" style={{ filter: 'drop-shadow(0 0 30px rgba(0,0,0,0.8))' }}>
        <svg width={340} height={340} viewBox="0 0 340 340" className="pointer-events-auto" style={{ touchAction: 'none' }}>
          <circle cx={CX} cy={CY} r={OUT + 4} fill="rgba(12,13,14,0.82)" stroke="#3a3c40" strokeWidth={1} />
          {cells.map((c, i) => {
            const isSel = sel !== null && colorsEqual(c.key, sel);
            const isLoaded = colorsEqual(c.key, loaded);
            return (
              <path
                key={i}
                d={c.d}
                fill={colorToCss(c.key)}
                opacity={isSel ? 1 : 0.72}
                stroke={isSel ? '#ffffff' : isLoaded ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.6)'}
                strokeWidth={isSel ? 2.5 : 1}
                strokeDasharray={isLoaded && !isSel ? '4 3' : undefined}
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  game?.tapWheelCell(c.key);
                }}
              />
            );
          })}
          {/* center: selection readout */}
          <circle cx={CX} cy={CY} r={DEAD - 4} fill="#0c0d0e" stroke="#3a3c40" />
          <rect x={CX - 16} y={CY - 26} width={32} height={20}
            fill={sel ? colorToCss(sel) : '#333'} stroke="#000" strokeWidth={2} />
          <text x={CX} y={CY + 18} textAnchor="middle" fill="#c9cbce" fontSize={9} letterSpacing={1}>
            {sel ? colorName(sel) : ''}
          </text>
          {/* virtual cursor (desktop pointer-lock) */}
          <circle cx={cxp} cy={cyp} r={6} fill="none" stroke="#fff" strokeWidth={2} />
          <circle cx={cxp} cy={cyp} r={1.6} fill="#fff" />
          {/* loaded marker ring */}
          <circle cx={CX} cy={CY} r={OUT + 12} fill="none" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 6" />
        </svg>
        <div className="absolute -bottom-10 left-0 right-0 text-center text-[10px] tracking-[0.3em] text-neutral-400 hud-text">
          TIME DILATED — RELEASE [{game ? codeLabel(game.input.bindings.colorWheel) : 'TAB'}] TO LOAD
        </div>
      </div>
    </div>
  );
}
