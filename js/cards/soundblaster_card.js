/**
 * Creative SoundBlaster 16 Modular Card
 * Features DSP 4.05 emulation, 8-bit/16-bit PCM streaming, SoundBlaster Mixer,
 * and Yamaha YM3812 / OPL2 AdLib FM synthesis directly rendered via Web Audio API.
 */

import { AdapterCard } from './adapter_card.js';

export class SoundBlasterCard extends AdapterCard {
    constructor(config = {}) {
        super(Object.assign({
            id: 'soundblaster_card',
            name: 'Creative SoundBlaster 16',
            shortName: 'SB16 OPL3',
            slotType: 'ISA-16',
            category: 'Audio',
            description: 'Industry-standard 16-bit SoundBlaster audio card with Yamaha OPL2/OPL3 FM music synthesis.',
            pcbColor: '#1a3c5a', // Dark blue PCB
            accentColor: '#d4af37',
            jumpers: {
                baseAddress: 0x220, // 0x220, 0x240, 0x260, 0x280
                irq: 5,             // IRQ 5 or 7
                dma8: 1,            // DMA 1
                dma16: 5            // DMA 5
            }
        }, config));

        // DSP State
        this.dspReset = 0;
        this.dspReadBuffer = [];
        this.dspWriteCmd = 0;
        this.dspWriteState = 0;
        this.dspSampleRate = 22050;
        this.dspBlockSize = 0;
        this.dspSpeakerOn = true;

        // Mixer Registers
        this.mixerIndex = 0;
        this.mixerRegs = new Uint8Array(256);
        this.mixerRegs[0x04] = 0xee; // Voice volume L/R max
        this.mixerRegs[0x22] = 0xee; // Master volume L/R max
        this.mixerRegs[0x26] = 0xee; // FM volume L/R max

        // OPL2 / AdLib Synthesizer State (ports 0x388 / 0x389)
        this.oplIndex = 0;
        this.oplRegs = new Uint8Array(256);
        this.oplChannels = new Array(9).fill(null).map(() => ({
            fnum: 0,
            block: 0,
            keyOn: false,
            freq: 0,
            osc: null,
            gain: null
        }));

        // Web Audio nodes
        this.audioCtx = null;
        this.masterGain = null;
        this.pcmBuffer = [];
    }

    getIOPortHandlers() {
        const base = this.jumpers.baseAddress;
        return [
            // SoundBlaster Mixer (0x224 / 0x225)
            { port: base + 0x04, read: () => this.mixerIndex, write: (_, val) => { this.mixerIndex = val & 0xff; } },
            { port: base + 0x05, read: () => this.mixerRegs[this.mixerIndex], write: (_, val) => { this.mixerRegs[this.mixerIndex] = val & 0xff; } },

            // DSP Reset (0x226)
            {
                port: base + 0x06,
                read: () => 0x00,
                write: (_, val) => {
                    if (val === 1) {
                        this.dspReset = 1;
                    } else if (this.dspReset === 1 && val === 0) {
                        this.dspReset = 0;
                        this.dspReadBuffer = [0xAA]; // DSP Ready signature
                        this.pulseActivity();
                    }
                }
            },

            // DSP Read Data (0x22A)
            {
                port: base + 0x0A,
                read: () => {
                    this.pulseActivity();
                    return this.dspReadBuffer.length > 0 ? this.dspReadBuffer.shift() : 0xff;
                },
                write: () => {}
            },

            // DSP Write Command / Buffer Status (0x22C)
            {
                port: base + 0x0C,
                read: () => 0x00, // Ready for write (bit 7 = 0)
                write: (_, val) => this.writeDspCommand(val)
            },

            // DSP Read Buffer Status / IRQ Ack (0x22E)
            {
                port: base + 0x0E,
                read: () => {
                    if (this.bus) this.bus.lowerIRQ(this.jumpers.irq);
                    return this.dspReadBuffer.length > 0 ? 0x80 : 0x00;
                },
                write: () => {}
            },

            // DSP 16-bit IRQ Ack (0x22F)
            {
                port: base + 0x0F,
                read: () => {
                    if (this.bus) this.bus.lowerIRQ(this.jumpers.irq);
                    return 0x00;
                },
                write: () => {}
            },

            // AdLib / OPL2 Ports (0x388 / 0x389)
            { port: 0x388, read: () => this.readOplStatus(), write: (_, val) => { this.oplIndex = val & 0xff; } },
            { port: 0x389, read: () => 0x00, write: (_, val) => this.writeOplData(val) },

            // Mirrored OPL ports at SB base (0x228 / 0x229)
            { port: base + 0x08, read: () => this.readOplStatus(), write: (_, val) => { this.oplIndex = val & 0xff; } },
            { port: base + 0x09, read: () => 0x00, write: (_, val) => this.writeOplData(val) }
        ];
    }

    getIRQLines() {
        return [this.jumpers.irq];
    }

    getDMALines() {
        return [this.jumpers.dma8, this.jumpers.dma16];
    }

