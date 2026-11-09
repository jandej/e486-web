/**
 * Automated Unit Tests for ISA Gameport Adapter Card (Port 0x201)
 */

import assert from 'node:assert/strict';
import { RetroBus } from '../js/retro_bus.js';
import { GameportCard } from '../js/cards/gameport_card.js';

console.log('Running ISA Gameport Card Tests...');

const bus = new RetroBus(16);
const gameport = new GameportCard();
bus.installCard(4, gameport);

assert.equal(bus.getCard(4), gameport, 'Gameport card should be installed in Slot 4');

// 1. Initial State: Buttons should be unpressed (active-low bits 4-7 set to 1 -> 0xF0)
// Timers should be idle (bits 0-3 set to 0)
let portVal = bus.ioRead(0x201);
assert.equal(portVal & 0xF0, 0xF0, 'All 4 buttons should be unpressed (high bits = 1)');
assert.equal(portVal & 0x0F, 0x00, 'All 4 timers should be expired initially');

// 2. Pressing Button 1 (Joy 1 Button 1 -> Bit 4 goes LOW)
gameport.setButton(0, true);
portVal = bus.ioRead(0x201);
assert.equal(portVal & 0x10, 0x00, 'Button 1 pressed should pull Bit 4 LOW (0)');
assert.equal(portVal & 0x20, 0x20, 'Button 2 unpressed should keep Bit 5 HIGH (1)');

// Pressing Button 2 (Bit 5 goes LOW) and Button 3 (Bit 6 goes LOW)
gameport.setButton(1, true);
gameport.setButton(2, true);
portVal = bus.ioRead(0x201);
assert.equal(portVal & 0x70, 0x00, 'Buttons 0, 1, 2 pressed should pull Bits 4, 5, 6 LOW');
assert.equal(portVal & 0x80, 0x80, 'Button 3 unpressed should remain HIGH');

// Release buttons
gameport.setButton(0, false);
gameport.setButton(1, false);
gameport.setButton(2, false);
assert.equal(bus.ioRead(0x201) & 0xF0, 0xF0, 'Releasing all buttons restores high nibble to 0xF0');

// 3. Triggering Timers (OUT to 0x201)
// Setting axes: Axis 0 = min resistance (-1.0 -> 0 Ohm -> ~24us), Axis 1 = max resistance (+1.0 -> 100k Ohm -> ~1124us)
gameport.setAxis(0, -1.0);
gameport.setAxis(1, 1.0);

// Write to port 0x201 to trigger NE558 multivibrator
bus.ioWrite(0x201, 0xFF);

// Immediately after write, all 4 timer bits (bits 0-3) should be HIGH (1)
portVal = bus.ioRead(0x201);
assert.equal(portVal & 0x03, 0x03, 'Immediately after write, timer bits 0 and 1 must be HIGH');

// Advance cycles beyond Axis 0 duration (~1200 cycles) but before Axis 1 (~56000 cycles)
gameport.tick(2000);
// Also simulate time passing for timeUs check
gameport.triggerTimeUs -= 100; // 100µs passed (Axis 0 is ~24µs, Axis 1 is ~1124µs)
portVal = bus.ioRead(0x201);
assert.equal(portVal & 0x01, 0x00, 'Axis 0 timer should have expired and returned to 0');
assert.equal(portVal & 0x02, 0x02, 'Axis 1 timer should still be active (1)');

// 4. Jumper Remapping from 0x201 to 0x203
gameport.jumpers.baseAddress = 0x203;
gameport.applyJumpers();
assert.equal(bus.ioRead(0x203) & 0xF0, 0xF0, 'Gameport should respond at new address 0x203');

// 5. Test Save State & Load State
gameport.setButton(0, true);
gameport.setAxis(0, 0.5);
const state = gameport.saveState();

const gameport2 = new GameportCard();
gameport2.loadState(state);
assert.equal(gameport2.buttons[0], true, 'Loaded state button 0 should be true');
assert.equal(gameport2.axisResistance[0], 75000, 'Loaded state axis 0 should be 75k Ohm');

console.log('✅ All ISA Gameport tests passed!');
