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
      fetchFirst(["la-jolla.json", "model_outputs/spots/la-jolla.json"]),
      fetchFirst(["diveprosd_grade_guidance.json", "model_outputs/diveprosd_grade_guidance.json"]),
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

function shortDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function dayLabel(date, index) {
  if (index === 0) return "Latest";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
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
    ["Secondary swell", "secondary_swell_height_ft", "ft"],
    ["Secondary period", "secondary_swell_period_s", "s"],
    ["Secondary direction", "secondary_swell_direction_label", ""],
    ["Total swell", "total_swell_height_mean_ft", "ft"],
    ["Water temp", "water_temp_estimate_f", "F"],
    ["Wind max", "wind_speed_max_mph", "mph"],
    ["Tide range", "tide_range_ft", "ft"],
    ["Rain forecast", "rain_24h_in", "in"],
    ["Prior 3d rain", "rain_prior_3day_in", "in"],
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

function renderCamera() {
  const frame = document.getElementById("cameraFrame");
  const image = document.getElementById("cameraImage");
  image.src = "pier-screenshot.png?v=mobile-fix-33";
  frame.hidden = false;
}

function reportText(data) {
  if (data.is_unavailable) {
    return "Forecast unavailable right now. The beta model did not produce a usable La Jolla forecast, so DivePro is not showing a fake grade.";
  }
  const features = data.features || {};
  const range = feet(data.estimated_visibility_range_ft || [0, 6]);
  const grade = String(data.grade || "C").replace("+", "");
  const swell = Number(features.swell_wave_height_max_ft ?? features.total_swell_height_mean_ft ?? 0);
  const period = Number(features.swell_wave_period_max_s ?? features.swell_wave_period_sec ?? 0);
  const wind = Number(features.wind_speed_max_mph ?? 0);
  const waterTemp = Number(features.water_temp_estimate_f ?? 0);
  const direction = features.swell_direction_label || directionFromDegrees(features.swell_wave_direction_deg) || "SW";
  const swellCopy = Number.isFinite(swell) && swell > 0 ? `${swell.toFixed(1)} ft @ ${Math.round(period)}s ${direction} swell` : "light rolling swell";

  if (grade === "A") {
    const tempCopy = waterTemp > 0 ? ` With water temps around ${Math.round(waterTemp - 1)}-${Math.round(waterTemp + 1)}F,` : "";
    return `Really solid visibility today, ${range}. The Scripps Pier cam is showing clean water and detail deep into the frame. Slight haze at distance, but for the most part conditions look clean with minimal particulate.${tempCopy} that means GO DIVE!!!!!\n\nHave fun out there divers :)`;
  }

  if (grade === "F" || grade === "D") {
    return `Visibility is cooked at ${range}. We are still seeing larger swell that should be picking up in the La Jolla area. Conditions look rough, maybe diveable near the cove, but do not go without a buddy!\n\nStay safe out there divers! :)`;
  }

  const windCopy = wind > 0 && wind < 8 ? `Winds look to be holding below ${Math.ceil(wind)} mph.` : "Wind gusts might pick up a bit more in the afternoon, creating bumpier, textured conditions.";
  return `Viz is currently sitting around ${range}. Expect ${swellCopy} to make some steady rolling waves. ${windCopy}\n\nStay safe out there divers! :)`;
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

function gradeClass(grade) {
  return `grade-${String(grade || "C").toLowerCase().replace("+", "-plus")}`;
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
  setText("waveWeight", data.is_unavailable ? "Unavailable" : waveWeight(data));
  setText("forecastSource", data.is_unavailable ? "Forecast unavailable" : data.is_projected ? `Projected from ${shortDate(data.projected_from || data.date)}` : "Soft probabilistic La Jolla beta model");
  setText("dailyReport", reportText(data));
  setText("tideSource", data.is_unavailable ? "NOAA La Jolla predictions" : `NOAA La Jolla 9410230 - ${shortDate(data.date)}`);
  setText("windSource", data.is_unavailable ? "Open-Meteo hourly forecast" : `Open-Meteo hourly wind - ${shortDate(data.date)}`);
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
    return;
  }
  renderCamera(data);
  renderTideChart(data);
  renderWindChart(data);
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

loadForecastData().then(({ latest, tenDay, gradeGuide }) => {
  render(latest);
  renderForecastStrip(tenDay, latest.date);
  renderGradeGuide(gradeGuide);
});
