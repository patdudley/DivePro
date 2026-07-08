import { forecastFromFeatures } from "./visibilityModel.js";

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

async function loadForecastData() {
  if (window.staticSpotReport) {
    return {
      latest: window.staticSpotReport,
      tenDay: [],
      gradeGuide: [],
      history: [],
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
    };
  } catch {
    const latest = fallbackForecast();
    return { latest, tenDay: [latest], gradeGuide: [], history: [] };
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

function liveEmbedUrl(url) {
  if (!url) return "";
  const inputUrl = new URL(url, window.location.href);
  const videoId = inputUrl.pathname.split("/").filter(Boolean).pop();
  const liveUrl = new URL(`https://www.youtube.com/embed/${videoId || ""}`);
  liveUrl.searchParams.set("autoplay", "1");
  liveUrl.searchParams.set("mute", "1");
  liveUrl.searchParams.set("playsinline", "1");
  liveUrl.searchParams.set("controls", "1");
  liveUrl.searchParams.set("rel", "0");
  liveUrl.searchParams.set("modestbranding", "1");
  liveUrl.searchParams.set("origin", window.location.origin);
  return liveUrl.toString();
}

function renderCamera(data) {
  const frame = document.getElementById("cameraFrame");
  const image = document.getElementById("cameraImage");
  if (!frame || !image) return;

  if (data.live_embed_url) {
    let iframe = frame.querySelector("iframe");
    if (!iframe) {
      iframe = document.createElement("iframe");
      frame.insertBefore(iframe, frame.querySelector("figcaption"));
    }
    const playButton = frame.querySelector(".camera-play-button");
    if (playButton) playButton.remove();
    iframe.src = liveEmbedUrl(data.live_embed_url);
    iframe.title = `${data.location || "Dive spot"} live camera`;
    iframe.loading = "eager";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    frame.classList.add("is-playing");
    image.hidden = true;
    image.removeAttribute("src");
  } else {
    const iframe = frame.querySelector("iframe");
    if (iframe) iframe.remove();
    const playButton = frame.querySelector(".camera-play-button");
    if (playButton) playButton.remove();
    frame.classList.remove("is-playing");
    image.hidden = false;
    image.src = data.camera_image || "pier-screenshot.png?v=mobile-fix-33";
    image.alt = `${data.location || "Dive spot"} camera preview`;
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

function reportText(data) {
  if (window.staticSpotReport && data.report_text) return data.report_text;

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
    ? `The tide signal is ${tidePhase || "mixed"}, with the next ${nextTide.type === "H" ? "high" : "low"} near ${Number(nextTide.height_ft).toFixed(1)} ft at ${nextTide.time}.`
    : tidePhase
      ? `The tide signal is ${tidePhase}.`
      : "";
  const waveCopy = waveWeight(data);

  if (grade === "A") {
    return `The model expects strong La Jolla visibility around ${range} with a grade ${data.grade || "A"}. The forecast is supported by ${swellCopy}, ${waveCopy.toLowerCase()}, and ${windCopy}${rainCopy}. ${tideCopy}`.trim();
  }

  if (grade === "F" || grade === "D") {
    return `The model expects poor La Jolla visibility around ${range} with a grade ${data.grade || grade}. The main drag is ${swellCopy} with ${waveCopy.toLowerCase()}, plus ${windCopy}${rainCopy}. ${tideCopy}`.trim();
  }

  return `The model expects moderate La Jolla visibility around ${range} with a grade ${data.grade || grade}. The forecast is mainly driven by ${swellCopy}, ${waveCopy.toLowerCase()}, and ${windCopy}${rainCopy}. ${tideCopy}`.trim();
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
  const range = data.estimated_visibility_range_ft || [0, 6];
  const score = data.numeric_score_0_100 ?? 0;
  setText("location", data.location || "La Jolla / Scripps Pier");
  setText("grade", data.grade || "C");
  setText("visibility", feet(range));
  setText("bestWindow", data.best_window || "Early morning");
  setText("waveWeight", waveWeight(data));
  setText("forecastSource", data.is_projected ? `Projected from ${shortDate(data.projected_from || data.date)}` : "Model prediction from parsed conditions");
  setText("dailyReport", reportText(data));
  setText("tideSource", data.tide_source || `NOAA La Jolla 9410230 - ${shortDate(data.date)}`);
  setText("windSource", data.wind_source || `Open-Meteo hourly wind - ${shortDate(data.date)}`);
  const panel = document.querySelector(".forecast-panel");
  const grade = document.getElementById("grade");
  if (panel) panel.className = `forecast-panel ${gradeClass(data.grade)}`;
  if (grade) grade.className = gradeClass(data.grade);
  const scoreFill = document.getElementById("scoreFill");
  const rows = document.getElementById("featureRows");
  if (scoreFill) scoreFill.style.width = `${score}%`;
  if (rows) rows.innerHTML = featureRows(data.features || {});
  renderCamera(data);
  renderTideChart(data);
  renderWindChart(data);
  renderWaveSwell(data);
  renderWeather(data);
  renderFishRadar(data);
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
    trackEvent(source, {
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

  strip.replaceChildren(...forecasts.map((forecast, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `forecast-day ${gradeClass(forecast.grade)}${forecast.date === activeDate ? " is-active" : ""}`;
    button.setAttribute("aria-pressed", forecast.date === activeDate ? "true" : "false");
    button.innerHTML = `
      <span>${dayLabel(forecast.date, index)}</span>
      <strong>${forecast.grade}</strong>
      <em>${feet(forecast.estimated_visibility_range_ft || [0, 6])}</em>
      <small>${forecast.is_projected ? "Projected" : shortDate(forecast.date)}</small>
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

loadForecastData().then(({ latest, tenDay, gradeGuide, history }) => {
  render(latest);
  renderForecastStrip(tenDay, latest.date);
  renderGradeGuide(gradeGuide);
  renderForecastHistory(history, latest.date);
  window.addEventListener("divepro:selectForecastDate", (event) => {
    if (!event.detail || typeof window.__diveProSelectForecastDate !== "function") return;
    window.__diveProSelectForecastDate(event.detail, event.detail.source || "wind_map_day_select");
  });
});
