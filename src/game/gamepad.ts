// Lightweight gamepad poller (Xbox / standard mapping). Polled once per frame from
// a scene's update(). Exposes a deadzoned movement axis (stick + d-pad merged) plus
// per-button EDGES (true only on the frame a button is first pressed) and per-frame
// directional edges for menu navigation. No Phaser gamepad plugin required — we read
// navigator.getGamepads() directly, consistent with the action battle's raw input.
const DZ = 0.35;

export interface PadFrame {
  connected: boolean;
  mx: number; my: number;                       // held movement axis (-1..1)
  A: boolean; B: boolean; X: boolean; Y: boolean;
  LB: boolean; RB: boolean; LT: boolean; RT: boolean;
  start: boolean; back: boolean;
  up: boolean; down: boolean; left: boolean; right: boolean;   // directional edges (menus)
}

const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, back: 8, start: 9, dUp: 12, dDown: 13, dLeft: 14, dRight: 15 };

// Browsers only expose a gamepad to navigator.getGamepads() AFTER the page receives
// a button press from it (a security gate). Log the connect/disconnect so it's obvious
// in the console whether the browser has seen the controller.
if (typeof window !== 'undefined') {
  window.addEventListener('gamepadconnected', e => console.log('[gamepad] connected:', (e as GamepadEvent).gamepad.id, '— press any face button to wake it if input lags'));
  window.addEventListener('gamepaddisconnected', () => console.log('[gamepad] disconnected'));
}

function empty(): PadFrame {
  return { connected: false, mx: 0, my: 0, A: false, B: false, X: false, Y: false, LB: false, RB: false, LT: false, RT: false, start: false, back: false, up: false, down: false, left: false, right: false };
}

export class GamepadPoller {
  private prev: boolean[] = [];
  private prevDir = { up: false, down: false, left: false, right: false };

  poll(): PadFrame {
    const out = empty();
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    for (const p of pads) { if (p) { gp = p; break; } }
    if (!gp) { this.prev = []; this.prevDir = { up: false, down: false, left: false, right: false }; return out; }
    out.connected = true;
    const pressed = (i: number) => { const b = gp!.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };
    const edge = (i: number) => { const now = pressed(i); const was = this.prev[i]; this.prev[i] = now; return now && !was; };

    let mx = Math.abs(gp.axes[0] || 0) > DZ ? gp.axes[0] : 0;
    let my = Math.abs(gp.axes[1] || 0) > DZ ? gp.axes[1] : 0;
    if (pressed(BTN.dLeft)) mx = -1; if (pressed(BTN.dRight)) mx = 1;
    if (pressed(BTN.dUp)) my = -1; if (pressed(BTN.dDown)) my = 1;
    out.mx = mx; out.my = my;

    out.A = edge(BTN.A); out.B = edge(BTN.B); out.X = edge(BTN.X); out.Y = edge(BTN.Y);
    out.LB = edge(BTN.LB); out.RB = edge(BTN.RB); out.LT = edge(BTN.LT); out.RT = edge(BTN.RT);
    out.start = edge(BTN.start); out.back = edge(BTN.back);

    // directional edges (stick OR d-pad), debounced so a held direction fires once per press
    const dl = mx < -0.5, dr = mx > 0.5, du = my < -0.5, dd = my > 0.5;
    out.left = dl && !this.prevDir.left; out.right = dr && !this.prevDir.right;
    out.up = du && !this.prevDir.up; out.down = dd && !this.prevDir.down;
    this.prevDir = { up: du, down: dd, left: dl, right: dr };
    return out;
  }
}
