/**
 * Automated Unit Tests for Roland MPU-401 MIDI Interface & Built-In GM Synth
 */

import assert from 'node:assert/strict';
import { RetroBus } from '../js/retro_bus.js';
import { Mpu401Card } from '../js/cards/mpu401_card.js';

console.log('Running Roland MPU-401 & General MIDI Synth Tests...');

const bus = new RetroBus(16);
const mpu = new Mpu401Card();
bus.installCard(5, mpu);

assert.equal(bus.getCard(5), mpu, 'MPU-401 card should be installed in Slot 5');

// 1. Initial Status Check (Port 0x331)
// Bit 7 = 0 (Output ready), Bit 6 = 0x40 (Input queue empty)
assert.equal(bus.ioRead(0x331) & 0xC0, 0x40, 'MPU-401 should report output ready and input empty');

// 2. Put into UART Mode (Command 0x3F to Port 0x331)
bus.ioWrite(0x331, 0x3F);
assert.equal(mpu.uartMode, true, 'MPU-401 should be placed into UART mode');

// Reading Data Port (0x330) should return ACK (0xFE)
const ack = bus.ioRead(0x330);
assert.equal(ack, 0xFE, 'MPU-401 should return 0xFE ACK after entering UART mode');

// 3. Test MIDI Program Change (0xC0: Channel 0 -> Program 19 [Church Organ])
bus.ioWrite(0x330, 0xC0); // Program change on Channel 0
bus.ioWrite(0x330, 19);   // Program 19
assert.equal(mpu.channels[0].program, 19, 'Channel 0 should have Program 19 (Organ)');

// 4. Test MIDI Control Change (Volume CC 7 = 90)
bus.ioWrite(0x330, 0xB0); // Control Change on Channel 0
bus.ioWrite(0x330, 7);    // CC 7 (Channel Volume)
bus.ioWrite(0x330, 90);   // Value 90
assert.equal(mpu.channels[0].volume, 90, 'Channel 0 volume should be 90');

// 5. Test Running Status with Note On & Note Off
// Send Note On: 0x90, Note 60 (Middle C), Velocity 100
bus.ioWrite(0x330, 0x90);
bus.ioWrite(0x330, 60);
bus.ioWrite(0x330, 100);

// Using Running Status (no status byte sent): Note 64 (E), Velocity 110
bus.ioWrite(0x330, 64);
bus.ioWrite(0x330, 110);

// Using Running Status with Note On Vel 0 -> treated as Note Off
bus.ioWrite(0x330, 60);
bus.ioWrite(0x330, 0);

// 6. Test Pitch Bend (0xE0)
// Center is 8192 (LSB=0, MSB=64). Maximum bend +2 semitones is LSB=127, MSB=127
bus.ioWrite(0x330, 0xE0);
bus.ioWrite(0x330, 127);
bus.ioWrite(0x330, 127);
assert(mpu.channels[0].pitchBend > 1.9, 'Pitch bend should be ~ +2 semitones');

// 7. Test Save State & Load State
const state = mpu.saveState();
assert.equal(state.uartMode, true, 'Saved state should capture UART mode');
assert.equal(state.channels[0].program, 19, 'Saved state should capture Program 19');

const mpu2 = new Mpu401Card();
mpu2.loadState(state);
assert.equal(mpu2.uartMode, true, 'Loaded state should be UART mode');
assert.equal(mpu2.channels[0].program, 19, 'Loaded state should have Program 19');
assert.equal(mpu2.channels[0].volume, 90, 'Loaded state should have volume 90');

console.log('✅ All Roland MPU-401 & General MIDI tests passed!');
