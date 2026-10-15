// Rebindable input manager. Keyboard via KeyboardEvent.code, mouse buttons as "Mouse0/1/2".
export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'dash' | 'slide' | 'parry'
  | 'fire' | 'weapon1' | 'weapon2' | 'weapon3'
  | 'colorWheel' | 'pause';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move Forward',
  back: 'Move Back',
  left: 'Strafe Left',
  right: 'Strafe Right',
  jump: 'Jump',
  dash: 'Dash',
  slide: 'Slide / Slam',
  parry: 'Parry',
  fire: 'Fire',
  weapon1: 'Weapon: Assault Rifle',
  weapon2: 'Weapon: Shotgun',
  weapon3: 'Weapon: Sniper',
  colorWheel: 'Color Wheel (hold)',
  pause: 'Pause',
};

export const DEFAULT_BINDINGS: Record<Action, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  dash: 'ShiftLeft',
  slide: 'KeyC',
  parry: 'KeyE',
  fire: 'Mouse0',
  weapon1: 'Digit1',
  weapon2: 'Digit2',
  weapon3: 'Digit3',
  colorWheel: 'Tab',
  pause: 'Escape',
};

const STORAGE_KEY = 'grayscale.bindings.v1';

export class InputManager {
  bindings: Record<Action, string> = { ...DEFAULT_BINDINGS };
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private virtualPressed = new Set<Action>();
  // touch-driven virtual state
  touchActions = new Set<Action>();
  touchMove = { x: 0, y: 0 }; // -1..1
  lookDelta = { x: 0, y: 0 }; // accumulated mouse/touch look
  wheelCursor = { x: 0, y: 0 }; // virtual cursor while color wheel is open
  enabled = false;

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<Action, string>>;
        for (const k of Object.keys(DEFAULT_BINDINGS) as Action[]) {
          if (typeof parsed[k] === 'string') this.bindings[k] = parsed[k]!;
        }
      }
    } catch { /* ignore */ }
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings)); } catch { /* ignore */ }
  }

  resetDefaults() {
    this.bindings = { ...DEFAULT_BINDINGS };
    this.save();
  }

  rebind(action: Action, code: string) {
    // remove duplicate: if another action uses this code, swap
    for (const k of Object.keys(this.bindings) as Action[]) {
      if (this.bindings[k] === code && k !== action) this.bindings[k] = '';
    }
    this.bindings[action] = code;
    this.save();
  }

  attach(el: HTMLElement) {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      if (e.code === 'Tab') e.preventDefault();
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.down.delete(e.code);
      if (e.code === 'Tab') e.preventDefault();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!this.enabled) return;
      const code = `Mouse${e.button}`;
      if (!this.down.has(code)) this.pressedThisFrame.add(code);
      this.down.add(code);
    };
    const onMouseUp = (e: MouseEvent) => this.down.delete(`Mouse${e.button}`);
    const onMouseMove = (e: MouseEvent) => {
      if (!this.enabled) return;
      this.lookDelta.x += e.movementX;
      this.lookDelta.y += e.movementY;
    };
    const onBlur = () => { this.down.clear(); this.touchActions.clear(); };
    const onCtx = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', onBlur);
    el.addEventListener('contextmenu', onCtx);
    this.detach = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('blur', onBlur);
      el.removeEventListener('contextmenu', onCtx);
    };
  }

  detach = () => {};

  isDown(action: Action): boolean {
    if (this.touchActions.has(action)) return true;
    const code = this.bindings[action];
    return code !== '' && this.down.has(code);
  }

  wasPressed(action: Action): boolean {
    if (this.virtualPressed.has(action)) return true;
    const code = this.bindings[action];
    return code !== '' && this.pressedThisFrame.has(code);
  }

  // touch: one-shot press (jump/dash/parry) and hold helpers
  pressAction(action: Action) {
    this.virtualPressed.add(action);
  }

  setTouchAction(action: Action, down: boolean) {
    if (down) this.touchActions.add(action);
    else this.touchActions.delete(action);
  }

  // movement vector from keys, merged with touch stick
  moveVec(): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.isDown('forward')) y -= 1;
    if (this.isDown('back')) y += 1;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('right')) x += 1;
    x += this.touchMove.x;
    y += this.touchMove.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  consumeLook(): { x: number; y: number } {
    const r = { x: this.lookDelta.x, y: this.lookDelta.y };
    this.lookDelta.x = 0; this.lookDelta.y = 0;
    return r;
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.virtualPressed.clear();
  }
}

export function codeLabel(code: string): string {
  if (code === '') return '—';
  if (code.startsWith('Mouse')) return ['LMB', 'MMB', 'RMB', 'MB4', 'MB5'][Number(code.slice(5))] ?? code;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace('ShiftLeft', 'L-Shift').replace('ShiftRight', 'R-Shift')
    .replace('ControlLeft', 'L-Ctrl').replace('ControlRight', 'R-Ctrl')
    .replace('Arrow', '');
}
