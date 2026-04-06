let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function playTones(tones: Array<{ freq: number; duration: number }>) {
  const ctx = getCtx();
  let startTime = ctx.currentTime;

  for (const { freq, duration } of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration);
    startTime += duration;
  }
}

export function playApproveSound() {
  playTones([
    { freq: 523.25, duration: 0.08 }, // C5
    { freq: 659.25, duration: 0.12 }, // E5
  ]);
}

export function playDenySound() {
  playTones([
    { freq: 329.63, duration: 0.08 }, // E4
    { freq: 261.63, duration: 0.12 }, // C4
  ]);
}

export function playCompleteSound() {
  playTones([
    { freq: 523.25, duration: 0.06 }, // C5
    { freq: 659.25, duration: 0.06 }, // E5
    { freq: 783.99, duration: 0.1 }, // G5
  ]);
}

export function playAlertSound() {
  playTones([
    { freq: 880, duration: 0.08 }, // A5
    { freq: 0, duration: 0.06 }, // pause
    { freq: 880, duration: 0.08 }, // A5
  ]);
}
