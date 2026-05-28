// NOTE: forecastFromFeatures is the unvalidated rule-based heuristic model.
// P0-5: it is no longer silently used as a model fallback.  Model-load failure
// returns an explicit "unavailable" state instead.
// If this import is removed entirely, also remove visibilityModel.js from the bundle.
// import { forecastFromFeatures } from "../model/visibilityModel.js";

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} unavailable`);
  return response.json();
}

/**
 * Returns an explicit "forecast unavailable" state.
 *
 * P0-5: When the model output JSON cannot be loaded, we show "unavailable"
 * rather than silently invoking the unvalidated rule-based heuristic.
 * The heuristic is not the model being evaluated with RPS and must not
 * share its accuracy display or be logged as a model forecast.
 *
 * @param {string} [reason] - optional reason string for logging
 * @returns forecast-shaped object with is_unavailable=true
 */
function forecastUnavailable(reason) {
  const now = new Date().toISOString().slice(0, 10);
  console.warn("[DivePro] Forecast unavailable:", reason || "model output could not be loaded");
  return {
    date: now,
    grade: "—",
    numeric_score_0_100: null,
    estimated_visibility_range_ft: null,
    estimated_visibility_mid_ft: null,
    confidence: "unavailable",
    best_window: null,
    risk_factors: [],
    positive_factors: [],
    report_text: "Forecast unavailable — model output could not be loaded. Check back shortly.",
    explanation: null,
    is_projected: false,
    is_unavailable: true,
    model_source: "unavailable",
    // P0-5: not labeling this as any model result; grade_probabilities absent
  };
}

async function loadForecastData() {
  // P0-4: default slug updated to la-jolla (renamed from san-diego)
  const slug = document.body.dataset.spot || "la-jolla";
  const dataPath = `../../model_outputs/spots/${slug}.json`;
  try {
    const [spotBundle, gradeGuide, directory] = await Promise.all([
      fetchJson(dataPath),
      fetchJson("../../model_outputs/diveprosd_grade_guidance.json"),
      fetchJson("../../model_outputs/spots.json"),
    ]);
    return {
      latest: spotBundle.latest,
      tenDay: Array.isArray(spotBundle.tenDay) && spotBundle.tenDay.length ? spotBundle.tenDay : [spotBundle.latest],
      gradeGuide: Array.isArray(gradeGuide) ? gradeGuide : [],
      directory: Array.isArray(directory) ? directory : [],
    };
  } catch (err) {
    // P0-5: return unavailable state; do NOT call the heuristic fallback
    const unavail = forecastUnavailable(err && err.message);
    return { latest: unavail, tenDay: [unavail], gradeGuide: [], directory: [] };
  }
}

function feet(range) {
  return `${range[0]}-${range[1]} ft`;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function shortDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function dayLabel(date, index) {
  if (index === 0) return "Latest";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function list(id, values) {
  document.getElementById(id).replaceChildren(...values.map((value) => {
    const li = document.createElement("li");
    li.textContent = value;
    return li;
  }));
}

function directionFromDegrees(degrees) {
  if (degrees === undefined || degrees === null || degrees === "") return "";
  const labels = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return labels[Math.round(Number(degrees) / 22.5) % 16] || "";
}

function featureRows(features) {
  const enriched = {
    ...features,
    secondary_swell_direction_label: features?.secondary_swell_direction_label
      || directionFromDegrees(features?.secondary_swell_direction_deg ?? features?.wind_direction_deg),
  };
  const wanted = [
    ["Surf max", "surf_height_max_ft", "ft"],
    ["Primary swell", "swell_wave_height_max_ft", "ft"],
    ["Primary period", "swell_wave_period_max_s", "s"],
    ["Primary direction", "swell_direction_label", ""],
    ["Secondary swell", "wind_wave_height_max_ft", "ft"],
    ["Secondary period", "wind_wave_period_max_s", "s"],
    ["Secondary direction", "secondary_swell_direction_label", ""],
    ["Total swell", "total_swell_height_mean_ft", "ft"],
    ["Water temp", "water_temp_estimate_f", "F"],
    ["Wind max", "wind_speed_max_mph", "mph"],
    ["Tide range", "tide_range_ft", "ft"],
    ["Rain", "rain_24h_in", "in"],
  ];
  return wanted.map(([label, key, unit]) => {
    const raw = enriched?.[key];
    const value = raw === undefined || raw === null || raw === ""
      ? "n/a"
      : typeof raw === "number"
        ? `${raw.toFixed(key.includes("energy") ? 0 : 1)} ${unit}`.trim()
        : `${raw}${unit ? ` ${unit}` : ""}`;
    return `<div><span>${label}</span><strong>${value}</strong></div>`;
  }).join("");
}

// ── Fish Radar species lists by habitat type ────────────────────────────────

const caKelpTargets = [
  { name: "Yellowtail", habitat: "Kelp edge / open water", prize: 98, abundance: 18, months: [6, 7, 8, 9, 10], tempMin: 64, note: "top trophy shot" },
  { name: "White seabass", habitat: "Kelp rooms", prize: 96, abundance: 10, months: [4, 5, 6, 7], tempMin: 60, note: "rare ghost fish" },
  { name: "California halibut", habitat: "Sand channels", prize: 86, abundance: 28, months: [4, 5, 6, 7, 8, 9], tempMin: 58, note: "high table value" },
  { name: "California sheephead", habitat: "Reef / boulders", prize: 78, abundance: 58, months: [5, 6, 7, 8, 9, 10, 11], tempMin: 56, note: "reliable reef target" },
  { name: "Bonito", habitat: "Current edges", prize: 66, abundance: 30, months: [7, 8, 9, 10], tempMin: 63, note: "fast pelagic" },
  { name: "Barracuda", habitat: "Kelp edge", prize: 62, abundance: 24, months: [6, 7, 8, 9], tempMin: 62, note: "seasonal cruiser" },
  { name: "Calico bass", habitat: "Kelp / reef", prize: 54, abundance: 72, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 55, note: "common kelp fish" },
  { name: "Rockfish", habitat: "Deeper reef", prize: 52, abundance: 38, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 54, note: "depth dependent" },
  { name: "Cabezon", habitat: "Rock structure", prize: 48, abundance: 22, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 54, note: "structure fish" },
  { name: "Sculpin", habitat: "Reef pockets", prize: 44, abundance: 32, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 54, note: "handle carefully" },
  { name: "Opaleye", habitat: "Shallow reef", prize: 34, abundance: 70, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 54, note: "abundant, lower prize" },
  { name: "Calico surfperch", habitat: "Surf grass / sand", prize: 26, abundance: 68, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 52, note: "bottom-tier target" },
];

// SE Florida Atlantic reef + Keys
const flReefTargets = [
  { name: "Mutton snapper", habitat: "Reef edge / sand", prize: 92, abundance: 28, months: [1, 2, 3, 4, 5, 6, 7, 11, 12], tempMin: 74, note: "high-value reef target" },
  { name: "Hogfish", habitat: "Patch reef / sand", prize: 88, abundance: 42, months: [1, 2, 3, 4, 5, 10, 11, 12], tempMin: 72, note: "classic clear-water find" },
  { name: "Grouper", habitat: "Ledges / reef cuts", prize: 86, abundance: 22, months: [5, 6, 7, 8, 9, 10, 11, 12], tempMin: 74, note: "check seasonal closures" },
  { name: "Cobia", habitat: "Rays / buoys / wrecks", prize: 78, abundance: 14, months: [3, 4, 5, 9, 10, 11], tempMin: 72, note: "rare bonus fish" },
  { name: "Mangrove snapper", habitat: "Reef pockets / pilings", prize: 72, abundance: 58, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 72, note: "reliable reef fish" },
  { name: "Yellow jack", habitat: "Current edges", prize: 68, abundance: 34, months: [4, 5, 6, 7, 8, 9, 10], tempMin: 76, note: "fast cruiser" },
  { name: "Sheepshead", habitat: "Pier / reef structure", prize: 54, abundance: 62, months: [1, 2, 3, 4, 11, 12], tempMin: 68, note: "structure grazer" },
  { name: "Triggerfish", habitat: "Patch reef", prize: 48, abundance: 46, months: [1, 2, 3, 4, 5, 6, 10, 11, 12], tempMin: 72, note: "check local rules" },
];

// Gulf Panhandle — Pensacola, Destin
const flGulfTargets = [
  { name: "Red snapper", habitat: "Ledges / artificial reef", prize: 94, abundance: 32, months: [6, 7, 8, 9, 10], tempMin: 72, note: "premium Gulf table fish" },
  { name: "Amberjack", habitat: "Wrecks / deep structure", prize: 88, abundance: 26, months: [4, 5, 6, 7, 8, 9, 10, 11], tempMin: 68, note: "hard-fighting structure fish" },
  { name: "Grouper", habitat: "Ledges / reef cuts", prize: 86, abundance: 20, months: [5, 6, 7, 8, 9, 10, 11, 12], tempMin: 70, note: "check seasonal closures" },
  { name: "Cobia", habitat: "Rays / buoys / wrecks", prize: 82, abundance: 14, months: [3, 4, 5, 9, 10, 11], tempMin: 68, note: "follows manta rays" },
  { name: "Flounder", habitat: "Sandy bottom / transitions", prize: 72, abundance: 36, months: [9, 10, 11, 12, 1, 2], tempMin: 58, note: "lies flat on sand" },
  { name: "Spanish mackerel", habitat: "Current edges / mid-water", prize: 68, abundance: 44, months: [3, 4, 5, 9, 10, 11], tempMin: 65, note: "fast schooling predator" },
  { name: "Triggerfish", habitat: "Patch reef / rubble", prize: 64, abundance: 50, months: [1, 2, 3, 4, 5, 6, 10, 11, 12], tempMin: 68, note: "check Gulf federal regs" },
  { name: "Sheepshead", habitat: "Pier / structure", prize: 56, abundance: 58, months: [1, 2, 3, 4, 11, 12], tempMin: 58, note: "barnacle grazer" },
  { name: "Black sea bass", habitat: "Rocky reef / rubble", prize: 50, abundance: 42, months: [1, 2, 3, 4, 5, 6, 10, 11, 12], tempMin: 60, note: "common reef fish" },
  { name: "Spadefish", habitat: "Wrecks / mid-water", prize: 36, abundance: 64, months: [5, 6, 7, 8, 9, 10], tempMin: 72, note: "abundant on wrecks" },
];

// Tampa Bay — estuarine / flats
const flBayTargets = [
  { name: "Snook", habitat: "Structure edges / dock pilings", prize: 94, abundance: 34, months: [4, 5, 6, 7, 8, 9, 10], tempMin: 70, note: "premier bay ambush predator" },
  { name: "Redfish", habitat: "Shallow flats / structure", prize: 90, abundance: 38, months: [1, 2, 3, 4, 5, 9, 10, 11, 12], tempMin: 62, note: "tailing on the flats" },
  { name: "Cobia", habitat: "Rays / buoys / open water", prize: 82, abundance: 14, months: [3, 4, 5, 10, 11], tempMin: 68, note: "follows manta rays" },
  { name: "Tarpon", habitat: "Passes / bridges", prize: 80, abundance: 12, months: [4, 5, 6, 7, 8], tempMin: 74, note: "catch-and-release only" },
  { name: "Mangrove snapper", habitat: "Dock pilings / structure", prize: 70, abundance: 56, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 68, note: "reliable structure fish" },
  { name: "Sea trout", habitat: "Grass flats / sand edges", prize: 68, abundance: 52, months: [1, 2, 3, 4, 5, 9, 10, 11, 12], tempMin: 60, note: "grass flat staple" },
  { name: "Spanish mackerel", habitat: "Open water / current", prize: 62, abundance: 44, months: [3, 4, 5, 9, 10, 11], tempMin: 65, note: "fast open-water" },
  { name: "Flounder", habitat: "Sandy bottom transitions", prize: 60, abundance: 36, months: [9, 10, 11, 12, 1, 2], tempMin: 58, note: "ambush in current" },
  { name: "Sheepshead", habitat: "Pier / dock structure", prize: 58, abundance: 64, months: [1, 2, 3, 4, 11, 12], tempMin: 60, note: "barnacle crushers" },
  { name: "Jack crevalle", habitat: "Open water / structure", prize: 44, abundance: 60, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 65, note: "aggressive schooling" },
];

// Florida Springs — freshwater / spring runs (observation-centric)
const flSpringsSpecies = [
  { name: "Manatee", habitat: "Warm spring boils", prize: 98, abundance: 44, months: [11, 12, 1, 2, 3], tempMin: 66, note: "observe only — no contact" },
  { name: "Snook", habitat: "Spring mouth transition", prize: 84, abundance: 26, months: [4, 5, 6, 7, 8, 9, 10], tempMin: 68, note: "saltwater species using springs" },
  { name: "Largemouth bass", habitat: "Spring run vegetation", prize: 72, abundance: 58, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 58, note: "year-round resident" },
  { name: "Florida gar", habitat: "Spring run surface", prize: 46, abundance: 56, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 56, note: "prehistoric ambush predator" },
  { name: "Softshell turtle", habitat: "Spring floor / run", prize: 40, abundance: 50, months: [3, 4, 5, 6, 7, 8, 9, 10], tempMin: 60, note: "observe only" },
  { name: "Catfish", habitat: "Spring bottom", prize: 34, abundance: 76, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 54, note: "bottom forager" },
  { name: "American eel", habitat: "Spring floor / crevices", prize: 32, abundance: 38, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 54, note: "nocturnal — rare sighting" },
  { name: "Striped mullet", habitat: "Open spring run", prize: 28, abundance: 82, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tempMin: 56, note: "abundant schooling fish" },
];

// ── Habitat type resolver ────────────────────────────────────────────────────

const FL_GULF_SLUGS = new Set(["pensacola", "destin"]);
const FL_BAY_SLUGS = new Set(["tampa-bay"]);
const FL_SPRINGS_SLUGS = new Set(["florida-springs"]);

function habitatType(data) {
  const slug = data.spot_slug || "";
  if (FL_SPRINGS_SLUGS.has(slug)) return "fl-springs";
  if (FL_BAY_SLUGS.has(slug)) return "fl-bay";
  if (FL_GULF_SLUGS.has(slug)) return "fl-gulf";
  if (data.region === "Florida" || data.region?.includes("Honduras")) return "fl-reef";
  return "ca-kelp";
}

const FISH_RADAR_META = {
  "ca-kelp": {
    subtitle: "Local dive target ranking",
    note: "Prize score blends table value, size, difficulty, and shore-dive realism. Always check current DFW regulations and local MPAs before take.",
  },
  "fl-reef": {
    subtitle: "Local dive target ranking",
    note: "Prize score blends table value, size, difficulty, and shore-dive realism. Always check current FWC rules and local protected areas before take.",
  },
  "fl-gulf": {
    subtitle: "Gulf Panhandle dive target ranking",
    note: "Prize score blends table value, size, and shore-dive realism. Gulf federal seasons apply — red snapper, grouper, and amberjack have strict calendar windows. Always verify current NOAA/FFWCC regs.",
  },
  "fl-bay": {
    subtitle: "Estuarine dive target ranking",
    note: "Prize score blends table value, size, and shore-dive realism. Tarpon is catch-and-release only in Florida. Always check current FWC rules before take.",
  },
  "fl-springs": {
    subtitle: "Common species encountered",
    note: "Springs are regulated areas. Crystal River NWR rules apply — manatees are federally protected and may not be approached or touched. Always check NWR guidelines before entering.",
  },
};

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const HABITAT_FISH_LISTS = {
  "ca-kelp": caKelpTargets,
  "fl-reef": flReefTargets,
  "fl-gulf": flGulfTargets,
  "fl-bay": flBayTargets,
  "fl-springs": flSpringsSpecies,
};

function fishRankings(data) {
  const features = data.features || {};
  const type = habitatType(data);
  const targets = HABITAT_FISH_LISTS[type] || caKelpTargets;
  const month = new Date(`${data.date}T12:00:00`).getMonth() + 1;
  const temp = Number(features.water_temp_estimate_f || features.air_temp_max_f || 60);
  const visibility = Number(data.estimated_visibility_mid_ft || 8);
  // Springs: use a flat visibility baseline (spring viz is always high)
  const vizRef = type === "fl-springs" ? 30 : 8;
  return targets.map((fish) => {
    const seasonBonus = fish.months.includes(month) ? 18 : -10;
    const tempBonus = temp >= fish.tempMin ? Math.min(18, (temp - fish.tempMin) * 3) : -12;
    const vizBonus = Math.min(12, Math.max(-8, visibility - vizRef));
    const abundance = clampScore(fish.abundance + seasonBonus + tempBonus + vizBonus);
    const overall = clampScore((fish.prize * 0.58) + (abundance * 0.42));
    return { ...fish, abundance, overall };
  }).sort((a, b) => b.overall - a.overall);
}

function renderFishRadar(data) {
  const grid = document.getElementById("fishGrid");
  if (!grid) return;
  const type = habitatType(data);
  const meta = FISH_RADAR_META[type] || FISH_RADAR_META["ca-kelp"];
  // Update subtitle and footnote if the IDs exist
  const subtitleEl = document.getElementById("fishRadarSubtitle");
  const noteEl = document.getElementById("fishRadarNote");
  if (subtitleEl) subtitleEl.textContent = meta.subtitle;
  if (noteEl) noteEl.textContent = meta.note;
  // Score label: "Prize" for take-targets, "Encounter" for springs observation
  const prizeLabel = type === "fl-springs" ? "Encounter" : "Prize";
  const abundLabel = type === "fl-springs" ? "Frequency" : "Abundance";
  grid.replaceChildren(...fishRankings(data).map((fish, index) => {
    const card = document.createElement("article");
    card.className = `fish-row${index < 3 ? " is-prime" : ""}`;
    card.innerHTML = `
      <div class="fish-rank">${index + 1}</div>
      <div>
        <strong>${fish.name}</strong>
        <span>${fish.habitat} · ${fish.note}</span>
      </div>
      <div class="fish-scores">
        <span>${prizeLabel} ${fish.prize}</span>
        <span>${abundLabel} ${fish.abundance}</span>
      </div>
      <div class="fish-meters" aria-hidden="true">
        <div class="fish-meter"><span>${prizeLabel}</span><i style="width:${fish.prize}%"></i></div>
        <div class="fish-meter abundance"><span>${abundLabel}</span><i style="width:${fish.abundance}%"></i></div>
      </div>
    `;
    return card;
  }));
}

function defaultReport(data) {
  if (data.is_unavailable) return data.report_text || "Forecast unavailable.";
  const range = data.estimated_visibility_range_ft || [0, 6];
  return `3:00 PM Update - Grade ${data.grade || "—"}\nViz is running ${feet(range)} out there today. ${data.risk_factors?.[0] || "Model conditions are moderate."}\n${data.best_window || "Early morning slack could clean things up."}`;
}

let renderedCameraSlug = "";

function renderCamera(data) {
  if (renderedCameraSlug === data.spot_slug) return;
  const frame = document.getElementById("cameraFrame");
  const embeds = document.getElementById("cameraEmbeds");
  const actions = document.getElementById("cameraActions");
  const caption = document.getElementById("cameraCaption");
  const cams = Array.isArray(data.cams) && data.cams.length ? data.cams : [];
  if (!cams.length) {
    embeds.replaceChildren();
    caption.replaceChildren();
    actions.replaceChildren();
    frame.hidden = true;
    actions.hidden = true;
    renderedCameraSlug = data.spot_slug;
    return;
  }
  embeds.replaceChildren(...cams.map((cam) => {
    if (cam.embed) {
      const iframe = document.createElement("iframe");
      iframe.src = cam.embed;
      iframe.title = cam.title || "Live underwater cam";
      iframe.loading = "eager";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.allowFullscreen = true;
      return iframe;
    }
    const link = document.createElement("a");
    link.href = cam.url || "https://coollab.ucsd.edu/pierviz/";
    link.target = "_blank";
    link.rel = "noopener";
    const image = document.createElement("img");
    image.src = data.camera_image || "../../assets/pier-screenshot.png";
    image.alt = cam.title || `${data.location} live cam`;
    link.append(image);
    return link;
  }));
  const firstCam = cams[0];
  caption.innerHTML = firstCam ? `<a href="${firstCam.url}" target="_blank" rel="noopener">${firstCam.title || "Live cam"}</a>` : "";
  actions.replaceChildren(...cams.map((cam) => {
    const link = document.createElement("a");
    link.href = cam.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `Open ${cam.title || "live stream"}`;
    return link;
  }));
  frame.hidden = false;
  actions.hidden = false;
  renderedCameraSlug = data.spot_slug;
}

function hourLabel(time) {
  const hour = Number(String(time || "0").split(":")[0]);
  if (Number.isNaN(hour)) return time || "";
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function chartTicks(min, max, count = 5) {
  const span = Math.max(1, max - min);
  const rawStep = span / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const start = Math.floor(min / niceStep) * niceStep;
  const end = Math.ceil(max / niceStep) * niceStep;
  const ticks = [];
  for (let value = start; value <= end + niceStep / 2; value += niceStep) {
    ticks.push(Number(value.toFixed(2)));
  }
  return ticks;
}

function xFromIndex(index, total, left, width) {
  return left + (index / Math.max(1, total - 1)) * width;
}

function yFromValue(value, min, max, top, height) {
  return top + (1 - ((value - min) / Math.max(0.1, max - min))) * height;
}

function renderTideChart(data) {
  const chart = document.getElementById("tideChart");
  const points = data.features?.tide_chart || [];
  if (!points.length) {
    chart.textContent = "Tide data unavailable.";
    return;
  }
  const values = points.map((point) => point.height_ft);
  const yTicks = chartTicks(Math.min(...values), Math.max(...values), 5);
  const min = yTicks[0];
  const max = yTicks[yTicks.length - 1];
  const left = 58;
  const top = 18;
  const width = 638;
  const height = 176;
  const coords = points.map((point, index) => {
    const x = xFromIndex(index, points.length, left, width);
    const y = yFromValue(point.height_ft, min, max, top, height);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const xTicks = points.filter((_, index) => index % 4 === 0 || index === points.length - 1);
  chart.innerHTML = `
    <svg viewBox="0 0 720 250" role="img" aria-label="Hourly tide height chart">
      ${yTicks.map((tick) => {
        const y = yFromValue(tick, min, max, top, height);
        return `
          <line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="chart-gridline"></line>
          <text x="${left - 10}" y="${y + 4}" class="chart-y-label" text-anchor="end">${tick.toFixed(1)} ft</text>
        `;
      }).join("")}
      ${xTicks.map((point, index) => {
        const pointIndex = points.indexOf(point);
        const x = xFromIndex(pointIndex, points.length, left, width);
        return `
          <line x1="${x}" x2="${x}" y1="${top}" y2="${top + height}" class="chart-x-grid ${index % 2 ? "is-soft" : ""}"></line>
          <text x="${x}" y="224" class="chart-x-label" text-anchor="middle">${hourLabel(point.time)}</text>
        `;
      }).join("")}
      <line x1="${left}" x2="${left}" y1="${top}" y2="${top + height}" class="chart-axis"></line>
      <line x1="${left}" x2="${left + width}" y1="${top + height}" y2="${top + height}" class="chart-axis"></line>
      <polyline points="${coords}" class="tide-line"></polyline>
      ${points.map((point, index) => {
        const x = xFromIndex(index, points.length, left, width);
        const y = yFromValue(point.height_ft, min, max, top, height);
        return `<circle cx="${x}" cy="${y}" r="3.5" class="tide-point"><title>${hourLabel(point.time)}: ${point.height_ft.toFixed(2)} ft</title></circle>`;
      }).join("")}
    </svg>
  `;
}

function renderWindChart(data) {
  const chart = document.getElementById("windChart");
  const points = data.features?.wind_chart || [];
  if (!points.length) {
    chart.textContent = "Wind data unavailable.";
    return;
  }
  const values = points.map((point) => point.speed_mph || 0);
  const yTicks = chartTicks(0, Math.max(...values), 5);
  const min = 0;
  const max = yTicks[yTicks.length - 1];
  const left = 58;
  const top = 18;
  const width = 638;
  const height = 176;
  const gap = 5;
  const barWidth = Math.max(8, (width / points.length) - gap);
  const xTicks = points.filter((_, index) => index % 4 === 0 || index === points.length - 1);
  chart.innerHTML = `
    <svg viewBox="0 0 720 250" role="img" aria-label="Hourly wind speed chart">
      ${yTicks.map((tick) => {
        const y = yFromValue(tick, min, max, top, height);
        return `
          <line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="chart-gridline"></line>
          <text x="${left - 10}" y="${y + 4}" class="chart-y-label" text-anchor="end">${tick.toFixed(0)} mph</text>
        `;
      }).join("")}
      ${xTicks.map((point, index) => {
        const pointIndex = points.indexOf(point);
        const x = xFromIndex(pointIndex, points.length, left, width);
        return `
          <line x1="${x}" x2="${x}" y1="${top}" y2="${top + height}" class="chart-x-grid ${index % 2 ? "is-soft" : ""}"></line>
          <text x="${x}" y="224" class="chart-x-label" text-anchor="middle">${hourLabel(point.time)}</text>
        `;
      }).join("")}
      <line x1="${left}" x2="${left}" y1="${top}" y2="${top + height}" class="chart-axis"></line>
      <line x1="${left}" x2="${left + width}" y1="${top + height}" y2="${top + height}" class="chart-axis"></line>
      ${points.map((point, index) => {
        const speed = point.speed_mph || 0;
        const x = xFromIndex(index, points.length, left, width) - barWidth / 2;
        const y = yFromValue(speed, min, max, top, height);
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${(top + height - y).toFixed(2)}" rx="4" class="wind-bar"><title>${hourLabel(point.time)}: ${speed.toFixed(1)} mph</title></rect>`;
      }).join("")}
    </svg>
  `;
}

function reportText(data) {
  return (data.report_text || defaultReport(data)).replace(/^\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s+Update\s+-\s+Grade\s+[^\n]+\n?/i, "");
}

function waveWeight(data) {
  const features = data.features || {};
  const swell = Number(features.swell_wave_height_max_ft ?? features.swell_wave_height_ft ?? features.total_swell_height_mean_ft ?? 0);
  const period = Number(features.swell_wave_period_max_s ?? features.swell_wave_period_sec ?? features.swell_period_sec ?? 0);
  if (!Number.isFinite(swell) || swell <= 0) return "Light";
  if (swell >= 4 || (swell >= 3 && period <= 10)) return `${swell.toFixed(1)} ft · Heavy`;
  if (swell >= 2) return `${swell.toFixed(1)} ft · Moderate`;
  return `${swell.toFixed(1)} ft · Light`;
}

function render(data) {
  // P0-fix: When the forecast is unavailable, display an explicit unavailable
  // state — no grade, no numeric score, no fake visibility range.
  // DO NOT fall through to numeric rendering with default values like [0,6] or 0.
  if (data.is_unavailable) {
    setText("spotTitle", data.spot_name || data.location || "Dive Forecast");
    setText("spotDescription", data.description || "");
    setText("date", shortDate(data.date));
    setText("location", data.location || "La Jolla / Scripps Pier");
    setText("grade", "—");
    setText("score", "Unavailable");
    setText("visibility", "—");
    setText("bestWindow", "—");
    setText("habitat", data.habitat || "Coastal reef");
    setText("exposure", data.exposure || "Coastal water");
    setText("confidence", "unavailable");
    setText("waveWeight", "—");
    setText("forecastSource", "Forecast unavailable — model output could not be loaded");
    setText("explanation", data.unavailable_reason || "Forecast unavailable. Check back shortly.");
    setText("dailyReport", data.report_text || "Forecast unavailable.");
    setText("tideSource", "—");
    setText("windSource", "—");
    document.getElementById("scoreFill").style.width = "0%";
    document.getElementById("featureRows").innerHTML = "";
    const cameraNote = document.getElementById("cameraNote");
    cameraNote.textContent = "";
    cameraNote.hidden = true;
    list("riskFactors", []);
    list("positiveFactors", []);
    renderCamera(data);
    return;
  }

  const range = data.estimated_visibility_range_ft || [0, 6];
  const score = data.numeric_score_0_100 ?? 0;
  setText("spotTitle", data.spot_name || data.location || "Dive Forecast");
  setText("spotDescription", data.description || "");
  const cameraNote = document.getElementById("cameraNote");
  cameraNote.textContent = data.camera_note || "";
  cameraNote.hidden = !data.camera_note;
  setText("date", shortDate(data.date));
  setText("location", data.location || "La Jolla / Scripps Pier");
  setText("grade", data.grade || "—");
  setText("score", `${score}/100`);
  setText("visibility", feet(range));
  setText("bestWindow", data.best_window || "Early morning");
  setText("habitat", data.habitat || "Coastal reef");
  setText("exposure", data.exposure || "Coastal water");
  setText("confidence", `${data.confidence || "medium"}${data.is_projected ? " - wave proxy" : ""}`);
  setText("waveWeight", waveWeight(data));
  setText("forecastSource", data.is_projected ? "Long-range wave proxy - lower confidence" : "Site-calibrated marine forecast");
  setText("explanation", data.explanation || "Transparent score from swell, wind, tide, and wave-energy factors.");
  setText("dailyReport", reportText(data));
  setText("tideSource", data.tide_source || `Tide predictions - ${shortDate(data.date)}`);
  setText("windSource", data.wind_source || `Open-Meteo hourly wind - ${shortDate(data.date)}`);
  document.getElementById("scoreFill").style.width = `${score}%`;
  document.getElementById("featureRows").innerHTML = featureRows(data.features || {});
  renderCamera(data);
  renderTideChart(data);
  renderWindChart(data);
  renderFishRadar(data);
  list("riskFactors", data.risk_factors || []);
  list("positiveFactors", data.positive_factors || []);
}

function renderForecastStrip(forecasts, activeDate) {
  const strip = document.getElementById("forecastStrip");
  strip.replaceChildren(...forecasts.map((forecast, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `forecast-day${forecast.date === activeDate ? " is-active" : ""}`;
    button.setAttribute("aria-pressed", forecast.date === activeDate ? "true" : "false");
    button.innerHTML = `
      <span>${dayLabel(forecast.date, index)}</span>
      <strong>${forecast.is_unavailable ? "—" : (forecast.grade || "—")}</strong>
      <em>${forecast.is_unavailable ? "—" : feet(forecast.estimated_visibility_range_ft || [0, 6])}</em>
      <small>${forecast.is_unavailable ? "Unavailable" : (forecast.is_projected ? "Projected" : shortDate(forecast.date))}</small>
    `;
    button.addEventListener("click", () => {
      render(forecast);
      renderForecastStrip(forecasts, forecast.date);
    });
    return button;
  }));
}

function renderGradeGuide(gradeGuide) {
  const guide = document.getElementById("gradeGuide");
  if (!gradeGuide.length) {
    guide.textContent = "Grade guidance unavailable.";
    return;
  }
  guide.replaceChildren(...gradeGuide.map((item) => {
    const row = document.createElement("div");
    const [min, max] = item.visibility_range_ft;
    row.innerHTML = `
      <strong>${item.grade}</strong>
      <span>${min}-${max} ft</span>
      <em>${item.source === "diveprosd_public_posts" ? "DiveProSD observed band" : "Inferred extension"}</em>
    `;
    return row;
  }));
}

function renderSpotSwitcher(directory, activeSlug) {
  const switcher = document.getElementById("spotSwitcher");
  if (!switcher || !directory.length) return;
  switcher.replaceChildren(...directory.map((spot) => {
    const option = document.createElement("option");
    option.value = spot.slug;
    option.textContent = `${spot.menu_name || spot.name} - ${spot.region}`;
    option.selected = spot.slug === activeSlug;
    return option;
  }));
  switcher.addEventListener("change", () => {
    window.location.href = `../${switcher.value}/`;
  });
}

loadForecastData().then(({ latest, tenDay, gradeGuide, directory }) => {
  renderSpotSwitcher(directory, latest.spot_slug);
  render(latest);
  renderForecastStrip(tenDay, latest.date);
  renderGradeGuide(gradeGuide);
});
