const spotList = document.getElementById("spotList");
const mapStatus = document.getElementById("mapStatus");
const mapLayerSelect = document.getElementById("mapLayerSelect");
const windLegend = document.getElementById("windLegend");
const visibilityLegend = document.getElementById("visibilityLegend");
const windTimeline = document.getElementById("windTimeline");
const windPlayButton = document.getElementById("windPlayButton");
const windDayLabel = document.getElementById("windDayLabel");
const windTimeSlider = document.getElementById("windTimeSlider");
const windPrevDayButton = document.getElementById("windPrevDayButton");
const windNextDayButton = document.getElementById("windNextDayButton");
const windTimeTicks = document.getElementById("windTimeTicks");
const windCurrentTime = document.getElementById("windCurrentTime");
const windThumbTime = document.getElementById("windThumbTime");
const windDateBubble = document.getElementById("windDateBubble");
const heroSpotPreview = document.getElementById("heroSpotPreview");
const heroPrevSpot = document.getElementById("heroPrevSpot");
const heroNextSpot = document.getElementById("heroNextSpot");
const WIND_GRID_PATH = "data/wind-cropped/wind-san-diego-f008.json?v=home-crop-timeline-1";
const WIND_MANIFEST_PATH = "data/wind-cropped/wind-san-diego-manifest.json?v=home-crop-timeline-1";
const WATER_MASK_PATH = "data/water-mask-san-diego.geojson?v=water-1";
const WIND_PARTICLE_COUNT = 760;
const WIND_COAST_FEATHER_PX = 52;
const NOW_FRAME_TOLERANCE_MS = 90 * 60 * 1000;
const MAPTILER_WATER_LAYER_ID = "Water";
const MAP_ALLOWED_BOUNDS = [[-180, 15], [-100, 55]];
const MAP_MIN_ZOOM = 7.15;
const HOME_MAP_CENTER = [-118.35, 33.12];
const HOME_MAP_ZOOM = 7.55;
const MPS_TO_MPH = 2.23694;
const VISIBILITY_REFERENCE_POINTS = [
  { label: "Los Angeles / Long Beach plume proxy", lng: -118.22, lat: 33.74, radiusMiles: 34, penalty: 42 },
  { label: "Santa Monica shelf proxy", lng: -118.62, lat: 33.88, radiusMiles: 30, penalty: 24 },
  { label: "San Diego Bay / Tijuana nearshore proxy", lng: -117.18, lat: 32.64, radiusMiles: 28, penalty: 40 },
  { label: "La Jolla nearshore proxy", lng: -117.255, lat: 32.866, radiusMiles: 12, penalty: 26 },
  { label: "Ventura / Oxnard nearshore proxy", lng: -119.22, lat: 34.18, radiusMiles: 22, penalty: 30 },
];
const VISIBILITY_CLEAR_ZONES = [
  { label: "Open shelf potential", lng: -119.0, lat: 32.7, radiusMiles: 96, bonus: 10 },
];
const VISIBILITY_ISLAND_ZONES = [
  { label: "Catalina island mixing proxy", lng: -118.46, lat: 33.42, radiusMiles: 26, leeBonus: 10, windwardPenalty: 24, shelfPenalty: 8 },
  { label: "Channel Islands mixing proxy", lng: -119.37, lat: 34.01, radiusMiles: 30, leeBonus: 10, windwardPenalty: 22, shelfPenalty: 8 },
];
const LA_JOLLA_CALIBRATION = { lng: -117.255, lat: 32.866, radiusMiles: 4.5 };
const HOME_MAP_PINS = [
  { label: "San Diego", detail: "Scripps Beach", lngLat: [-117.255, 32.866], href: "la-jolla.html" },
  { label: "Catalina", detail: "Wrigley Marine Reserve", lngLat: [-118.485, 33.445], href: "catalina-wrigley.html" },
  { label: "Channel Islands", detail: "Anacapa Ocean", lngLat: [-119.37, 34.015], href: "anacapa-ocean.html" },
];
const SPOT_GROUP_ORDER = ["California", "Florida", "Caribbean"];
let windProbeMarker = null;
let windProbePopup = null;
let windProbeElement = null;
let windProbeMap = null;
let windProbeLngLat = null;
let heroForecasts = [];

function orderedHomeSpots(spots = []) {
  const groups = spots.reduce((acc, spot) => {
    const group = spot.regionGroup || "Other";
    if (!acc.has(group)) acc.set(group, []);
    acc.get(group).push(spot);
    return acc;
  }, new Map());

  const orderedGroups = [
    ...SPOT_GROUP_ORDER.filter((group) => groups.has(group)),
    ...[...groups.keys()].filter((group) => !SPOT_GROUP_ORDER.includes(group)).sort(),
  ];

  return orderedGroups.flatMap((group) => groups.get(group));
}

