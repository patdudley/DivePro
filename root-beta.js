async function fetchJson(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} unavailable`);
  return response.json();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}

function feet(range) {
  return Array.isArray(range) ? `${range[0]}-${range[1]} ft` : "—";
}

function shortDate(date) {
  if (!date) return "—";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function dayLabel(date, index) {
  if (index === 0) return "Latest";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function list(id, values) {
  const el = document.getElementById(id);
  if (!el) return;
  el.replaceChildren(...(values || []).map((value) => {
    const li = document.createElement("li");
    li.textContent = value;
    return li;
  }));
}

function featureRows(features = {}) {
  const rows = [
    ["Primary swell", "swell_wave_height_max_ft", "ft"],
    ["Primary period", "swell_wave_period_max_s", "s"],
    ["Primary direction", "swell_direction_label", ""],
    ["Secondary swell", "secondary_swell_height_ft", "ft"],
    ["Secondary period", "secondary_swell_period_s", "s"],
    ["Secondary direction", "secondary_swell_direction_label", ""],
    ["Wind wave", "wind_wave_height_max_ft", "ft"],
    ["Wind max", "wind_speed_max_mph", "mph"],
    ["Water temp", "water_temp_estimate_f", "F"],
    ["Rain", "rain_24h_in", "in"],
    ["Tide range", "tide_range_ft", "ft"],
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

function render(data) {
  const range = data.estimated_visibility_range_ft;
  setText("spotTitle", data.spot_name || "La Jolla");
  setText("spotDescription", "La Jolla Forecast Beta — prospective testing, not a verified accuracy claim.");
  setText("date", shortDate(data.date));
  setText("location", data.location || "La Jolla, San Diego");
  setText("grade", data.grade || "—");
  setText("score", data.numeric_score_0_100 == null ? "—" : `${data.numeric_score_0_100}/100`);
  setText("visibility", feet(range));
  setText("bestWindow", data.best_window || "—");
  setText("habitat", data.habitat || "Kelp forest / sand channels");
  setText("exposure", data.exposure || "Open coast");
  setText("confidence", data.confidence || "medium");
  setText("waveWeight", data.features?.surf_height_max_ft ? `${data.features.surf_height_max_ft} ft surf` : "—");
  setText("forecastSource", data.model_source === "soft_probabilistic" ? "Soft probabilistic beta model" : "Forecast unavailable");
  setText("dailyReport", data.report_text || "Forecast unavailable.");
  setText("explanation", data.explanation || "");
  setText("tideSource", `Tide predictions — ${shortDate(data.date)}`);
  setText("windSource", `Open-Meteo hourly wind — ${shortDate(data.date)}`);
  const fill = document.getElementById("scoreFill");
  if (fill) fill.style.width = `${data.numeric_score_0_100 || 0}%`;
  const featureEl = document.getElementById("featureRows");
  if (featureEl) featureEl.innerHTML = featureRows(data.features);
  list("riskFactors", data.risk_factors || []);
  list("positiveFactors", data.positive_factors || []);
}

function renderStrip(forecasts = [], activeDate) {
  const strip = document.getElementById("forecastStrip");
  if (!strip) return;
  strip.replaceChildren(...forecasts.map((forecast, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `forecast-day${forecast.date === activeDate ? " is-active" : ""}`;
    button.innerHTML = `
      <span>${dayLabel(forecast.date, index)}</span>
      <strong>${forecast.grade || "—"}</strong>
      <em>${feet(forecast.estimated_visibility_range_ft)}</em>
      <small>${shortDate(forecast.date)}</small>
    `;
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
    row.innerHTML = `<strong>${item.grade}</strong><span>${min}-${max} ft</span><em>${item.source || "grade band"}</em>`;
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
    setText("date", "Forecast unavailable");
    setText("grade", "—");
    setText("visibility", "—");
    setText("dailyReport", "Forecast unavailable — forecast data could not be loaded.");
  }
}

main();
