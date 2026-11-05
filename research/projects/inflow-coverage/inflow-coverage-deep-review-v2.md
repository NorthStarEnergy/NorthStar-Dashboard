# NorthStar precipitation and inflow coverage audit — revised review

**19 October 2026. Supersedes `inflow-precipitation-gap-analysis.md`.**

## 1. Findings and corrections

The highest-value improvement is to organize observations around **the water entering each plant from upstream releases and intervening tributaries**. Adding town forecasts helps only when those places represent the correct contributing watershed.

The first pilot should remain **Black River → Iroquois Falls**, using Matheson, Monteith and the upper Black/Watabeag area as geographic anchors for catchment precipitation. The strongest additional opportunities identified are Nemegosenda for the Kapuskasing plants; Upsala and reservoir operations for the Seine plants; Turtle River and American headwater discharge for Fort Frances; the Forks for Lake of the Woods; Sturgeon/Veuve/South River for Okikendawt; and upstream Quebec precipitation and tributary coverage.

These priorities reflect physical relevance, existing coverage and source availability. **No percentage improvement or river travel time has been established.** This audit inspected configuration, selected local database contents, official metadata and selected current public observations. It did not calibrate a forecast model or establish continuous production ingestion.

| Earlier review weakness | Correction |
|---|---|
| Almost equated the ten Weather tiles with all weather tracked | The daily-report adapter also defines **12 precipitation sources**. Several recommended regions already have configured observations. |
| Grouped Frederick House, Little Abitibi and North French with Twin/Lake Abitibi | Frederick House enters below Iroquois and above Island Falls. Little Abitibi enters farther downstream. North French drains to the Moose. These are not upstream inflows to Twin or Iroquois. |
| Proposed Groundhog/Mattagami for the Kapuskasing plants | Membership in the wider Moose drainage does not make these rivers upstream of the four plants. Concentrate on the Kapuskasing watershed. |
| Named old gauge IDs without checking status | Current ECCC metadata marks Twin, Iroquois, Island and Frederick House dam stations discontinued. Historical records are not live feeds. |
| Omitted French/Nipissing and Quebec plants | Included below, with existing Shannon and Saint-Jerome sources acknowledged. |
| Did not inspect the local water archive | It contains about 7.95 million raw imported rows from three isolated months, primarily an Iroquois forebay/Twin tailrace level pair. These are not a continuous discharge target. |

The town in the Black River example is **Matheson, Ontario**. Unless an active station ID is explicitly identified below, town names mean proposed geographic sampling anchors, not verified physical rain gauges.

