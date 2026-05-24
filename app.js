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
    explanation: "Score starts at 70, then adjusts for swell, surf height, short-period energy, wind, mixed swell, and wave energy.",
    is_projected: false,
  };
}

async function loadForecastData() {
  try {
    const [latest, tenDay, gradeGuide] = await Promise.all([
      fetchJson("latest_forecast.json"),
      fetchJson("forecast_10day.json"),
      fetchJson("diveprosd_grade_guidance.json"),
    ]);

    return {
      latest,
      tenDay: Array.isArray(tenDay) && tenDay.length ? tenDay : [latest],
      gradeGuide: Array.isArray(gradeGuide) ? gradeGuide : [],
    };
  } catch {
    const latest = fallbackForecast();
    return { latest, tenDay: [latest], gradeGuide: [] };
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
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function dayLabel(date, index) {
  if (index === 0) return "Latest";

  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
  });
}

function list(id, values) {
  const el = document.getElementById(id);
  if (!el) return;

  el.replaceChildren(
    ...(values || []).map((value) => {
      const li = document.createElement("li");
      li.textContent = value;
      return li;
    })
  );
}

function directionFromDegrees(degrees) {
  if (degrees === undefined || degrees === null || degrees === "") return "";

  const labels = [
    "N", "NNE", "NE", "ENE",
    "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW",
    "W", "WNW", "NW", "NNW",
  ];

  return labels[Math.round(Number(degrees) / 22.5) % 16] || "";
}