function metricMarkup(metrics = []) {
  return metrics.map(([label, value]) => `
    <div>
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function previewMarkup(spot) {
  const classes = ["spot-preview", spot.previewClass].filter(Boolean).join(" ");
  const media = spot.image
    ? `<img src="${spot.image}" alt="${spot.imageAlt || `${spot.name} preview`}">`
    : `<div class="preview-art" aria-hidden="true"></div>`;

  return `
    <figure class="${classes}">
      ${media}
      <span>${spot.imageLabel || "Forecast"}</span>
      <b class="sport-badge sport-${spot.sport}">${spot.sportLabel}</b>
    </figure>
  `;
}

function spotCard(spot) {
  return `
    <a class="spot-card ${spot.gradeClass}" href="${spot.href}" data-sport="${spot.sport}">
      ${previewMarkup(spot)}
      <div class="spot-info">
        <div class="spot-title">
          <span>${spot.city}</span>
          <h1>${spot.name}</h1>
        </div>
        <div class="spot-grade"><b>${spot.grade}</b><em>${spot.primaryText}</em></div>
      </div>
      <div class="spot-metrics">
        ${metricMarkup(spot.metrics)}
      </div>
      <div class="spot-gradient" style="--fill:${spot.fill}%"></div>
    </a>
  `;
}

function groupedSpotSections(spots) {
  const groups = spots.reduce((acc, spot) => {
    const group = spot.regionGroup || "Other";
    if (!acc.has(group)) acc.set(group, []);
    acc.get(group).push(spot);
    return acc;
  }, new Map());

  const orderedGroups = [
    ...SPOT_GROUP_ORDER.filter((group) => groups.has(group)),
    ...[...groups.keys()].filter((group) => !SPOT_GROUP_ORDER.includes(group)).sort(),
  ];

  return orderedGroups.map((group) => `
    <section class="spot-region-section" aria-label="${group} dive spots">
      <div class="spot-region-heading">
        <h2>${group}</h2>
        <span>${groups.get(group).length} ${groups.get(group).length === 1 ? "spot" : "spots"}</span>
      </div>
      <div class="spot-region-grid">
        ${groups.get(group).map(spotCard).join("")}
      </div>
    </section>
  `).join("");
}

function renderSpots() {
  const spots = orderedHomeSpots(window.outdoorSpots || []);
  spotList.innerHTML = groupedSpotSections(spots);
}

function heroMetricValue(spot, label) {
  const metric = (spot.metrics || []).find(([name]) => name.toLowerCase() === label.toLowerCase());
  return metric ? metric[1] : "—";
}

function heroGradeClass(grade = "") {
  return `grade-${String(grade).toLowerCase().replace("+", "plus")}`;
}

function heroVisibilityRange(forecast = {}) {
  const range = forecast.estimated_visibility_range_ft;
  if (Array.isArray(range) && range.length >= 2) return `${range[0]}-${range[1]} ft`;
  return forecast.visibility || "—";
}

function heroDayLabel(date, index) {
  if (!date) return index === 0 ? "Now" : `+${index}`;
  if (index === 0) return "Now";
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return `+${index}`;
  return parsed.toLocaleDateString("en-US", { weekday: "short" });
}

function heroWaveSummary(forecast = {}) {
  const features = forecast.features || {};
  const wave = Number(features.surf_height_max_ft || features.wave_height_max_ft || 0);
  if (!wave) return "Wave height loading";
  const rounded = Math.max(1, Math.round(wave));
  const range = `${Math.max(1, rounded - 1)}-${rounded} ft`;
  const descriptor = wave >= 5 ? "Heavy" : wave >= 3 ? "Moderate" : "Light";
  return `${range} · ${descriptor}`;
}

function heroWindowSummary(forecast = {}) {
  const text = forecast.best_window || "Morning";
  return text
    .replace(/\s+before wind builds$/i, "")
    .replace(/^Early morning/i, "Early morning");
}

function heroForecastPreviewMarkup(spot) {
  if (spot.slug !== "la-jolla" || !heroForecasts.length) {
    const water = heroMetricValue(spot, "Water");
    const wind = heroMetricValue(spot, "Wind");
    const windowText = heroMetricValue(spot, "Window");

    return `
      <div class="hero-live-metrics">
        <div><span>Visibility</span><strong>${spot.primaryText}</strong></div>
        <div><span>Water</span><strong>${water}</strong></div>
        <div><span>Wind</span><strong>${wind}</strong></div>
        <div><span>Window</span><strong>${windowText}</strong></div>
      </div>
    `;
  }

  const outlookForecasts = heroForecasts.slice(1, 4);

  return `
    <div class="hero-forecast-preview" aria-label="La Jolla forecast preview">
      <div class="hero-forecast-kicker">
        <span>Forecast preview</span>
        <strong>La Jolla model</strong>
      </div>
      <div class="hero-forecast-days">
        ${heroForecasts.slice(0, 4).map((forecast, index) => `
          <div class="hero-forecast-day ${heroGradeClass(forecast.grade)}">
            <span>${heroDayLabel(forecast.date, index)}</span>
            <strong>${forecast.grade || "—"}</strong>
            <em>${heroVisibilityRange(forecast)}</em>
          </div>
        `).join("")}
      </div>
      <div class="hero-mobile-outlook">
        <span>3 day outlook</span>
        <div>
          ${outlookForecasts.map((forecast, index) => `
            <div class="${heroGradeClass(forecast.grade)}">
              <b>${heroDayLabel(forecast.date, index + 1)}</b>
              <strong>${forecast.grade || "—"}</strong>
              <em>${heroVisibilityRange(forecast)}</em>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function heroPreviewMarkup(spot, index, total) {
  const image = spot.image || "";
  const forecastClass = spot.slug === "la-jolla" && heroForecasts.length ? "has-mobile-forecast" : "";

  return `
    <a class="hero-live-card ${spot.gradeClass} ${forecastClass}" href="${spot.href}" aria-label="Open ${spot.name} report">
      <figure class="hero-live-media">
        ${image ? `<img src="${image}" alt="${spot.imageAlt || `${spot.name} live camera frame`}">` : `<div class="preview-art" aria-hidden="true"></div>`}
        <span>${spot.imageLabel || "Live spot data"}</span>
      </figure>
      <div class="hero-live-body">
        <div class="hero-live-topline">
          <span>${spot.city}</span>
          <em>${index + 1}/${total}</em>
        </div>
        <div class="hero-live-main">
          <div>
            <h2>${spot.name}</h2>
            <p>Live forecast card</p>
          </div>
          <div class="hero-live-grade">
            <b>${spot.grade}</b>
            <span>${spot.primaryText}</span>
          </div>
        </div>
        ${heroForecastPreviewMarkup(spot)}
        <div class="spot-gradient" style="--fill:${spot.fill}%"></div>
      </div>
    </a>
  `;
}

async function loadHeroForecasts() {
  try {
    const response = await fetch("forecast_10day.json?v=hero-forecast-1");
    if (!response.ok) return;
    const forecasts = await response.json();
    heroForecasts = Array.isArray(forecasts) ? forecasts : [];
  } catch {
    heroForecasts = [];
  }
}

function initHeroCarousel() {
  const spots = orderedHomeSpots(window.outdoorSpots || []);
  if (!heroSpotPreview || !heroPrevSpot || !heroNextSpot || !spots.length) return;

  let activeIndex = 0;

  function renderHeroSpot() {
    heroSpotPreview.innerHTML = heroPreviewMarkup(spots[activeIndex], activeIndex, spots.length);
  }

  heroPrevSpot.addEventListener("click", () => {
    activeIndex = (activeIndex - 1 + spots.length) % spots.length;
    renderHeroSpot();
  });

  heroNextSpot.addEventListener("click", () => {
    activeIndex = (activeIndex + 1) % spots.length;
    renderHeroSpot();
  });

  renderHeroSpot();
}

function tintDiveProMapStyle(style) {
  style.layers = style.layers.map((layer) => {
    const paint = { ...(layer.paint || {}) };
    const id = layer.id.toLowerCase();

    if (layer.type === "background") {
      paint["background-color"] = "#676a68";
    }

    if (layer.type === "fill") {
      if (id.includes("water")) Object.assign(paint, { "fill-color": "#20384c", "fill-outline-color": "#1b5a73" });
      if (id.includes("landcover")) Object.assign(paint, { "fill-color": "#676a68", "fill-opacity": 0.96 });
      if (id.includes("landuse") || id.includes("residential")) Object.assign(paint, { "fill-color": "#717371", "fill-opacity": 0.86 });
      if (id.includes("park")) Object.assign(paint, { "fill-color": "#626a62", "fill-opacity": 0.9 });
      if (id.includes("building")) Object.assign(paint, { "fill-color": "#5d5f5e", "fill-outline-color": "#7a7d7b", "fill-opacity": 0.5 });
    }

    if (layer.type === "line") {
      if (id.includes("water")) Object.assign(paint, { "line-color": "#3e7b8f", "line-opacity": 0.5 });
      if (id.includes("road")) Object.assign(paint, { "line-color": "#484e50", "line-opacity": 0.58 });
      if (id.includes("bridge")) Object.assign(paint, { "line-color": "#565f62", "line-opacity": 0.72 });
      if (id.includes("tunnel")) Object.assign(paint, { "line-color": "#515555", "line-opacity": 0.35 });
      if (id.includes("boundary")) Object.assign(paint, { "line-color": "#444747", "line-opacity": 0.38 });
      if (id.includes("minor")) Object.assign(paint, { "line-color": "#4b5050", "line-opacity": 0.38 });
    }

    if (layer.type === "symbol") {
      Object.assign(paint, {
        "text-color": id.includes("water") ? "#d7f6ff" : "#f2f2ef",
        "text-halo-color": "#454747",
        "text-halo-width": 1.35,
        "text-opacity": 0.9,
        ...(paint["icon-color"] ? { "icon-color": "#e8eceb" } : {}),
      });
    }

    return { ...layer, paint };
  });

  return style;
}

async function getDiveProMapStyle(apiKey) {
  const styleUrl = `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${apiKey}`;
  const response = await fetch(styleUrl);
  if (!response.ok) throw new Error("MapTiler style request failed");
  return tintDiveProMapStyle(await response.json());
}

function normalizeWindFrame(frame, index = 0) {
  const hour = Number(frame.hour ?? frame.forecast_hour ?? 0);
  const label = frame.label || (hour === 0 ? "Now" : `+${hour}h`);
  const path = frame.path || WIND_GRID_PATH.split("?")[0];
  return { ...frame, hour, label, path, index };
}

function pacificDate(value) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function frameDate(frame) {
  return frame.localDate || pacificDate(frame.valid_utc);
}

function frameDayLabel(frame) {
  if (!frame?.valid_utc) return frame?.localDate || "";
  const date = new Date(frame.valid_utc);
  if (Number.isNaN(date.getTime())) return frame?.localDate || "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(date);
}

function frameTime(frame) {
  const date = new Date(frame?.valid_utc || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function pacificHour(frame) {
  const date = frameTime(frame);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return Number.isFinite(hour) ? hour : null;
}

function pacificHourLabel(frame) {
  const hour = pacificHour(frame);
  if (hour === null) return frame?.tickLabel || frame?.label || "Wind";
  if (hour === 0) return "12AM";
  if (hour === 12) return "12PM";
  return hour < 12 ? `${hour}AM` : `${hour - 12}PM`;
}

function defaultFrameIndex(frames) {
  const now = Date.now();
  const firstCurrentOrFuture = frames.findIndex((frame) => {
    const time = frameTime(frame);
    return time && time.getTime() >= now - NOW_FRAME_TOLERANCE_MS;
  });
  return firstCurrentOrFuture >= 0 ? firstCurrentOrFuture : 0;
}

function isCurrentWindFrame(frame) {
  const time = frameTime(frame);
  return Boolean(time && Math.abs(time.getTime() - Date.now()) <= NOW_FRAME_TOLERANCE_MS);
}

async function loadWindManifest() {
  try {
    const response = await fetch(WIND_MANIFEST_PATH, { cache: "no-store" });
    if (!response.ok) throw new Error("Wind forecast manifest unavailable");
    const manifest = await response.json();
    const frames = (manifest.frames || []).map(normalizeWindFrame).filter((frame) => frame.path);
    if (!frames.length) throw new Error("Wind forecast manifest has no frames");
    return { ...manifest, frames };
  } catch (error) {
    return {
      run: "latest",
      frames: [normalizeWindFrame({ hour: 0, label: "Now", path: WIND_GRID_PATH })],
    };
  }
}

async function fetchWindFrame(frame, cache) {
  if (cache.has(frame.path)) return cache.get(frame.path);
  const response = await fetch(frame.path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Wind frame request failed: ${frame.path}`);
  const grid = await response.json();
  cache.set(frame.path, grid);
  return grid;
}

function addHomeMapPins(map) {
  const maplibre = window.maplibregl || globalThis.maplibregl;
  if (!maplibre) return;

  HOME_MAP_PINS.forEach((pin) => {
    const marker = document.createElement("a");
    marker.className = "map-spot-pin";
    marker.href = pin.href;
    marker.setAttribute("aria-label", `${pin.label}: ${pin.detail}`);
    marker.innerHTML = `<span>${pin.label}</span>`;

    new maplibre.Marker({ element: marker, anchor: "bottom" })
      .setLngLat(pin.lngLat)
      .setPopup(new maplibre.Popup({ offset: 18 }).setHTML(`
        <strong>${pin.label}</strong>
        <span>${pin.detail}</span>
      `))
      .addTo(map);
  });
}

function windDirectionDegrees(u, v) {
  return (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
}

function compassFromDegrees(degrees) {
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return points[Math.round(degrees / 22.5) % points.length];
}

function normalizeLngLat(lngLat) {
  const lng = Number(lngLat?.lng ?? lngLat?.lon ?? lngLat?.[0]);
  const lat = Number(lngLat?.lat ?? lngLat?.[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat, coordinates: [lng, lat] };
}

function windAtLngLat(grid, lngLat) {
  const normalized = normalizeLngLat(lngLat);
  if (!grid || !normalized) return null;
  const wind = interpolateWindAtLonLat(grid, normalized.lng, normalized.lat);
  if (!wind) return null;
  const directionDegrees = windDirectionDegrees(wind.u, wind.v);
  return {
    ...wind,
    directionDegrees,
    direction: compassFromDegrees(directionDegrees),
  };
}

function windProbeMarkup(wind, lngLat, frame) {
  const label = frame?.tickLabel || frame?.label || "Now";
  const normalized = normalizeLngLat(lngLat);
  if (!wind) {
    return `
      <div class="wind-probe-card">
        <span>Dropped pin</span>
        <strong>Wind unavailable</strong>
        <small>${normalized ? `${normalized.lat.toFixed(3)}, ${normalized.lng.toFixed(3)}` : "No location"} · ${label}</small>
      </div>
    `;
  }

  return `
      <div class="wind-probe-card">
        <span>Dropped pin</span>
        <strong>${wind.speedMph.toFixed(1)} mph <em>${wind.direction}</em></strong>
      <small>${label} · ${normalized.lat.toFixed(3)}, ${normalized.lng.toFixed(3)}</small>
    </div>
  `;
}

function visibilityProbeMarkup(potential, lngLat) {
  const normalized = normalizeLngLat(lngLat);
  if (!potential || !normalized) {
    return `
      <div class="wind-probe-card">
        <span>Dropped pin</span>
        <strong>Visibility unavailable</strong>
        <small>Relative estimate only offshore</small>
      </div>
    `;
  }

  const headline = potential.calibrated
    ? `${potential.calibratedRange} calibrated`
    : potential.label;
  const detail = potential.calibrated
    ? "La Jolla model area"
    : `Relative index ${Math.round(potential.index)}/100`;

  return `
    <div class="wind-probe-card">
      <span>Dropped pin</span>
      <strong>${headline}</strong>
      <small>${detail} · ${normalized.lat.toFixed(3)}, ${normalized.lng.toFixed(3)}</small>
    </div>
  `;
}

function positionWindProbe(map = windProbeMap) {
  if (!map || !windProbeElement || !windProbeLngLat) return;
  const point = map.project([windProbeLngLat.lng, windProbeLngLat.lat]);
  windProbeElement.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px) translate(-50%, -100%)`;
}

function updateWindProbe() {
  if (!windProbeElement || !windProbeLngLat) return;
  const markerLabel = windProbeElement.querySelector("span");
  const selectedLayer = mapLayerSelect?.value || "wind";
  if (selectedLayer === "visibility") {
    const potential = visibilityPotentialAtLngLat(window.__diveProWindGrid, windProbeLngLat);
    const label = potential
      ? (potential.calibrated ? potential.calibratedRange : potential.label.replace(" potential", ""))
      : "No viz";
    markerLabel.textContent = label;
    windProbeElement.style.removeProperty("--wind-flow-rotation");
    windProbeElement.setAttribute("aria-label", `Dropped visibility pin: ${label}`);
    windProbeElement.title = visibilityProbeMarkup(potential, windProbeLngLat).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    windProbeElement.dataset.layer = "visibility";
    positionWindProbe();
    return;
  }

  const wind = windAtLngLat(window.__diveProWindGrid, windProbeLngLat);
  const label = wind ? `${wind.speedMph.toFixed(1)} mph` : "No wind";
  markerLabel.textContent = label;
  if (wind?.directionDegrees !== undefined) {
    windProbeElement.style.setProperty("--wind-flow-rotation", `${(wind.directionDegrees + 180) % 360}deg`);
  } else {
    windProbeElement.style.removeProperty("--wind-flow-rotation");
  }
  windProbeElement.setAttribute("aria-label", `Dropped wind pin: ${label}`);
  windProbeElement.title = windProbeMarkup(wind, windProbeLngLat, window.__diveProWindFrame).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  windProbeElement.dataset.layer = "wind";
  positionWindProbe();
}

function setWindProbe(map, lngLat) {
  const normalized = normalizeLngLat(lngLat);
  if (!normalized) return;
  windProbeLngLat = normalized;
  windProbeMap = map;

  if (!windProbeElement) {
    const marker = document.createElement("button");
    marker.className = "map-wind-probe-pin";
    marker.type = "button";
    marker.innerHTML = '<span>Wind</span><i class="map-wind-probe-arrow" aria-hidden="true"></i>';
    marker.addEventListener("click", (event) => event.stopPropagation());

    windProbeElement = marker;
    map.getContainer().appendChild(windProbeElement);
  }

  positionWindProbe(map);
  updateWindProbe();
}

function setupWindProbe(map) {
  map.on("click", (event) => {
    const target = event.originalEvent?.target;
    if (target?.closest?.(".map-layer-control, .wind-timeline, .wind-legend, .visibility-legend, .maplibregl-ctrl, .map-spot-pin, .map-wind-probe-pin")) {
      return;
    }
    const clickLngLat = event.lngLat;
    setWindProbe(map, clickLngLat);
  });
  map.on("move", () => positionWindProbe(map));
  map.on("resize", () => positionWindProbe(map));
}

function windColor(speedMph) {
  // Wind colors are displayed in MPH. Anything at/above 10 mph lands in the
  // C-grade purple zone instead of escalating into pink for normal coastal wind.
  const stops = [
    [0, [0, 117, 223]],
    [5, [19, 186, 238]],
    [10, [166, 75, 216]],
    [20, [238, 19, 186]],
  ];

  for (let i = 1; i < stops.length; i += 1) {
    const [speed, color] = stops[i];
    const [prevSpeed, prevColor] = stops[i - 1];
    if (speedMph <= speed) {
      const t = Math.max(0, Math.min(1, (speedMph - prevSpeed) / (speed - prevSpeed)));
      return color.map((channel, index) => Math.round(prevColor[index] + (channel - prevColor[index]) * t));
    }
  }

  return stops[stops.length - 1][1];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mixColor(start, end, amount) {
  const t = clamp(amount, 0, 1);
  return start.map((channel, index) => Math.round(channel + (end[index] - channel) * t));
}

function distanceMiles(a, b) {
  const latMiles = (a.lat - b.lat) * 69;
  const avgLat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const lonMiles = (a.lng - b.lng) * 69 * Math.cos(avgLat);
  return Math.hypot(latMiles, lonMiles);
}

function pointInfluence(distance, radius) {
  return Math.exp(-((distance / radius) ** 2));
}

function relativeMiles(point, origin) {
  const north = (point.lat - origin.lat) * 69;
  const avgLat = ((point.lat + origin.lat) / 2) * Math.PI / 180;
  const east = (point.lng - origin.lng) * 69 * Math.cos(avgLat);
  return { east, north, distance: Math.hypot(east, north) };
}

function islandWindExposure(point, island, wind) {
  const relative = relativeMiles(point, island);
  if (!relative.distance || !wind) return { lee: 0, windward: 0, influence: 0 };
  const speed = Math.hypot(wind.u, wind.v);
  if (!speed) return { lee: 0, windward: 0, influence: 0 };

  const flowEast = wind.u / speed;
  const flowNorth = wind.v / speed;
  const awayEast = relative.east / relative.distance;
  const awayNorth = relative.north / relative.distance;
  const alignment = flowEast * awayEast + flowNorth * awayNorth;
  const influence = pointInfluence(relative.distance, island.radiusMiles);

  return {
    lee: clamp((alignment + 0.12) / 0.88, 0, 1) * influence,
    windward: clamp((-alignment + 0.05) / 0.95, 0, 1) * influence,
    influence,
  };
}

function laJollaVisibilityRange() {
  const spot = (window.outdoorSpots || []).find((item) => item.slug === "la-jolla");
  return spot?.primaryText || "10-14 ft";
}

function visibilityLabel(index) {
  if (index < 34) return "Lower potential";
  if (index < 58) return "Fair potential";
  if (index < 78) return "Clearer potential";
  return "Clearest potential";
}

function visibilityColor(index) {
  const stops = [
    [0, [116, 82, 42]],
    [28, [67, 145, 88]],
    [52, [22, 181, 190]],
    [72, [10, 171, 236]],
    [100, [0, 96, 255]],
  ];

  for (let i = 1; i < stops.length; i += 1) {
    const [stopValue, color] = stops[i];
    const [prevValue, prevColor] = stops[i - 1];
    if (index <= stopValue) {
      return mixColor(prevColor, color, (index - prevValue) / (stopValue - prevValue));
    }
  }

  return stops[stops.length - 1][1];
}

function visibilityPotentialAtLngLat(grid, lngLat) {
  const normalized = normalizeLngLat(lngLat);
  if (!grid || !normalized) return null;
  const wind = interpolateWindAtLonLat(grid, normalized.lng, normalized.lat);
  if (!wind) return null;

  const point = { lng: normalized.lng, lat: normalized.lat };
  const laJollaDistance = distanceMiles(point, LA_JOLLA_CALIBRATION);
  const windPenalty = clamp((wind.speedMph - 8) / 18, 0, 1) * 12;

  let strongestNearshorePenalty = 0;
  let closestNearshoreMiles = Infinity;
  VISIBILITY_REFERENCE_POINTS.forEach((reference) => {
    const distance = distanceMiles(point, reference);
    closestNearshoreMiles = Math.min(closestNearshoreMiles, distance);
    strongestNearshorePenalty = Math.max(
      strongestNearshorePenalty,
      reference.penalty * pointInfluence(distance, reference.radiusMiles),
    );
  });

  const offshoreBonus = clamp((closestNearshoreMiles - 4) / 36, 0, 1) * 42;
  const blueWaterBonus = clamp((closestNearshoreMiles - 22) / 52, 0, 1) * 16;
  const leeBonus = VISIBILITY_CLEAR_ZONES.reduce((sum, zone) => {
    const distance = distanceMiles(point, zone);
    return sum + zone.bonus * pointInfluence(distance, zone.radiusMiles);
  }, 0);
  const islandAdjustment = VISIBILITY_ISLAND_ZONES.reduce((sum, island) => {
    const exposure = islandWindExposure(point, island, wind);
    return sum
      + island.leeBonus * exposure.lee
      - island.windwardPenalty * exposure.windward
      - island.shelfPenalty * exposure.influence;
  }, 0);

  // Placeholder for chlorophyll/K490: until ERDDAP is wired in, nearshore plume
  // proximity is the honest visual proxy for greener/turbid water.
  const index = clamp(40 + offshoreBonus + blueWaterBonus + leeBonus + islandAdjustment - strongestNearshorePenalty - windPenalty, 4, 98);
  const calibrated = laJollaDistance <= LA_JOLLA_CALIBRATION.radiusMiles;

  return {
    index,
    label: visibilityLabel(index),
    calibrated,
    calibratedRange: calibrated ? laJollaVisibilityRange() : null,
    windMph: wind.speedMph,
  };
}

function interpolateWindVector(grid, xNorm, yNorm) {
  const { nx, ny } = grid.metadata;
  const gx = Math.max(0, Math.min(nx - 1, xNorm * (nx - 1)));
  const gy = Math.max(0, Math.min(ny - 1, yNorm * (ny - 1)));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(nx - 1, x0 + 1);
  const y1 = Math.min(ny - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;

  const corners = [
    { x: x0, y: y0, weight: (1 - tx) * (1 - ty) },
    { x: x1, y: y0, weight: tx * (1 - ty) },
    { x: x0, y: y1, weight: (1 - tx) * ty },
    { x: x1, y: y1, weight: tx * ty },
  ];
  let u = 0;
  let v = 0;
  let totalWeight = 0;

  corners.forEach(({ x, y, weight }) => {
    const cornerU = grid.u[y][x];
    const cornerV = grid.v[y][x];
    if (cornerU === null || cornerV === null || weight <= 0) return;
    u += cornerU * weight;
    v += cornerV * weight;
    totalWeight += weight;
  });

  if (!totalWeight) {
    const fallback = nearestValidWindVector(grid, Math.round(gx), Math.round(gy));
    if (!fallback) return null;
    return fallback;
  }

  u /= totalWeight;
  v /= totalWeight;
  return { u, v, speedMph: Math.hypot(u, v) * MPS_TO_MPH };
}

function nearestValidWindVector(grid, x, y) {
  const { nx, ny } = grid.metadata;
  let best = null;
  let bestDistance = Infinity;

  for (let radius = 1; radius <= 7; radius += 1) {
    for (let yy = Math.max(0, y - radius); yy <= Math.min(ny - 1, y + radius); yy += 1) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(nx - 1, x + radius); xx += 1) {
        const u = grid.u[yy][xx];
        const v = grid.v[yy][xx];
        if (u === null || v === null) continue;
        const distance = (xx - x) ** 2 + (yy - y) ** 2;
        if (distance < bestDistance) {
          best = { u, v, speedMph: Math.hypot(u, v) * MPS_TO_MPH };
          bestDistance = distance;
        }
      }
    }
    if (best) return best;
  }

  return null;
}

function lonLatToGridNorm(grid, lon, lat) {
  const { west, east, south, north } = grid.metadata.bbox;
  return {
    xNorm: (lon - west) / (east - west),
    yNorm: (north - lat) / (north - south),
  };
}

function interpolateWindAtLonLat(grid, lon, lat) {
  const { xNorm, yNorm } = lonLatToGridNorm(grid, lon, lat);
  if (xNorm < 0 || xNorm > 1 || yNorm < 0 || yNorm > 1) return null;
  return interpolateWindVector(grid, xNorm, yNorm);
}

function renderWindGradientImage(map, grid) {
  const canvas = document.createElement("canvas");
  const mapCanvas = map.getCanvas();
  const width = Math.max(1, Math.round(mapCanvas.clientWidth));
  const height = Math.max(1, Math.round(mapCanvas.clientHeight));
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  const image = ctx.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const lngLat = map.unproject([x, y]);
      const wind = interpolateWindAtLonLat(grid, lngLat.lng, lngLat.lat);
      if (!wind) {
        image.data[index + 3] = 0;
        continue;
      }

      const [r, g, b] = windColor(wind.speedMph);
      image.data[index] = r;
      image.data[index + 1] = g;
      image.data[index + 2] = b;
      image.data[index + 3] = 198;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function renderVisibilityGradientImage(map, grid, isScreenPointOnWater) {
  const canvas = document.createElement("canvas");
  const mapCanvas = map.getCanvas();
  const width = Math.max(1, Math.round(mapCanvas.clientWidth));
  const height = Math.max(1, Math.round(mapCanvas.clientHeight));
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  const image = ctx.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (!isScreenPointOnWater(x, y)) {
        image.data[index + 3] = 0;
        continue;
      }

      const lngLat = map.unproject([x, y]);
      const potential = visibilityPotentialAtLngLat(grid, lngLat);
      if (!potential) {
        image.data[index + 3] = 0;
        continue;
      }

      const [r, g, b] = visibilityColor(potential.index);
      image.data[index] = r;
      image.data[index + 1] = g;
      image.data[index + 2] = b;
      image.data[index + 3] = 188;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function randomWaterPoint(map, grid, isScreenPointOnWater = () => true) {
  const mapCanvas = map.getCanvas();
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const point = [Math.random() * mapCanvas.clientWidth, Math.random() * mapCanvas.clientHeight];
    const lngLat = map.unproject(point);
    if (isScreenPointOnWater(point[0], point[1]) && interpolateWindAtLonLat(grid, lngLat.lng, lngLat.lat)) {
      return { x: point[0], y: point[1], lon: lngLat.lng, lat: lngLat.lat, age: Math.floor(Math.random() * 120) };
    }
  }
  const fallbackPoint = [-1000, -1000];
  const fallback = map.unproject(fallbackPoint);
  return { x: fallbackPoint[0], y: fallbackPoint[1], lon: fallback.lng, lat: fallback.lat, age: 999 };
}

function normalizeWaterPolygons(waterMask) {
  return (waterMask?.features || []).flatMap((feature) => {
    const geometry = feature.geometry;
    if (!geometry) return [];
    if (geometry.type === "Polygon") return [geometry.coordinates];
    if (geometry.type === "MultiPolygon") return geometry.coordinates;
    return [];
  });
}

function geometryToPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function createWindCanvasLayer(map, initialGrid, waterMask) {
  const mapContainer = map.getContainer();
  const frame = mapContainer.closest(".map-frame");
  if (!frame) return null;

  let grid = initialGrid;
  const waterPolygons = normalizeWaterPolygons(waterMask);
  const gradientCanvas = document.createElement("canvas");
  gradientCanvas.className = "wind-gradient-canvas";
  frame.appendChild(gradientCanvas);
  const canvas = document.createElement("canvas");
  canvas.className = "wind-particle-canvas";
  frame.appendChild(canvas);
  const waterMaskCanvas = document.createElement("canvas");
  const gradientCtx = gradientCanvas.getContext("2d");
  const ctx = canvas.getContext("2d");
  const waterMaskCtx = waterMaskCanvas.getContext("2d", { willReadFrequently: true });
  let particles = [];
  let animationId;
  let visible = true;
  let needsGradientDraw = true;
  let needsWaterMaskDraw = true;
  let waterMaskData = null;
  let particleFrame = 0;
  let mapIsInteracting = false;
  let interactionSettleTimer;

  function resize() {
    const rect = mapContainer.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    gradientCanvas.style.width = `${rect.width}px`;
    gradientCanvas.style.height = `${rect.height}px`;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    gradientCanvas.width = Math.max(1, Math.round(rect.width * scale));
    gradientCanvas.height = Math.max(1, Math.round(rect.height * scale));
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    waterMaskCanvas.width = Math.max(1, Math.round(rect.width * scale));
    waterMaskCanvas.height = Math.max(1, Math.round(rect.height * scale));
    gradientCtx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    waterMaskCtx.setTransform(scale, 0, 0, scale, 0, 0);
    needsWaterMaskDraw = true;
    waterMaskData = null;
    needsGradientDraw = true;
  }

  function drawRing(ring) {
    ring.forEach((coordinate, index) => {
      const point = map.project([coordinate[0], coordinate[1]]);
      if (index === 0) waterMaskCtx.moveTo(point.x, point.y);
      else waterMaskCtx.lineTo(point.x, point.y);
    });
    waterMaskCtx.closePath();
  }

  function drawPolygon(polygon) {
    waterMaskCtx.beginPath();
    polygon.forEach(drawRing);
    waterMaskCtx.fill("evenodd");
  }

  function getRenderedOceanPolygons() {
    if (!map.getLayer(MAPTILER_WATER_LAYER_ID)) return [];
    return map
      .queryRenderedFeatures(undefined, { layers: [MAPTILER_WATER_LAYER_ID] })
      .filter((feature) => feature.properties?.class === "ocean")
      .flatMap((feature) => geometryToPolygons(feature.geometry));
  }

  function drawWaterMask() {
    if (!needsWaterMaskDraw) return;
    const rect = mapContainer.getBoundingClientRect();
    waterMaskCtx.clearRect(0, 0, rect.width, rect.height);
    waterMaskCtx.fillStyle = "#000";
    const renderedOceanPolygons = getRenderedOceanPolygons();
    const polygons = renderedOceanPolygons.length ? renderedOceanPolygons : waterPolygons;
    polygons.forEach(drawPolygon);

    window.__diveProWindWaterMaskStats = {
      source: renderedOceanPolygons.length ? "maptiler-rendered-ocean" : "baked-natural-earth",
      polygons: polygons.length,
    };
    waterMaskData = waterMaskCtx.getImageData(0, 0, waterMaskCanvas.width, waterMaskCanvas.height).data;
    needsWaterMaskDraw = false;
  }

  function isScreenPointOnWater(x, y) {
    drawWaterMask();
    const scaleX = waterMaskCanvas.width / Math.max(1, waterMaskCanvas.clientWidth || mapContainer.clientWidth);
    const scaleY = waterMaskCanvas.height / Math.max(1, waterMaskCanvas.clientHeight || mapContainer.clientHeight);
    const sampleX = Math.max(0, Math.min(waterMaskCanvas.width - 1, Math.round(x * scaleX)));
    const sampleY = Math.max(0, Math.min(waterMaskCanvas.height - 1, Math.round(y * scaleY)));
    if (!waterMaskData) return false;
    return waterMaskData[(sampleY * waterMaskCanvas.width + sampleX) * 4 + 3] > 0;
  }

  function resetParticle(particle) {
    Object.assign(particle, randomWaterPoint(map, grid, isScreenPointOnWater));
  }

  function drawGradient() {
    const rect = mapContainer.getBoundingClientRect();
    gradientCtx.clearRect(0, 0, rect.width, rect.height);
    if (!visible) return;

    gradientCtx.drawImage(renderWindGradientImage(map, grid), 0, 0, rect.width, rect.height);
    drawWaterMask();
    gradientCtx.save();
    gradientCtx.globalCompositeOperation = "destination-in";
    gradientCtx.filter = `blur(${WIND_COAST_FEATHER_PX}px)`;
    gradientCtx.drawImage(waterMaskCanvas, 0, 0, rect.width, rect.height);
    gradientCtx.filter = "none";
    gradientCtx.drawImage(waterMaskCanvas, 0, 0, rect.width, rect.height);
    gradientCtx.restore();
    needsGradientDraw = false;
  }

  function draw() {
    const rect = mapContainer.getBoundingClientRect();
    if (mapIsInteracting) {
      ctx.clearRect(0, 0, rect.width, rect.height);
      animationId = requestAnimationFrame(draw);
      return;
    }

    if (needsGradientDraw) drawGradient();

    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.globalCompositeOperation = "source-over";

    if (visible) {
      ctx.lineWidth = 1.15;
      ctx.lineCap = "round";
      let drawnParticles = 0;
      particles.forEach((particle) => {
        const lngLat = map.unproject([particle.x, particle.y]);
        particle.lon = lngLat.lng;
        particle.lat = lngLat.lat;
        const wind = interpolateWindAtLonLat(grid, particle.lon, particle.lat);
        if (!wind || !isScreenPointOnWater(particle.x, particle.y) || particle.x < -40 || particle.x > rect.width + 40 || particle.y < -40 || particle.y > rect.height + 40 || particle.age > 150) {
          resetParticle(particle);
          return;
        }

        const nextLon = particle.lon + wind.u * 0.00016;
        const nextLat = particle.lat + wind.v * 0.00016;
        const end = map.project([nextLon, nextLat]);
        if (!isScreenPointOnWater(end.x, end.y)) {
          resetParticle(particle);
          return;
        }
        const alpha = Math.max(0.28, Math.min(0.7, wind.speedMph / 16));
        ctx.strokeStyle = `rgba(226, 242, 255, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        drawnParticles += 1;

        particle.x = end.x;
        particle.y = end.y;
        particle.age += 1;
      });
      particleFrame += 1;
      window.__diveProWindParticleStats = { drawnParticles, particleFrame };
    } else {
      ctx.clearRect(0, 0, rect.width, rect.height);
    }

    animationId = requestAnimationFrame(draw);
  }

  function beginInteraction() {
    mapIsInteracting = true;
    frame.classList.add("is-map-moving");
    needsWaterMaskDraw = true;
    waterMaskData = null;
    needsGradientDraw = true;
    window.clearTimeout(interactionSettleTimer);
  }

  function endInteraction() {
    mapIsInteracting = false;
    needsWaterMaskDraw = true;
    waterMaskData = null;
    needsGradientDraw = true;
    window.clearTimeout(interactionSettleTimer);
    interactionSettleTimer = window.setTimeout(() => {
      frame.classList.remove("is-map-moving");
    }, 150);
  }

  resize();
  drawWaterMask();
  particles = Array.from({ length: WIND_PARTICLE_COUNT }, () => randomWaterPoint(map, grid, isScreenPointOnWater));
  map.on("resize", resize);
  map.on("movestart", beginInteraction);
  map.on("zoomstart", beginInteraction);
  map.on("dragstart", beginInteraction);
  map.on("moveend", endInteraction);
  map.on("zoomend", endInteraction);
  map.on("idle", endInteraction);
  [900, 2600].forEach((delay) => {
    window.setTimeout(() => {
      needsWaterMaskDraw = true;
      waterMaskData = null;
      needsGradientDraw = true;
    }, delay);
  });
  window.addEventListener("resize", resize);
  animationId = requestAnimationFrame(draw);

  return {
    gradientCanvas,
    canvas,
    setVisible(nextVisible) {
      visible = nextVisible;
      needsGradientDraw = true;
      gradientCanvas.classList.toggle("is-hidden", !nextVisible);
      canvas.classList.toggle("is-hidden", !nextVisible);
    },
    setGrid(nextGrid) {
      grid = nextGrid;
      needsWaterMaskDraw = true;
      waterMaskData = null;
      needsGradientDraw = true;
      particles = Array.from({ length: WIND_PARTICLE_COUNT }, () => randomWaterPoint(map, grid, isScreenPointOnWater));
    },
    destroy() {
      cancelAnimationFrame(animationId);
      gradientCanvas.remove();
      canvas.remove();
      window.removeEventListener("resize", resize);
    },
  };
}

