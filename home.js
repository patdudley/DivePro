async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} unavailable`);
  return response.json();
}

function feet(range) {
  return `${range[0]}-${range[1]} ft`;
}

function searchableText(spot) {
  return [
    spot.name,
    spot.location,
    spot.region,
    ...(spot.cams || []).map((cam) => cam.title),
  ].join(" ").toLowerCase();
}

function camBadge(spot) {
  const hasCams = spot.cams && spot.cams.length > 0;
  if (!hasCams) return `<i>Forecast</i>`;
  const hasEmbed = spot.cams.some((cam) => cam.embed);
  return hasEmbed
    ? `<i class="has-cam">&#9679; Live cam</i>`
    : `<i class="has-cam">Cam</i>`;
}

function renderSpotCard(spot) {
  const card = document.createElement("a");
  card.className = "spot-card";
  if (spot.thumb) card.classList.add("has-thumb");
  card.href = spot.url;
  card.dataset.search = searchableText(spot);
  card.dataset.region = spot.region;

  const thumbHtml = spot.thumb
    ? `<div class="card-thumb">
        <img src="${spot.thumb}" alt="${spot.name} cam" loading="lazy" onerror="this.parentElement.hidden=true">
        <div class="card-thumb-badge">
          <span class="card-thumb-region">${spot.region}</span>
          ${camBadge(spot)}
        </div>
      </div>`
    : "";

  card.innerHTML = `
    ${thumbHtml}
    <div class="card-body">
      ${!spot.thumb ? `<div class="spot-card-head"><span>${spot.region}</span>${camBadge(spot)}</div>` : ""}
      <strong>${spot.name}</strong>
      <em>${spot.location}</em>
      <p>${spot.habitat}</p>
      <div class="spot-stats">
        <b>${spot.grade}</b>
        <div class="spot-stats-meta">
          <small>${feet(spot.visibility)}</small>
          <small>${spot.score}/100</small>
        </div>
      </div>
    </div>
  `;
  return card;
}

// Region display order
const REGION_ORDER = ["California", "Florida"];

function buildRegionSections(spots) {
  const byRegion = {};
  spots.forEach((spot) => {
    const r = spot.region || "Other";
    if (!byRegion[r]) byRegion[r] = [];
    byRegion[r].push(spot);
  });

  const regionKeys = Object.keys(byRegion).sort((a, b) => {
    const ai = REGION_ORDER.indexOf(a);
    const bi = REGION_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const sections = [];
  const cards = [];

  regionKeys.forEach((region) => {
    const regionSpots = byRegion[region];
    const section = document.createElement("div");
    section.className = "region-section";
    section.dataset.region = region;

    const header = document.createElement("div");
    header.className = "region-header";
    header.innerHTML = `
      <strong>${region}</strong>
      <span>${regionSpots.length} spot${regionSpots.length !== 1 ? "s" : ""}</span>
    `;

    const grid = document.createElement("div");
    grid.className = "spot-grid";

    const regionCards = regionSpots.map(renderSpotCard);
    regionCards.forEach((card) => {
      grid.append(card);
      cards.push(card);
    });

    section.append(header, grid);
    sections.push(section);
  });

  return { sections, cards };
}

function filterCards(cards, sections, query, region) {
  const normalized = query.trim().toLowerCase();
  let visibleCount = 0;

  cards.forEach((card) => {
    const matchesText = !normalized || card.dataset.search.includes(normalized);
    const matchesRegion = region === "all" || card.dataset.region === region;
    card.hidden = !(matchesText && matchesRegion);
    if (!card.hidden) visibleCount += 1;
  });

  sections.forEach((section) => {
    const sectionCards = section.querySelectorAll(".spot-card");
    section.hidden = [...sectionCards].every((c) => c.hidden);
  });

  document.getElementById("emptyResults").hidden = visibleCount !== 0;
}

function formattedUpdate(timestamp) {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function init() {
  const results = document.getElementById("spotResults");
  const search = document.getElementById("spotSearch");
  const filters = document.getElementById("regionFilters");
  let activeRegion = "all";

  try {
    const spots = await fetchJson("model_outputs/spots.json");
    const { sections, cards } = buildRegionSections(spots);
    results.replaceChildren(...sections);
    document.getElementById("updatedAt").textContent = `Updated ${formattedUpdate(spots[0].generated_at)}`;

    search.addEventListener("input", () =>
      filterCards(cards, sections, search.value, activeRegion)
    );

    filters.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-region]");
      if (!button) return;
      activeRegion = button.dataset.region;
      filters.querySelectorAll("button").forEach((filter) => {
        filter.classList.toggle("is-active", filter === button);
      });
      filterCards(cards, sections, search.value, activeRegion);
    });
  } catch {
    results.textContent =
      "Forecast spots are unavailable. Rebuild the forecast data and refresh.";
  }
}

init();
