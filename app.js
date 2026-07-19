import { forecastFromFeatures } from "./visibilityModel.js";

const DISPLAY_HS_TO_CHAR = 0.625; // 1 / 1.6, display-only Hs to characteristic height.
const DISPLAY_WAVE_MODERATE_FT = 2 * DISPLAY_HS_TO_CHAR;
const DISPLAY_WAVE_SHORT_HEAVY_FT = 3 * DISPLAY_HS_TO_CHAR;
const DISPLAY_WAVE_HEAVY_FT = 4 * DISPLAY_HS_TO_CHAR;

const fallback = {
  date: "2026-05-23",
  location: "La Jolla / Scripps Pier",
  features: {
    date: "2026-05-23",
    surf_height_max_ft: 2,
    total_swell_height_mean_ft: 2.5,
    short_period_swell_energy: 8.2,
    wind_speed_max_mph: 8,
    wave_energy_mean_kj: 29,
    mixed_swell_score: 1,
  },
};

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} unavailable`);
  return response.json();
}

function fallbackForecast() {
  const computed = forecastFromFeatures(fallback.features);
  return {
    ...fallback,
    grade: computed.grade,
    numeric_score_0_100: computed.score,
    estimated_visibility_range_ft: computed.visibilityRange,
    estimated_visibility_mid_ft: computed.visibilityMid,
    confidence: computed.confidence,
    best_window: computed.bestWindow,
    risk_factors: computed.riskFactors,
    positive_factors: computed.positiveFactors,
    explanation: "Score starts at 70, then adjusts for total swell, surf height, short-period energy, wind, mixed swell, and wave energy.",
    is_projected: false,
  };
}

function localTodayInLaJolla() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

function isCameraObservationDisplayable(observation) {
  // Screenshot display depends only on a validated same-day capture.
  // Grades and grading mode never gate the photo (see SCRIPPS_CAMERA.md).
  return Boolean(
    observation &&
      observation.capture_ok === true &&
      observation.image_url &&
      observation.observation_date === localTodayInLaJolla(),
  );
}

// Why the reference image (not a live frame) is on screen. Set by
// loadCameraObservation before first render; renderCamera turns it into a
// visible label so the fallback is never mistaken for a live capture.
//   "pending"     -> no same-day record yet (before the first slot lands)
//   "offline"     -> a same-day capture was attempted but failed / unusable
//   "unavailable" -> status feed unreachable or screenshot publishing off
let scrippsCameraFallbackReason = "unavailable";

async function loadCameraObservation() {
  try {
    const config = await fetchJson("camera-config.json");
    if (!config || config.publish_screenshots !== true) {
      scrippsCameraFallbackReason = "unavailable";
      return null;
    }
    const observation = await fetchJson("camera-snapshots/scripps-pier-latest.json");
    if (isCameraObservationDisplayable(observation)) return observation;
    if (observation && observation.observation_date === localTodayInLaJolla()) {
      scrippsCameraFallbackReason = "offline";
    } else {
      scrippsCameraFallbackReason = "pending";
    }
    return null;
  } catch {
    scrippsCameraFallbackReason = "unavailable";
    return null;
  }
}

async function loadForecastData() {
  const cameraObservation = await loadCameraObservation();
  if (window.staticSpotReport) {
    return {
      latest: window.staticSpotReport,
      tenDay: [],
      gradeGuide: [],
      history: [],
      cameraObservation,
    };
  }

  try {
    const [latest, tenDay, gradeGuide] = await Promise.all([
      fetchJson("model_outputs/latest_forecast.json"),
      fetchJson("model_outputs/forecast_10day.json"),
      fetchJson("diveprosd_grade_guidance.json"),
    ]);
    let history = [];
    try {
      history = await fetchJson("forecast_history.json");
    } catch {
      history = [];
    }
    return {
      latest,
      tenDay: Array.isArray(tenDay) && tenDay.length ? tenDay : [latest],
      gradeGuide: Array.isArray(gradeGuide) ? gradeGuide : [],
      history: Array.isArray(history) ? history : [],
      cameraObservation,
    };
  } catch {
    const latest = fallbackForecast();
    return { latest, tenDay: [latest], gradeGuide: [], history: [], cameraObservation };
  }
}

function feet(range) {
  return `${range[0]}-${range[1]} ft`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function shortDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function dayLabel(date) {
  if (!date) return "Projected";
  if (date === localTodayInLaJolla()) return "Today";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function currentForecastWindow(forecasts, today = localTodayInLaJolla()) {
  const currentAndFuture = forecasts.filter((forecast) => (
    forecast && (!forecast.date || forecast.date >= today)
  ));
  return currentAndFuture.length ? currentAndFuture : forecasts.slice(-1);
}

function initialForecastForToday(forecasts, fallbackForecast, today = localTodayInLaJolla()) {
  return forecasts.find((forecast) => forecast.date === today)
    || forecasts.find((forecast) => forecast.date && forecast.date > today)
    || forecasts[0]
    || fallbackForecast;
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
  const waterTempKey = enriched?.buoy_water_temp_f != null ? "buoy_water_temp_f" : "water_temp_estimate_f";
  const waterTempLabel = enriched?.buoy_water_temp_f != null ? "Water temp (buoy)" : "Water temp (est.)";
  const wanted = [
    [waterTempLabel, waterTempKey, "°F"],
    ["Today's high", "air_temp_max_f", "°F"],
    ["Rain forecast", "rain_24h_in", "in"],
    ["72-hour rain", "rain_prior_3day_in", "in"],
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

const cdfwRulesUrl = "https://wildlife.ca.gov/Fishing/Ocean/Regulations/Fishing-Map/Southern";

const fishTargets = [
  { name: "Kelp bass", habitat: "Kelp edge / boulders", prize: 62, abundance: 88, note: "reliable reef target", photo: 6, sizeRule: "14 in total length minimum; 5/day.", takeNote: "Listed as kelp bass in CDFW regulations. Open-area and MPA rules still apply." },
  { name: "California sheephead", habitat: "Reef / boulders", prize: 70, abundance: 80, note: "solid table fish", photo: 3, sizeRule: "12 in total length minimum; 2/day.", takeNote: "Divers are generally open year-round, but confirm current CDFW rules before take." },
  { name: "White seabass", habitat: "Kelp edge / open water", prize: 96, abundance: 24, note: "top SD trophy", photo: 1, sizeRule: "28 in total length minimum; 3/day, but 1/day Mar 15-Jun 15 south of Pt. Conception.", takeNote: "La Jolla is south of Pt. Conception. MPAs still apply." },
  { name: "California halibut", habitat: "Sand channels", prize: 88, abundance: 35, note: "prime table fish", photo: 2, sizeRule: "22 in total length minimum; 5/day south of Pt. Sur.", takeNote: "Measure total length before retaining." },
  { name: "Yellowtail", habitat: "Outer kelp / blue water", prize: 92, abundance: 28, note: "pelagic trophy", photo: 0, sizeRule: "24 in fork length minimum; 10/day.", takeNote: "Confirm current CDFW bag language before taking." },
  { name: "California barracuda", habitat: "Mid-water / kelp edge", prize: 55, abundance: 52, note: "spring run target", photo: 5, sizeRule: "28 in fork length minimum; 10/day.", takeNote: "Pelagic run timing changes fast." },
  { name: "Opaleye", habitat: "Shallow reef", prize: 38, abundance: 78, note: "ubiquitous, decent eating", photo: 10, sizeRule: "Verify current general finfish rules.", takeNote: "Confirm identification and local MPA boundaries." },
  { name: "Blacksmith", habitat: "Mid-water over reef", prize: 12, abundance: 95, note: "#1 most-abundant fish", photo: 7, sizeRule: "Not a normal table target.", takeNote: "Useful visibility and reef-life indicator." },
  { name: "Barred surfperch", habitat: "Sand / surf transition", prize: 32, abundance: 62, note: "shore-dive beginner fish", photo: 11, sizeRule: "Surfperch rules depend on species and area.", takeNote: "Confirm identification and current limits." },
  { name: "Garibaldi", habitat: "Reef", prize: 0, abundance: 85, note: "PROHIBITED, no take", photo: 8, sizeRule: "Do not take.", takeNote: "Garibaldi are protected statewide." },
  { name: "Halfmoon", habitat: "Kelp canopy / mid-water", prize: 35, abundance: 60, note: "light table value", photo: 4, sizeRule: "Verify current general finfish rules.", takeNote: "Confirm identification and MPA boundaries." },
  { name: "Sargo / black perch", habitat: "Reef ledges / sand edge", prize: 30, abundance: 65, note: "common surfperch family", photo: 9, sizeRule: "Species-specific rules may apply.", takeNote: "Confirm identification before retaining." },
];

const fishWikiTitles = {
  "Kelp bass": "Kelp_bass",
  "California sheephead": "Semicossyphus_pulcher",
  "White seabass": "White_seabass",
  "California halibut": "California_halibut",
  "Yellowtail": "California_yellowtail",
  "California barracuda": "California_barracuda",
  "Opaleye": "Opaleye",
  "Blacksmith": "Blacksmith_(fish)",
  "Barred surfperch": "Barred_surfperch",
  "Garibaldi": "Garibaldi_(fish)",
  "Halfmoon": "Halfmoon_(fish)",
  "Sargo / black perch": "Sargo_(fish)",
  "Yellowtail snapper": "Yellowtail_snapper",
  "Hogfish": "Hogfish",
  "Mutton snapper": "Mutton_snapper",
  "Gray snapper": "Mangrove_snapper",
  "Black grouper": "Black_grouper",
  "Red grouper": "Red_grouper",
  "Bluestriped grunt": "Bluestriped_grunt",
  "Blue tang": "Blue_tang",
  "Stoplight parrotfish": "Stoplight_parrotfish",
  "Great barracuda": "Great_barracuda",
  "African pompano": "African_pompano",
  "Lionfish": "Pterois",
  "Sheepshead": "Sheepshead_(fish)",
  "Mangrove snapper": "Mangrove_snapper",
  "Snook": "Common_snook",
  "Tarpon": "Atlantic_tarpon",
  "Crevalle jack": "Crevalle_jack",
  "Lookdown": "Lookdown_(fish)",
  "Porkfish": "Porkfish",
  "Gray triggerfish": "Grey_triggerfish",
  "Spanish / cero mackerel": "Spanish_mackerel",
  "Cobia": "Cobia",
  "Sergeant major": "Sergeant_major_(fish)",
  "Southern stingray": "Southern_stingray",
  "Yellow stingray": "Yellow_stingray",
  "Bar jack": "Bar_jack",
  "Sand diver": "Synodus_intermedius",
  "Peacock flounder": "Peacock_flounder",
  "Goatfish": "Mullidae",
  "Yellowhead jawfish": "Yellowhead_jawfish",
  "Spotted eagle ray": "Spotted_eagle_ray",
  "Nassau grouper": "Nassau_grouper",
  "Spotted scorpionfish": "Scorpaena_plumieri",
  "Caribbean reef squid": "Caribbean_reef_squid",
  "Bluehead wrasse": "Bluehead_wrasse",
  "French grunt": "French_grunt",
  "Foureye butterflyfish": "Foureye_butterflyfish",
  "Queen / French angelfish": "Queen_angelfish",
  "Caribbean reef shark": "Caribbean_reef_shark",
  "Senorita": "Oxyjulis_californica",
  "Black perch": "Black_perch",
  "Giant sea bass": "Giant_sea_bass",
  "Bat ray": "Bat_ray",
  "Horn shark": "Horn_shark",
  "Giant kelpfish": "Giant_kelpfish",
  "Bat ray / leopard shark": "Bat_ray",
  "Yellowtail parrotfish": "Yellowtail_parrotfish",
  "Stoplight / rainbow parrotfish": "Stoplight_parrotfish",
  "French / queen angelfish": "French_angelfish",
  "Lemon shark": "Lemon_shark",
  "Atlantic spadefish": "Atlantic_spadefish",
  "West Indian manatee": "West_Indian_manatee",
  "Florida pompano": "Florida_pompano",
  "Permit": "Permit_(fish)",
  "King / Spanish mackerel": "King_mackerel",
};

const fishImageCache = new Map();

function fishWikiTitle(name) {
  return fishWikiTitles[name] || String(name || "").split("/")[0].trim().replaceAll(" ", "_");
}

async function loadFishPhoto(image, fish) {
  if (!image || image.dataset.loaded === "true") return;
  const frame = image.closest(".fish-photo");
  const label = frame?.querySelector("span");
  const title = fishWikiTitle(fish.name);
  image.dataset.loaded = "true";
  if (label) label.textContent = "Loading photo...";

  try {
    let source = fishImageCache.get(title);
    if (source === undefined) {
      const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if (!response.ok) throw new Error("image unavailable");
      const data = await response.json();
      source = data.thumbnail?.source || data.originalimage?.source || "";
      fishImageCache.set(title, source);
    }

    if (!source) throw new Error("image unavailable");
    image.src = source;
    image.alt = `${fish.name} photo`;
    image.hidden = false;
    if (label) label.hidden = true;
  } catch {
    image.hidden = true;
    if (label) label.textContent = "Photo unavailable";
  }
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function fishRankings(data) {
  const targets = Array.isArray(data.fish_targets) && data.fish_targets.length ? data.fish_targets : fishTargets;
  return targets.map((fish, index) => ({
    ...fish,
    prize: clampScore(fish.prize ?? 0),
    abundance: clampScore(fish.abundance ?? 0),
    photo: Number.isFinite(Number(fish.photo)) ? Number(fish.photo) : index % 12,
  }));
}

function renderFishRadar(data) {
  const grid = document.getElementById("fishGrid");
  if (!grid) return;
  const fishCard = grid.closest(".fish-card");
  const sectionLabel = fishCard?.querySelector(".section-heading span");
  const footnote = fishCard?.querySelector(":scope > p");
  const prizeLabel = data.fish_prize_label || "Prize";
  const ruleLabel = data.fish_rule_label || "Spearfishing size guidance";
  const rulesUrl = data.fish_rules_url || (data.fish_targets ? "" : cdfwRulesUrl);
  const rulesLinkText = data.fish_rules_link_text || "Check current regulations";

  if (sectionLabel && data.fish_context) sectionLabel.textContent = data.fish_context;
  if (footnote) {
    footnote.textContent = data.fish_legal_label
      ? "Tap a species for local guidance. Confirm current rules, seasons, closures, and local protected areas before taking fish."
      : "Tap a species for take-size guidance. Confirm current rules, seasons, closures, and local MPAs before taking fish.";
  }

  if (fishCard) {
    let note = fishCard.querySelector(".fish-site-note");
    if (data.fish_legal_label) {
      if (!note) {
        note = document.createElement("div");
        note.className = "fish-site-note";
        fishCard.insertBefore(note, grid);
      }
      note.textContent = data.fish_legal_label;
    } else if (note) {
      note.remove();
    }
  }

  grid.replaceChildren(...fishRankings(data).map((fish, index) => {
    const card = document.createElement("details");
    card.className = `fish-row${index < 3 ? " is-prime" : ""}`;
    const link = rulesUrl
      ? `<a href="${rulesUrl}" target="_blank" rel="noopener">${rulesLinkText}</a>`
      : "";
    card.innerHTML = `
      <summary>
        <div class="fish-rank">${index + 1}</div>
        <div class="fish-title">
          <strong>${fish.name}</strong>
          <span>${fish.habitat} · ${fish.note}</span>
        </div>
        <div class="fish-summary-scores">
          <span>${prizeLabel} ${fish.prize}</span>
          <span>Abundance ${fish.abundance}</span>
        </div>
        <span class="expand-label">View</span>
      </summary>
      <div class="fish-details">
        <div class="fish-photo">
          <img alt="${fish.name} photo" loading="lazy" hidden>
          <span>Tap to load fish photo</span>
        </div>
        <div class="fish-meters" aria-hidden="true">
          <div class="fish-meter"><span>${prizeLabel}</span><i style="width:${fish.prize}%"></i></div>
          <div class="fish-meter abundance"><span>Abundance</span><i style="width:${fish.abundance}%"></i></div>
        </div>
        <div class="fish-rule">
          <span>${ruleLabel}</span>
          <strong>${fish.sizeRule || "Confirm current local rules before take."}</strong>
          <p>${fish.takeNote || "Regulations change. Use this as prototype guidance, not final legal advice."}</p>
          ${link}
        </div>
      </div>
    `;
    card.addEventListener("toggle", () => {
      if (card.open) loadFishPhoto(card.querySelector(".fish-photo img"), fish);
    });
    return card;
  }));
}

function defaultReport(data) {
  const range = data.estimated_visibility_range_ft || [0, 6];
  return `The model expects ${feet(range)} visibility based on the available wave, wind, tide, and rain inputs.`;
}

function cameraImageForGrade(grade) {
  const letter = String(grade || "").trim().toUpperCase().match(/[ABCDF]/)?.[0] || "C";
  if (letter === "A" || letter === "B") return "viz-best.jpg";
  if (letter === "D" || letter === "F") return "viz-bad.jpg";
  return "viz-mid.jpg";
}

let scrippsCameraObservation = null;

function cameraObservationDisplay(data) {
  const observation = scrippsCameraObservation;
  const grade = String(observation?.grade || "").trim().toUpperCase();
  const range = observation?.visibility_range_ft;
  const hasReviewedObservation = Boolean(
    observation
      && observation.status === "manual_observation"
      && data?.date === observation.observation_date
      && ["A+", "A", "B", "C", "D", "F"].includes(grade)
      && Array.isArray(range)
      && range.length === 2
      && range.every((value) => Number.isFinite(Number(value))),
  );
  if (!hasReviewedObservation) return data;

  const score = Number(observation.numeric_score_0_100);
  return {
    ...data,
    grade,
    estimated_visibility_range_ft: range.map(Number),
    numeric_score_0_100: Number.isFinite(score) ? score : data.numeric_score_0_100,
    is_camera_observation: true,
    camera_observation_slot: observation.slot,
  };
}

function cameraSlotLabel(slot) {
  const hour = Number(String(slot || "").split(":")[0]);
  if (Number.isNaN(hour)) return "today";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function renderCamera(data) {
  const frame = document.getElementById("cameraFrame");
  const image = document.getElementById("cameraImage");
  if (!frame || !image) return;

  const iframe = frame.querySelector("iframe");
  if (iframe) iframe.remove();
  const playButton = frame.querySelector(".camera-play-button");
  if (playButton) playButton.remove();
  frame.classList.remove("is-playing");
  image.hidden = false;

  const badge = document.getElementById("cameraObservedBadge");
  const observation = scrippsCameraObservation;
  const showObservation = Boolean(
    observation && (!data.date || data.date === observation.observation_date),
  );
  if (showObservation) {
    const slotLabel = cameraSlotLabel(observation.slot);
    image.src = observation.image_url;
    image.alt = `Scripps Pier underwater camera, captured today at ${slotLabel}`;
    if (badge) {
      badge.textContent = `Today ${slotLabel}`;
      badge.classList.remove("is-reference");
      badge.hidden = false;
    }
  } else {
    image.src = cameraImageForGrade(data.grade);
    image.alt = `${data.location || "Dive spot"} estimated visibility reference`;
    if (badge) {
      const fallbackLabels = {
        pending: "Reference image \u00b7 live photo pending",
        offline: "Camera offline \u00b7 reference image",
        unavailable: "Reference image \u00b7 not live",
      };
      badge.textContent =
        fallbackLabels[scrippsCameraFallbackReason] || fallbackLabels.unavailable;
      badge.classList.add("is-reference");
      badge.hidden = false;
    }
  }
  frame.hidden = false;
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
  if (!chart) return;
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
  if (!chart) return;
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
  const bandWidth = width / points.length;
  const barWidth = Math.max(8, bandWidth - gap);
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
        const x = left + (index * bandWidth) + (gap / 2);
        const y = yFromValue(speed, min, max, top, height);
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${(top + height - y).toFixed(2)}" rx="4" class="wind-bar ${windGradeClass(speed)}" style="fill: ${windGradeColor(speed)}"><title>${hourLabel(point.time)}: ${speed.toFixed(1)} mph</title></rect>`;
      }).join("")}
    </svg>
  `;
}

function windGradeClass(speed) {
  if (speed <= 1) return "wind-grade-a-plus";
  if (speed <= 4) return "wind-grade-a";
  if (speed <= 6) return "wind-grade-b";
  if (speed <= 8) return "wind-grade-c";
  if (speed <= 10) return "wind-grade-d";
  return "wind-grade-f";
}

function windGradeColor(speed) {
  if (speed <= 1) return "#0075df";
  if (speed <= 4) return "#13baee";
  if (speed <= 6) return "#5e8ee8";
  if (speed <= 8) return "#a64bd8";
  if (speed <= 10) return "#d82fca";
  return "#ee13ba";
}

function displayWaveHeight(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number * DISPLAY_HS_TO_CHAR : NaN;
}

function formatWaveFeet(value) {
  const number = displayWaveHeight(value);
  return Number.isFinite(number) ? `${number.toFixed(1)} ft` : "n/a";
}

function formatPeriod(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}s` : "n/a";
}

