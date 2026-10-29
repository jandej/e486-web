# Retro486 Pro — Pure-JavaScript Intel 80486DX2 PC & Motherboard Emulator

A 100% browser-based, dependency-free **Intel 80486DX2-66 PC, Motherboard & Modular ISA/VLB Adapter Card Emulator** written in pure ES6 JavaScript. Runs real unmodified **SeaBIOS**, **VGA BIOS**, **FreeDOS 1.3**, and classic DOS games (Commander Keen 4, Wolfenstein 3D, Duke Nukem II, DOOM) directly in the browser.

**▶ Live demo:** <https://jandej.github.io/e486-web/>

---

## Screenshots

### 🖥️ CRT Monitor & FreeDOS 1.3 Boot
![CRT Monitor & FreeDOS 1.3](docs/screenshots/crt-monitor.png)

### 🔌 Interactive 486 VLB/ISA Motherboard & Expansion Slots
![486 Motherboard & Slots](docs/screenshots/motherboard.png)

### 💾 Storage Bay & Pre-Bundled Disk Library
![Storage Bay & Disk Library](docs/screenshots/storage-bay.png)

### 🛠️ Custom ISA/VLB Adapter Card Studio & Test Bench
![Custom Card Studio](docs/screenshots/card-studio.png)

### ⚙️ Live 80486 CPU Registers & Physical Memory Hex Inspector
![System & Diagnostics](docs/screenshots/system-diagnostics.png)

---

## Features

- **Full Intel 80486DX2 CPU + 80487 FPU (`js/cpu_486.js`, `js/fpu_487.js`)**
  - Real Mode, 16/32-bit Protected Mode, Virtual 8086 (V86) Mode
  - 32-bit Demand Paging (`CR0.PG`, `CR3`) with 4096-entry hardware TLB
  - Hardware Task Switching (`TSS`), `CPUID`, `BSWAP`, `CMPXCHG`, `XADD`, `INVLPG`
  - Integrated x87 Floating-Point Unit (`FPU487`)
- **AT / i440FX Motherboard & Chipset (`js/retro_bus.js`, `js/bios_rom.js`)**
  - Dual 8259A Programmable Interrupt Controllers (Master/Slave PIC)
  - 8254 Programmable Interval Timer (PIT Channels 0, 1, 2 + PC Speaker + SeaBIOS PM Timer `0x3CC`)
  - MC146818 CMOS Real-Time Clock & NVRAM
  - 8042 PS/2 Keyboard & Mouse Controller + A20 Gate (`0x92` / `0x60`)
  - Interactive 486 Motherboard visualizer with live address/data bus, IRQ lines, and 7-segment POST display
- **Hot-Pluggable ISA / VLB Expansion Cards (`js/cards/`)**
  - **SVGA / Bochs VBE Display Card (`vga_card.js`)**: Text modes (`03h`), CGA (`04h`/`06h`), EGA/VGA Planar 16-color (`0Dh`/`0Eh`/`10h`/`12h`) with hardware Pel Panning & Split-Screen `LINE_COMPARE`, Mode 13h (`320x200x256`), Mode-X, and VBE LFB
  - **EGA 64-Color Planar Card (`ega_card.js`)** & **CGA Card (`cga_card.js`)**
  - **SoundBlaster 16 + AdLib OPL3 Card (`soundblaster_card.js`)**: WebAudio synthesis, DSP DMA playback, configurable IRQ/DMA/Port jumpers
  - **Multi-I/O Storage Controller (`multio_card.js`)**: Dual-channel ATA/ATAPI IDE (`C:`, `D:`, `E:` CD-ROM) + `EMULINK` Floppy Controller (`A:`, `B:`)
  - **Port 80h POST Diagnostic Card (`post_card.js`)** & live **In-Browser Custom JS Card SDK**
- **Browser Persistence (`js/storage_cache.js`)**
  - Automatically caches ROMs, floppy images, custom uploaded `.img`/`.iso` files, and dirty DOS disk writes in browser `IndexedDB` + `localStorage`
  - Persists hardware setup (RAM size, CPU speed, CRT bezel effects, installed slot cards, and mounted drives) across browser reloads

## Quick Start

Start any static HTTP server in the project root:

```bash
npm start
# or: python3 -m http.server 8080
```

Then open **http://localhost:8080/** in your browser.

## Running Automated Unit Tests

```bash
npm test
```

## Directory Structure

```text
├── index.html              # Main Retro486 Pro Hardware Lab UI
├── css/                    # CRT monitor, motherboard & storage bay styling
├── js/
│   ├── app.js              # Main emulator coordinator & UI bindings
│   ├── cpu_486.js          # Intel 80486DX2 CPU core (Real/PM/V86/Paging)
│   ├── fpu_487.js          # 80487 x87 Floating-Point Unit
│   ├── retro_bus.js        # System bus, PIC, PIT, DMA, CMOS, 8042, PCI
│   ├── bios_rom.js         # SeaBIOS & VGA BIOS loader + fallback ROM
│   ├── storage_cache.js    # IndexedDB + localStorage persistence engine
│   ├── cards/              # Modular ISA/VLB expansion cards
│   └── ui/                 # Motherboard, Storage Bay & Card Editor views
├── data/                   # SeaBIOS (bios.bin), VGA BIOS (vgabios.bin), FreeDOS 1.3 (dos.img)
├── extra_disks/            # Pre-bundled 1.44MB DOS game & utility floppy images
├── docs/screenshots/       # UI screenshots for documentation
└── tests/                  # Node.js unit test suites
```
