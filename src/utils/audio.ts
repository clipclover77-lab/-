/**
 * Web Audio API Synthesizer for Retro Cyber Shogi Chimes and Tocks
 */

let audioCtx: AudioContext | null = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// 1. Traditional Shogi Wood Tock Sound
export function playPieceMoveSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    // Low woody thud
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(140, now);
    osc1.frequency.exponentialRampToValueAtTime(80, now + 0.08);
    
    gain1.gain.setValueAtTime(0.8, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    
    osc1.start(now);
    osc1.stop(now + 0.1);

    // Hard click overlay for wood-on-wood impact
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(800, now);
    osc2.frequency.exponentialRampToValueAtTime(300, now + 0.02);
    
    gain2.gain.setValueAtTime(0.4, now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.02);
    
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    
    osc2.start(now);
    osc2.stop(now + 0.03);
  } catch (e) {
    console.warn('Audio play failed', e);
  }
}

// 2. Capture Sound (Thud + Cyber Slide)
export function playCaptureSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    // Low wood block
    playPieceMoveSound();
    
    // Metallic capture slide (cyber)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(600, now + 0.15);
    
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.16);
  } catch (e) {
    // Ignore
  }
}

// 3. Promotion Sound (Magical upward chime)
export function playPromotionSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.05);
      
      gain.gain.setValueAtTime(0.12, now + idx * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.3);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now + idx * 0.05);
      osc.stop(now + idx * 0.05 + 0.35);
    });
  } catch (e) {
    // Ignore
  }
}

// 4. Power Charge Up Sound (Zippy sweep)
export function playChargeSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.35);
    
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.4);
  } catch (e) {
    // Ignore
  }
}

// 5. King Hack Trigger Wave Sound (Large matrix cyber attack boom)
export function playKingHackSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    // Sub bass drop
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(100, now);
    subOsc.frequency.exponentialRampToValueAtTime(40, now + 0.6);
    subGain.gain.setValueAtTime(0.35, now);
    subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.6);

    // Glitchy filter sweep (using noise-like oscillators)
    for (let i = 0; i < 5; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      const offset = i * 0.06;
      osc.type = 'sawtooth';
      
      // Cyber frequencies
      const startFreq = 440 + Math.random() * 600;
      osc.frequency.setValueAtTime(startFreq, now + offset);
      osc.frequency.linearRampToValueAtTime(startFreq / 3, now + offset + 0.3);
      
      gain.gain.setValueAtTime(0.08, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.3);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now + offset);
      osc.stop(now + offset + 0.32);
    }
  } catch (e) {
    // Ignore
  }
}

// 6. Check warning sound
export function playCheckAlarmSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    // Double beep
    [0, 0.15].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now + delay); // D5
      
      gain.gain.setValueAtTime(0.15, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.12);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now + delay);
      osc.stop(now + delay + 0.15);
    });
  } catch (e) {
    // Ignore
  }
}