function formatDirection(label, degrees) {
  const direction = label || directionFromDegrees(degrees);
  const number = Number(degrees);
  if (direction && Number.isFinite(number)) return `${direction} ${Math.round(number)}°`;
  return direction || "n/a";
}

function waveHeightValue(forecast) {
  const features = forecast?.features || {};
  return displayWaveHeight(
    features.surf_height_max_ft
    ?? features.wave_height_max_ft
    ?? features.swell_wave_height_max_ft
    ?? 0
  );
}

function renderWaveComponents(data) {
  const container = document.getElementById("waveComponents");
  if (!container) return;
  const features = data.features || {};
  const rows = [
    {
      label: "Primary",
      height: features.swell_wave_height_max_ft,
      period: features.swell_wave_period_max_s,
      directionLabel: features.swell_direction_label,
      directionDeg: features.swell_wave_direction_deg,
    },
    {
      label: "Secondary",
      height: features.secondary_swell_height_ft ?? features.wind_wave_height_max_ft,
      period: features.secondary_swell_period_s ?? features.wind_wave_period_max_s,
      directionLabel: features.secondary_swell_direction_label,
      directionDeg: features.secondary_swell_direction_deg ?? features.wind_direction_deg,
    },
  ];
  container.innerHTML = `
    <div class="wave-component-grid" role="table" aria-label="Swell components">
      <span></span>
      <span>Swell</span>
      <span>Period</span>
      <span>Dir</span>
      ${rows.map((row) => `
        <strong>${row.label}</strong>
        <em>${formatWaveFeet(row.height)}</em>
        <em>${formatPeriod(row.period)}</em>
        <em>${formatDirection(row.directionLabel, row.directionDeg)}</em>
      `).join("")}
    </div>
    <div class="wave-component-cards" aria-label="Swell components">
      ${rows.map((row) => `
        <article class="wave-component-card">
          <span>${row.label}</span>
          <strong>${formatWaveFeet(row.height)}</strong>
          <em>${formatPeriod(row.period)} · ${formatDirection(row.directionLabel, row.directionDeg)}</em>
        </article>
      `).join("")}
    </div>
  `;
}

