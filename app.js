async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} unavailable`);
  return response.json();
}

async function fetchFirst(paths) {
  let lastError;
  for (const path of paths) {
    try {
      return await fetchJson(path);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No forecast path available");
}

async function loadForecastData() {
  try {
    const [spotForecast, gradeGuide] = await Promise.all([
      fetchFirst(["model_outputs/spots/la-jolla.json", "la-jolla.json"]),
      fetchFirst(["model_outputs/diveprosd_grade_guidance.json", "diveprosd_grade_guidance.json"]),
    ]);
    const latest = spotForecast.latest || spotForecast;
    const tenDay = Array.isArray(spotForecast.tenDay) && spotForecast.tenDay.length
      ? spotForecast.tenDay
      : [latest];
    return {
      latest,
      tenDay,
      gradeGuide: Array.isArray(gradeGuide) ? gradeGuide : [],
    };
  } catch (error) {
    console.error(error);
    return {
      latest: {
        date: new Date().toISOString().slice(0, 10),
        location: "La Jolla / Scripps Pier",
        grade: "--",
        numeric_score_0_100: 0,
        estimated_visibility_range_ft: null,
        features: {},
        best_window: "Forecast unavailable",
        is_unavailable: true,
      },
      tenDay: [],
      gradeGuide: [],
    };
  }
}

function displayRange(range) {
  if (!Array.isArray(range) || range.length < 2) return "-- ft";
  const low = Number(range[0]);
  const high = Number(range[1]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return "-- ft";
  const roundedLow = Math.max(0, Math.floor(low / 5) * 5);
  const roundedHigh = Math.max(roundedLow + 5, Math.ceil(high / 5) * 5);
  return `${roundedLow}-${roundedHigh} ft`;
}

function feet(range) {
  return displayRange(range);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function trackEvent(name, params = {}) {
  if (typeof window.diveproTrack === "function") {
    window.diveproTrack(name, params);
  }
}

const viewedVerdicts = new Set();

function trackVerdictView(data) {
  if (!data || data.is_unavailable) return;
  const panel = document.querySelector(".forecast-panel");
  if (!panel) return;
  const key = `${data.date || "unknown"}:${data.grade || "--"}`;
  if (viewedVerdicts.has(key)) return;

  const fire = () => {
    if (viewedVerdicts.has(key)) return;
    viewedVerdicts.add(key);
    trackEvent("verdict_view", {
      spot: "la_jolla",
      forecast_date: data.date,
      grade: data.grade,
      visibility_range: feet(data.estimated_visibility_range_ft),
      score: data.numeric_score_0_100 ?? null,
    });
  };

  if (!("IntersectionObserver" in window)) {
    fire();
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
      observer.disconnect();
      fire();
    }
  }, { threshold: [0.5] });
  observer.observe(panel);
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
  const waterTempKey = enriched?.buoy_water_temp_f != null ? "buoy_water_temp_f" : "water_temp_estimate_f";
  const waterTempLabel = enriched?.buoy_water_temp_f != null ? "Water temp (buoy)" : "Water temp (est.)";
  const wanted = [
    [waterTempLabel, waterTempKey, "°F"],
    ["Rain forecast", "rain_24h_in", "in"],
    ["72-hour rain", "rain_prior_3day_in", "in"],
  ];
  const rows = wanted.map(([label, key, unit]) => {
    const raw = enriched?.[key];
    const value = raw === undefined || raw === null || raw === ""
      ? "n/a"
      : typeof raw === "number"
        ? `${raw.toFixed(key.includes("energy") ? 0 : 1)} ${unit}`.trim()
        : `${raw}${unit ? ` ${unit}` : ""}`;
    return `<div><span>${label}</span><strong>${value}</strong></div>`;
  });
  return rows.join("");
}

const cdfwRulesUrl = "https://wildlife.ca.gov/Fishing/Ocean/Regulations/Fishing-Map/Southern";

const fishTargets = [
  { name: "California sheephead", habitat: "Reef / boulders", prize: 78, abundance: 98, note: "staple reef resident", season: "Common on rocky structure most of the year.", photo: 3, sizeRule: "12 in total length minimum.", takeNote: "Large males are prized; confirm season and bag rules." },
  { name: "California halibut", habitat: "Sand meets rock", prize: 86, abundance: 68, note: "camouflaged table fish", season: "Often best in warmer months on sand channels.", photo: 2, sizeRule: "22 in total length minimum.", takeNote: "Measure total length before retaining." },
  { name: "White seabass", habitat: "Kelp rooms", prize: 96, abundance: 47, note: "low / seasonal trophy", season: "Spring to early summer, especially around squid.", photo: 1, sizeRule: "28 in total length minimum.", takeNote: "Open-area and MPA rules still apply." },
  { name: "Calico bass", habitat: "Kelp / reef", prize: 54, abundance: 100, note: "most common legal target", season: "Seen year-round around La Jolla kelp and reef.", photo: 6, sizeRule: "14 in total length minimum.", takeNote: "Listed as kelp bass in regulations." },
  { name: "Yellowtail", habitat: "Outer kelp edge", prize: 98, abundance: 15, note: "rare from shore", season: "Best chance in warm summer-fall pushes.", photo: 0, sizeRule: "No minimum for the first 5 fish; 24 in fork length if taking more.", takeNote: "Rare from shore; confirm current pelagic rules before take." },
  { name: "Surfperch", habitat: "Surf grass / shallow sand", prize: 46, abundance: 100, note: "practice / beginner target", season: "Frequent in shallow surf grass and sand.", photo: 11, sizeRule: "No size limit for most species; 10.5 in for redtail surfperch.", takeNote: "Confirm species ID, season, bag and local MPA rules." },
  { name: "Opaleye", habitat: "Shallow reef", prize: 34, abundance: 100, note: "abundant lower-prize fish", season: "Very common on shallow reefs year-round.", photo: 10, sizeRule: "No minimum size shown in the southern finfish table.", takeNote: "Verify current general bag rules and MPAs." },
  { name: "Sculpin", habitat: "Reef pockets", prize: 44, abundance: 72, note: "handle carefully", season: "Found around reef pockets; venomous spines.", photo: 9, sizeRule: "10 in total length minimum.", takeNote: "Regulations list this as California scorpionfish." },
  { name: "Cabezon", habitat: "Rock structure", prize: 48, abundance: 62, note: "winter-heavy reef fish", season: "More of a winter / cool-season reef target.", photo: 8, sizeRule: "15 in total length minimum.", takeNote: "Groundfish seasons and area rules apply." },
  { name: "Rockfish", habitat: "Deeper reef edge", prize: 52, abundance: 78, note: "depth-dependent", season: "Varies by depth, species, season and closure area.", photo: 7, sizeRule: "No single generic minimum size.", takeNote: "Species, season, depth and closed-area rules vary." },
  { name: "Bonito", habitat: "Current edges", prize: 66, abundance: 30, note: "seasonal pelagic cruiser", season: "Occasional summer-fall passes outside the kelp.", photo: 4, sizeRule: "No minimum size listed for bonito.", takeNote: "Use the current CDFW table before taking." },
  { name: "Barracuda", habitat: "Outer kelp edge", prize: 62, abundance: 27, note: "seasonal cruiser", season: "Occasional warm-water passes through outer kelp.", photo: 5, sizeRule: "28 in total length minimum.", takeNote: "Confirm current bag limit." },
];

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function fishRankings(data) {
  return fishTargets.map((fish) => {
    const abundance = clampScore(fish.abundance);
    const overall = clampScore((fish.prize * 0.58) + (abundance * 0.42));
    return { ...fish, abundance, overall };
  });
}

function renderFishRadar(data) {
  const grid = document.getElementById("fishGrid");
  if (!grid) return;
  grid.replaceChildren(...fishRankings(data).map((fish, index) => {
    const card = document.createElement("details");
    card.className = `fish-row${index < 3 ? " is-prime" : ""}`;
    const photoCol = fish.photo % 3;
    const photoRow = Math.floor(fish.photo / 3);
    card.innerHTML = `
      <summary>
        <div class="fish-rank">${index + 1}</div>
        <div class="fish-title">
          <strong>${fish.name}</strong>
          <span>${fish.habitat} · ${fish.note}</span>
        </div>
        <div class="fish-summary-scores">
          <span>Prize ${fish.prize}</span>
          <span>Abundance ${fish.abundance}</span>
        </div>
        <span class="expand-label">View details</span>
      </summary>
      <div class="fish-details">
        <div class="fish-photo" style="--photo-col:${photoCol};--photo-row:${photoRow}" role="img" aria-label="${fish.name} visual reference"></div>
        <div class="fish-meters" aria-hidden="true">
          <div class="fish-meter"><span>Prize</span><i style="width:${fish.prize}%"></i></div>
          <div class="fish-meter abundance"><span>Abundance</span><i style="width:${fish.abundance}%"></i></div>
        </div>
        <div class="fish-rule">
          <span>Season / Location</span>
          <p>${fish.season}</p>
          <span>Spearfishing size guidance</span>
          <strong>${fish.sizeRule}</strong>
          <p>${fish.takeNote}</p>
          <a href="${cdfwRulesUrl}" target="_blank" rel="noopener">Check current CDFW regulations</a>
        </div>
      </div>
    `;
    card.querySelector("summary")?.addEventListener("click", () => {
      window.setTimeout(() => {
        card.setAttribute("aria-expanded", card.open ? "true" : "false");
        if (card.open) {
          trackEvent("fish_detail_open", {
            species: fish.name,
            prize: fish.prize,
            abundance: fish.abundance,
          });
        }
      }, 0);
    });
    return card;
  }));
}

function defaultReport(data) {
  const range = data.estimated_visibility_range_ft || [0, 6];
  const date = data.date ? shortDate(data.date) : "this forecast date";
  return `For ${date}, the model expects ${feet(range)} visibility. This is a forecast estimate based on the available wave, wind, tide, rain, and water-temperature inputs.`;
}

function renderCamera(data) {
  const frame = document.getElementById("cameraFrame");
  const image = document.getElementById("cameraImage");
  const grade = String(data.grade || "C").replace("+", "").toUpperCase();
  const imageName = ["A", "B"].includes(grade)
    ? "viz-best.jpg"
    : grade === "C"
      ? "viz-mid.jpg"
      : "viz-bad.jpg";
  image.src = `${imageName}?v=viz-fallback-1`;
  image.alt = `Expected Scripps Pier visibility reference for grade ${data.grade || grade}`;
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
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${(top + height - y).toFixed(2)}" rx="4" class="wind-bar"><title>${hourLabel(point.time)}: ${speed.toFixed(1)} mph</title></rect>`;
      }).join("")}
    </svg>
  `;
}

function formatFeet(value) {
  const number = Number(value);
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
  return Number(
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
      <span>Direction</span>
      ${rows.map((row) => `
        <strong>${row.label}</strong>
        <em>${formatFeet(row.height)}</em>
        <em>${formatPeriod(row.period)}</em>
        <em>${formatDirection(row.directionLabel, row.directionDeg)}</em>
      `).join("")}
    </div>
  `;
}

