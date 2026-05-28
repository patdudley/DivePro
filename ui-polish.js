function relabelRainRows() {
  const rows = document.querySelectorAll("#featureRows div");
  rows.forEach((row) => {
    const label = row.querySelector("span");
    if (!label) return;
    if (label.textContent.trim() === "Rain") {
      label.textContent = "Rain forecast";
      row.title = "Forecast precipitation for the target forecast day.";
    }
  });
}

async function addPriorRainRow() {
  const featureRows = document.getElementById("featureRows");
  if (!featureRows || featureRows.dataset.priorRainAdded === "true") return;
  try {
    const response = await fetch(`la-jolla.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const bundle = await response.json();
    const features = (bundle.latest || bundle).features || {};
    const prior = features.rain_prior_3day_in;
    if (prior === undefined || prior === null) return;
    const card = document.createElement("div");
    card.title = "Rain from the three days before the forecast day, used as the runoff signal.";
    card.innerHTML = `<span>Prior 3d rain</span><strong>${Number(prior).toFixed(3)} in</strong>`;
    featureRows.append(card);
    featureRows.dataset.priorRainAdded = "true";
  } catch {
    // Non-critical UI label helper only.
  }
}

const observer = new MutationObserver(() => {
  relabelRainRows();
  addPriorRainRow();
});

const start = () => {
  const target = document.getElementById("featureRows");
  if (!target) return;
  observer.observe(target, { childList: true, subtree: true });
  relabelRainRows();
  addPriorRainRow();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
