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
const bus = lib.snapPoint({ type: "bus", x: 200, y: 200, rotation: 0 }, 220, 280, "span");
const breakerLeft = lib.snapPoint({ type: "breaker", x: 300, y: 200, rotation: 0 }, 0, 200, "L");
const rotated = lib.snapPoint({ type: "breaker", x: 300, y: 200, rotation: 90 }, 300, 0, "L");
process.stdout.write(JSON.stringify({
  profile: lib.profile,
  catalogueVersion: lib.catalogueVersion,
  graphicalStandard: lib.graphicalStandard,
  designationStandard: lib.designationStandard,
  ids: lib.definitions.map(item => item.id),
  switching: lib.definitions.filter(item => item.switching).map(item => item.id),
  winding: lib.definitions.filter(item => item.winding).map(item => item.id),
  hidden: lib.definitions.filter(item => item.hidden).map(item => item.id),
  getUnknown: lib.get("not-a-real-type"),
  getBreaker: lib.get("breaker") && lib.get("breaker").id,
  aliasCapacitior: lib.get("capacitior") && lib.get("capacitior").id,
  aliasCircuitSwitching: lib.get("circuit-switching") && lib.get("circuit-switching").id,
  aliasLineSwitch: lib.get("line-switch") && lib.get("line-switch").id,
  closedLineAligned: closedLine.includes("M86 100h28"),
  openedLinePerp: openedLine.includes("M100 86v28"),
  closedBreakerBoxed: closed.includes("<rect") && closed.includes("M86 100h28"),
  openedHasSlash: opened.includes("L113 87"),
  openedDashed: opened.includes("device-open"),
  fuseHasArmCartridge: fuseOpen.includes("rotate(-35") && fuseOpen.includes("<rect"),
  circuitSwitcherThroughSquare: circuitSwitcher.includes("<rect") && circuitSwitcher.includes("M78 100h44"),
  resistorHasZigzag: resistor.includes("l7-11"),
  unknownIsNotSource: !unknown.includes("q7-13") && unknown.includes("?"),
  busSnap: bus,
  breakerLeft,
  rotated,
  sourceHasSine: source.includes("q7-13"),
}));
