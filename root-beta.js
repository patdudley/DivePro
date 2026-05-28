async function fetchJson(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} unavailable`);
  return response.json();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}

function displayRange(range) {
  if (!Array.isArray(range) || range.length < 2) return "--";
  const low = Number(range[0]);
  const high = Number(range[1]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return "--";
  const roundedLow = Math.max(0, Math.floor(low / 5) * 5);
  const roundedHigh = Math.max(roundedLow + 5, Math.ceil(high / 5) * 5);
  return `${roundedLow}-${roundedHigh} ft`;
}

function feet(range) {
  return displayRange(range);
}

function shortDate(date) {
  if (!date) return "--";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function dayLabel(date, index) {
  if (index === 0) return "Latest";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function featureRows(features = {}) {
  const rows = [
    ["Surf max", "surf_height_max_ft", "ft"],
    ["Primary swell", "swell_wave_height_max_ft", "ft"],
    ["Primary period", "swell_wave_period_max_s", "s"],
    ["Primary direction", "swell_direction_label", ""],
    ["Secondary swell", "secondary_swell_height_ft", "ft"],
    ["Secondary period", "secondary_swell_period_s", "s"],
    ["Secondary direction", "secondary_swell_direction_label", ""],
    ["Wind wave", "wind_wave_height_max_ft", "ft"],
    ["Water temp", "water_temp_estimate_f", "F"],
    ["Wind max", "wind_speed_max_mph", "mph"],
    ["Tide range", "tide_range_ft", "ft"],
    ["Rain", "rain_24h_in", "in"],
  ];
  return rows.map(([label, key, unit]) => {
    const raw = features[key];
    const value = raw === undefined || raw === null || raw === ""
      ? "n/a"
      : typeof raw === "number"
        ? `${raw.toFixed(unit === "in" ? 3 : 1)} ${unit}`.trim()
        : `${raw}${unit ? ` ${unit}` : ""}`;
    return `<div><span>${label}</span><strong>${value}</strong></div>`;
  }).join("");
}

const cdfwRulesUrl = "https://wildlife.ca.gov/Fishing/Ocean/Regulations/Fishing-Map/Southern";
const fishTargets = [
  { name: "Yellowtail", habitat: "Kelp edge / open water", prize: 98, abundance: 18, months: [6,7,8,9,10], tempMin: 64, note: "top trophy shot", photo: 0, sizeRule: "24 in fork length minimum; limited undersize allowance applies.", takeNote: "Confirm bag rules before spearfishing." },
  { name: "White seabass", habitat: "Kelp rooms", prize: 96, abundance: 10, months: [4,5,6,7], tempMin: 60, note: "rare ghost fish", photo: 1, sizeRule: "28 in total length minimum.", takeNote: "Open-area and MPA rules still apply." },
  { name: "California halibut", habitat: "Sand channels", prize: 86, abundance: 28, months: [4,5,6,7,8,9], tempMin: 58, note: "high table value", photo: 2, sizeRule: "22 in total length minimum.", takeNote: "Measure total length before retaining." },
  { name: "California sheephead", habitat: "Reef / boulders", prize: 78, abundance: 58, months: [5,6,7,8,9,10,11], tempMin: 56, note: "reliable reef target", photo: 3, sizeRule: "12 in total length minimum.", takeNote: "Season and bag rules apply." },
  { name: "Bonito", habitat: "Current edges", prize: 66, abundance: 30, months: [7,8,9,10], tempMin: 63, note: "fast pelagic", photo: 4, sizeRule: "Special size and bag provisions apply.", takeNote: "Use current CDFW table before taking." },
  { name: "Barracuda", habitat: "Kelp edge", prize: 62, abundance: 24, months: [6,7,8,9], tempMin: 62, note: "seasonal cruiser", photo: 5, sizeRule: "28 in total length minimum.", takeNote: "Confirm current bag limit." },
  { name: "Calico bass", habitat: "Kelp / reef", prize: 54, abundance: 72, months: [1,2,3,4,5,6,7,8,9,10,11,12], tempMin: 55, note: "common kelp fish", photo: 6, sizeRule: "14 in total length minimum.", takeNote: "Listed as kelp bass in regulations." },
  { name: "Rockfish", habitat: "Deeper reef", prize: 52, abundance: 38, months: [1,2,3,4,5,6,7,8,9,10,11,12], tempMin: 54, note: "depth dependent", photo: 7, sizeRule: "No single generic minimum size.", takeNote: "Species, season, depth and closed-area rules vary." },
  { name: "Cabezon", habitat: "Rock structure", prize: 48, abundance: 22, months: [1,2,3,4,5,6,7,8,9,10,11,12], tempMin: 54, note: "structure fish", photo: 8, sizeRule: "No minimum length listed in current groundfish guidance.", takeNote: "Groundfish seasons and area rules apply." },
  { name: "Sculpin", habitat: "Reef pockets", prize: 44, abundance: 32, months: [1,2,3,4,5,6,7,8,9,10,11,12], tempMin: 54, note: "handle carefully", photo: 9, sizeRule: "10 in total length minimum.", takeNote: "Regulations list this as California scorpionfish." },
  { name: "Opaleye", habitat: "Shallow reef", prize: 34, abundance: 70, months: [1,2,3,4,5,6,7,8,9,10,11,12], tempMin: 54, note: "abundant, lower prize", photo: 10, sizeRule: "No minimum size shown in the southern finfish table.", takeNote: "Verify current general bag rules and MPAs." },
  { name: "Calico surfperch", habitat: "Surf grass / sand", prize: 26, abundance: 68, months: [1,2,3,4,5,6,7,8,9,10,11,12], tempMin: 52, note: "bottom-tier target", photo: 11, sizeRule: "Surfperch rules depend on species and area.", takeNote: "Confirm identification and current limit before take." },
];

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function fishRankings(data) {
  const features = data.features || {};
  const month = new Date(`${data.date}T12:00:00`).getMonth() + 1;
  const temp = Number(features.water_temp_estimate_f || features.ml_sst_f || 60);
  const visibility = Number(data.estimated_visibility_mid_ft || 8);
  return fishTargets.map((fish) => {
    const seasonBonus = fish.months.includes(month) ? 18 : -10;
    const tempBonus = temp >= fish.tempMin ? Math.min(18, (temp - fish.tempMin) * 3) : -12;
    const vizBonus = Math.min(12, Math.max(-8, visibility - 8));
    const abundance = clampScore(fish.abundance + seasonBonus + tempBonus + vizBonus);
    const overall = clampScore((fish.prize * 0.58) + (abundance * 0.42));
    return { ...fish, abundance, overall };
  }).sort((a, b) => b.overall - a.overall);
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
        <div class="fish-title"><strong>${fish.name}</strong><span>${fish.habitat} - ${fish.note}</span></div>
        <div class="fish-summary-scores"><span>Prize ${fish.prize}</span><span>Abundance ${fish.abundance}</span></div>
        <span class="expand-label">View</span>
      </summary>
      <div class="fish-details">
        <div class="fish-photo" style="--photo-col:${photoCol};--photo-row:${photoRow}" role="img" aria-label="${fish.name} visual reference"></div>
        <div class="fish-meters" aria-hidden="true">
          <div class="fish-meter"><span>Prize</span><i style="width:${fish.prize}%"></i></div>
          <div class="fish-meter abundance"><span>Abundance</span><i style="width:${fish.abundance}%"></i></div>
        </div>
        <div class="fish-rule"><span>Spearfishing size guidance</span><strong>${fish.sizeRule}</strong><p>${fish.takeNote}</p><a href="${cdfwRulesUrl}" target="_blank" rel="noopener">Check current CDFW regulations</a></div>
      </div>
    `;
    return card;
  }));
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
  for (let value = start; value <= end + niceStep / 2; value += niceStep) ticks.push(Number(value.toFixed(2)));
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
  const coords = points.map((point, index) => `${xFromIndex(index, points.length, left, width).toFixed(2)},${yFromValue(point.height_ft, min, max, top, height).toFixed(2)}`).join(" ");
  const xTicks = points.filter((_, index) => index % 4 === 0 || index === points.length - 1);
  chart.innerHTML = `
    <svg viewBox="0 0 720 250" role="img" aria-label="Hourly tide height chart">
      ${yTicks.map((tick) => {
        const y = yFromValue(tick, min, max, top, height);
        return `<line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="chart-gridline"></line><text x="${left - 10}" y="${y + 4}" class="chart-y-label" text-anchor="end">${tick.toFixed(1)} ft</text>`;
      }).join("")}
      ${xTicks.map((point, index) => {
        const pointIndex = points.indexOf(point);
        const x = xFromIndex(pointIndex, points.length, left, width);
        return `<line x1="${x}" x2="${x}" y1="${top}" y2="${top + height}" class="chart-x-grid ${index % 2 ? "is-soft" : ""}"></line><text x="${x}" y="224" class="chart-x-label" text-anchor="middle">${hourLabel(point.time)}</text>`;
      }).join("")}
      <line x1="${left}" x2="${left}" y1="${top}" y2="${top + height}" class="chart-axis"></line>
      <line x1="${left}" x2="${left + width}" y1="${top + height}" y2="${top + height}" class="chart-axis"></line>
      <polyline points="${coords}" class="tide-line"></polyline>
      ${points.map((point, index) => {
        const x = xFromIndex(index, points.length, left, width);
        const y = yFromValue(point.height_ft, min, max, top, height);
        return `<circle cx="${x}" cy="${y}" r="3.5" class="tide-point"><title>${hourLabel(point.time)}: ${point.height_ft.toFixed(2)} ft</title></circle>`;
      }).join("")}
    </svg>`;
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
        return `<line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="chart-gridline"></line><text x="${left - 10}" y="${y + 4}" class="chart-y-label" text-anchor="end">${tick.toFixed(0)} mph</text>`;
      }).join("")}
      ${xTicks.map((point, index) => {
        const pointIndex = points.indexOf(point);
        const x = xFromIndex(pointIndex, points.length, left, width);
        return `<line x1="${x}" x2="${x}" y1="${top}" y2="${top + height}" class="chart-x-grid ${index % 2 ? "is-soft" : ""}"></line><text x="${x}" y="224" class="chart-x-label" text-anchor="middle">${hourLabel(point.time)}</text>`;
      }).join("")}
      <line x1="${left}" x2="${left}" y1="${top}" y2="${top + height}" class="chart-axis"></line>
      <line x1="${left}" x2="${left + width}" y1="${top + height}" y2="${top + height}" class="chart-axis"></line>
      ${points.map((point, index) => {
        const speed = point.speed_mph || 0;
        const x = left + (index * bandWidth) + (gap / 2);
        const y = yFromValue(speed, min, max, top, height);
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${(top + height - y).toFixed(2)}" rx="4" class="wind-bar"><title>${hourLabel(point.time)}: ${speed.toFixed(1)} mph</title></rect>`;
      }).join("")}
    </svg>`;
}

function waveWeight(data) {
  const features = data.features || {};
  const swell = Number(features.swell_wave_height_max_ft ?? features.primary_swell_height_max_ft ?? 0);
  const period = Number(features.swell_wave_period_max_s ?? features.primary_swell_period_max_s ?? 0);
  if (!Number.isFinite(swell) || swell <= 0) return "Light";
  if (swell >= 4 || (swell >= 3 && period <= 10)) return `${swell.toFixed(1)} ft - Heavy`;
  if (swell >= 2) return `${swell.toFixed(1)} ft - Moderate`;
  return `${swell.toFixed(1)} ft - Light`;
}

function dailyReport(data) {
  if (data.is_unavailable) return data.report_text || "Forecast unavailable.";
  const features = data.features || {};
  const range = feet(data.estimated_visibility_range_ft);
  const wave = Number(features.wave_height_max_ft ?? features.surf_height_max_ft ?? 0);
  const wind = Number(features.wind_speed_max_mph ?? 0);
  const bits = [`Viz is expected around ${range}.`];
  if (wave > 0) bits.push(`Waves are around ${wave.toFixed(1)} ft.`);
  if (wind > 0) bits.push(`Wind tops out near ${wind.toFixed(0)} mph.`);
  if (data.best_window) bits.push(`Best shot: ${String(data.best_window).toLowerCase()}.`);
  return `${bits.join(" ")}\n\nStay safe out there divers! :)`;
}

function render(data) {
  if (data.is_unavailable || data.model_source === "unavailable") {
    setText("location", data.location || "La Jolla / Scripps Pier");
    setText("grade", "--");
    setText("score", "Unavailable");
    setText("visibility", "--");
    setText("bestWindow", "Forecast unavailable");
    setText("waveWeight", "--");
    setText("dailyReport", data.report_text || "Forecast unavailable - model output could not be loaded.");
    setText("forecastSource", "Forecast unavailable");
    setText("tideSource", "--");
    setText("windSource", "--");
    const fill = document.getElementById("scoreFill");
    if (fill) fill.style.width = "0%";
    return;
  }
  const score = data.numeric_score_0_100 ?? 0;
  setText("location", data.location || "La Jolla / Scripps Pier");
  setText("grade", data.grade || "--");
  setText("score", `${score}/100`);
  setText("visibility", feet(data.estimated_visibility_range_ft));
  setText("bestWindow", data.best_window || "Early morning");
  setText("waveWeight", waveWeight(data));
  setText("dailyReport", dailyReport(data));
  setText("forecastSource", data.model_source === "soft_probabilistic" ? "Soft probabilistic beta model" : "Forecast unavailable");
  setText("tideSource", `NOAA La Jolla predictions - ${shortDate(data.date)}`);
  setText("windSource", `Open-Meteo hourly forecast - ${shortDate(data.date)}`);
  const fill = document.getElementById("scoreFill");
  if (fill) fill.style.width = `${score}%`;
  const featureEl = document.getElementById("featureRows");
  if (featureEl) featureEl.innerHTML = featureRows(data.features || {});
  renderTideChart(data);
  renderWindChart(data);
  renderFishRadar(data);
}

function renderStrip(forecasts = [], activeDate) {
  const strip = document.getElementById("forecastStrip");
  if (!strip) return;
  strip.replaceChildren(...forecasts.map((forecast, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `forecast-day${forecast.date === activeDate ? " is-active" : ""}`;
    button.innerHTML = `<span>${dayLabel(forecast.date, index)}</span><strong>${forecast.grade || "--"}</strong><em>${feet(forecast.estimated_visibility_range_ft)}</em><small>${shortDate(forecast.date)}</small>`;
    button.addEventListener("click", () => {
      render(forecast);
      renderStrip(forecasts, forecast.date);
    });
    return button;
  }));
}

function renderGuide(guide = []) {
  const el = document.getElementById("gradeGuide");
  if (!el) return;
  el.replaceChildren(...guide.map((item) => {
    const row = document.createElement("div");
    const [min, max] = item.visibility_range_ft || ["?", "?"];
    row.innerHTML = `<strong>${item.grade}</strong><span>${min}-${max} ft</span><em>${item.source === "diveprosd_public_posts" ? "DiveProSD observed band" : "Inferred extension"}</em>`;
    return row;
  }));
}

async function main() {
  try {
    const [bundle, guide] = await Promise.all([
      fetchJson("la-jolla.json"),
      fetchJson("diveprosd_grade_guidance.json"),
    ]);
    const latest = bundle.latest || bundle;
    const tenDay = Array.isArray(bundle.tenDay) ? bundle.tenDay : [latest];
    render(latest);
    renderStrip(tenDay, latest.date);
    renderGuide(Array.isArray(guide) ? guide : []);
  } catch (error) {
    console.error(error);
    setText("grade", "--");
    setText("visibility", "--");
    setText("dailyReport", "Forecast unavailable - forecast data could not be loaded.");
  }
}

main();
