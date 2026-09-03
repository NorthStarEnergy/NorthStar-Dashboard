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
const source = lib.draw({ type: "source", x: 100, y: 100 });
const unknown = lib.draw({ type: "not-a-real-type", x: 100, y: 100 });
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
  closedHasSlash: closed.includes("L113 87"),
  openedHasSlash: opened.includes("L113 87"),
  openedDashed: opened.includes("device-open"),
  unknownIsNotSource: !unknown.includes("q7-13") && unknown.includes("?"),
  busSnap: bus,
  breakerLeft,
  rotated,
  sourceHasSine: source.includes("q7-13"),
}));
