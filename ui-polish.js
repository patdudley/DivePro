function relabelRainRows() {
  const rows = document.querySelectorAll("#featureRows div");
  let seenPriorRain = false;
  rows.forEach((row) => {
    const label = row.querySelector("span");
    if (!label) return;
    const text = label.textContent.trim();
    if (text === "Wind wave") {
      row.remove();
      return;
    }
    if (text === "Prior 3d rain" || text === "72-hour rain") {
      if (seenPriorRain) {
        row.remove();
        return;
      }
      seenPriorRain = true;
      label.textContent = "72-hour rain";
    }
    if (text === "Rain" || text === "Rain forecast") {
      label.textContent = "Rain forecast";
      row.title = "Forecast precipitation for the target forecast day.";
    }
  });
}

function formatWaveRange(value) {
  const text = String(value);
  if (text.includes("-")) return null;
  const wave = Number.parseFloat(text);
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
    if (text === "Surf max") {
      const range = formatWaveRange(value.textContent);
      if (range && value.textContent.trim() !== range) value.textContent = range;
    }
  });
}

let polishQueued = false;
const runPolish = () => {
  polishQueued = false;
  relabelRainRows();
  polishWaveRows();
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