function createVisibilityCanvasLayer(map, initialGrid, waterMask) {
  const mapContainer = map.getContainer();
  const frame = mapContainer.closest(".map-frame");
  if (!frame) return null;

  let grid = initialGrid;
  let visible = false;
  let needsDraw = true;
  let needsWaterMaskDraw = true;
  let waterMaskData = null;
  let interactionSettleTimer;
  const waterPolygons = normalizeWaterPolygons(waterMask);
  const canvas = document.createElement("canvas");
  canvas.className = "visibility-gradient-canvas is-hidden";
  frame.appendChild(canvas);
  const waterMaskCanvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const waterMaskCtx = waterMaskCanvas.getContext("2d", { willReadFrequently: true });

  function resize() {
    const rect = mapContainer.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    waterMaskCanvas.width = Math.max(1, Math.round(rect.width * scale));
    waterMaskCanvas.height = Math.max(1, Math.round(rect.height * scale));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    waterMaskCtx.setTransform(scale, 0, 0, scale, 0, 0);
    needsWaterMaskDraw = true;
    waterMaskData = null;
    needsDraw = true;
  }

  function drawRing(ring) {
    ring.forEach((coordinate, index) => {
      const point = map.project([coordinate[0], coordinate[1]]);
      if (index === 0) waterMaskCtx.moveTo(point.x, point.y);
      else waterMaskCtx.lineTo(point.x, point.y);
    });
    waterMaskCtx.closePath();
  }

  function drawPolygon(polygon) {
    waterMaskCtx.beginPath();
    polygon.forEach(drawRing);
    waterMaskCtx.fill("evenodd");
  }

  function getRenderedOceanPolygons() {
    if (!map.getLayer(MAPTILER_WATER_LAYER_ID)) return [];
    return map
      .queryRenderedFeatures(undefined, { layers: [MAPTILER_WATER_LAYER_ID] })
      .filter((feature) => feature.properties?.class === "ocean")
      .flatMap((feature) => geometryToPolygons(feature.geometry));
  }

  function drawWaterMask() {
    if (!needsWaterMaskDraw) return;
    const rect = mapContainer.getBoundingClientRect();
    waterMaskCtx.clearRect(0, 0, rect.width, rect.height);
    waterMaskCtx.fillStyle = "#000";
    const renderedOceanPolygons = getRenderedOceanPolygons();
    const polygons = renderedOceanPolygons.length ? renderedOceanPolygons : waterPolygons;
    polygons.forEach(drawPolygon);
    waterMaskData = waterMaskCtx.getImageData(0, 0, waterMaskCanvas.width, waterMaskCanvas.height).data;
    needsWaterMaskDraw = false;
  }

  function isScreenPointOnWater(x, y) {
    drawWaterMask();
    const scaleX = waterMaskCanvas.width / Math.max(1, waterMaskCanvas.clientWidth || mapContainer.clientWidth);
    const scaleY = waterMaskCanvas.height / Math.max(1, waterMaskCanvas.clientHeight || mapContainer.clientHeight);
    const sampleX = Math.max(0, Math.min(waterMaskCanvas.width - 1, Math.round(x * scaleX)));
    const sampleY = Math.max(0, Math.min(waterMaskCanvas.height - 1, Math.round(y * scaleY)));
    if (!waterMaskData) return false;
    return waterMaskData[(sampleY * waterMaskCanvas.width + sampleX) * 4 + 3] > 0;
  }

  function draw() {
    const rect = mapContainer.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!visible) return;
    drawWaterMask();
    ctx.drawImage(renderVisibilityGradientImage(map, grid, isScreenPointOnWater), 0, 0, rect.width, rect.height);
    needsDraw = false;
  }

  function requestDraw() {
    if (!visible) return;
    needsDraw = true;
    window.requestAnimationFrame(() => {
      if (needsDraw) draw();
    });
  }

  function beginInteraction() {
    frame.classList.add("is-map-moving");
    needsWaterMaskDraw = true;
    waterMaskData = null;
    window.clearTimeout(interactionSettleTimer);
  }

  function endInteraction() {
    needsWaterMaskDraw = true;
    waterMaskData = null;
    requestDraw();
    window.clearTimeout(interactionSettleTimer);
    interactionSettleTimer = window.setTimeout(() => {
      frame.classList.remove("is-map-moving");
    }, 150);
  }

  resize();
  map.on("resize", resize);
  map.on("movestart", beginInteraction);
  map.on("zoomstart", beginInteraction);
  map.on("dragstart", beginInteraction);
  map.on("moveend", endInteraction);
  map.on("zoomend", endInteraction);
  map.on("idle", endInteraction);
  window.addEventListener("resize", resize);

  return {
    canvas,
    setVisible(nextVisible) {
      visible = nextVisible;
      canvas.classList.toggle("is-hidden", !nextVisible);
      if (nextVisible) requestDraw();
      else {
        const rect = mapContainer.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
      }
    },
    setGrid(nextGrid) {
      grid = nextGrid;
      needsWaterMaskDraw = true;
      waterMaskData = null;
      requestDraw();
    },
    destroy() {
      canvas.remove();
      window.removeEventListener("resize", resize);
    },
  };
}

