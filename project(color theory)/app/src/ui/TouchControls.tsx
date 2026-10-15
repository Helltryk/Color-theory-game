import { useRef } from 'react';
import { game } from '../game/game';
import type { Action } from '../game/input';
import { useStore } from '../game/store';

export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function TouchControls() {
  useStore();
  if (!isTouch()) return null;
  return <TouchControlsInner />;
}

function TouchControlsInner() {
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });

  const onStickDown = (e: React.PointerEvent) => {
    stickId.current = e.pointerId;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onStickMove(e);
  };
  const onStickMove = (e: React.PointerEvent) => {
    if (stickId.current !== e.pointerId || !stickRef.current) return;
    const rect = stickRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = (e.clientX - cx) / (rect.width / 2);
    let dy = (e.clientY - cy) / (rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    if (game) {
      game.input.touchMove.x = dx;
      game.input.touchMove.y = dy;
    }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx * 32}px, ${dy * 32}px)`;
  };
  const onStickUp = (e: React.PointerEvent) => {
    if (stickId.current !== e.pointerId) return;
    stickId.current = null;
    if (game) { game.input.touchMove.x = 0; game.input.touchMove.y = 0; }
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
  };

  const onLookDown = (e: React.PointerEvent) => {
    lookId.current = e.pointerId;
    lookLast.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onLookMove = (e: React.PointerEvent) => {
    if (lookId.current !== e.pointerId || !game) return;
    game.input.lookDelta.x += (e.clientX - lookLast.current.x) * 2.4;
    game.input.lookDelta.y += (e.clientY - lookLast.current.y) * 2.4;
    lookLast.current = { x: e.clientX, y: e.clientY };
  };
  const onLookUp = (e: React.PointerEvent) => {
    if (lookId.current === e.pointerId) lookId.current = null;
  };

  const hold = (a: Action) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); game?.input.setTouchAction(a, true); game?.input.pressAction(a); },
    onPointerUp: () => game?.input.setTouchAction(a, false),
    onPointerCancel: () => game?.input.setTouchAction(a, false),
    onPointerLeave: () => game?.input.setTouchAction(a, false),
  });

  const tap = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); fn(); },
  });

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      {/* look area: right 55% */}
      <div
        className="absolute right-0 top-0 bottom-0 w-[55%] pointer-events-auto"
        style={{ touchAction: 'none' }}
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookUp}
      />

      {/* move stick: bottom-left */}
      <div
        ref={stickRef}
        className="absolute pointer-events-auto rounded-full border border-neutral-500/40 bg-neutral-900/30"
        style={{
          width: 120, height: 120,
          left: 'max(20px, env(safe-area-inset-left))',
          bottom: 'max(110px, calc(env(safe-area-inset-bottom) + 96px))',
          touchAction: 'none',
        }}
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
      >
        <div ref={knobRef} className="absolute left-1/2 top-1/2 -ml-6 -mt-6 w-12 h-12 rounded-full bg-neutral-400/50 border border-neutral-300/60" />
      </div>

      {/* right button cluster */}
      <div className="absolute pointer-events-none" style={{
        right: 'max(16px, env(safe-area-inset-right))',
        bottom: 'max(100px, calc(env(safe-area-inset-bottom) + 88px))',
      }}>
        <div className="flex flex-col items-end gap-3 pointer-events-none">
          <div className="flex gap-3 pointer-events-auto">
            <button className="touch-btn" {...tap(() => game?.toggleWheelTouch())}>WHEEL</button>
            <button className="touch-btn" {...tap(() => {
              const g = game;
              if (g) g.weapons.setWeapon(((g.weapons.weapon + 1) % 3) as 0 | 1 | 2);
            })}>WPN</button>
          </div>
          <div className="flex gap-3 pointer-events-auto items-end">
            <button className="touch-btn" {...hold('parry')}>PARRY</button>
            <button className="touch-btn" {...hold('slide')}>SLIDE</button>
          </div>
          <div className="flex gap-3 pointer-events-auto items-end">
            <button className="touch-btn" {...hold('dash')}>DASH</button>
            <button className="touch-btn" {...hold('jump')}>JUMP</button>
            <button className="touch-btn" style={{ width: 76, height: 76 }} {...hold('fire')}>FIRE</button>
          </div>
        </div>
      </div>
    </div>
  );
}