    writeDspCommand(cmd) {
        this.pulseActivity();
        switch (cmd) {
            case 0xE1: // Get DSP Version (SB16 = v4.05)
                this.dspReadBuffer.push(0x04);
                this.dspReadBuffer.push(0x05);
                break;
            case 0xD1: // Turn on speaker
                this.dspSpeakerOn = true;
                break;
            case 0xD3: // Turn off speaker
                this.dspSpeakerOn = false;
                break;
            case 0xD0: // Halt 8-bit DMA
            case 0xD4: // Continue 8-bit DMA
            case 0xD8: // Speaker status
                this.dspReadBuffer.push(this.dspSpeakerOn ? 0xff : 0x00);
                break;
            case 0x10: // Direct 8-bit sample output
                this.dspWriteCmd = 0x10;
                break;
            default:
                if (this.dspWriteCmd === 0x10) {
                    this.playDirectSample(cmd);
                    this.dspWriteCmd = 0;
                }
                break;
        }
    }

    /* ======================================================================
     * OPL2 / ADLIB FM SYNTHESIS ENGINE
     * ====================================================================== */

    readOplStatus() {
        const timer1 = ((performance.now() * 12) & 0x40) ? 0xC0 : 0x00;
        return timer1;
    }

    writeOplData(val) {
        this.pulseActivity();
        const reg = this.oplIndex;
        this.oplRegs[reg] = val & 0xff;

        // Channel Key-On / F-Number / Block registers (0xB0-0xB8)
        if (reg >= 0xB0 && reg <= 0xB8) {
            const ch = reg - 0xB0;
            const a0Val = this.oplRegs[0xA0 + ch];
            const fnum = ((val & 0x03) << 8) | a0Val;
            const block = (val >> 2) & 0x07;
            const keyOn = !!(val & 0x20);

            const channel = this.oplChannels[ch];
            channel.fnum = fnum;
            channel.block = block;
            channel.keyOn = keyOn;

            // Frequency formula: freq = fnum * 49716 / 2^(20 - block)
            channel.freq = (fnum * 49716) / Math.pow(2, 20 - block);

            if (this.audioCtx) {
                this.updateOplVoice(ch);
            }
        }
    }

    updateOplVoice(ch) {
        if (!this.audioCtx || this.audioCtx.state === 'suspended') return;
        const channel = this.oplChannels[ch];

        if (channel.keyOn && channel.freq > 20) {
            if (!channel.osc) {
                channel.osc = this.audioCtx.createOscillator();
                channel.gain = this.audioCtx.createGain();
                channel.osc.type = 'sawtooth'; // Classic OPL sharp harmonic profile
                channel.osc.connect(channel.gain);
                channel.gain.connect(this.masterGain);
                channel.osc.start();
            }
            channel.osc.frequency.setValueAtTime(channel.freq, this.audioCtx.currentTime);
            channel.gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
        } else {
            if (channel.gain) {
                channel.gain.gain.setValueAtTime(0.0, this.audioCtx.currentTime);
            }
        }
    }

    playDirectSample(sampleByte) {
        if (!this.audioCtx) return;
        // Float sample in [-1.0, 1.0]
        const sample = (sampleByte - 128) / 128;
        this.pcmBuffer.push(sample);

        if (this.pcmBuffer.length >= 256) {
            const buf = this.audioCtx.createBuffer(1, this.pcmBuffer.length, 22050);
            buf.copyToChannel(new Float32Array(this.pcmBuffer), 0);
            const src = this.audioCtx.createBufferSource();
            src.buffer = buf;
            src.connect(this.masterGain);
            src.start();
            this.pcmBuffer = [];
        }
    }

    initAudio(audioCtx, masterGainNode) {
        this.audioCtx = audioCtx;
        this.masterGain = masterGainNode;
    }

    getPcbVisualData() {
        return {
            pcbColor: this.pcbColor,
            chips: [
                { name: 'CT1741 DSP', x: 25, y: 15, w: 40, h: 30 },
                { name: 'YAMAHA YM3812', x: 75, y: 15, w: 35, h: 25 },
                { name: 'Y3014B DAC', x: 120, y: 15, w: 20, h: 20 },
                { name: 'CT1745 MIXER', x: 150, y: 15, w: 30, h: 25 }
            ],
            leds: [
                { name: 'DSP ACT', active: this.activityLed, color: '#ffaa00' }
            ],
            bracketConnectors: ['Line Out', 'Mic In', 'DA-15 MIDI/Gameport']
        };
    }

    saveState() {
        return {
            id: this.id,
            jumpers: Object.assign({}, this.jumpers),
            dspReset: this.dspReset,
            dspSampleRate: this.dspSampleRate,
            dspBlockSize: this.dspBlockSize,
            dspSpeakerOn: this.dspSpeakerOn,
            mixerIndex: this.mixerIndex,
            mixerRegs: Array.from(this.mixerRegs),
            oplIndex: this.oplIndex,
            oplRegs: Array.from(this.oplRegs)
        };
    }

    loadState(state) {
        if (!state) return;
        this.dspReset = state.dspReset;
        this.dspSampleRate = state.dspSampleRate || 22050;
        this.dspBlockSize = state.dspBlockSize || 0;
        this.dspSpeakerOn = !!state.dspSpeakerOn;
        this.mixerIndex = state.mixerIndex || 0;
        if (state.mixerRegs) this.mixerRegs.set(state.mixerRegs);
        this.oplIndex = state.oplIndex || 0;
        if (state.oplRegs) this.oplRegs.set(state.oplRegs);
        if (state.jumpers) {
            Object.assign(this.jumpers, state.jumpers);
            this.applyJumpers();
        }
    }
}