Topology sources: [Abitibi geographical account](https://collections.dartmouth.edu/archive/text/arctica/diplomatic/EA13-04-diplomatic.html), [Frederick House environmental report](https://www.xeneca.com/files/Wanatango%20Falls%20Final%20ER%20-%20June%202014.pdf), [Moose Cree North French field account](https://www.moosecree.com/lake-sturgeon-project-youth-trip/). Historical sources establish geography and operating mechanisms, not present operating rules.

## 2. What is already tracked

### Weather and precipitation

The backend and Weather UI define ten forecast locations: **Iroquois Falls, Atikokan, Kapuskasing, Oshawa, Toronto, Fort Frances, Dokis FN, Kenora, Lachute and Lake Abitibi**. The Open-Meteo request includes temperature, humidity, wind, precipitation amount/probability, 14 forecast days and seven past days. It does not request SWE, soil moisture or evaporation. The ECCC fallback retrieves a nearby usable current observation; it is not evidence of a complete local rainfall archive.

Past days from a forecast API must not be labelled measured rainfall. Store **observations, gridded analyses and forecasts separately**. [Open-Meteo documentation](https://open-meteo.com/en/docs)

| Daily precipitation source configured | Identifier | Direct audit finding |
|---|---|---|
| Fort Frances RCS | 6022474 | Non-null daily total returned for Oct 18 |
| Atikokan (AUT) | 6020LPQ | Oct 18 |
| Kenora A | 6034076 | Oct 18 |
| Kirkland Lake | 6074207 | Oct 18 |
| Rouyn | 7086716 | Oct 18; **not La Sarre** |
| Kapuskasing A | 6073976 | Oct 18 |
| Chapleau Airport | 6061366 | Oct 18 |
| North Bay Airport | 6085695 | Oct 18 |
| Monetville 2 | 6065252 | Latest non-null total in ten recent records: Oct 17 |
| Ste-Catherine, Quebec | 7011190 | Provincial source configured; current value not independently sampled |
| Lachute, Quebec | 7033650 | Provincial source configured; current value not independently sampled |
| Timmins | Weatherstats daily endpoint | Third-party source configured; provenance and latency need confirmation |

The nine ECCC sources were queried directly. Their newest dated rows were not necessarily complete: Oct 19 precipitation was null. Select the requested accumulation period, preserve missingness and never silently substitute zero or another date. Recent records and URLs are saved in `climate-latest.json`.

The Rouyn cell has a conflicting workbook defined name, `LaSarre.Precip`, already documented in the adapter. It actually uses **7086716 at Rouyn**. Counting that cell as La Sarre hides a northern Lake Abitibi coverage gap.

### Public water configuration

The elevation registry contains **27 unique sites: 24 WSC and three USGS**. The flow adapter adds two CEHQ sites, making **29 unique public sites across those registries**. Its five WSC entries overlap the elevation registry. This is a count of configured identities, not 29 operating discharge feeds.

| Group | Existing coverage | Limitation |
|---|---|---|
| Rainy/Namakan | Lac La Croix outlet, Squirrel Island, Bear Pass, Rainy near Fort Frances, Point Park; USGS Basswood, Vermilion and Gold Portage | Much of the ingestion is level-oriented; check parameter before using it as flow |
| Kenora/Norman | Forebay/tailrace sites and Keewatin | Latest checked records were levels; storage and outlet releases still matter |
| Abitibi | Mancebourg, historical Twin/Iroquois, Onakawana | Mancebourg latest query returned no record despite active/realtime metadata; Onakawana is downstream context |
| Kapuskasing | 04LF001 at Kapuskasing | Downstream of all four plants; reference/response series, not an upstream warning gauge |
| Nipissing/French | North Bay, West Bay, French outlet, Little French at Okikendawt | Good lake/branch context; several tributary flow signals missing |
| Seine/Atikokan | Atikokan River, Seine at Sturgeon GS | 05PB009 is active in metadata but REAL_TIME=0 in the checked service |
| Quebec | Shannon 050801, Saint-Jerome 040110, Lachute 02LC020 | Lachute is discontinued in current metadata but lacks a historical-only flag in local configuration |
| Southern Ontario | Oshawa Creek and Don River | Separate Lake Ontario drainage; no physical inflow to northern hydro plants |

The USGS elevation collector requests **63160**; the daily-report adapter requests **00065 gauge height**. Neither is a discharge request. Flow requires the appropriate discharge series, commonly **00060**, where available, preserving units and qualifiers.

Existing CEHQ sources are [050801, Jacques-Cartier at Shannon](https://www.cehq.gouv.qc.ca/hydrometrie/historique_donnees/fiche_station.asp?NoStation=050801), basin 1,997 km², and [040110, du Nord at Saint-Jerome](https://www.cehq.gouv.qc.ca/hydrometrie/historique_donnees/fiche_station.asp?NoStation=040110), basin 1,163 km². Their pages identify regulation influence, which should remain part of the source record.

### Local archive and production limits

Read-only inspection of `data/northstar.db` found three imported files and **7,948,797 raw source rows**, covering August 2025, December 2025 and April 2026. The inspected headers identify **IR GS FOREBAY LEVEL PLC (m)** and **TW GS TAILRACE LEVEL (m)** with empty intervening columns. First/last timestamps span their respective months at approximately second resolution. This was a coverage/header inspection, not a full gap or sensor-quality audit. The SQLite `water_observations` table had zero rows.

The scheduled public collector targets a separate PostgreSQL **ns_water** schema, which was not inspected. Therefore an empty SQLite observation table does not establish empty production collection. Conversely, configured sources do not establish successful production ingestion.

The level pair can support reach-response, backwater, datum and sensor-quality investigation. **Subtracting the elevations cannot yield Black River discharge.** Three isolated months also do not establish year-round predictive skill, regardless of the row count.

## 3. Coverage opportunities by plant

Priority A identifies a strong collection/pilot candidate. B identifies relevant work dependent on operations, geometry or access. These are qualitative priorities, not measured benefit scores.

| Target plants | Overlooked catchment or driver | Useful precipitation anchors | First action |
|---|---|---|---|
| **Iroquois — A** | Black River and drainage entering below Twin | Matheson, Monteith, upper Black/Watabeag | Catchment rain plus Driftwood level; establish operator Black-flow provenance and plant total outflows |
| **Twin — A/B** | Lake Abitibi tributaries, particularly Quebec branches | La Sarre/Macamic, Palmarolle/Dagenais, Duparquet/Rapide-Danseur, La Reine | Separate tributary rain, lake storage and outlet releases; fix Rouyn/La Sarre identity |
| **Island — A/B** | Frederick House and drainage below Iroquois | Connaught/Frederick House Lake, Night Hawk/Porcupine catchments, lower Frederick House | Release history/schedule plus catchment precipitation |
| **Old Woman, White Otter, Camp Three, Big Beaver — A** | Upper Kapuskasing/Nemegosenda and other delineated branches | Existing Chapleau; Elsas/upper Kapuskasing and Nemegosenda zones | Add 04LE002 discharge and basin precipitation; retain downstream town gauge as reference |
| **Calm Lake, Sturgeon Falls — A** | Seine headwaters and managed reservoir releases | Upsala/Raith, Lac des Mille Lacs, Marmion/Raft areas | Add Upsala rain; resolve upstream release records and Raft source |
| **Fort Frances — A** | Turtle, Seine and American Rainy/Namakan headwaters | Mine Centre; Ely/Winton, Tower/Cook, Crane Lake/Orr | Turtle discharge, actual USGS flow where available, lake routing/storage |
| **Kenora, Norman — A/B** | Rainy River into LOTW, Forks below Fort Frances, local lake runoff and releases | Big Falls, Littlefork, Baudette/Rainy River, Warroad | Forks flow/QPF; routed Rainy flow and LOTW water balance |
| **Okikendawt — A** | Sturgeon, Veuve, South River; French outlet allocation | Verner, upper Sturgeon/Glen Afton–River Valley corridor, South River/Sundridge | Tributary gauges plus lake storage and branch-specific releases |
| **Bird, McDougal — A** | Upper Jacques-Cartier; evaluate incremental Ontaritzi below Shannon | Laurentian headwaters, Stoneham/Tewkesbury, Shannon; existing Ste-Catherine | Use Shannon flow; add basin rain/snow and evaluate CEHQ 050807 |
| **Aiyers 1/2 — A** | Upper du Nord and incremental area Saint-Jerome→Lachute | Sainte-Agathe, Sainte-Adele, Morin-Heights/Simon; existing Lachute | Use 040110; add upper-basin precipitation and replace assumed live Lachute coverage |

The 17 clearly named hydro sites are covered above. **Fort Frances TS and Iroquois Falls 230 kV** are electrical entries; **Cogent** needs physical/fuel identity confirmation. Do not manufacture river catchments for these entries. Canonical `Aiyers`/`McDougal` spellings are retained for mapping; source documents may use `Ayers`/`McDougall`.

## 4. Black River: recommended first pilot

### Separate the contributions

Iroquois receives routed Twin outflow plus water entering below Twin, including Black River. FirstLight publishes a [Black River daily flow graph](https://firstlight.energy/wp-content/uploads/Graphs/BlackRiverGraph.pdf), which displayed an Oct 19, 2026 update during this audit. The graph does not establish whether the series is gauged or estimated from plant balances. Obtain its method, timestamps and historical data before treating it as independent truth.

ECCC metadata lists Twin gross drainage area as **9,854 km²** and Iroquois as **13,200 km²**. Their **3,346 km² difference** is a screening estimate of all intervening drainage, approximately 25% of the listed Iroquois upstream area. It is not a delineated Black River polygon or a 25% contribution to flow. [Twin metadata](https://api.weather.gc.ca/collections/hydrometric-stations/items/04MC002?f=json), [Iroquois metadata](https://api.weather.gc.ca/collections/hydrometric-stations/items/04MC001?f=json)

### Add verified response indicators

- **Driftwood at Monteith, 04MB002:** active/realtime; current level returned, discharge null. Listed gross area 539.2 km², only about 16% of the Twin-to-Iroquois incremental area. It is a partial-basin response indicator.
- **Watabeag Lake at the dam, 04MB005:** active/realtime; current level only. Useful storage/response context, not measured tributary discharge.
- **Watabeag River at the dam, 04MB003:** discontinued. Do not confuse the historical river station with the active lake station.

[Driftwood metadata](https://api.weather.gc.ca/collections/hydrometric-stations/items/04MB002?f=json), [Watabeag Lake metadata](https://api.weather.gc.ca/collections/hydrometric-stations/items/04MB005?f=json)

### Represent the rain where it falls

Create upper Black/Watabeag, Driftwood/Monteith and lower Black/Matheson precipitation zones after delineating their contributing areas. Begin with gridded analysis across the whole catchment and compare with physical observations. A town-centre forecast is a temporary display anchor, not an area-average rainfall estimate.

The ECCC catalogue entries found for **Matheson 6075012** and **Matheson Ontario Hydro 6075013** ended in 1972 and 1992. This does not rule out provincial, operator or private gauges; it rules out assuming these historic IDs are current rainfall sources.

### Define a defensible inflow target

Required plant inputs: turbine discharge, spill/bypass discharge, gate changes, forebay/storage relationship and synchronized Twin/Iroquois timestamps. An approximate reach balance is:

> Incremental inflow = Iroquois total outflow + reach storage change − routed Twin total outflow, corrected for direct precipitation, evaporation, diversions and other exchanges.

The residual includes other tributaries and measurement error. It is not automatically Black River flow. If the published Black series uses this same balance, comparing a model against it is not independent validation. Level-derived storage change is noisy; use documented averaging and uncertainty instead of forcing all negative residuals to zero.

## 5. Other catchments: specific additions

### Twin/Lake Abitibi and Island/Frederick House

Quebec watershed planning identifies **La Sarre/Macamic, Dagenais, Duparquet and La Reine** branches entering Lake Abitibi. These are practical rainfall/snow zones with different storage and storm exposure. Current catalogue searches found historical La Sarre, Duparquet and Palmarolle entries, not verified present-day gauges at those exact IDs. Use the places as grid anchors while checking provincial/operator networks. [OBVAJ watershed portrait](https://obvaj.org/wp-content/uploads/2016/11/Fusion_Portrait-Abitibi-K.C..pdf), [MRC Abitibi-Ouest water plan](https://www.mrcao.qc.ca/documents/pages/prmhh-adopte_decembre-2024_mrcao.pdf)

For Island, Frederick House is a separate contribution below Iroquois. The environmental report documents strong release control from Frederick House Lake, supporting a priority on operations and storage. **Porcupine Lake 04MD005** returned a current level; **Porcupine River at Hoyle 04MD004** and **Frederick House dam 04MD002** are discontinued. Porcupine Lake is a limited indicator, not a replacement for the whole regulated branch. [Frederick House report](https://www.xeneca.com/files/Wanatango%20Falls%20Final%20ER%20-%20June%202014.pdf)

### Kapuskasing cascade

**Nemegosenda near Chapleau, 04LE002**, is a concrete new candidate: active/realtime, gross area 433.5 km², current level and discharge returned. Combine it with existing Chapleau precipitation and upper Kapuskasing/Nemegosenda grid coverage. Delineate Dunrankin and other branches before assigning additional weights. [Nemegosenda metadata](https://api.weather.gc.ca/collections/hydrometric-stations/items/04LE002?f=json)

The operator's [Kapuskasing graph](https://firstlight.energy/wp-content/uploads/Graphs/KapGraph.pdf) displays four plant forebay curves and Kapuskasing daily-average flow. Obtain machine-readable history and provenance. One shared basin forecast can feed the cascade, with plant releases and local incremental drainage routed separately. The downstream town gauge can help evaluate basin response, but cannot provide an advance flow observation entering upstream plants.

### Seine: Calm Lake and Sturgeon Falls

The operator describes a roughly **6,250 km² basin beginning near Raith/Upsala**, well beyond an Atikokan weather point. **UPSALA (AUT), 6049095**, returned a non-null Oct 18 daily precipitation total. This is a practical addition for the headwaters. Add snow/rain around Lac des Mille Lacs and reservoir/outlet information through the Marmion/Raft/Seine system. [Seine basin description](https://seineriverwmp.com/the-river/), [Upsala daily records](https://api.weather.gc.ca/collections/climate-daily/items?CLIMATE_IDENTIFIER=6049095&sortby=-LOCAL_DATE&limit=10&f=json)

Map plant-specific routing and Atikokan River's contribution before transferring that gauge to both plants. The local code already identifies an unresolved **Raft Lake NOAA DCS 4815D640 feed/decoder**. Upstream Valerie/Marmion release records are discovery priorities. Managed releases can produce flow changes that town rain cannot explain. [Seine water management](https://seineriverwmp.com/water-management/)

### Fort Frances versus Kenora/Norman

**Turtle River near Mine Centre, 05PB014**, is missing from the inspected registry and returned current discharge and level. Its listed gross basin area is **4,769 km²**. It is a strong candidate for separately tracking a Rainy Lake input. [Turtle metadata](https://api.weather.gc.ca/collections/hydrometric-stations/items/05PB014?f=json)

For American headwaters, retain Basswood/Vermilion/Gold Portage but request actual discharge where published, and investigate Kawishiwi coverage. Ely/Winton and Tower/Cook/Crane Lake/Orr are useful anchors only after spatial assignment to sub-basins. NOAA organizes the river/lake sources upstream-to-downstream and includes precipitation and snow resources. Some forecast hydrographs are explicitly unofficial; retain their status. [NWS Rainy basin resources](https://www.weather.gov/dlh/RainyRiverBasin)

**Big Fork at Big Falls 05132000** and **Little Fork at Littlefork 05131500** join the Rainy system below Fort Frances and contribute toward Lake of the Woods. They are not upstream inflows to Fort Frances; tailwater/backwater effects would be a separate use. Official USGS station identities were checked, but fresh October numeric API observations were not established for these two candidates. [Big Fork USGS](https://waterdata.usgs.gov/monitoring-location/USGS-05132000/), [Little Fork USGS](https://waterdata.usgs.gov/monitoring-location/USGS-05131500/)

For Kenora/Norman combine routed Rainy inflow, local LOTW runoff, lake storage and scheduled outlet releases. Wind-driven shoreline level differences can distort storage changes inferred from one gauge. English River/Lac Seul is downstream of these outlets and must not be counted as their upstream inflow. Obtain representative lake levels and compatible datums. [Lake of the Woods Control Board](https://lwcb.ca/)

### Okikendawt: Nipissing and French River

PSPC identifies **Sturgeon, Veuve and South River** as major Nipissing tributaries and describes managed French outlets. North Bay/Monetville precipitation and lake levels already exist in configuration; improve upstream runoff and branch-allocation coverage. [PSPC French River management](https://www.canada.ca/en/public-services-procurement/services/infrastructure-buildings/bridges-docks-dams/french-river/about.html)

| New candidate | Audit result | Use |
|---|---|---|
| 02DC004 Sturgeon near Glen Afton | Current discharge + level; 3,015 km² | Main tributary response |
| 02DC012 Sturgeon at Upper Goose Falls | Current discharge + level; 1,213 km² | Nested upstream signal; do not sum independently with Glen Afton |
| 02DD012 Veuve near Verner | Current discharge + level; 935.9 km² | Separate lake tributary |
| 02DD023 Forest Lake on South River | Current level only; 320.8 km² | Partial storage indicator, not total South River discharge |

Add Verner, South River/Sundridge and upper Sturgeon precipitation/snow zones. Okikendawt needs allocation to its particular French River branch: total lake tributary inflow is not next-hour plant inflow. Distinguish **Sturgeon Falls on the Seine** from Sturgeon River/Sturgeon Falls in Nipissing. Station-specific metadata URLs and samples are in `source-audit.json`.

### Bird/McDougal and Aiyers

Official documentation places **Bird and McDougal on the Jacques-Cartier at Pont-Rouge**. Use existing Shannon flow plus upper Laurentian and Stoneham/Tewkesbury rain/snow. Ste-Catherine precipitation is already configured. [Quebec Gazette plant identification](https://www.publicationsduquebec.gouv.qc.ca/fileadmin/gazette/pdf_encrypte/lois_reglements/2022F/78324.pdf)

**Ontaritzi below Lac Saint-Joseph** is a promising incremental branch to map relative to Shannon and the plants. CEHQ **050807** is listed open since 1976, basin 223 km², with influenced flow. Confirm confluence/polygon, retrieve history and check current freshness and releases. A current numeric observation was not independently checked here. [CEHQ Ontaritzi](https://www.cehq.gouv.qc.ca/hydrometrie/historique_donnees/fiche_station.asp?NoStation=050807)

The official plant list places **Ayers on the du Nord at Lachute**. Existing Saint-Jerome flow covers an upstream part of that watershed. Add upper Laurentian rain zones around Sainte-Agathe/Sainte-Adele and Simon/Morin-Heights; delineate the incremental area down to Lachute. Simon runoff already captured at Saint-Jerome must not be counted twice. The discontinued Lachute gauge is a gap, not live lower-basin confirmation. Avoid confusing local similarly named tributaries with major Ottawa tributaries. [BAPE plant list](https://voute.bape.gouv.qc.ca/dl/?id=00000369483), [Abrinord watershed portrait](https://www.abrinord.ca/wp-content/uploads/2023/06/Portrait_MAJ_2023.pdf)

## 6. Missing layers with value across the portfolio

| Layer | Recommendation | Benefit and qualification |
|---|---|---|
| Areal precipitation analysis | ECCC CaPA/HRDPA weighted over plant/tributary polygons | Captures spatial rain missed by towns; an analysis, not a physical observation at every grid point |
| Forecast precipitation | Basin-average amounts and ensemble members, archived with issue time | Represents storm-location/amount uncertainty; rain probability alone is insufficient |
| Snow water equivalent and melt | CaLDAS-NSRPS SWE, temperature, phase and available snow surveys | Tracks stored winter water; snow depth is not SWE |
| Antecedent wetness/freeze | 3/7/14/30-day rain, seasonal baseflow, soil moisture/temperature and freeze state | Distinguishes rain on dry, saturated or frozen ground |
| Operations and storage | Total releases, spill, gates/logs, storage curves, planned outages/release schedules | Explains controlled pulses and attenuation; use information known at forecast issue time |
| Ice/backwater and sensor quality | Ice/provisional flags, datum/version, lake wind context | Prevents stage changes being misread as runoff |
| Evaporation/water balance | Lake-area rain/evaporation and seasonal evapotranspiration | Particularly useful for lake-dominated low flows and multi-day forecasts |

The **HRDPA watershed product** already aggregates precipitation over certain gauge watersheds. Documentation describes a 2.5 km analysis, six- and 24-hour accumulations, preliminary production approximately one hour after valid time and final production about seven hours later. Its native watershed set is associated with active streamflow gauges, not every plant, discontinued station or level-only gauge. Aggregate the gridded product over verified plant polygons where native coverage is absent. Archive preliminary/final versions separately. [ECCC HRDPA watershed documentation](https://eccc-msc.github.io/open-data/msc-data/nwp_hrdpa-watershed/readme_hrdpa-watershed_en/)

**CaLDAS-NSRPS** is a concrete Canadian land-analysis source to investigate for SWE and land state. Check product variables, coverage/history and bias at each basin. Pair model SWE with local surveys when available. Ontario water-management access may require registration; existing code already flags protected MNR forecast sources. [CaLDAS-NSRPS](https://eccc-msc.github.io/open-data/msc-data/nwp_caldas-nsrps/readme_caldas-nsrps_en/), [Ontario data access](https://www.ontario.ca/form/register-surface-water-monitoring-data)

Use disagreement between gauges and radar/gridded analysis as a quality indicator. Winter undercatch and sparse northern observation support need checking. Many points from the same model do not create independent measurements. A maintained operator rain gauge or snow course may outperform another town forecast in an underserved branch; choose sites after assessing representativeness and existing networks.

## 7. Turning these sources into measurable forecast improvement

### Register sources and catchments

For each series store: provider/station ID, parameter/unit, observed/estimated/forecast class, coordinates, catchment polygon/version, affected plant, upstream/downstream role, regulation, interval, valid/issue/receipt times, accumulation window/timezone, datum, QC flags, freshness threshold and history span.

Maintain cumulative catchments and non-overlapping incremental areas separately. Weight precipitation by contributing area, not by the number of town points. Nested gauges aid routing but cannot simply be summed. Establish travel times from hydrographs and operations, not straight-line distance.

### Separate targets and horizons

Keep natural inflow, regulated river flow, plant total outflow and forebay level distinct. Initial hypotheses to evaluate are:

- **0–6 hours:** current upstream response, releases and reach routing.
- **6–48 hours:** areal rain forecasts/observations, snow/soil state and tributary response.
- **2–7 days:** ensemble weather, lake storage, melt and release policy, expressed as ranges.

Useful lead time depends on routing and publication latency, not merely the displayed forecast horizon.

### Preserve time and units

Retain UTC plus original source time and accumulation definitions. The Quebec daily precipitation adapter uses **EST 08:01 to next-day 08:00**. ECCC `LOCAL_DATE`, rolling 24-hour rain and the morning water snapshot are different periods. Handle DST explicitly and preserve trace/missing/estimated/provisional flags.

Standardize flow to m³/s and precipitation/SWE to mm while preserving originals. One mm across one km² equals 1,000 m³ of precipitation **before losses, storage and routing**. This conversion does not establish a peak flow. Water-level comparisons need compatible vertical datums and geometry.

### Evaluate additions honestly

1. Establish a defensible plant inflow target or documented water-balance estimate with uncertainty. Identify any predictor mathematically reused in the target.
2. Build persistence/recent-flow and routed-upstream-flow baselines, then add existing weather inputs.
3. Add tributary observations, areal precipitation, snow/soil and operations in separate steps to measure each contribution.
4. Split by whole events, seasons and years. Do not randomly split adjacent second-level records. Use forecasts and data versions available at the historical issue time; later final analyses can leak future information.
5. Measure MAE/RMSE, volume bias, peak magnitude/timing error, threshold misses/false alarms and interval coverage by plant and lead time. Include rainfall, melt, rain-on-snow, ice and release-change events.
6. Evaluate missing-source days, effective lead time after latency, and uncertainty across events. Do not promote a source solely because it correlates with the same storm in a small sample.

## 8. Recommended work order

| Order | Work | Completion criterion |
|---|---|---|
| 1 | Source integrity: Rouyn/La Sarre, discontinued Lachute, Mancebourg missing result, stage versus flow | Correct identity, parameter, period and freshness for each series |
| 2 | Black/Iroquois pilot: polygons, Black-series provenance, plant flows, Monteith/Watabeag, areal rain | Reproducible incremental-inflow target and aligned predictors without circular validation |
| 3 | Verified gaps: Nemegosenda, Turtle, Upsala, Sturgeon/Veuve; evaluate Ontaritzi | Working retrieval, useful historical overlap, upstream assignment and QC |
| 4 | Operations gaps: Frederick House, Seine/Raft, Rainy/Namakan, French branches, LOTW | Distinguish catchment response from controlled releases |
| 5 | Missing weather zones and snow/land state | Area-weighted coverage with observation support and uncertainty documented |
| 6 | Backtest and present forecast ranges/contributions | Demonstrated improvement over baselines at useful lead times, including failure cases |

The useful operator view would eventually show **upstream released water, incremental tributary runoff, storage change and uncertainty** for each plant.

## 9. Evidence and limits

**Verified in this review:** canonical weather, site, flow, elevation, collector and daily-report source; selected SQLite counts/headers/edge timestamps; 39 WSC metadata records with latest samples where realtime was advertised; nine existing ECCC climate metadata entries; ten recent daily rows for those nine plus Upsala; climate catalogue searches in four geographic windows; the linked primary/operator/watershed documents.

**Evidence bundle:** `source-audit.json` records source hashes, configured identities and hydrometric samples; `climate-discovery.json` records catalogue discovery; `climate-latest.json` preserves recent daily precipitation/nulls; `audit_sources.py` reproduces the principal configuration/public-source audit. Operational raw rows and database files are excluded.

**Not established:** continuous production ingestion or PostgreSQL contents, complete historical quality, exact plant/tributary polygons, proposed-town representativeness, fresh numeric CEHQ/USGS candidate records except where stated, operator Black-series methodology, calibrated travel times or predictive skill. Public instantaneous values can be provisional. A successful query is not an uptime guarantee. No runtime code changed and no model was trained.

**Next step:** assemble the Black/Iroquois source and catchment register, beginning with operator Black-flow provenance and Twin/Iroquois total outflows. Keep Frederick House assigned to Island Falls. The existing paired levels can support investigation, but additional discharge/storage information is needed for a defensible inflow target.