function renderWaveChart(forecasts, activeDate) {
  const chart = document.getElementById("waveChart");
  if (!chart) return;
  const active = (forecasts || []).find((forecast) => forecast.date === activeDate) || forecasts?.[0];
  const activeValue = waveHeightValue(active);
  setText("waveSurfRange", Number.isFinite(activeValue) && activeValue > 0 ? waveRange(activeValue) : "-- ft");
  if (active?.is_unavailable) {
    renderWaveComponents({ features: {} });
  } else if (active) {
    renderWaveComponents(active);
  }
  const points = (active?.features?.wave_chart || [])
    .map((point) => ({
      time: point.time,
      value: Number(point.height_ft),
    }))
    .filter((point) => point.time && Number.isFinite(point.value) && point.value >= 0);
  if (!points.length) {
    chart.textContent = "Wave data unavailable.";
    return;
  }
  const values = points.map((point) => point.value);
  const chartPoints = points.filter((_, index) => index % 3 === 0 || index === points.length - 1);
  const yTicks = chartTicks(0, Math.max(...values), 4);
  const min = 0;
  const max = Math.max(5, yTicks[yTicks.length - 1]);
  const left = 58;
  const top = 22;
  const width = 638;
  const height = 166;
  const coords = chartPoints.map((point, index) => {
    const x = xFromIndex(index, chartPoints.length, left, width);
    const y = yFromValue(point.value, min, max, top, height);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const activeIndex = Math.max(0, chartPoints.findIndex((point) => point.value === Math.max(...chartPoints.map((item) => item.value))));
  const activeX = xFromIndex(activeIndex, chartPoints.length, left, width);
  const area = `${left},${top + height} ${coords.join(" ")} ${left + width},${top + height}`;
  chart.innerHTML = `
    <svg viewBox="0 0 720 250" role="img" aria-label="3-hour wave height chart">
      ${yTicks.map((tick) => {
        const y = yFromValue(tick, min, max, top, height);
        return `
          <line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="chart-gridline"></line>
          <text x="${left - 10}" y="${y + 4}" class="chart-y-label" text-anchor="end">${tick.toFixed(tick % 1 ? 1 : 0)} ft</text>
        `;
      }).join("")}
      ${chartPoints.map((point, index) => {
        const x = xFromIndex(index, chartPoints.length, left, width);
        return `
          <line x1="${x}" x2="${x}" y1="${top}" y2="${top + height}" class="chart-x-grid ${index % 2 ? "is-soft" : ""}"></line>
          <text x="${x}" y="224" class="chart-x-label" text-anchor="middle">${hourLabel(point.time)}</text>
        `;
      }).join("")}
      <line x1="${left}" x2="${left}" y1="${top}" y2="${top + height}" class="chart-axis"></line>
      <line x1="${left}" x2="${left + width}" y1="${top + height}" y2="${top + height}" class="chart-axis"></line>
      <polygon points="${area}" class="wave-area"></polygon>
      <polyline points="${coords.join(" ")}" class="wave-line"></polyline>
      <line x1="${activeX}" x2="${activeX}" y1="${top}" y2="${top + height}" class="wave-active-line"></line>
      ${chartPoints.map((point, index) => {
        const x = xFromIndex(index, chartPoints.length, left, width);
        const y = yFromValue(point.value, min, max, top, height);
        const activeClass = index === activeIndex ? " is-active" : "";
        return `<circle cx="${x}" cy="${y}" r="${activeClass ? 6 : 4}" class="wave-point${activeClass}"><title>${hourLabel(point.time)}: ${point.value.toFixed(1)} ft</title></circle>`;
      }).join("")}
    </svg>
  `;
}

function reportText(data) {
  if (data.is_unavailable) {
    return "Forecast unavailable right now. The beta model did not produce a usable La Jolla forecast, so DivePro is not showing a fake grade.";
  }
  const features = data.features || {};
  const range = feet(data.estimated_visibility_range_ft || [0, 6]);
  const grade = String(data.grade || "C").replace("+", "");
  const date = data.date ? shortDate(data.date) : "this forecast date";
  const swell = Number(features.swell_wave_height_max_ft ?? features.total_swell_height_mean_ft ?? 0);
  const period = Number(features.swell_wave_period_max_s ?? features.swell_wave_period_sec ?? 0);
  const wind = Number(features.wind_speed_max_mph ?? 0);
  const waterTemp = Number(features.water_temp_estimate_f ?? 0);
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
  const rainCopy = Number.isFinite(rain) && Number.isFinite(priorRain)
    ? `${rain.toFixed(1)} in forecast rain and ${priorRain.toFixed(1)} in recent 72-hour rain`
    : "limited rain signal";
  const tempCopy = Number.isFinite(waterTemp) && waterTemp > 0
    ? `Water temperature is modeled near ${Math.round(waterTemp)}F.`
    : "";
  const tideCopy = nextTide
    ? `The tide signal is ${tidePhase || "mixed"}, with the next ${nextTide.type === "H" ? "high" : "low"} near ${Number(nextTide.height_ft).toFixed(1)} ft at ${nextTide.time}.`
    : tidePhase
      ? `The tide signal is ${tidePhase}.`
      : "";
  const waveCopy = waveWeight(data);

  if (grade === "A") {
    return `For ${date}, the model expects strong La Jolla visibility around ${range} with a grade ${data.grade || "A"}. The forecast is supported by ${swellCopy}, ${waveCopy.toLowerCase()}, ${windCopy}, and ${rainCopy}. ${tideCopy} ${tempCopy}`.trim();
  }

  if (grade === "F" || grade === "D") {
    return `For ${date}, the model expects poor La Jolla visibility around ${range} with a grade ${data.grade || grade}. The main drag is ${swellCopy} with ${waveCopy.toLowerCase()}, plus ${windCopy} and ${rainCopy}. ${tideCopy} ${tempCopy}`.trim();
  }

  return `For ${date}, the model expects moderate La Jolla visibility around ${range} with a grade ${data.grade || grade}. The forecast is mainly driven by ${swellCopy}, ${waveCopy.toLowerCase()}, ${windCopy}, and ${rainCopy}. ${tideCopy} ${tempCopy}`.trim();
}

function waveWeight(data) {
  const features = data.features || {};
  const surf = waveHeightValue(data);
  const period = Number(features.swell_wave_period_max_s ?? features.swell_wave_period_sec ?? features.swell_period_sec ?? 0);
  if (!Number.isFinite(surf) || surf <= 0) return "Light";
  const range = waveRange(surf);
  if (surf >= 4 || (surf >= 3 && period <= 10)) return `${range} · Heavy`;
  if (surf >= 2) return `${range} · Moderate`;
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

function render(data) {
  const range = data.estimated_visibility_range_ft || [0, 6];
  const score = data.numeric_score_0_100 ?? 0;
  document.body.dataset.forecastState = data.is_unavailable ? "unavailable" : "ready";
  setText("date", data.date ? shortDate(data.date) : "Today");
  setText("location", data.location || "La Jolla / Scripps Pier");
  setText("score", data.is_unavailable ? "--/100" : `${score}/100`);
  setText("grade", data.is_unavailable ? "--" : (data.grade || "--"));
  setText("visibility", data.is_unavailable ? "-- ft" : feet(range));
  setText("bestWindow", data.best_window || "Early morning");
  setText("waveWeight", waveWeight(data));
  setText(
    "forecastSource",
    data.is_unavailable
      ? "Forecast unavailable"
      : data.is_projected
        ? `Projected from ${shortDate(data.projected_from || data.date)}`
        : "Soft probabilistic La Jolla beta model"
  );
  setText("dailyReport", reportText(data));
  setText("tideSource", `NOAA La Jolla 9410230 - ${shortDate(data.date)}`);
  setText("windSource", `Open-Meteo hourly wind - ${shortDate(data.date)}`);
  const panel = document.querySelector(".forecast-panel");
  const grade = document.getElementById("grade");
  if (panel) panel.className = `forecast-panel ${data.is_unavailable ? "" : gradeClass(data.grade)}`;
  if (grade) grade.className = data.is_unavailable ? "" : gradeClass(data.grade);
  document.getElementById("scoreFill").style.width = `${data.is_unavailable ? 0 : score}%`;
  const featureEl = document.getElementById("featureRows");
  if (featureEl) featureEl.innerHTML = data.is_unavailable ? "" : featureRows(data.features || {});
  const fishGrid = document.getElementById("fishGrid");
  if (fishGrid && data.is_unavailable) fishGrid.replaceChildren();
  if (data.is_unavailable) {
    document.getElementById("tideChart").textContent = "Forecast data unavailable.";
    document.getElementById("windChart").textContent = "Forecast data unavailable.";
    document.getElementById("waveChart").textContent = "Forecast data unavailable.";
    return;
  }
  renderCamera(data);
  renderTideChart(data);
  renderWindChart(data);
  renderFishRadar(data);
  trackVerdictView(data);

  // Tide phase and next event
  const tidePhase = data.features?.tide_phase;
  const nextTide = data.features?.tide_next_event;
  const phaseArrow = tidePhase === "rising" ? "↑ Rising" : tidePhase === "falling" ? "↓ Falling" : "--";
  setText("tidePhase", phaseArrow);
  if (nextTide) {
    const typeLabel = nextTide.type === "H" ? "High" : "Low";
    setText("tideNextEvent", `Next: ${typeLabel} ${nextTide.height_ft.toFixed(1)} ft at ${nextTide.time}`);
  } else {
    setText("tideNextEvent", "");
  }
}

function renderForecastStrip(forecasts, activeDate) {
  const strip = document.getElementById("forecastStrip");
  if (!forecasts.length) {
    strip.textContent = "Forecast unavailable.";
    return;
  }
  strip.replaceChildren(...forecasts.map((forecast, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `forecast-day ${gradeClass(forecast.grade)}${forecast.date === activeDate ? " is-active" : ""}`;
    button.setAttribute("aria-pressed", forecast.date === activeDate ? "true" : "false");
    button.innerHTML = `
      <span>${dayLabel(forecast.date, index)}</span>
      <strong>${forecast.grade}</strong>
      <em>${feet(forecast.estimated_visibility_range_ft || [0, 6])}</em>
      <small>${shortDate(forecast.date)}</small>
    `;
    button.addEventListener("click", () => {
      render(forecast);
      renderWaveChart(forecasts, forecast.date);
      renderForecastStrip(forecasts, forecast.date);
      trackEvent("forecast_day_select", {
        forecast_date: forecast.date,
        grade: forecast.grade,
      });
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
    row.className = gradeClass(item.grade);
    row.innerHTML = `
      <strong>${item.grade}</strong>
      <span>${min}-${max} ft</span>
    `;
    return row;
  }));
}

loadForecastData().then(({ latest, tenDay, gradeGuide }) => {
  render(latest);
  renderStaleNotice(latest);
  renderCommunityReport(latest);
  renderForecastStrip(tenDay, latest.date);
  renderWaveChart(tenDay, latest.date);
  renderGradeGuide(gradeGuide);
  if (!latest.is_unavailable) {
    trackEvent("forecast_loaded", {
      forecast_date: latest.date,
      grade: latest.grade,
      visibility_range: feet(latest.estimated_visibility_range_ft),
      surf_range: waveHeightValue(latest),
    });
  }
});
