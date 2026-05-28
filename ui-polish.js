function relabelRainRows() {
  const rows = document.querySelectorAll("#featureRows div");
  rows.forEach((row) => {
    const label = row.querySelector("span");
    if (!label) return;
    const text = label.textContent.trim();
    if (text === "Wind wave") {
      row.remove();
      return;
    }
    if (text === "Rain" || text === "Rain forecast") {
      label.textContent = "Rain forecast";
      row.title = "Forecast precipitation for the target forecast day.";
    }
  });
}

function formatWaveRange(value) {
  const wave = Number.parseFloat(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(wave)) return null;
  const low = Math.max(0, Math.floor(wave));
  const high = Math.max(low + 1, Math.ceil(wave));
  return `${low}-${high} ft`;
}

function polishWaveRows() {
  const rows = document.querySelectorAll("#featureRows div");
  rows.forEach((row) => {
    const label = row.querySelector("span");
    const value = row.querySelector("strong");
    if (!label || !value) return;
    const text = label.textContent.trim();
    if (text === "Surf max" || text === "Primary swell" || text === "Secondary swell") {
      const range = formatWaveRange(value.textContent);
      if (range) value.textContent = range;
    }
  });
}

const localFish = [
  { name: "Surfperch", habitat: "Surf grass / shallow sand", likelihood: 96, note: "one of the most common local sightings" },
  { name: "Opaleye", habitat: "Shallow reef", likelihood: 88, note: "very common around structure" },
  { name: "Calico bass", habitat: "Kelp / reef", likelihood: 84, note: "reliable kelp fish" },
  { name: "California sheephead", habitat: "Reef / boulders", likelihood: 72, note: "common when reef is visible" },
  { name: "Sculpin", habitat: "Reef pockets", likelihood: 58, note: "present but easy to miss" },
  { name: "Rockfish", habitat: "Deeper reef", likelihood: 54, note: "depth and site dependent" },
  { name: "California halibut", habitat: "Sand channels", likelihood: 42, note: "good target, less common sighting" },
  { name: "Cabezon", habitat: "Rock structure", likelihood: 36, note: "structure-dependent" },
  { name: "Bonito", habitat: "Current edges", likelihood: 28, note: "seasonal cruiser" },
  { name: "Barracuda", habitat: "Kelp edge", likelihood: 24, note: "seasonal and water-temp dependent" },
  { name: "Yellowtail", habitat: "Kelp edge / open water", likelihood: 18, note: "trophy chance, not common" },
  { name: "White seabass", habitat: "Kelp rooms", likelihood: 10, note: "rare ghost fish" },
];

function renderSimpleFishRadar() {
  const grid = document.getElementById("fishGrid");
  if (!grid) return;
  const hasOldCards = Boolean(grid.querySelector("details"));
  if (grid.dataset.simpleFish === "true" && !hasOldCards) return;
  grid.classList.add("is-simple");
  grid.dataset.simpleFish = "true";
  grid.replaceChildren(...localFish.map((fish, index) => {
    const card = document.createElement("article");
    card.className = `fish-row simple-fish${index < 3 ? " is-prime" : ""}`;
    card.innerHTML = `
      <div class="fish-rank">${index + 1}</div>
      <div>
        <strong>${fish.name}</strong>
        <span>${fish.habitat} - ${fish.note}</span>
      </div>
      <div class="fish-likelihood">${fish.likelihood}%</div>
    `;
    return card;
  }));
}

async function syncPriorRainRow() {
  const featureRows = document.getElementById("featureRows");
  if (!featureRows) return;
  try {
    const response = await fetch(`la-jolla.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const bundle = await response.json();
    const features = (bundle.latest || bundle).features || {};
    const prior = features.rain_prior_3day_in;
    if (prior === undefined || prior === null) return;
    const existing = Array.from(featureRows.querySelectorAll("div")).find((row) => {
      const label = row.querySelector("span");
      return label && label.textContent.trim() === "Prior 3d rain";
    });
    const card = existing || document.createElement("div");
    card.title = "Rain from the three days before the forecast day, used as the runoff signal.";
    card.innerHTML = `<span>Prior 3d rain</span><strong>${Number(prior).toFixed(3)} in</strong>`;
    if (!existing) featureRows.append(card);
  } catch {
    // Non-critical UI label helper only.
  }
}

function relabelTodayChip() {
  const firstChipLabel = document.querySelector("#forecastStrip .forecast-day:first-child span");
  if (firstChipLabel && firstChipLabel.textContent.trim() === "Latest") {
    firstChipLabel.textContent = "Today";
  }
}

let polishQueued = false;
const runPolish = () => {
  polishQueued = false;
  relabelRainRows();
  polishWaveRows();
  syncPriorRainRow();
  renderSimpleFishRadar();
  relabelTodayChip();
};

const queuePolish = () => {
  if (polishQueued) return;
  polishQueued = true;
  window.requestAnimationFrame(runPolish);
};

const observer = new MutationObserver(queuePolish);

const start = () => {
  observer.observe(document.body, { childList: true, subtree: true });
  runPolish();
  window.setTimeout(runPolish, 100);
  window.setTimeout(runPolish, 500);
  window.setTimeout(runPolish, 1500);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
