/**
 * Automated Unit Tests for Full System Save States (CPU, Bus, RAM, Cards)
 */

import assert from 'node:assert/strict';
import { RetroBus } from '../js/retro_bus.js';
import { Cpu486 } from '../js/cpu_486.js';
import { VgaCard } from '../js/cards/vga_card.js';
import { GameportCard } from '../js/cards/gameport_card.js';
import { Mpu401Card } from '../js/cards/mpu401_card.js';
import { SaveStateManager } from '../js/save_state_manager.js';

console.log('Running Save State & Snapshot Tests...');

// 1. Setup Mock Emulator App
const bus = new RetroBus(16);
const cpu = new Cpu486(bus);

const vga = new VgaCard();
bus.installCard(1, vga);

const gameport = new GameportCard();
bus.installCard(4, gameport);

const mpu = new Mpu401Card();
bus.installCard(5, mpu);

const mockApp = {
    bus,
    cpu,
    updateActiveVideoCard: () => {},
    crtRenderer: null,
    storageCache: null
};

const stateManager = new SaveStateManager(mockApp);

// 2. Modify State: CPU registers, RAM, VRAM, I/O registers
cpu.regs[0] = 0xDEADBEEF; // EAX
cpu.regs[3] = 0xCAFEBABE; // EBX
cpu.ip = 0x1234;
cpu.flags = 0x246;
cpu.setSegment(cpu.DS, 0x1000);

// Write to RAM
bus.memWrite8(0x1000, 0x42);
bus.memWrite8(0x50000, 0x99);

// Write to VGA VRAM
vga.vga_ram[0] = 0xAA;
vga.vga_ram[100] = 0x55;

// Modify Gameport & MPU-401 states
gameport.setButton(0, true);
gameport.setAxis(0, 0.75);
mpu.channels[0].program = 42; // Cello
mpu.uartMode = true;

// 3. Create Snapshot
const snapshot = stateManager.createSnapshot('Test State 1');

// Verify Snapshot Content
assert.equal(snapshot.cpu.regs[0], 0xDEADBEEF, 'Snapshot should capture EAX');
assert.equal(snapshot.cpu.regs[3], 0xCAFEBABE, 'Snapshot should capture EBX');
assert.equal(snapshot.cpu.ip, 0x1234, 'Snapshot should capture IP');
assert.equal(snapshot.bus.ram[0x1000], 0x42, 'Snapshot should capture RAM byte');

// 4. Mutate emulator state (simulate continued play / different game state)
cpu.regs[0] = 0x00000000;
cpu.regs[3] = 0x11111111;
cpu.ip = 0x9999;
bus.memWrite8(0x1000, 0x00);
vga.vga_ram[0] = 0x00;
gameport.setButton(0, false);
mpu.channels[0].program = 0;
mpu.uartMode = false;

assert.equal(cpu.regs[0], 0, 'State was mutated to 0');
assert.equal(bus.memRead8(0x1000), 0, 'RAM was mutated to 0');

// 5. Restore Snapshot
stateManager.restoreSnapshot(snapshot);

assert.equal(cpu.regs[0] >>> 0, 0xDEADBEEF, 'Restored EAX should match original DEADBEEF');
assert.equal(cpu.regs[3] >>> 0, 0xCAFEBABE, 'Restored EBX should match original CAFEBABE');
assert.equal(cpu.ip, 0x1234, 'Restored IP should match original 0x1234');
assert.equal(bus.memRead8(0x1000), 0x42, 'Restored RAM at 0x1000 should be 0x42');
assert.equal(bus.memRead8(0x50000), 0x99, 'Restored RAM at 0x50000 should be 0x99');
assert.equal(vga.vga_ram[0], 0xAA, 'Restored VGA VRAM should match');
assert.equal(gameport.buttons[0], true, 'Restored Gameport button 0 should be true');
assert.equal(mpu.channels[0].program, 42, 'Restored MPU-401 channel 0 program should be 42');
assert.equal(mpu.uartMode, true, 'Restored MPU-401 UART mode should be true');

// 6. Test Serialization & Deserialization (Storage Hydration)
const storageClone = stateManager.cloneForStorage(snapshot);
assert(typeof storageClone.bus.ramB64 === 'string', 'Cloned bus RAM should be Base64 string');
assert.equal(storageClone.bus.ram, null, 'Cloned bus RAM buffer should be null');

const hydrated = stateManager.hydrateFromStorage(storageClone);
assert(hydrated.bus.ram instanceof Uint8Array, 'Hydrated RAM should be Uint8Array');
assert.equal(hydrated.bus.ram[0x1000], 0x42, 'Hydrated RAM byte should match 0x42');

console.log('✅ All Save State & Snapshot tests passed!');