function setupWindTimeline(layer, manifest, frameCache) {
  const frames = manifest.frames || [];
  if (!windTimeline || !windTimeSlider || !windPlayButton || !windTimeTicks || !frames.length) {
    windTimeline?.classList.add("is-hidden");
    return;
  }

  const currentIndex = defaultFrameIndex(frames);
  let activeIndex = currentIndex;
  let windowStartIndex = activeIndex;
  let playTimer;
  let requestToken = 0;
  let tickResizeTimer;
  const mobileTimelineQuery = window.matchMedia("(max-width: 640px)");
  windTimeline.classList.toggle("is-hidden", frames.length < 2);

  frames.forEach((forecastFrame) => {
    forecastFrame.localDate = frameDate(forecastFrame);
    forecastFrame.dayLabel = frameDayLabel(forecastFrame);
  });

  const timelineDates = [...new Set(frames.map((forecastFrame) => forecastFrame.localDate).filter(Boolean))];

  function firstIndexForDate(date) {
    return frames.findIndex((forecastFrame) => forecastFrame.localDate === date);
  }

  function lastIndexForDate(date) {
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      if (frames[index].localDate === date) return index;
    }
    return -1;
  }

  function startIndexForDate(date) {
    const midnightIndex = frames.findIndex((forecastFrame) => (
      forecastFrame.localDate === date && pacificHour(forecastFrame) === 0
    ));
    return midnightIndex >= 0 ? midnightIndex : firstIndexForDate(date);
  }

  function activeWindowDate() {
    return frames[windowStartIndex]?.localDate || frames[activeIndex]?.localDate || timelineDates[0];
  }

  function adjacentTimelineDate(offset) {
    const dateIndex = timelineDates.indexOf(activeWindowDate());
    if (dateIndex < 0) return null;
    return timelineDates[dateIndex + offset] || null;
  }

  function currentTimelineDate() {
    return pacificDate(new Date().toISOString());
  }

  function activeWindowIsFuture() {
    return Boolean(adjacentTimelineDate(-1));
  }

  function timelineDateLabel(date) {
    if (!date) return "";
    return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function updateDayLabel(frame = frames[activeIndex]) {
    if (!windDayLabel) return;
    windDayLabel.textContent = frame?.dayLabel || frame?.localDate || "";
  }

  function windowEndIndex() {
    const date = activeWindowDate();
    const dateEndIndex = lastIndexForDate(date);
    const boundedEndIndex = Math.min(frames.length - 1, windowStartIndex + 23);
    return dateEndIndex >= 0 ? Math.min(dateEndIndex, boundedEndIndex) : boundedEndIndex;
  }

  function updateSliderBounds() {
    const endIndex = windowEndIndex();
    windTimeSlider.min = "0";
    windTimeSlider.max = String(Math.max(0, endIndex - windowStartIndex));
    windTimeSlider.value = String(Math.max(0, activeIndex - windowStartIndex));
  }

  function renderTicks() {
    const endIndex = windowEndIndex();
    const windowFrames = frames.slice(windowStartIndex, endIndex + 1);
    if (!windowFrames.length) {
      windTimeTicks.innerHTML = "";
      return;
    }

    const fullDay = windowFrames.length >= 24 && pacificHour(windowFrames[0]) === 0;
    const fixedTicks = fullDay
      ? [
          { left: 0, label: "12AM" },
          { left: 25, label: "6AM" },
          { left: 50, label: "12PM" },
          { left: 75, label: "6PM" },
          { left: 100, label: "11PM" },
        ]
      : [
          { left: 0, label: activeTimeLabel(windowFrames[0], windowStartIndex) },
          {
            left: 50,
            label: activeTimeLabel(
              windowFrames[Math.round((windowFrames.length - 1) * 0.5)],
              windowStartIndex + Math.round((windowFrames.length - 1) * 0.5)
            ),
          },
          { left: 100, label: activeTimeLabel(windowFrames[windowFrames.length - 1], endIndex) },
        ];

    const seen = new Set();
    windTimeTicks.innerHTML = fixedTicks
      .filter(({ label }) => {
        if (!label || seen.has(label)) return false;
        seen.add(label);
        return true;
      })
      .map(({ left, label }, index, allTicks) => {
        const edgeClass = index === 0 ? " is-start" : index === allTicks.length - 1 ? " is-end" : "";
        return `<span class="is-visible${edgeClass}" style="left:${left}%">${label}</span>`;
      })
      .join("");
  }

  function scheduleTickRender() {
    window.clearTimeout(tickResizeTimer);
    tickResizeTimer = window.setTimeout(renderTicks, 120);
  }

  function activeTimeLabel(forecastFrame) {
    return isCurrentWindFrame(forecastFrame) ? "Now" : pacificHourLabel(forecastFrame);
  }

  function updateActiveTime() {
    const label = activeTimeLabel(frames[activeIndex], activeIndex);
    if (windCurrentTime) windCurrentTime.textContent = label;
    if (!windThumbTime) return;
    const max = Math.max(1, Number(windTimeSlider.max || 0));
    const value = Math.max(0, Math.min(max, Number(windTimeSlider.value || 0)));
    windThumbTime.textContent = label;
    windThumbTime.style.left = `${(value / max) * 100}%`;
  }

  function setTimelineDayButton(button, isAvailable) {
    if (!button) return;
    button.classList.toggle("is-unavailable", !isAvailable);
    button.disabled = !isAvailable;
    button.setAttribute("aria-hidden", isAvailable ? "false" : "true");
  }

  function updateDayButtons() {
    setTimelineDayButton(
      windPrevDayButton,
      Boolean(activeWindowIsFuture() && adjacentTimelineDate(-1))
    );
    setTimelineDayButton(windNextDayButton, Boolean(adjacentTimelineDate(1)));
  }

  function updateDateBubble() {
    if (!windDateBubble) return;
    const show = activeWindowIsFuture();
    windDateBubble.hidden = !show;
    if (show) windDateBubble.textContent = timelineDateLabel(activeWindowDate());
  }

  renderTicks();
  updateSliderBounds();
  updateActiveTime();
  updateDayButtons();
  updateDateBubble();
  updateDayLabel();

  async function applyFrame(index) {
    activeIndex = Math.max(0, Math.min(frames.length - 1, index));
    if (activeIndex < windowStartIndex || activeIndex > windowEndIndex()) {
      const dateStartIndex = startIndexForDate(frames[activeIndex]?.localDate);
      windowStartIndex = dateStartIndex >= 0 ? dateStartIndex : activeIndex;
    }
    const token = requestToken + 1;
    requestToken = token;
    const frame = frames[activeIndex];
    updateSliderBounds();
    updateActiveTime();
    updateDayButtons();
    updateDateBubble();
    updateDayLabel(frame);
    renderTicks();
    const statusTime = [frame.dayLabel, frame.label].filter(Boolean).join(" ");
    const frameIsCached = frameCache?.has(frame.path);
    if (!frameIsCached) {
      window.__diveProWindGrid = null;
      window.__diveProWindFrame = frame;
      layer.setGrid(null);
      window.__diveProVisibilityLayer?.setGrid(null);
      updateWindProbe();
    }
    if (mapStatus) mapStatus.textContent = `Loading wind forecast ${statusTime}...`;
    try {
      const nextGrid = await fetchWindFrame(frame, frameCache);
      if (token !== requestToken) return;
      window.__diveProWindGrid = nextGrid;
      window.__diveProWindFrame = frame;
      layer.setGrid(nextGrid);
      window.__diveProVisibilityLayer?.setGrid(nextGrid);
      updateWindProbe();
      if (mapStatus) mapStatus.textContent = `Interactive map loaded with ${statusTime} wind forecast. Pan or zoom to explore conditions.`;
    } catch (error) {
      if (mapStatus) mapStatus.textContent = `Wind forecast ${statusTime} failed to load.`;
      stopPlayback();
    }
  }

  function stopPlayback() {
    window.clearInterval(playTimer);
    playTimer = null;
    windPlayButton.textContent = "▶";
    windPlayButton.setAttribute("aria-label", "Play wind forecast timeline");
  }

  function startPlayback() {
    if (frames.length < 2) return;
    windPlayButton.textContent = "||";
    windPlayButton.setAttribute("aria-label", "Pause wind forecast timeline");
    playTimer = window.setInterval(() => {
      const nextIndex = activeIndex + 1;
      if (nextIndex > windowEndIndex()) {
        const nextDate = adjacentTimelineDate(1);
        if (!nextDate) {
          stopPlayback();
          return;
        }
        moveToTimelineDate(nextDate);
        return;
      }
      applyFrame(nextIndex);
    }, 1300);
  }

  function moveToTimelineDate(date) {
    const startIndex = startIndexForDate(date);
    if (startIndex < 0) return false;
    windowStartIndex = startIndex;
    applyFrame(startIndex);
    return true;
  }

  windTimeSlider.addEventListener("input", () => {
    stopPlayback();
    applyFrame(windowStartIndex + Number(windTimeSlider.value));
  });

  windPlayButton.addEventListener("click", () => {
    if (playTimer) stopPlayback();
    else startPlayback();
  });

  windPrevDayButton?.addEventListener("click", () => {
    stopPlayback();
    const previousDate = adjacentTimelineDate(-1);
    if (previousDate) moveToTimelineDate(previousDate);
  });

  windNextDayButton?.addEventListener("click", () => {
    stopPlayback();
    const nextDate = adjacentTimelineDate(1);
    if (nextDate) moveToTimelineDate(nextDate);
  });

  window.addEventListener("resize", scheduleTickRender);
  mobileTimelineQuery.addEventListener?.("change", renderTicks);
  applyFrame(activeIndex);
}