function featureRows(features) {
  const enriched = {
    ...features,
    secondary_swell_direction_label:
      features?.secondary_swell_direction_label ||
      directionFromDegrees(features?.secondary_swell_direction_deg ?? features?.wind_direction_deg),
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

  return wanted
    .map(([label, key, unit]) => {
      const raw = enriched?.[key];

      const value =
        raw === undefined || raw === null || raw === ""
          ? "n/a"
          : typeof raw === "number"
            ? `${raw.toFixed(key.includes("energy") ? 0 : 1)} ${unit}`.trim()
            : `${raw}${unit ? ` ${unit}` : ""}`;

      return `<div><span>${label}</span><strong>${value}</strong></div>`;
    })
    .join("");
}

const fishTargets = [
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

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function fishRankings(data) {
  const features = data.features || {};
  const month = new Date(`${data.date}T12:00:00`).getMonth() + 1;
  const temp = Number(features.water_temp_estimate_f || features.air_temp_max_f || 60);
  const visibility = Number(data.estimated_visibility_mid_ft || 8);

  return fishTargets
    .map((fish) => {
      const seasonBonus = fish.months.includes(month) ? 18 : -10;
      const tempBonus = temp >= fish.tempMin ? Math.min(18, (temp - fish.tempMin) * 3) : -12;
      const vizBonus = Math.min(12, Math.max(-8, visibility - 8));
      const abundance = clampScore(fish.abundance + seasonBonus + tempBonus + vizBonus);
      const overall = clampScore(fish.prize * 0.58 + abundance * 0.42);

      return { ...fish, abundance, overall };
    })
    .sort((a, b) => b.overall - a.overall);
}

function renderFishRadar(data) {
  const grid = document.getElementById("fishGrid");
  if (!grid) return;

  grid.replaceChildren(
    ...fishRankings(data).map((fish, index) => {
      const card = document.createElement("article");
      card.className = `fish-row${index < 3 ? " is-prime" : ""}`;

      card.innerHTML = `
        <div class="fish-rank">${index + 1}</div>
        <div>
          <strong>${fish.name}</strong>
          <span>${fish.habitat} · ${fish.note}</span>
        </div>
        <div class="fish-scores">
          <span>Prize ${fish.prize}</span>
          <span>Abundance ${fish.abundance}</span>
        </div>
        <div class="fish-meters" aria-hidden="true">
          <div class="fish-meter"><span>Prize</span><i style="width:${fish.prize}%"></i></div>
          <div class="fish-meter abundance"><span>Abundance</span><i style="width:${fish.abundance}%"></i></div>
        </div>
      `;

      return card;
    })
  );
}

function defaultReport(data) {
  const range = data.estimated_visibility_range_ft || [0, 6];

  return `Viz is running ${feet(range)} out there today. ${
    data.risk_factors?.[0] || "Model conditions are moderate."
  } ${data.best_window || "Early morning slack could clean things up."}`;
}

function renderCamera(data) {
  const frame = document.getElementById("cameraFrame");
  const image = document.getElementById("cameraImage");

  if (!frame || !image) return;

  image.removeAttribute("srcset");
  image.src = "./pier-screenshot.png";
  image.alt = "Scripps Pier underwater visibility screenshot";

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
  return top + (1 - (value - min) / Math.max(0.1, max - min)) * height;
}

function renderTideChart(data) {
  const chart = document.getElementById("tideChart");
  const points = data.features?.tide_chart || [];

  if (!chart) return;

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

  const coords = points
    .map((point, index) => {
      const x = xFromIndex(index, points.length, left, width);
      const y = yFromValue(point.height_ft, min, max, top, height);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const xTicks = points.filter((_, index) => index % 4 === 0 || index === points.length - 1);

  chart.innerHTML = `
    <svg viewBox="0 0 720 250" role="img" aria-label="Hourly tide chart">
      ${yTicks
        .map((tick) => {
          const y = yFromValue(tick, min, max, top, height);
          return `
            <line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="chart-gridline"></line>
            <text x="${left - 10}" y="${y + 4}" class="chart-y-label" text-anchor="end">${tick.toFixed(1)} ft</text>
          `;
        })
        .join("")}

      ${xTicks
        .map((point, index) => {
          const pointIndex = points.indexOf(point);
          const x = xFromIndex(pointIndex, points.length, left, width);
          return `
            <line x1="${x}" x2="${x}" y1="${top}" y2="${top + height}" class="chart-x-grid ${index % 2 ? "is-soft" : ""}"></line>
            <text x="${x}" y="224" class="chart-x-label" text-anchor="middle">${hourLabel(point.time)}</text>
          `;
        })
        .join("")}

      <line x1="${left}" x2="${left}" y1="${top}" y2="${top + height}" class="chart-axis"></line>
      <line x1="${left}" x2="${left + width}" y1="${top + height}" y2="${top + height}" class="chart-axis"></line>
      <polyline points="${coords}" class="tide-line"></polyline>

      ${points
        .map((point, index) => {
          const x = xFromIndex(index, points.length, left, width);
          const y = yFromValue(point.height_ft, min, max, top, height);
          return `<circle cx="${x}" cy="${y}" r="3.5" class="tide-point"><title>${hourLabel(point.time)}: ${point.height_ft.toFixed(2)} ft</title></circle>`;
        })
        .join("")}
    </svg>
  `;
}

function renderWindChart(data) {
  const chart = document.getElementById("windChart");
  const points = data.features?.wind_chart || [];

  if (!chart) return;

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
  const barWidth = Math.max(8, width / points.length - gap);
  const xTicks = points.filter((_, index) => index % 4 === 0 || index === points.length - 1);

  chart.innerHTML = `
    <svg viewBox="0 0 720 250" role="img" aria-label="Hourly wind speed chart">
      ${yTicks
        .map((tick) => {
          const y = yFromValue(tick, min, max, top, height);
          return `
            <line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="chart-gridline"></line>
            <text x="${left - 10}" y="${y + 4}" class="chart-y-label" text-anchor="end">${tick.toFixed(0)} mph</text>
          `;
        })
        .join("")}

      ${xTicks
        .map((point, index) => {
          const pointIndex = points.indexOf(point);
          const x = xFromIndex(pointIndex, points.length, left, width);
          return `
            <line x1="${x}" x2="${x}" y1="${top}" y2="${top + height}" class="chart-x-grid ${index % 2 ? "is-soft" : ""}"></line>
            <text x="${x}" y="224" class="chart-x-label" text-anchor="middle">${hourLabel(point.time)}</text>
          `;
        })
        .join("")}

      <line x1="${left}" x2="${left}" y1="${top}" y2="${top + height}" class="chart-axis"></line>
      <line x1="${left}" x2="${left + width}" y1="${top + height}" y2="${top + height}" class="chart-axis"></line>

      ${points
        .map((point, index) => {
          const speed = point.speed_mph || 0;
          const x = xFromIndex(index, points.length, left, width) - barWidth / 2;
          const y = yFromValue(speed, min, max, top, height);
          return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${(top + height - y).toFixed(2)}" rx="4" class="wind-bar"><title>${hourLabel(point.time)}: ${speed.toFixed(1)} mph</title></rect>`;
        })
        .join("")}
    </svg>
  `;
}

function reportText(data) {
  return (data.report_text || defaultReport(data)).replace(
    /^\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s+Update\s+-\s+Grade\s+[^\n]+\n?/i,
    ""
  );
}

function waveWeight(data) {
  const features = data.features || {};
  const swell = Number(features.swell_wave_height_ft ?? features.total_swell_height_mean_ft ?? 0);
  const period = Number(features.swell_wave_period_sec ?? features.swell_period_sec ?? 0);

  if (!Number.isFinite(swell) || swell <= 0) return "Light";
  if (swell >= 4 || (swell >= 3 && period <= 10)) return `${swell.toFixed(1)} ft · Heavy`;
  if (swell >= 2) return `${swell.toFixed(1)} ft · Moderate`;

  return `${swell.toFixed(1)} ft · Light`;
}

function render(data) {
  const range = data.estimated_visibility_range_ft || [0, 6];
  const score = data.numeric_score_0_100 ?? 0;

  setText("date", shortDate(data.date));
  setText("location", data.location || "La Jolla / Scripps Pier");
  setText("grade", data.grade || "C");
  setText("score", `${score}/100`);
  setText("visibility", feet(range));
  setText("bestWindow", data.best_window || "Early morning");
  setText("waveWeight", waveWeight(data));
  setText("forecastSource", data.is_projected ? `Projected from ${shortDate(data.projected_from || data.date)}` : "Model prediction from parsed conditions");
  setText("explanation", data.explanation || "Transparent score from swell, wind, tide, and wave-energy factors.");
  setText("dailyReport", reportText(data));
  setText("tideSource", `NOAA La Jolla 9410230 - ${shortDate(data.date)}`);
  setText("windSource", `Open-Meteo hourly wind - ${shortDate(data.date)}`);

  const scoreFill = document.getElementById("scoreFill");
  if (scoreFill) scoreFill.style.width = `${score}%`;

  const featureRowsEl = document.getElementById("featureRows");
  if (featureRowsEl) featureRowsEl.innerHTML = featureRows(data.features || {});

  renderCamera(data);
  renderTideChart(data);
  renderWindChart(data);
  renderFishRadar(data);
  list("riskFactors", data.risk_factors || []);
  list("positiveFactors", data.positive_factors || []);
}

function renderForecastStrip(forecasts, activeDate) {
  const strip = document.getElementById("forecastStrip");
  if (!strip) return;

  strip.replaceChildren(
    ...forecasts.map((forecast, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `forecast-day${forecast.date === activeDate ? " is-active" : ""}`;
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
    })
  );
}

function renderGradeGuide(gradeGuide) {
  const guide = document.getElementById("gradeGuide");
  if (!guide) return;

  if (!gradeGuide.length) {
    guide.textContent = "Grade guidance unavailable.";
    return;
  }

  guide.replaceChildren(
    ...gradeGuide.map((item) => {
      const row = document.createElement("div");
      const [min, max] = item.visibility_range_ft;

      row.innerHTML = `
        <strong>${item.grade}</strong>
        <span>${min}-${max} ft</span>
        <em>${item.source === "diveprosd_public_posts" ? "Scraped from DiveProSD posts" : "Inferred extension"}</em>
      `;

      return row;
    })
  );
}

loadForecastData().then(({ latest, tenDay, gradeGuide }) => {
  render(latest);
  renderForecastStrip(tenDay, latest.date);
  renderGradeGuide(gradeGuide);
});
