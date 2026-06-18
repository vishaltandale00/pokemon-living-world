// Deterministic, serializable RNG for the WORLD-SIM layer.
//
// Determinism is a property of the world simulation (kernel ticks, accretion,
// rules, structural ops, Director, store mutations, encounter selection): the
// same seed + the same actions must produce a byte-identical save, and a
// half-grown world must reload identically. The real-time action battle is
// explicitly EXCLUDED — it is reflex/frame-driven and keeps using Math.random;
// the sim only consumes its deterministic OUTCOME (see world/battleOutcome.ts).
//
// Design: NAMED streams with per-stream cursors. Each draw is a pure function of
// (seed, streamName, cursor), so:
//   - streams are independent — a skipped/conditional draw in one stream can
//     never desync another stream's sequence (the decoupling the kernel needs);
//   - the full RNG state is just `seed` + a `Record<stream, cursor>` of plain
//     numbers, which JSON round-trips exactly (no Set/Map, no Date.now).
// Stream-key convention: use a stable name, and for per-entity ops suffix the
// entity id (e.g. `place:loc_warehouse`) so two entities never share a stream.

// hash a stream name to a 32-bit int (djb2-xor variant).
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) | 0;
  return h | 0;
}

// splitmix32 finalizer — strong avalanche, fully deterministic from a 32-bit key.
function splitmix32(a: number): number {
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  t = t ^ (t >>> 15);
  return (t >>> 0) / 4294967296;
}

// One unit draw in [0,1) from (seed, stream, cursor). Pure — no state mutation.
export function drawUnit(seed: number, stream: string, cursor: number): number {
  const key =
    (Math.imul(hashStr(stream), 0x9e3779b1) ^
      Math.imul(seed | 0, 0x85ebca77) ^
      Math.imul((cursor + 1) | 0, 0xc2b2ae3d)) | 0;
  return splitmix32(key);
}

// The serializable RNG state carried in WorldState.
export interface RngState {
  seed: number;
  cursors: Record<string, number>;
}

// Advance a stream by one and return its next unit draw. Mutates `cursors`.
export function nextUnit(rng: RngState, stream: string): number {
  const c = rng.cursors[stream] ?? 0;
  rng.cursors[stream] = c + 1;
  return drawUnit(rng.seed, stream, c);
}