async function addWindLayer(map) {
  const frameCache = new Map();
  const [manifest, waterResponse] = await Promise.all([
    loadWindManifest(),
    fetch(WATER_MASK_PATH, { cache: "no-store" }),
  ]);
  if (!waterResponse.ok) throw new Error("Wind layer request failed");
  const [grid, waterMask] = await Promise.all([
    fetchWindFrame(manifest.frames[0], frameCache),
    waterResponse.json(),
  ]);
  window.__diveProWindGrid = grid;
  window.__diveProWindFrame = manifest.frames[0];
  window.__diveProWindManifest = manifest;
  window.__diveProWindWaterMask = waterMask;
  window.__diveProWindLayer = createWindCanvasLayer(map, grid, waterMask);
  window.__diveProVisibilityLayer = createVisibilityCanvasLayer(map, grid, waterMask);
  setupWindTimeline(window.__diveProWindLayer, manifest, frameCache);
}

function setMapLayerVisibility(map, value) {
  const showWind = value === "wind";
  const showVisibility = value === "visibility";
  window.__diveProWindLayer?.setVisible(showWind);
  window.__diveProVisibilityLayer?.setVisible(showVisibility);
  windLegend?.classList.toggle("is-hidden", !showWind);
  visibilityLegend?.classList.toggle("is-hidden", !showVisibility);
  windTimeline?.classList.toggle("is-hidden", value === "none" || (window.__diveProWindManifest?.frames || []).length < 2);
  updateWindProbe();
}

