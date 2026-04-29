/**
 * Order notification sounds using Web Audio API.
 * - Dine-in: "叮咚" (high then low tone)
 * - Takeout: "叮叮" (two same high tones)
 */

let audioCtx: AudioContext | null = null;
let unlocked = false;

/** Call this once on any user gesture to unlock audio */
export function unlockAudio() {
  if (unlocked) return;
  audioCtx = new AudioContext();
  // Play a silent buffer to fully unlock
  const buf = audioCtx.createBuffer(1, 1, 22050);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.start(0);
  unlocked = true;
}

function getCtx(): AudioContext | null {
  if (!audioCtx) return null;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(frequency: number, startTime: number, duration: number, ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.5, startTime);
  gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

/** 堂食: "叮咚" — high note then lower note */
export function playDineInSound() {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(880, now, 0.25, ctx);        // 叮 (A5 high)
  playTone(660, now + 0.25, 0.35, ctx); // 咚 (E5 lower)
}

/** 外卖: "叮叮" — two same high notes */
export function playTakeoutSound() {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(880, now, 0.2, ctx);        // 叮 (A5)
  playTone(880, now + 0.3, 0.2, ctx);  // 叮 (A5)
}