function formatUserTime(value) {
  const match = String(value || "").match(/(?:T|\s|^)(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return "";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

const REPORT_TEXT_VERSION = "v2-explanatory-three-paragraph";

function narrativeNumber(features, ...keys) {
  for (const key of keys) {
    const number = Number(features[key]);
    if (features[key] !== null && features[key] !== "" && Number.isFinite(number)) return number;
  }
  return null;
}

function joinNarrativeItems(items) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function narrativeDrivers(features) {
  const negative = [];
  const positive = [];
  const surf = narrativeNumber(features, "surf_height_max_ft", "wave_height_max_ft");
  const swellEnergy = narrativeNumber(features, "swell_power_proxy_max", "wave_energy_max_kj");
  const shortEnergy = narrativeNumber(features, "short_period_swell_energy");
  const wind = narrativeNumber(features, "wind_speed_max_mph");
  const rain = narrativeNumber(features, "rain_target_day_forecast_in", "rain_24h_in");
  const priorRain = narrativeNumber(features, "rain_prior_3day_in", "ml_rain_3day_in");
  const waveTrend = narrativeNumber(features, "ml_wave_trend");

  if (swellEnergy !== null) {
    if (swellEnergy >= 70) negative.push("swell energy");
    else if (swellEnergy <= 40) positive.push("lower swell energy");
  }
  if (surf !== null) {
    if (surf >= 3) negative.push("surface movement");
    else if (surf <= 2.25) positive.push("limited surface movement");
  }
  if (shortEnergy !== null && shortEnergy >= 18) negative.push("short-period wind-wave churn");
  if (wind !== null) {
    if (wind >= 8) negative.push("wind-driven mixing");
    else if (wind <= 6) positive.push("lighter winds");
  }
  if ((rain !== null && rain >= 0.1) || (priorRain !== null && priorRain >= 0.1)) {
    negative.push("rain-related nearshore mixing");
  } else if (rain !== null && priorRain !== null && rain < 0.05 && priorRain < 0.05) {
    positive.push("dry recent conditions");
  }
  if (waveTrend !== null) {
    if (waveTrend >= 0.2) negative.push("a building wave trend");
    else if (waveTrend <= -0.2) positive.push("an easing wave trend");
  }

  return {
    negative: negative.slice(0, 3),
    positive: positive.slice(0, 3),
  };
}

function buildLajollaNarrative(data) {
  const features = data.features || {};
  const visibility = data.estimated_visibility_range_ft || [0, 4];
  const low = Number.isFinite(Number(visibility[0])) ? Number(visibility[0]) : 0;
  const high = Number.isFinite(Number(visibility[1])) ? Number(visibility[1]) : 4;
  const grade = String(data.grade || "F").toUpperCase();
  const { negative, positive } = narrativeDrivers(features);
  const negativeCopy = joinNarrativeItems(negative);
  const positiveCopy = joinNarrativeItems(positive);
  const opening = `The model expects ${low}-${high} ft of visibility, resulting in a ${grade} grade.`;
  let driverCopy;

  if (grade === "A" || grade === "A+") {
    const support = positiveCopy || "relatively settled conditions in the available inputs";
    driverCopy = `Conditions are very favorable overall, supported by ${support}.`;
    if (negativeCopy) driverCopy += ` The remaining ${negativeCopy} are not strong enough to displace the high-clarity result.`;
  } else if (grade === "B") {
    const support = positiveCopy || "a generally manageable disturbance profile";
    driverCopy = `Conditions are favorable overall, with ${support} supporting useful clarity.`;
    driverCopy += negativeCopy
      ? ` Some ${negativeCopy} keep the forecast below exceptional A-grade conditions.`
      : " Residual uncertainty keeps the forecast below exceptional A-grade conditions.";
  } else if (grade === "C") {
    const constraints = negativeCopy || "a mixed set of swell, surface and wind signals";
    driverCopy = `Conditions are moderately favorable overall, but the algorithm is seeing enough ${constraints} to prevent a clearer B-grade forecast.`;
  } else if (grade === "D") {
    const constraints = negativeCopy || "multiple unsettled physical signals";
    driverCopy = `Conditions are marginal, with ${constraints} creating significant pressure on visibility.`;
  } else {
    const constraints = negativeCopy || "strongly unsettled physical signals";
    driverCopy = `Conditions are poor, and ${constraints} point to very limited underwater clarity.`;
  }

  const tidePhase = String(features.tide_phase || "unknown").trim().toLowerCase();
  const nextTide = features.tide_next_event && typeof features.tide_next_event === "object"
    ? features.tide_next_event
    : null;
  const nextTime = nextTide ? formatUserTime(nextTide.time) : "";
  const nextType = String(nextTide?.type || "").toUpperCase();
  const eventName = nextType === "H" ? "high tide" : nextType === "L" ? "low tide" : "tide change";
  const eventCopy = nextTime ? ` at ${nextTime}` : "";
  let tideParagraph;

  if (tidePhase === "rising") {
    tideParagraph = `The rising tide is a favorable signal. As water moves toward the next ${eventName}${eventCopy}, cleaner offshore water may move into La Jolla and support improving visibility.`;
  } else if (tidePhase === "falling") {
    tideParagraph = `The falling tide is an additional negative signal. As water moves toward the next ${eventName}${eventCopy}, visibility may gradually decline because the outgoing tide is less likely to bring cleaner offshore water into La Jolla.`;
  } else if (["slack", "near slack", "near-slack"].includes(tidePhase)) {
    tideParagraph = `The tide is near slack and is a more neutral visibility signal. The next ${eventName}${eventCopy} may change water movement, but the current tide offers limited directional support either way.`;
  } else {
    tideParagraph = `The next ${eventName}${eventCopy} could still change nearshore water movement, so local clarity may vary.`;
  }

  let practicalParagraph;
  if (grade === "A" || grade === "A+") {
    practicalParagraph = "Overall, conditions look very favorable for productive diving, though clarity can still vary around sandy bottoms and surge-prone sections of exposed reef.";
  } else if (grade === "B") {
    practicalParagraph = "Overall, the forecast is favorable for diving. Sheltered coves and deeper water may hold the clearest conditions, while exposed coastline and sandy entries could be less consistent.";
  } else if (grade === "C") {
    practicalParagraph = "Overall, the forecast remains diveable, but clarity may vary by location and could be worse around shallow reefs, sandy bottoms and areas exposed to surge.";
  } else if (grade === "D") {
    practicalParagraph = "Overall, visibility looks marginal. Divers should confirm local conditions before committing and favor sheltered coves or deeper water over shallow, sandy, or surge-exposed areas.";
  } else {
    practicalParagraph = "Overall, conditions look poor and are unlikely to support productive diving. Consider postponing or verifying a substantially clearer sheltered site before entering the water.";
  }

  return [`${opening} ${driverCopy}`, tideParagraph, practicalParagraph].join("\n\n");
}

function reportText(data) {

  const features = data.features || {};
  const range = feet(data.estimated_visibility_range_ft || [0, 6]);
  const grade = String(data.grade || "C").replace("+", "");
  const swell = Number(features.swell_wave_height_max_ft ?? features.total_swell_height_mean_ft ?? 0);
  const period = Number(features.swell_wave_period_max_s ?? features.swell_wave_period_sec ?? 0);
  const wind = Number(features.wind_speed_max_mph ?? 0);
  const rain = Number(features.rain_target_day_forecast_in ?? features.rain_24h_in ?? 0);
  const priorRain = Number(features.rain_prior_3day_in ?? features.ml_rain_3day_in ?? 0);
  const tidePhase = features.tide_phase;
  const nextTide = features.tide_next_event;
  const direction = features.swell_direction_label
    || directionFromDegrees(features.swell_wave_direction_deg)
    || "SW";
  const swellCopy = Number.isFinite(swell) && swell > 0
    ? `${swell.toFixed(1)} ft @ ${Math.round(period)}s ${direction} swell`
    : "light rolling swell";
  const windCopy = Number.isFinite(wind) && wind > 0
    ? `${Math.round(wind)} mph peak wind`
    : "light wind";
  const rainParts = [];
  if (Number.isFinite(rain) && rain >= 0.05) rainParts.push(`${rain.toFixed(1)} in forecast rain`);
  if (Number.isFinite(priorRain) && priorRain >= 0.05) rainParts.push(`${priorRain.toFixed(1)} in recent 72-hour rain`);
  const rainCopy = rainParts.length ? `, and ${rainParts.join(" plus ")}` : "";
  const tideCopy = nextTide
    ? `The tide signal is ${tidePhase || "mixed"}, with the next ${nextTide.type === "H" ? "high" : "low"} near ${Number(nextTide.height_ft).toFixed(1)} ft at ${formatUserTime(nextTide.time) || "an unavailable time"}.`
    : tidePhase
      ? `The tide signal is ${tidePhase}.`
      : "";
  const waveCopy = waveWeight(data);

  if (data.is_camera_observation) {
    const slotLabel = cameraSlotLabel(data.camera_observation_slot);
    return `Today's ${slotLabel} Scripps Pier camera observation indicates ${range} visibility with a grade ${data.grade}. Weather context remains forecast-driven: ${swellCopy}, ${waveCopy.toLowerCase()}, and ${windCopy}${rainCopy}. ${tideCopy}`.trim();
  }

  if (data.is_unavailable) return data.report_text || "Forecast data unavailable.";
  if (data.report_text_version === REPORT_TEXT_VERSION && data.report_text) return data.report_text;
  return buildLajollaNarrative(data);
}

function waveWeight(data) {
  const features = data.features || {};
  const swell = Number(features.swell_wave_height_max_ft ?? features.swell_wave_height_ft ?? features.total_swell_height_mean_ft ?? 0);
  const period = Number(features.swell_wave_period_max_s ?? features.swell_wave_period_sec ?? features.swell_period_sec ?? 0);
  if (!Number.isFinite(swell) || swell <= 0) return "Light";
  const range = waveRange(swell);
  if (swell >= 4 || (swell >= 3 && period <= 10)) return `${range} · Heavy`;
  if (swell >= 2) return `${range} · Moderate`;
  return `${range} · Light`;
}

function waveRange(feet) {
  const low = Math.max(0, Math.floor(feet));
  const high = Math.max(low + 1, Math.ceil(feet));
  return `${low}-${high} ft`;
}

function gradeClass(grade) {
  return `grade-${String(grade || "C").toLowerCase().replace("+", "-plus")}`;
}

function formatOneDecimal(value, fallback = "n/a") {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : fallback;
}

function renderWaveSwell(data) {
  const features = data.features || {};
  const surf = formatOneDecimal(features.surf_height_max_ft ?? features.wave_height_max_ft ?? features.total_swell_height_mean_ft, "0.0");
  const primarySwell = formatOneDecimal(features.swell_wave_height_max_ft ?? features.primary_swell_height_max_ft, "0.0");
  const primaryPeriod = Math.round(Number(features.swell_wave_period_max_s ?? features.primary_swell_period_max_s ?? 0));
  const primaryDirection = features.swell_direction_label || directionFromDegrees(features.swell_wave_direction_deg) || "SW";
  const primaryDegrees = Number(features.swell_wave_direction_deg ?? features.primary_swell_direction_deg);
  const secondarySwell = formatOneDecimal(features.secondary_swell_height_ft ?? features.wind_wave_height_max_ft, "0.0");
  const secondaryPeriod = Math.round(Number(features.secondary_swell_period_s ?? features.wind_wave_period_max_s ?? 0));
  const secondaryDirection = features.secondary_swell_direction_label || directionFromDegrees(features.secondary_swell_direction_deg) || "WNW";
  const secondaryDegrees = Number(features.secondary_swell_direction_deg);

  setText("surfHeight", waveRange(Number(surf)));
  setText("primarySwell", `${primarySwell} ft`);
  setText("primaryPeriod", `${primaryPeriod || "n/a"}s`);
  setText("primaryDirection", `${primaryDirection}${Number.isFinite(primaryDegrees) ? ` ${Math.round(primaryDegrees)}°` : ""}`);
  setText("secondarySwell", `${secondarySwell} ft`);
  setText("secondaryPeriod", `${secondaryPeriod || "n/a"}s`);
  setText("secondaryDirection", `${secondaryDirection}${Number.isFinite(secondaryDegrees) ? ` ${Math.round(secondaryDegrees)}°` : ""}`);

  renderSwellChart(data);
}

function renderSwellChart(data) {
  const chart = document.getElementById("swellChart");
  if (!chart) return;
  const features = data.features || {};
  const base = Number(features.surf_height_max_ft ?? features.wave_height_max_ft ?? features.total_swell_height_mean_ft ?? 2.5);
  const points = Array.from({ length: 9 }, (_, index) => ({
    time: ["12am", "3am", "6am", "9am", "12pm", "3pm", "6pm", "9pm", "11pm"][index],
    value: Math.max(0.4, base + (index - 3) * 0.12 + Math.sin(index / 2) * 0.18),
  }));
  const max = Math.max(5, Math.ceil(Math.max(...points.map((point) => point.value))));
  const left = 72;
  const top = 24;
  const width = 856;
  const height = 150;
  const coords = points.map((point, index) => {
    const x = xFromIndex(index, points.length, left, width);
    const y = yFromValue(point.value, 0, max, top, height);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const area = `${left},${top + height} ${coords} ${left + width},${top + height}`;
  chart.innerHTML = `
    <svg viewBox="0 0 1000 230" role="img" aria-label="Hourly wave height and swell chart">
      ${[0, Math.round(max / 2), max].map((tick) => {
        const y = yFromValue(tick, 0, max, top, height);
        return `
          <line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="chart-gridline"></line>
          <text x="${left - 10}" y="${y + 4}" class="chart-y-label" text-anchor="end">${tick} ft</text>
        `;
      }).join("")}
      ${points.map((point, index) => {
        const x = xFromIndex(index, points.length, left, width);
        return `
          <line x1="${x}" x2="${x}" y1="${top}" y2="${top + height}" class="chart-x-grid ${index % 2 ? "is-soft" : ""}"></line>
          <text x="${x}" y="206" class="chart-x-label" text-anchor="middle">${point.time}</text>
        `;
      }).join("")}
      <polygon points="${area}" class="swell-area"></polygon>
      <polyline points="${coords}" class="swell-line"></polyline>
      ${points.map((point, index) => {
        const x = xFromIndex(index, points.length, left, width);
        const y = yFromValue(point.value, 0, max, top, height);
        return `<circle cx="${x}" cy="${y}" r="4" class="swell-point"></circle>`;
      }).join("")}
      <line x1="${left + width}" x2="${left + width}" y1="${top}" y2="${top + height}" class="swell-now"></line>
    </svg>
  `;
}

function renderWeather(data) {
  document.querySelectorAll(".weather-grid > div").forEach((tile) => {
    const label = tile.querySelector("span")?.textContent?.toLowerCase() || "";
    const value = tile.querySelector("strong")?.textContent?.toLowerCase() || "";
    if (
      label.includes("chlorophyll")
      || label.includes("chla")
      || value.includes("no satellite data")
    ) {
      tile.remove();
    }
  });
  const features = data.features || {};
  setText("waterTemp", `${formatOneDecimal(features.water_temp_estimate_f ?? features.ml_sst_f, "n/a")} F`);
  setText("rainForecast", `${formatOneDecimal(features.rain_target_day_forecast_in ?? features.rain_24h_in, "0.0")} in`);
  setText("rain72", `${formatOneDecimal(features.rain_prior_3day_in ?? features.ml_rain_3day_in, "0.0")} in`);
}

function render(data) {
  data = cameraObservationDisplay(data);
  const range = data.estimated_visibility_range_ft || [0, 6];
  const score = data.numeric_score_0_100 ?? 0;
  setText("location", data.location || "La Jolla / Scripps Pier");
  setText("grade", data.grade || "C");
  setText("visibility", feet(range));
  setText("bestWindow", data.best_window || "Early morning");
  setText("waveWeight", waveWeight(data));
  setText(
    "forecastSource",
    data.is_camera_observation
      ? `Observed at ${cameraSlotLabel(data.camera_observation_slot)} · forecast context from model`
      : data.is_projected
        ? `Projected from ${shortDate(data.projected_from || data.date)}`
        : "Model prediction from parsed conditions",
  );
  setText("dailyReport", reportText(data));
  const panel = document.querySelector(".forecast-panel");
  const grade = document.getElementById("grade");
  if (panel) panel.className = `forecast-panel ${data.is_unavailable ? "" : gradeClass(data.grade)}`;
  if (grade) grade.className = data.is_unavailable ? "" : gradeClass(data.grade);
  document.getElementById("scoreFill").style.width = `${data.is_unavailable ? 0 : score}%`;
  const featureEl = document.getElementById("featureRows");
  if (featureEl) featureEl.innerHTML = data.is_unavailable ? "" : featureRows(data.features || {});
  if (data.is_unavailable) {
    document.getElementById("tideChart").textContent = "Forecast data unavailable.";
    document.getElementById("windChart").textContent = "Forecast data unavailable.";
    const waveChart = document.getElementById("waveChart");
    if (waveChart) waveChart.textContent = "Forecast data unavailable.";
    return;
  }
  renderWaveComponents(data);
  renderCamera(data);
  renderTideChart(data);
  renderWindChart(data);
  renderWaveSwell(data);
  renderWeather(data);
}

function renderForecastStrip(forecasts, activeDate) {
  const strip = document.getElementById("forecastStrip");
  if (!strip) return;

  if (!forecasts.length) {
    strip.textContent = "Forecast unavailable.";
    return;
  }
  function selectForecast(forecast, source = "forecast_day_select") {
    render(forecast);
    renderForecastStrip(forecasts, forecast.date);
    if (source !== "wind_map_timeline") {
      window.dispatchEvent(new CustomEvent("divepro:forecastDateSelected", {
        detail: {
          date: forecast.date,
          source,
        },
      }));
    }
    window.diveproTrack(source, {
      forecast_date: forecast.date,
      grade: forecast.grade,
    });
  }

  window.__diveProSelectForecastDate = (dateOrDetail, source = "wind_map_day_select") => {
    const detail = typeof dateOrDetail === "object" && dateOrDetail !== null ? dateOrDetail : { date: dateOrDetail };
    const forecast = forecasts.find((item) => item.date === detail.date) || forecasts[detail.dayIndex];
    if (!forecast) return false;
    selectForecast(forecast, detail.source || source);
    return true;
  };

  strip.replaceChildren(...forecasts.map((forecast) => {
    const displayedForecast = cameraObservationDisplay(forecast);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `forecast-day ${gradeClass(displayedForecast.grade)}${forecast.date === activeDate ? " is-active" : ""}`;
    button.setAttribute("aria-pressed", forecast.date === activeDate ? "true" : "false");
    button.innerHTML = `
      <span>${dayLabel(forecast.date)}</span>
      <strong>${displayedForecast.grade}</strong>
      <em>${feet(displayedForecast.estimated_visibility_range_ft || [0, 6])}</em>
      <small>${forecast.is_projected ? "Projected" : shortDate(forecast.date)}</small>
    `;
    button.addEventListener("click", () => {
      selectForecast(forecast);
    });
    return button;
  }));
}

function renderGradeGuide(gradeGuide) {
  const guide = document.getElementById("gradeGuide");
  if (!guide) return;
  if (!gradeGuide.length) {
    guide.textContent = "Grade guidance unavailable.";
    return;
  }
  guide.replaceChildren(...gradeGuide.map((item) => {
    const row = document.createElement("div");
    const [min, max] = item.visibility_range_ft;
    row.className = gradeClass(item.grade);
    row.innerHTML = `
      <strong>${item.grade}</strong>
      <span>${min}-${max} ft</span>
      <em>${item.source === "diveprosd_public_posts" ? "Scraped from DiveProSD posts" : "Inferred extension"}</em>
    `;
    return row;
  }));
}

function renderCommunityReport(data) {
  const section = document.getElementById("communitySection");
  const report = data?.community_report;
  if (!section) return;
  if (!report || !report.visibility_ft || report.error) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const confidence = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };
  setText("communityConfidence", confidence[report.confidence_label] || "");
  setText("communityVis", `Reported visibility: ${report.visibility_ft[0]}–${report.visibility_ft[1]} ft`);
  setText("communityExcerpt", report.source_excerpt || "");
}

function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function renderStaleNotice(latest) {
  const banner = document.getElementById("staleBanner");
  if (!banner) return;
  const isStale = !latest.is_unavailable && latest.date && latest.date < todayPacific();
  if (!isStale) {
    banner.hidden = true;
    return;
  }
  banner.textContent = `Last updated ${shortDate(latest.date)} — conditions may have changed since this forecast was issued.`;
  banner.hidden = false;
}

function normalizeForecastHistory(history) {
  const rawEntries = Array.isArray(history)
    ? history
    : Array.isArray(history?.reports)
      ? history.reports
      : Array.isArray(history?.entries)
        ? history.entries
        : Array.isArray(history?.history)
          ? history.history
          : [];

  return rawEntries
    .filter((entry) => entry && entry.date)
    .map((entry) => ({
      ...entry,
      generated_at: entry.generated_at || entry.archived_at || entry.date,
      report_text: entry.report_text || entry.daily_report || entry.summary || "",
    }))
    .sort((a, b) => String(b.generated_at || b.date).localeCompare(String(a.generated_at || a.date)));
}

function renderForecastHistory(history, currentDate) {
  const list = document.getElementById("forecastHistory");
  const button = document.getElementById("historyToggle");
  if (!list) return;

  const savedEntries = normalizeForecastHistory(history);
  const pastEntries = savedEntries.filter((entry) => entry.date !== currentDate);
  const entries = pastEntries.length ? pastEntries : savedEntries;

  if (!entries.length) {
    list.innerHTML = `<p class="history-empty">Past reports will show here after the next forecast archive run.</p>`;
    if (button) button.hidden = true;
    return;
  }

  const visibleCount = 4;
  list.replaceChildren(...entries.map((entry, index) => {
    const article = document.createElement("article");
    article.className = `history-item${index >= visibleCount ? " is-hidden" : ""}`;
    const range = entry.estimated_visibility_range_ft || entry.visibility || [0, 0];
    article.innerHTML = `
      <div>
        <span>${shortDate(entry.date)}</span>
        <strong>${entry.grade || "C"} · ${feet(range)}</strong>
      </div>
      <p>${entry.report_text || "Forecast archived."}</p>
    `;
    return article;
  }));

  if (!button) return;
  button.hidden = entries.length <= visibleCount;
  button.textContent = `See ${entries.length - visibleCount} More`;
  button.onclick = () => {
    const hidden = [...list.querySelectorAll(".history-item.is-hidden")];
    const isExpanded = hidden.length === 0;
    list.querySelectorAll(".history-item").forEach((item, index) => {
      item.classList.toggle("is-hidden", isExpanded && index >= visibleCount);
    });
    button.textContent = isExpanded ? `See ${entries.length - visibleCount} More` : "Show Less";
  };
}

loadForecastData().then(({ latest, tenDay, gradeGuide, history, cameraObservation }) => {
  scrippsCameraObservation = cameraObservation || null;
  const visibleForecasts = currentForecastWindow(tenDay);
  const initialForecast = initialForecastForToday(visibleForecasts, latest);
  render(initialForecast);
  renderStaleNotice(initialForecast);
  renderCommunityReport(initialForecast);
  renderForecastStrip(visibleForecasts, initialForecast.date);
  renderGradeGuide(gradeGuide);
  renderForecastHistory(history, initialForecast.date);
  if (!initialForecast.is_unavailable) {
    window.diveproTrack("forecast_loaded", {
      forecast_date: initialForecast.date,
      grade: initialForecast.grade,
      visibility_range: feet(initialForecast.estimated_visibility_range_ft),
      surf_range: waveHeightValue(initialForecast),
    });
  }
  window.addEventListener("divepro:selectForecastDate", (event) => {
    if (!event.detail || typeof window.__diveProSelectForecastDate !== "function") return;
    window.__diveProSelectForecastDate(event.detail, event.detail.source || "wind_map_day_select");
  });
});
