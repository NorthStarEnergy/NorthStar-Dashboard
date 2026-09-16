const fs = require("fs");
const path = require("path");
const vm = require("vm");
const libraryPath = path.join(__dirname, "..", "one-line-symbol-library.js");
const context = { window: {}, console };
vm.runInNewContext(fs.readFileSync(libraryPath, "utf8"), context);
const lib = context.window.NorthStarOneLineSymbols;
if (!lib) {
  throw new Error("symbol library did not attach to window");
}
const closed = lib.draw({ type: "breaker", x: 100, y: 100, operatingState: "closed" });
const opened = lib.draw({ type: "breaker", x: 100, y: 100, operatingState: "open" });
const closedLine = lib.draw({ type: "disconnect", x: 100, y: 100, operatingState: "closed" });
const openedLine = lib.draw({ type: "disconnect", x: 100, y: 100, operatingState: "open" });
const source = lib.draw({ type: "source", x: 100, y: 100 });
const unknown = lib.draw({ type: "not-a-real-type", x: 100, y: 100 });
const fuseOpen = lib.draw({ type: "fuse", x: 100, y: 100, operatingState: "open" });
const circuitSwitcher = lib.draw({ type: "circuit-switcher", x: 100, y: 100, operatingState: "closed" });
const resistor = lib.draw({ type: "resistor", x: 100, y: 100 });
const inductor = lib.draw({ type: "inductor", x: 100, y: 100 });
const led = lib.draw({ type: "led", x: 100, y: 100 });
const reactor = lib.draw({ type: "reactor", x: 100, y: 100 });
const bank = lib.draw({ type: "capacitor", x: 100, y: 100 });
const element = lib.draw({ type: "capacitor-element", x: 100, y: 100 });
const circuitSwitch = lib.draw({ type: "switch", x: 100, y: 100, operatingState: "open" });
const bus = lib.snapPoint({ type: "bus", x: 200, y: 200, rotation: 0 }, 220, 280, "span");
const breakerLeft = lib.snapPoint({ type: "breaker", x: 300, y: 200, rotation: 0 }, 0, 200, "L");
const rotated = lib.snapPoint({ type: "breaker", x: 300, y: 200, rotation: 90 }, 300, 0, "L");
process.stdout.write(JSON.stringify({
  profile: lib.profile,
  catalogueVersion: lib.catalogueVersion,
  notationSource: lib.notationSource,
  graphicalStandard: lib.graphicalStandard,
  designationStandard: lib.designationStandard,
  ids: lib.definitions.map(item => item.id),
  switching: lib.definitions.filter(item => item.switching).map(item => item.id),
  winding: lib.definitions.filter(item => item.winding).map(item => item.id),
  hidden: lib.definitions.filter(item => item.hidden).map(item => item.id),
  getUnknown: lib.get("not-a-real-type"),
  getBreaker: lib.get("breaker") && lib.get("breaker").id,
  aliasCapacitior: lib.get("capacitior") && lib.get("capacitior").id,
  aliasLdr: lib.get("ldr") && lib.get("ldr").id,
  aliasPhotoresistor: lib.get("photoresistor") && lib.get("photoresistor").id,
  aliasCircuitSwitching: lib.get("circuit-switching") && lib.get("circuit-switching").id,
  aliasLineSwitch: lib.get("line-switch") && lib.get("line-switch").id,
  closedLineAligned: closedLine.includes("M80 100h40"),
  openedLinePerp: openedLine.includes("M80 100L112 78"),
  closedBreakerBoxed: closed.includes("<rect") && closed.includes("M86 100h28"),
  openedHasSlash: opened.includes("L113 87"),
  openedDashed: opened.includes("device-open"),
  fuseHasArmCartridge: fuseOpen.includes("rotate(-35") && fuseOpen.includes("<rect"),
  circuitSwitcherThroughSquare: circuitSwitcher.includes("<rect") && circuitSwitcher.includes("M78 100h44"),
  resistorHasZigzag: resistor.includes("l7-11"),
  inductorHasFourLoops: (inductor.match(/a8 10/g) || []).length === 4,
  ledHasEmission: led.includes("l14-12"),
  reactorIsSine: reactor.includes("q7-18"),
  capacitorElementShorter: element.includes("v32") && bank.includes("v44") && !element.includes("v44"),
  switchHasBlade: circuitSwitch.includes("L104 81"),
  unknownIsNotSource: !unknown.includes("q7-13") && unknown.includes("?"),
  busSnap: bus,
  breakerLeft,
  rotated,
  sourceHasSine: source.includes("q7-13"),
}));
