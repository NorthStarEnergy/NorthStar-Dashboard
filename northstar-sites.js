(() => {
  const STATIONS = [
    { id: "site:fort-frances", name: "Fort Frances", area: "West" },
    { id: "site:calm-lake", name: "Calm Lake", area: "West" },
    { id: "site:sturgeon-falls", name: "Sturgeon Falls", area: "West" },
    { id: "site:kenora", name: "Kenora", area: "West" },
    { id: "site:norman", name: "Norman", area: "West" },
    { id: "site:twin-falls", name: "Twin Falls", area: "East" },
    { id: "site:iroquois-falls", name: "Iroquois Falls", area: "East" },
    { id: "site:island-falls", name: "Island Falls", area: "East" },
    { id: "site:old-woman-falls", name: "Old Woman Falls", area: "East" },
    { id: "site:white-otter-rapids", name: "White Otter Rapids", area: "East" },
    { id: "site:camp-three-rapids", name: "Camp Three Rapids", area: "East" },
    { id: "site:big-beaver-falls", name: "Big Beaver Falls", area: "East" },
    { id: "site:okikendawt-gs", name: "Okikendawt GS", area: "East" },
    { id: "site:mcdougal", name: "McDougal", area: "Quebec" },
    { id: "site:bird-gs", name: "Bird GS", area: "Quebec" },
    { id: "site:cogent", name: "Cogent", area: "Quebec" },
    { id: "site:aiyers-1", name: "Aiyers 1", area: "Quebec" },
    { id: "site:aiyers-2", name: "Aiyers 2", area: "Quebec" }
  ];
  const SYSTEM = { id: "site:system-transmission", name: "System / transmission", area: "" };
  const ALIASES = {
    "fort frances gs": "site:fort-frances",
    "calm lake gs": "site:calm-lake",
    "sturgeon falls gs": "site:sturgeon-falls",
    "kenora gs": "site:kenora",
    "kenora / norman": "site:kenora",
    "norman gs": "site:norman",
    "twin falls gs": "site:twin-falls",
    "iroquois falls gs": "site:iroquois-falls",
    "iroquois falls 230 kv": "site:iroquois-falls",
    "iroquois falls": "site:iroquois-falls",
    "island falls gs": "site:island-falls",
    "old woman falls gs": "site:old-woman-falls",
    "white otter rapids gs": "site:white-otter-rapids",
    "camp three rapids gs": "site:camp-three-rapids",
    "big beaver falls gs": "site:big-beaver-falls",
    "mcdougal gs": "site:mcdougal",
    "cogent gs": "site:cogent",
    "system": "site:system-transmission",
    "transmission": "site:system-transmission",
    "system/transmission": "site:system-transmission"
  };

  let catalog = {
    stations: STATIONS,
    system: SYSTEM,
    options: STATIONS.concat([SYSTEM]),
    crewOptions: STATIONS
  };

  function norm(value) {
    return String(value || "").trim().toLowerCase().replace(/[\s_/]+/g, " ");
  }

  function known() {
    return catalog.stations.concat(catalog.system ? [catalog.system] : []);
  }

  function resolve(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const byId = Object.fromEntries(known().map(row => [row.id, row]));
    if (byId[text]) return byId[text];
    const byKey = {};
    known().forEach(row => {
      byKey[norm(row.name)] = row;
      byKey[norm(row.id)] = row;
      byKey[norm(String(row.id).replace(/^site:/, ""))] = row;
    });
    Object.entries(ALIASES).forEach(([label, id]) => {
      if (byId[id]) byKey[norm(label)] = byId[id];
    });
    return byKey[norm(text)] || null;
  }

  function displayName(site, siteId) {
    const found = resolve(siteId) || resolve(site);
    return found ? found.name : String(site || siteId || "");
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[<>&"]/g, character => ({
      "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;"
    }[character]));
  }

  function fillSelect(select, rows) {
    if (!select || !rows) return;
    const current = select.value;
    select.innerHTML = rows.map(row => (
      `<option value="${esc(row.name)}" data-site-id="${esc(row.id)}">${esc(row.name)}</option>`
    )).join("");
    if ([...select.options].some(option => option.value === current)) select.value = current;
  }

  function fillSelects() {
    if (typeof document === "undefined") return;
    fillSelect(document.querySelector("#outageSite"), catalog.options);
    fillSelect(document.querySelector("#crewSite"), catalog.crewOptions);
  }

  function selected(select) {
    const option = select && select.selectedOptions && select.selectedOptions[0];
    return {
      site: select ? select.value : "",
      siteId: option && option.dataset ? option.dataset.siteId || "" : ""
    };
  }

  async function load() {
    if (typeof fetch !== "function") {
      fillSelects();
      return;
    }
    try {
      const response = await fetch("/api/sites?ts=" + Date.now());
      if (!response.ok) throw new Error("sites unavailable");
      const payload = await response.json();
      if (Array.isArray(payload.stations) && payload.stations.length) {
        catalog = {
          stations: payload.stations,
          system: payload.system || SYSTEM,
          options: payload.options || payload.stations.concat(payload.system ? [payload.system] : []),
          crewOptions: payload.crewOptions || payload.stations
        };
      }
    } catch {
      /* keep the fallback list */
    }
    fillSelects();
  }

  const api = {
    stations: () => catalog.stations.slice(),
    stationNames: () => catalog.stations.map(row => row.name),
    options: () => catalog.options.slice(),
    resolve,
    displayName,
    fillSelects,
    selected,
    ready: typeof document === "undefined" ? Promise.resolve() : load()
  };

  if (typeof window !== "undefined") window.NorthStarSites = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fillSelects);
    else fillSelects();
  }
})();
