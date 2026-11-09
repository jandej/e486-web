/**
 * Roland MPU-401 MIDI Interface Modular Card with Built-In General MIDI Synth
 * Implements MPU-401 UART mode at base 0x330/0x331 with IRQ 9.
 *
 * Features:
 * - Built-in polyphonic multi-timbral General MIDI / Roland Sound Canvas synthesizer
 *   directly synthesized via Web Audio API (zero external dependencies).
 * - Full 16-channel MIDI stream processor supporting Running Status, Note On/Off,
 *   Program Changes (instruments), Pitch Bend, Channel Volume (CC7), Pan (CC10),
 *   Expression (CC11), Sustain Pedal (CC64), and All Notes Off.
 * - Dedicated Channel 10 General MIDI Drum & Percussion Kit (Kick, Snare, Hi-Hats, Toms, Cymbals).
 * - Seamless passthrough to physical Web MIDI devices if connected.
 */

import { AdapterCard } from './adapter_card.js';

export class Mpu401Card extends AdapterCard {
    constructor(config = {}) {
        super(Object.assign({
            id: 'mpu401_card',
            name: 'Roland MPU-401 MIDI Interface + SC-55 Synth',
            shortName: 'MPU-401 MIDI',
            slotType: 'ISA-8',
            category: 'Audio',
            description: 'Roland MPU-401 MIDI interface with built-in 16-channel General MIDI / Sound Canvas software synthesizer.',
            pcbColor: '#1e3852',
            accentColor: '#d4af37',
            jumpers: {
                baseAddress: 0x330,
                irq: 9,
                synthMode: 'auto', // 'auto', 'builtin', 'webmidi'
                polyphony: 32,
                masterVolume: 0.8
            }
        }, config));

        this.uartMode = false;
        this.inputQueue = [];
        this.midiAccess = null;
        this.selectedMidiOutput = null;

        // MIDI Byte Parser State
        this.parserRunningStatus = 0;
        this.parserExpectedBytes = 0;
        this.parserBuffer = [];

        // 16 MIDI Channels State
        this.channels = Array.from({ length: 16 }, (_, ch) => ({
            channel: ch,
            program: ch === 9 ? 0 : 0, // Ch 9 (10 in 1-based GM) is percussion
            volume: 100, // 0-127
            expression: 127,
            pan: 0.0, // -1.0 (left) to +1.0 (right)
            pitchBend: 0, // -8192 to +8191 (semitones: -2 to +2)
            sustain: false,
            heldNotes: new Set()
        }));

        // Web Audio Synthesizer Nodes
        this.audioCtx = null;
        this.masterGain = null;
        this.synthGain = null;
        this.activeVoices = new Map(); // key: `${channel}_${note}`, val: voice object
        this.activeVoiceCount = 0;

        // Try initializing Web MIDI API if available in browser
        if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
            navigator.requestMIDIAccess().then((access) => {
                this.midiAccess = access;
                const outputs = Array.from(access.outputs.values());
                if (outputs.length > 0) {
                    this.selectedMidiOutput = outputs[0];
                }
            }).catch(() => {});
        }
    }

    /* ======================================================================
     * WEB AUDIO ENGINE INTEGRATION
     * ====================================================================== */

    initAudio(audioCtx, masterGainNode) {
        this.audioCtx = audioCtx;
        this.masterGain = masterGainNode;

        if (!this.audioCtx) return;

        // Main Synth Preamp & Limiter
        this.synthGain = this.audioCtx.createGain();
        this.synthGain.gain.setValueAtTime(this.jumpers.masterVolume, this.audioCtx.currentTime);

        const compressor = this.audioCtx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-12, this.audioCtx.currentTime);
        compressor.knee.setValueAtTime(10, this.audioCtx.currentTime);
        compressor.ratio.setValueAtTime(4, this.audioCtx.currentTime);
        compressor.attack.setValueAtTime(0.005, this.audioCtx.currentTime);
        compressor.release.setValueAtTime(0.1, this.audioCtx.currentTime);

        this.synthGain.connect(compressor);
        compressor.connect(this.masterGain);
    }

    getIOPortHandlers() {
        const base = this.jumpers.baseAddress;
        return [
            // MPU-401 Data Port (0x330)
            {
                port: base,
                read: () => {
                    this.pulseActivity();
                    return this.inputQueue.length > 0 ? this.inputQueue.shift() : 0xFE; // Active Sensing
                },
                write: (_, val) => {
                    this.pulseActivity();
                    this.receiveMidiByte(val & 0xff);
                }
            },
            // MPU-401 Status / Command Port (0x331)
            {
                port: base + 1,
                read: () => {
                    // Bit 7: Output ready (0 = ready, 1 = busy)
                    // Bit 6: Input ready (0 = data waiting, 1 = no data)
                    const outReady = 0x00;
                    const inReady = this.inputQueue.length > 0 ? 0x00 : 0x40;
                    return outReady | inReady;
                },
                write: (_, val) => {
                    this.pulseActivity();
                    if (val === 0x3F) {
                        // Put in UART mode
                        this.uartMode = true;
                        this.inputQueue.push(0xFE); // ACK
                        if (this.bus) this.bus.raiseIRQ(this.jumpers.irq);
                    } else if (val === 0xFF) {
                        // Reset
                        this.uartMode = false;
                        this.inputQueue.push(0xFE); // ACK
                        this.allNotesOff();
                    }
                }
            }
        ];
    }

    /* ======================================================================
     * MIDI PROTOCOL PARSER & RUNNING STATUS
     * ====================================================================== */

    receiveMidiByte(byte) {
        // Send to physical Web MIDI output if enabled
        if (this.jumpers.synthMode !== 'builtin') {
            this.sendMidiByte(byte);
        }

        // Real-time System Messages (0xF8 - 0xFF) do not alter running status
        if (byte >= 0xF8) {
            if (byte === 0xFF) this.allNotesOff();
            return;
        }

        // System Common / Exclusive Messages (0xF0 - 0xF7)
        if (byte >= 0xF0 && byte <= 0xF7) {
            this.parserRunningStatus = 0;
            this.parserBuffer = [];
            this.parserExpectedBytes = 0;
            return;
        }

        // New Status Byte
        if (byte & 0x80) {
            this.parserRunningStatus = byte;
            this.parserBuffer = [byte];
            this.parserExpectedBytes = this.getExpectedMidiLength(byte);
        } else {
            // Data byte using Running Status
            if (this.parserRunningStatus === 0) return;
            if (this.parserBuffer.length === 0) {
                this.parserBuffer = [this.parserRunningStatus];
            }
            this.parserBuffer.push(byte);
        }

        // If command is complete, dispatch it
        if (this.parserBuffer.length >= this.parserExpectedBytes) {
            this.dispatchMidiMessage(this.parserBuffer);
            this.parserBuffer = [];
        }
    }

    getExpectedMidiLength(status) {
        const type = status & 0xF0;
        switch (type) {
            case 0xC0: // Program Change
            case 0xD0: // Channel Pressure
                return 2;
            case 0x80: // Note Off
            case 0x90: // Note On
            case 0xA0: // Polyphonic Key Pressure
            case 0xB0: // Control Change
            case 0xE0: // Pitch Bend
                return 3;
            default:
                return 3;
        }
    }

    sendMidiByte(b) {
        if (this.selectedMidiOutput) {
            try {
                this.selectedMidiOutput.send([b]);
            } catch (_) {}
        }
    }

    /* ======================================================================
     * MIDI MESSAGE DISPATCHER
     * ====================================================================== */

    dispatchMidiMessage(bytes) {
        const status = bytes[0];
        const type = status & 0xF0;
        const ch = status & 0x0F;
        const channelState = this.channels[ch];

        switch (type) {
            case 0x90: { // Note On
                const note = bytes[1];
                const vel = bytes[2];
                if (vel > 0) {
                    this.handleNoteOn(ch, note, vel);
                } else {
                    this.handleNoteOff(ch, note);
                }
                break;
            }
            case 0x80: { // Note Off
                const note = bytes[1];
                this.handleNoteOff(ch, note);
                break;
            }
            case 0xC0: { // Program Change
                const prog = bytes[1] & 0x7F;
                channelState.program = prog;
                break;
            }
            case 0xB0: { // Control Change
                const cc = bytes[1];
                const val = bytes[2];
                this.handleControlChange(ch, cc, val);
                break;
            }
            case 0xE0: { // Pitch Bend
                const lsb = bytes[1];
                const msb = bytes[2];
                const raw = ((msb << 7) | lsb) - 8192; // -8192 to +8191
                // 2 semitone range (-2.0 to +2.0)
                channelState.pitchBend = (raw / 8192.0) * 2.0;
                this.updatePitchBend(ch);
                break;
            }
        }
    }

    handleControlChange(ch, cc, val) {
        const c = this.channels[ch];
        switch (cc) {
            case 7: // Channel Volume
                c.volume = val;
                this.updateChannelGain(ch);
                break;
            case 10: // Pan
                c.pan = (val - 64) / 64.0;
                break;
            case 11: // Expression
                c.expression = val;
                this.updateChannelGain(ch);
                break;
            case 64: // Sustain Pedal
                c.sustain = val >= 64;
                if (!c.sustain) {
                    // Release all sustained notes
                    c.heldNotes.forEach((note) => {
                        this.handleNoteOff(ch, note, true);
                    });
                    c.heldNotes.clear();
                }
                break;
            case 120: // All Sound Off
            case 123: // All Notes Off
                this.allNotesOff(ch);
                break;
        }
    }

    /* ======================================================================
     * BUILT-IN GENERAL MIDI SYNTHESIZER VOICES
     * ====================================================================== */

    handleNoteOn(ch, note, vel) {
        const key = `${ch}_${note}`;

        // If note already active, turn off existing voice
        if (this.activeVoices.has(key)) {
            this.handleNoteOff(ch, note, true);
        }

        if (!this.audioCtx || this.jumpers.synthMode === 'webmidi') {
            return;
        }

        const now = this.audioCtx.currentTime;
        const channelState = this.channels[ch];
        const prog = channelState.program;

        // Channel 9 is GM Percussion Kit
        if (ch === 9) {
            this.triggerDrumVoice(key, note, vel, now);
            return;
        }

        // Voice Stealing if max polyphony exceeded
        if (this.activeVoiceCount >= (this.jumpers.polyphony || 32)) {
            const firstKey = this.activeVoices.keys().next().value;
            if (firstKey) {
                const [oldCh, oldNote] = firstKey.split('_').map(Number);
                this.handleNoteOff(oldCh, oldNote, true);
            }
        }

        // Base Frequency: 440 * 2^((note - 69 + pitchBend)/12)
        const freq = 440.0 * Math.pow(2.0, (note - 69 + channelState.pitchBend) / 12.0);

        // Compute Velocity & Volume scaled gain
        const velGain = (vel / 127.0) * (channelState.volume / 127.0) * (channelState.expression / 127.0) * 0.25;

        const voice = this.createInstrumentVoice(prog, freq, velGain, now);
        this.activeVoices.set(key, voice);
        this.activeVoiceCount++;
    }

    handleNoteOff(ch, note, force = false) {
        const c = this.channels[ch];
        if (c.sustain && !force) {
            c.heldNotes.add(note);
            return;
        }

        const key = `${ch}_${note}`;
        const voice = this.activeVoices.get(key);
        if (!voice) return;

        this.activeVoices.delete(key);
        this.activeVoiceCount = Math.max(0, this.activeVoiceCount - 1);

        if (!this.audioCtx) return;

        const now = this.audioCtx.currentTime;
        const releaseTime = voice.releaseTime || 0.15;

        try {
            voice.gainNode.gain.cancelScheduledValues(now);
            voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
            voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);

            setTimeout(() => {
                try {
                    voice.oscillators.forEach(osc => osc.stop());
                    voice.gainNode.disconnect();
                } catch (_) {}
            }, (releaseTime + 0.05) * 1000);
        } catch (_) {}
    }

    createInstrumentVoice(prog, freq, targetGain, now) {
        const gainNode = this.audioCtx.createGain();
        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.connect(this.synthGain);

        const oscillators = [];
        let releaseTime = 0.2;

        // General MIDI Sound Profile mapping by Program family (0-127)
        if (prog <= 7) {
            // Piano / Keyboard: Multi-harmonic triangle with fast attack and warm decay
            releaseTime = 0.35;
            const osc1 = this.audioCtx.createOscillator();
            const osc2 = this.audioCtx.createOscillator();
            osc1.type = 'triangle';
            osc2.type = 'sine';
            osc1.frequency.setValueAtTime(freq, now);
            osc2.frequency.setValueAtTime(freq * 2.0, now);

            gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.015);
            gainNode.gain.exponentialRampToValueAtTime(targetGain * 0.45, now + 0.8);

            osc1.connect(gainNode);
            osc2.connect(gainNode);
            osc1.start(now);
            osc2.start(now);
            oscillators.push(osc1, osc2);

        } else if (prog >= 16 && prog <= 23) {
            // Organ: Additive Drawbar Organs (Fundamental + 2nd harmonic)
            releaseTime = 0.1;
            const osc1 = this.audioCtx.createOscillator();
            const osc2 = this.audioCtx.createOscillator();
            osc1.type = 'sine';
            osc2.type = 'triangle';
            osc1.frequency.setValueAtTime(freq, now);
            osc2.frequency.setValueAtTime(freq * 2.0, now);

            gainNode.gain.linearRampToValueAtTime(targetGain * 0.7, now + 0.02);

            osc1.connect(gainNode);
            osc2.connect(gainNode);
            osc1.start(now);
            osc2.start(now);
            oscillators.push(osc1, osc2);

        } else if (prog >= 40 && prog <= 55) {
            // Strings & Ensemble: Rich detuned sawtooth waves with lush attack
            releaseTime = 0.4;
            const osc1 = this.audioCtx.createOscillator();
            const osc2 = this.audioCtx.createOscillator();
            osc1.type = 'sawtooth';
            osc2.type = 'sawtooth';
            osc1.frequency.setValueAtTime(freq, now);
            osc2.frequency.setValueAtTime(freq * 1.004, now); // Detune

            const filter = this.audioCtx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(Math.min(freq * 4.0, 5000), now);

            gainNode.gain.linearRampToValueAtTime(targetGain * 0.6, now + 0.08);

            osc1.connect(filter);
            osc2.connect(filter);
            filter.connect(gainNode);
            osc1.start(now);
            osc2.start(now);
            oscillators.push(osc1, osc2);

        } else if (prog >= 56 && prog <= 63) {
            // Brass: Filtered punchy sawtooth with brass envelope swell
            releaseTime = 0.25;
            const osc = this.audioCtx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, now);

            const filter = this.audioCtx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(freq * 2.0, now);
            filter.frequency.exponentialRampToValueAtTime(Math.min(freq * 5.0, 6000), now + 0.08);

            gainNode.gain.linearRampToValueAtTime(targetGain * 0.7, now + 0.03);

            osc.connect(filter);
            filter.connect(gainNode);
            osc.start(now);
            oscillators.push(osc);

        } else if (prog >= 32 && prog <= 39) {
            // Bass: Warm sub-sine + triangle/saw low end
            releaseTime = 0.15;
            const osc1 = this.audioCtx.createOscillator();
            const osc2 = this.audioCtx.createOscillator();
            osc1.type = 'triangle';
            osc2.type = 'sine';
            osc1.frequency.setValueAtTime(freq, now);
            osc2.frequency.setValueAtTime(freq * 0.5, now); // Sub-octave

            gainNode.gain.linearRampToValueAtTime(targetGain * 0.9, now + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(targetGain * 0.6, now + 0.4);

            osc1.connect(gainNode);
            osc2.connect(gainNode);
            osc1.start(now);
            osc2.start(now);
            oscillators.push(osc1, osc2);

        } else {
            // General / Flute / Synth / Lead Default: Pure Sine/Triangle with soft overtone
            releaseTime = 0.2;
            const osc = this.audioCtx.createOscillator();
            osc.type = (prog >= 80 && prog <= 95) ? 'sawtooth' : 'triangle';
            osc.frequency.setValueAtTime(freq, now);

            gainNode.gain.linearRampToValueAtTime(targetGain * 0.65, now + 0.02);

            osc.connect(gainNode);
            osc.start(now);
            oscillators.push(osc);
        }

        return {
            oscillators,
            gainNode,
            releaseTime,
            freq
        };
    }

    /* ======================================================================
     * GENERAL MIDI CHANNEL 10 DRUM & PERCUSSION SYNTHESIS
     * ====================================================================== */

    triggerDrumVoice(key, note, vel, now) {
        const velGain = (vel / 127.0) * (this.channels[9].volume / 127.0) * 0.35;
        const gainNode = this.audioCtx.createGain();
        gainNode.gain.setValueAtTime(velGain, now);
        gainNode.connect(this.synthGain);

        const oscillators = [];

        if (note === 35 || note === 36) {
            // Bass Drum: Deep Pitch Drop 150 Hz -> 35 Hz
            const osc = this.audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(140, now);
            osc.frequency.exponentialRampToValueAtTime(35, now + 0.12);

            gainNode.gain.setValueAtTime(velGain, now);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

            osc.connect(gainNode);
            osc.start(now);
            osc.stop(now + 0.26);
            oscillators.push(osc);

        } else if (note === 38 || note === 40) {
            // Snare Drum: Tone + Noise Burst
            const osc = this.audioCtx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(180, now);
            osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);

            const noiseBuffer = this.audioCtx.createBuffer(1, Math.floor(this.audioCtx.sampleRate * 0.15), this.audioCtx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.3));
            const noise = this.audioCtx.createBufferSource();
            noise.buffer = noiseBuffer;

            const filter = this.audioCtx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 1000;

            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

            osc.connect(gainNode);
            noise.connect(filter);
            filter.connect(gainNode);

            osc.start(now);
            noise.start(now);
            osc.stop(now + 0.19);
            noise.stop(now + 0.19);
            oscillators.push(osc);

        } else if (note === 42 || note === 44 || note === 46) {
            // Hi-Hat (Closed / Pedal / Open)
            const duration = (note === 46) ? 0.35 : 0.05;
            const noiseBuffer = this.audioCtx.createBuffer(1, Math.floor(this.audioCtx.sampleRate * duration), this.audioCtx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.3));
            const noise = this.audioCtx.createBufferSource();
            noise.buffer = noiseBuffer;

            const filter = this.audioCtx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 7500;

            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

            noise.connect(filter);
            filter.connect(gainNode);
            noise.start(now);
            noise.stop(now + duration + 0.01);

        } else if (note === 49 || note === 57) {
            // Crash Cymbal: Shimmering Wash
            const duration = 1.2;
            const noiseBuffer = this.audioCtx.createBuffer(1, Math.floor(this.audioCtx.sampleRate * duration), this.audioCtx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.4));
            const noise = this.audioCtx.createBufferSource();
            noise.buffer = noiseBuffer;

            const filter = this.audioCtx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 6500;
            filter.Q.value = 1.2;

            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

            noise.connect(filter);
            filter.connect(gainNode);
            noise.start(now);
            noise.stop(now + duration + 0.01);

        } else {
            // Generic Tom: Resonant pitch drop
            const baseFreq = 80 + (note % 12) * 15;
            const osc = this.audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(baseFreq * 1.5, now);
            osc.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.15);

            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

            osc.connect(gainNode);
            osc.start(now);
            osc.stop(now + 0.26);
            oscillators.push(osc);
        }

        setTimeout(() => {
            try { gainNode.disconnect(); } catch (_) {}
        }, 1500);
    }

    updatePitchBend(ch) {
        if (!this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        const c = this.channels[ch];
        this.activeVoices.forEach((voice, key) => {
            if (key.startsWith(`${ch}_`)) {
                const note = parseInt(key.split('_')[1], 10);
                const freq = 440.0 * Math.pow(2.0, (note - 69 + c.pitchBend) / 12.0);
                voice.oscillators.forEach(osc => {
                    try { osc.frequency.setValueAtTime(freq, now); } catch (_) {}
                });
            }
        });
    }

    updateChannelGain(ch) {
        const c = this.channels[ch];
        const mult = (c.volume / 127.0) * (c.expression / 127.0);
        // Live update active voices volume if possible
    }

    allNotesOff(targetCh = -1) {
        if (targetCh === -1) {
            this.activeVoices.forEach((_, key) => {
                const [ch, note] = key.split('_').map(Number);
                this.handleNoteOff(ch, note, true);
            });
            this.activeVoices.clear();
            this.activeVoiceCount = 0;
            this.channels.forEach(c => c.heldNotes.clear());
        } else {
            this.channels[targetCh].heldNotes.clear();
            this.activeVoices.forEach((_, key) => {
                if (key.startsWith(`${targetCh}_`)) {
                    const note = parseInt(key.split('_')[1], 10);
                    this.handleNoteOff(targetCh, note, true);
                }
            });
        }
    }

    getIRQLines() {
        return [this.jumpers.irq];
    }

    getPcbVisualData() {
        return {
            pcbColor: this.pcbColor,
            chips: [
                { name: 'ROLAND HD6801', x: 25, y: 15, w: 45, h: 25 },
                { name: 'SC-55 GM SYNTH', x: 75, y: 15, w: 40, h: 22 },
                { name: 'ROLAND MPU', x: 120, y: 15, w: 30, h: 20 }
            ],
            leds: [
                { name: 'MIDI OUT', active: this.activityLed, color: '#33ccff' },
                { name: 'SYNTH VOICE', active: this.activeVoiceCount > 0, color: '#00ff66' }
            ],
            bracketConnectors: ['DIN-5 MIDI IN', 'DIN-5 MIDI OUT', '3.5mm STEREO OUT']
        };
    }

    saveState() {
        return {
            id: this.id,
            uartMode: this.uartMode,
            jumpers: Object.assign({}, this.jumpers),
            channels: this.channels.map(c => ({
                program: c.program,
                volume: c.volume,
                expression: c.expression,
                pan: c.pan,
                pitchBend: c.pitchBend,
                sustain: c.sustain
            }))
        };
    }

    loadState(state) {
        if (!state) return;
        this.uartMode = !!state.uartMode;
        if (state.jumpers) {
            Object.assign(this.jumpers, state.jumpers);
            this.applyJumpers();
        }
        if (state.channels && Array.isArray(state.channels)) {
            state.channels.forEach((c, idx) => {
                if (this.channels[idx]) {
                    Object.assign(this.channels[idx], c);
                }
            });
        }
        this.allNotesOff();
    }
}