async function initConditionsMap() {
  const mapEl = document.getElementById("conditionsMap");
  const apiKey = window.MAPTILER_API_KEY;
  const maplibre = window.maplibregl || globalThis.maplibregl;
  if (!mapEl) return;
  if (!maplibre) {
    mapEl.classList.add("is-unavailable");
    if (mapStatus) mapStatus.textContent = "MapLibre did not load. Check the network connection.";
    return;
  }
  if (!apiKey) {
    mapEl.classList.add("is-unavailable");
    if (mapStatus) mapStatus.textContent = "Add your MapTiler API key in map-config.js to load the base map.";
    return;
  }

  let style;
  try {
    style = await getDiveProMapStyle(apiKey);
  } catch (error) {
    mapEl.classList.add("is-unavailable");
    if (mapStatus) mapStatus.textContent = "Map style failed to load. Check the MapTiler API key.";
    return;
  }

  const map = new maplibre.Map({
    container: mapEl,
    style,
    center: HOME_MAP_CENTER,
    zoom: HOME_MAP_ZOOM,
    minZoom: MAP_MIN_ZOOM,
    maxBounds: MAP_ALLOWED_BOUNDS,
    attributionControl: false,
  });
  window.__conditionsMap = map;

  map.addControl(new maplibre.AttributionControl({ compact: true }), "top-left");
  map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), "top-right");
  map.on("load", async () => {
    mapEl.classList.remove("is-unavailable");
    addHomeMapPins(map);
    try {
      await addWindLayer(map);
      setupWindProbe(map);
      setMapLayerVisibility(map, mapLayerSelect?.value || "wind");
      if (mapStatus) mapStatus.textContent = "Interactive map loaded with wind forecast timeline. Pan or zoom to explore conditions.";
    } catch (error) {
      if (mapStatus) mapStatus.textContent = "Interactive map loaded. Wind layer data unavailable.";
    }
  });
  map.on("error", () => {
    if (mapStatus) mapStatus.textContent = "Map failed to load. Check the MapTiler API key.";
  });

  mapLayerSelect?.addEventListener("change", () => {
    setMapLayerVisibility(map, mapLayerSelect.value);
  });
}

renderSpots();
loadHeroForecasts().finally(initHeroCarousel);
initConditionsMap();
