(function () {
  const WIND_MANIFEST_PATH = "data/wind-cropped/wind-san-diego-manifest.json?v=multi-map-timeline-2";
  const WATER_MASK_PATH = "data/water-mask-san-diego.geojson?v=multi-map-2";
  const NOW_FRAME_TOLERANCE_MS = 90 * 60 * 1000;
  const WIND_PARTICLE_COUNT = 360;
  const WIND_COAST_FEATHER_PX = 52;
  const WIND_PARTICLE_SPEED = 0.000078;
  const WIND_PARTICLE_REFERENCE_ZOOM = 8.5;
  const WIND_STREAK_LENGTH_MULTIPLIER = 5.4;
  const DEPTH_SOURCE_ID = "divepro-ocean-depth";
  const DEPTH_REFERENCE_SOURCE_ID = "divepro-ocean-depth-reference";
  const DEPTH_LAYER_ID = "divepro-ocean-depth";
  const DEPTH_REFERENCE_LAYER_ID = "divepro-ocean-depth-reference";
  const DEPTH_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}";
  const DEPTH_REFERENCE_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}";
  const MAPTILER_WATER_LAYER_ID = "Water";
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
  const SPOT_PROBES = new WeakMap();

  const DETAIL_MAPS = {
    "la-jolla": {
      region: "La Jolla, San Diego",
      center: [-117.255, 32.866],
      zoom: 12.25,
      pins: [
        { label: "Scripps Beach", detail: "San Diego", lngLat: [-117.255, 32.866], href: "index.html" },
      ],
    },
    "catalina-wrigley": {
      region: "Catalina Island",
      center: [-118.485, 33.445],
      zoom: 10.6,
      pins: [
        { label: "Wrigley Reserve", detail: "Catalina Island", lngLat: [-118.485, 33.445], href: "catalina-wrigley.html" },
      ],
    },
    "anacapa-ocean": {
      region: "Channel Islands",
      center: [-119.37, 34.015],
      zoom: 10.35,
      pins: [
        { label: "Anacapa Ocean", detail: "Channel Islands", lngLat: [-119.37, 34.015], href: "anacapa-ocean.html" },
      ],
    },
    "lower-keys": {
      region: "Lower Keys, Florida",
      center: [-81.43, 24.64],
      zoom: 10.7,
      pins: [
        { label: "Lower Keys", detail: "Viva The Keys Reef Cam", lngLat: [-81.43, 24.64], href: "lower-keys.html" },
      ],
    },
    "deerfield-beach": {
      region: "Deerfield Beach, Florida",
      center: [-80.073, 26.317],
      zoom: 12.2,
      pins: [
        { label: "Deerfield Beach", detail: "International Fishing Pier", lngLat: [-80.073, 26.317], href: "deerfield-beach.html" },
      ],
    },
    "pompano-pier": {
      region: "Pompano Beach, Florida",
      center: [-80.083, 26.235],
      zoom: 12.15,
      pins: [
        { label: "Pompano Pier", detail: "Underwater Pier Cam", lngLat: [-80.083, 26.235], href: "pompano-pier.html" },
      ],
    },
    "coral-city": {
      region: "Miami, Florida",
      center: [-80.16, 25.75],
      zoom: 12.1,
      pins: [
        { label: "Coral City", detail: "Miami reef camera", lngLat: [-80.16, 25.75], href: "coral-city.html" },
      ],
    },
    "utopia-sandy-channel": {
      region: "Roatan",
      center: [-86.55, 16.35],
      zoom: 11.25,
      pins: [
        { label: "Sandy Channel", detail: "Utopia Village", lngLat: [-86.55, 16.35], href: "utopia-sandy-channel.html" },
        { label: "Reef Cam", detail: "Utopia Village", lngLat: [-86.53, 16.36], href: "utopia-reef-cam.html" },
      ],
    },
    "utopia-reef-cam": {
      region: "Roatan",
      center: [-86.53, 16.36],
      zoom: 11.25,
      pins: [
        { label: "Sandy Channel", detail: "Utopia Village", lngLat: [-86.55, 16.35], href: "utopia-sandy-channel.html" },
        { label: "Reef Cam", detail: "Utopia Village", lngLat: [-86.53, 16.36], href: "utopia-reef-cam.html" },
      ],
    },
  };

  function tintDiveProMapStyle(style) {
    style.layers = style.layers.map((layer) => {
      const paint = { ...(layer.paint || {}) };
      const id = layer.id.toLowerCase();

      if (layer.type === "background") paint["background-color"] = "#676a68";

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
    const response = await fetch(`https://api.maptiler.com/maps/dataviz-dark/style.json?key=${apiKey}`);
    if (!response.ok) throw new Error("MapTiler style request failed");
    return tintDiveProMapStyle(await response.json());
  }

  function addPins(map, pins) {
    const maplibre = window.maplibregl || globalThis.maplibregl;
    pins.forEach((pin) => {
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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeLngLat(lngLat) {
    const lng = Number(lngLat?.lng ?? lngLat?.lon ?? lngLat?.[0]);
    const lat = Number(lngLat?.lat ?? lngLat?.[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lng, lat };
  }

  function distanceMiles(a, b) {
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const dLat = lat2 - lat1;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function pointInfluence(distance, radius) {
    if (distance >= radius) return 0;
    const t = 1 - distance / radius;
    return t * t * (3 - 2 * t);
  }

  function windDirectionDegrees(u, v) {
    return (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
  }

  function compassFromDegrees(degrees) {
    const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return points[Math.round(degrees / 22.5) % points.length];
  }

  function relativeVector(point, origin) {
    const milesPerDegreeLat = 69;
    const milesPerDegreeLng = Math.cos(origin.lat * Math.PI / 180) * 69;
    const dx = (point.lng - origin.lng) * milesPerDegreeLng;
    const dy = (point.lat - origin.lat) * milesPerDegreeLat;
    return {
      dx,
      dy,
      distance: Math.hypot(dx, dy),
    };
  }

  function islandWindExposure(point, island, wind) {
    const relative = relativeVector(point, island);
    if (!relative.distance) return { lee: 0, windward: 0, influence: 1 };
    const windUnit = { x: wind.u / Math.max(wind.speedMph / MPS_TO_MPH, 0.001), y: wind.v / Math.max(wind.speedMph / MPS_TO_MPH, 0.001) };
    const pointUnit = { x: relative.dx / relative.distance, y: relative.dy / relative.distance };
    const alignment = windUnit.x * pointUnit.x + windUnit.y * pointUnit.y;
    const influence = pointInfluence(relative.distance, island.radiusMiles);
    return {
      lee: clamp((alignment + 0.12) / 0.88, 0, 1) * influence,
      windward: clamp((-alignment + 0.05) / 0.95, 0, 1) * influence,
      influence,
    };
  }

  function visibilityLabel(index) {
    if (index < 34) return "Lower";
    if (index < 58) return "Fair";
    if (index < 78) return "Clearer";
    return "Clearest";
  }

  function laJollaVisibilityRange() {
    const text = document.querySelector(".visibility-value, [data-visibility-range]")?.textContent?.trim();
    return text || "10-14 ft";
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
    const leeBonus = VISIBILITY_CLEAR_ZONES.reduce((sum, zone) => (
      sum + zone.bonus * pointInfluence(distanceMiles(point, zone), zone.radiusMiles)
    ), 0);
    const islandAdjustment = VISIBILITY_ISLAND_ZONES.reduce((sum, island) => {
      const exposure = islandWindExposure(point, island, wind);
      return sum
        + island.leeBonus * exposure.lee
        - island.windwardPenalty * exposure.windward
        - island.shelfPenalty * exposure.influence;
    }, 0);
    const index = clamp(40 + offshoreBonus + blueWaterBonus + leeBonus + islandAdjustment - strongestNearshorePenalty - windPenalty, 4, 98);
    const calibrated = laJollaDistance <= LA_JOLLA_CALIBRATION.radiusMiles;

    return {
      index,
      label: visibilityLabel(index),
      calibrated,
      calibratedRange: calibrated ? laJollaVisibilityRange() : null,
    };
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

  function windColor(speedMph) {
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

  function windParticleSpeedForZoom(zoom) {
    return WIND_PARTICLE_SPEED * Math.max(0.14, Math.min(1, 2 ** ((WIND_PARTICLE_REFERENCE_ZOOM - zoom) * 0.72)));
  }

  function windParticleSpeedForWind(speedMph) {
    return Math.max(0.82, Math.min(1.68, 0.72 + speedMph / 16));
  }

  function normalizeWindFrame(frame, index = 0) {
    const hour = Number(frame.hour ?? frame.forecast_hour ?? 0);
    return {
      ...frame,
      hour,
      label: frame.label || (hour === 0 ? "Now" : `+${hour}h`),
      path: frame.path || "data/wind-san-diego.json",
      index,
    };
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
    const response = await fetch(WIND_MANIFEST_PATH, { cache: "no-store" });
    if (!response.ok) throw new Error("Wind forecast manifest unavailable");
    const manifest = await response.json();
    const frames = (manifest.frames || []).map(normalizeWindFrame).filter((frame) => frame.path);
    if (!frames.length) throw new Error("Wind forecast manifest has no frames");
    return { ...manifest, frames };
  }

  async function fetchWindFrame(frame, cache) {
    if (cache?.has(frame.path)) return cache.get(frame.path);
    const response = await fetch(frame.path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Wind frame request failed: ${frame.path}`);
    const grid = await response.json();
    cache?.set(frame.path, grid);
    return grid;
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

    if (!totalWeight) return nearestValidWindVector(grid, Math.round(gx), Math.round(gy));
    u /= totalWeight;
    v /= totalWeight;
    return { u, v, speedMph: Math.hypot(u, v) * MPS_TO_MPH };
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
    let needsGradientDraw = true;
    let needsWaterMaskDraw = true;
    let waterMaskData = null;
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

    function randomWaterPoint() {
      if (!grid) {
        const fallback = map.unproject([-1000, -1000]);
        return { x: -1000, y: -1000, lon: fallback.lng, lat: fallback.lat, age: 999 };
      }
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const point = [Math.random() * mapContainer.clientWidth, Math.random() * mapContainer.clientHeight];
        const lngLat = map.unproject(point);
        if (isScreenPointOnWater(point[0], point[1]) && interpolateWindAtLonLat(grid, lngLat.lng, lngLat.lat)) {
          return { x: point[0], y: point[1], lon: lngLat.lng, lat: lngLat.lat, age: Math.floor(Math.random() * 120) };
        }
      }
      const fallback = map.unproject([-1000, -1000]);
      return { x: -1000, y: -1000, lon: fallback.lng, lat: fallback.lat, age: 999 };
    }

    function resetParticle(particle) {
      Object.assign(particle, randomWaterPoint());
    }

    function drawGradient() {
      const rect = mapContainer.getBoundingClientRect();
      gradientCtx.clearRect(0, 0, rect.width, rect.height);
      if (!grid) {
        needsGradientDraw = false;
        return;
      }
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
      if (!grid) {
        gradientCtx.clearRect(0, 0, rect.width, rect.height);
        ctx.clearRect(0, 0, rect.width, rect.height);
        animationId = requestAnimationFrame(draw);
        return;
      }
      if (mapIsInteracting) {
        ctx.clearRect(0, 0, rect.width, rect.height);
        animationId = requestAnimationFrame(draw);
        return;
      }
      if (needsGradientDraw) drawGradient();
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const particleSpeed = windParticleSpeedForZoom(map.getZoom());
      particles.forEach((particle) => {
        const lngLat = map.unproject([particle.x, particle.y]);
        particle.lon = lngLat.lng;
        particle.lat = lngLat.lat;
        const wind = interpolateWindAtLonLat(grid, particle.lon, particle.lat);
        if (!wind || !isScreenPointOnWater(particle.x, particle.y) || particle.x < -40 || particle.x > rect.width + 40 || particle.y < -40 || particle.y > rect.height + 40 || particle.age > 150) {
          resetParticle(particle);
          return;
        }
        const windSpeedFactor = windParticleSpeedForWind(wind.speedMph);
        const end = map.project([
          particle.lon + wind.u * particleSpeed * windSpeedFactor,
          particle.lat + wind.v * particleSpeed * windSpeedFactor,
        ]);
        if (!isScreenPointOnWater(end.x, end.y)) {
          resetParticle(particle);
          return;
        }
        const streakX = particle.x + (end.x - particle.x) * WIND_STREAK_LENGTH_MULTIPLIER;
        const streakY = particle.y + (end.y - particle.y) * WIND_STREAK_LENGTH_MULTIPLIER;
        const alpha = Math.max(0.24, Math.min(0.58, wind.speedMph / 18));

        const glow = ctx.createLinearGradient(particle.x, particle.y, streakX, streakY);
        glow.addColorStop(0, "rgba(226, 242, 255, 0)");
        glow.addColorStop(0.32, `rgba(125, 216, 247, ${alpha * 0.18})`);
        glow.addColorStop(1, `rgba(255, 255, 255, ${Math.min(0.38, alpha * 0.72)})`);
        ctx.lineWidth = 4.2;
        ctx.strokeStyle = glow;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(streakX, streakY);
        ctx.stroke();

        const core = ctx.createLinearGradient(particle.x, particle.y, streakX, streakY);
        core.addColorStop(0, "rgba(226, 242, 255, 0)");
        core.addColorStop(0.42, `rgba(226, 242, 255, ${alpha * 0.44})`);
        core.addColorStop(1, `rgba(255, 255, 255, ${Math.min(0.88, alpha + 0.2)})`);
        ctx.lineWidth = 1.75;
        ctx.strokeStyle = core;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(streakX, streakY);
        ctx.stroke();

        particle.x = end.x;
        particle.y = end.y;
        particle.age += 1;
      });
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
      interactionSettleTimer = window.setTimeout(() => frame.classList.remove("is-map-moving"), 150);
    }

    resize();
    drawWaterMask();
    particles = Array.from({ length: WIND_PARTICLE_COUNT }, randomWaterPoint);
    map.on("resize", resize);
    map.on("movestart", beginInteraction);
    map.on("zoomstart", beginInteraction);
    map.on("dragstart", beginInteraction);
    map.on("moveend", endInteraction);
    map.on("zoomend", endInteraction);
    map.on("idle", endInteraction);
    window.addEventListener("resize", resize);
    animationId = requestAnimationFrame(draw);

    return {
      setGrid(nextGrid) {
        grid = nextGrid;
        needsWaterMaskDraw = true;
        waterMaskData = null;
        needsGradientDraw = true;
        particles = Array.from({ length: WIND_PARTICLE_COUNT }, randomWaterPoint);
      },
      destroy() {
        cancelAnimationFrame(animationId);
        gradientCanvas.remove();
        canvas.remove();
        window.removeEventListener("resize", resize);
      },
    };
  }

  function ensureSpotWindTimeline(frame) {
    let timeline = frame.querySelector(".spot-wind-timeline");
    if (timeline) return timeline;

    timeline = document.createElement("div");
    timeline.className = "wind-timeline spot-wind-timeline is-hidden";
    timeline.setAttribute("aria-label", "Wind forecast timeline");
    timeline.innerHTML = `
      <div class="spot-wind-control-row">
        <button class="spot-wind-play" type="button" aria-label="Play wind forecast timeline">▶</button>
        <output class="spot-wind-readout" aria-live="polite">Now</output>
        <div class="spot-wind-axis">
          <div class="spot-wind-slider-wrap">
            <input class="spot-wind-slider" type="range" min="0" max="0" value="0" aria-label="Wind forecast hour">
          </div>
          <div class="wind-time-ticks spot-wind-ticks" aria-hidden="true"></div>
        </div>
      </div>
      <div class="spot-wind-days" role="tablist" aria-label="Wind forecast date"></div>
    `;
    frame.appendChild(timeline);
    return timeline;
  }

  function setupSpotWindTimeline(frame, layer, manifest, frameCache, map, timelineCoordinates) {
    const frames = manifest.frames || [];
    const timeline = ensureSpotWindTimeline(frame);
    const playButton = frame.querySelector(".spot-wind-play");
    const slider = frame.querySelector(".spot-wind-slider");
    const sliderWrap = frame.querySelector(".spot-wind-slider-wrap");
    const ticks = frame.querySelector(".spot-wind-ticks");
    const timeReadout = frame.querySelector(".spot-wind-readout");
    const daySelector = frame.querySelector(".spot-wind-days");
    if (!timeline || !playButton || !slider || !ticks || !frames.length) {
      timeline?.classList.add("is-hidden");
      return;
    }

    frames.forEach((forecastFrame) => {
      forecastFrame.localDate = frameDate(forecastFrame);
    });

    const timelineDates = [...new Set(frames.map((forecastFrame) => forecastFrame.localDate).filter(Boolean))];
    const currentIndex = defaultFrameIndex(frames);
    let activeIndex = currentIndex;
    let windowStartIndex = Math.max(0, frames.findIndex((forecastFrame) => forecastFrame.localDate === frames[currentIndex]?.localDate));
    let playTimer;
    let requestToken = 0;
    let tickResizeTimer;
    let tickResizeObserver;
    let activeWindSpeed = null;
    timeline.classList.toggle("is-hidden", frames.length < 2);

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

    function timelineDateLabel(date) {
      if (!date) return "";
      return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }

    function timelineDayParts(date) {
      const value = new Date(`${date}T12:00:00`);
      return {
        weekday: value.toLocaleDateString("en-US", { weekday: "short" }),
        day: value.toLocaleDateString("en-US", { day: "numeric" }),
      };
    }

    function fullTimeLabel(forecastFrame) {
      const time = frameTime(forecastFrame);
      if (!time) return forecastFrame?.label || "Wind";
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "numeric",
        minute: "2-digit",
      }).format(time);
    }

    function sunriseFrameIndex(date) {
      const dayIndices = frames
        .map((forecastFrame, index) => (forecastFrame.localDate === date ? index : -1))
        .filter((index) => index >= 0);
      if (!dayIndices.length) return -1;

      const [longitude, latitude] = timelineCoordinates || [];
      let sunriseTime = null;
      if (window.SunCalc?.getTimes && Number.isFinite(latitude) && Number.isFinite(longitude)) {
        const [year, month, day] = date.split("-").map(Number);
        const referenceDate = new Date(Date.UTC(year, month - 1, day, 20));
        const calculatedSunrise = window.SunCalc.getTimes(referenceDate, latitude, longitude)?.sunrise;
        if (calculatedSunrise instanceof Date && !Number.isNaN(calculatedSunrise.getTime()) && pacificDate(calculatedSunrise.toISOString()) === date) {
          sunriseTime = calculatedSunrise.getTime();
        }
      }

      return dayIndices.reduce((bestIndex, index) => {
        const forecastTime = frameTime(frames[index])?.getTime();
        const bestTime = frameTime(frames[bestIndex])?.getTime();
        if (!Number.isFinite(forecastTime)) return bestIndex;
        if (sunriseTime !== null) {
          return Math.abs(forecastTime - sunriseTime) < Math.abs(bestTime - sunriseTime) ? index : bestIndex;
        }
        return Math.abs((pacificHour(frames[index]) ?? 6) - 6) < Math.abs((pacificHour(frames[bestIndex]) ?? 6) - 6) ? index : bestIndex;
      }, dayIndices[0]);
    }

    function windowEndIndex() {
      const date = activeWindowDate();
      const dateEndIndex = lastIndexForDate(date);
      const boundedEndIndex = Math.min(frames.length - 1, windowStartIndex + 23);
      return dateEndIndex >= 0 ? Math.min(dateEndIndex, boundedEndIndex) : boundedEndIndex;
    }

    function updateSliderBounds() {
      const endIndex = windowEndIndex();
      slider.min = "0";
      slider.max = String(Math.max(0, endIndex - windowStartIndex));
      slider.value = String(Math.max(0, activeIndex - windowStartIndex));
    }

    function renderTicks() {
      const endIndex = windowEndIndex();
      const windowFrames = frames.slice(windowStartIndex, endIndex + 1);
      if (!windowFrames.length) {
        ticks.innerHTML = "";
        return;
      }

      const firstTime = frameTime(windowFrames[0])?.getTime();
      const lastTime = frameTime(windowFrames[windowFrames.length - 1])?.getTime();
      const duration = Math.max(1, (lastTime || 0) - (firstTime || 0));
      const candidates = windowFrames.map((forecastFrame, index) => {
        const hour = pacificHour(forecastFrame);
        const time = frameTime(forecastFrame)?.getTime() || firstTime || 0;
        const isStart = index === 0;
        const isEnd = index === windowFrames.length - 1;
        const priority = isStart || isEnd ? 100 : hour === 12 ? 90 : hour % 6 === 0 ? 70 : hour % 3 === 0 ? 50 : hour % 2 === 0 ? 30 : 10;
        return {
          label: pacificHourLabel(forecastFrame),
          left: ((time - (firstTime || time)) / duration) * 100,
          priority,
          hour,
          isStart,
          isEnd,
          index,
        };
      }).filter((candidate) => candidate.isStart || candidate.isEnd || candidate.hour % 3 === 0);

      ticks.innerHTML = candidates.map((candidate) => {
        const edgeClass = candidate.isStart ? " is-start" : candidate.isEnd ? " is-end" : "";
        return `<span class="is-candidate${edgeClass}" data-priority="${candidate.priority}" data-index="${candidate.index}" style="left:${candidate.left}%">${candidate.label}</span>`;
      }).join("");

      const tickBounds = ticks.getBoundingClientRect();
      const accepted = [];
      Array.from(ticks.children)
        .sort((a, b) => Number(b.dataset.priority) - Number(a.dataset.priority) || Number(a.dataset.index) - Number(b.dataset.index))
        .forEach((tick) => {
          const rect = tick.getBoundingClientRect();
          const bounds = { left: rect.left - tickBounds.left - 2, right: rect.right - tickBounds.left + 2 };
          if (accepted.some((item) => bounds.left < item.right && bounds.right > item.left)) return;
          accepted.push(bounds);
          tick.classList.add("is-visible");
        });
    }

    function scheduleTickRender() {
      window.clearTimeout(tickResizeTimer);
      tickResizeTimer = window.setTimeout(renderTicks, 120);
    }

    function updateActiveTime(speedMph = null) {
      activeWindSpeed = speedMph;
      const forecastFrame = frames[activeIndex];
      const label = isCurrentWindFrame(forecastFrame) ? "Now" : fullTimeLabel(forecastFrame);
      const windLabel = Number.isFinite(speedMph) ? `${Math.round(speedMph)} mph` : "…";
      if (timeReadout) timeReadout.textContent = label;
      slider.setAttribute("aria-valuetext", `${timelineDateLabel(forecastFrame.localDate)}, ${label}, ${Number.isFinite(speedMph) ? windLabel : "wind loading"}`);
    }

    function syncForecastDate(forecastFrame) {
      if (!forecastFrame.localDate) return;
      window.dispatchEvent(new CustomEvent("divepro:selectForecastDate", {
        detail: {
          date: forecastFrame.localDate,
          dayIndex: timelineDates.indexOf(forecastFrame.localDate),
          source: "wind_map_timeline",
        },
      }));
    }

    function keepActiveDayVisible(activeButton) {
      if (!activeButton || !daySelector) return;
      const left = activeButton.offsetLeft;
      const right = left + activeButton.offsetWidth;
      const visibleLeft = daySelector.scrollLeft;
      const visibleRight = visibleLeft + daySelector.clientWidth;
      if (left < visibleLeft) daySelector.scrollTo({ left, behavior: "auto" });
      else if (right > visibleRight) daySelector.scrollTo({ left: right - daySelector.clientWidth, behavior: "auto" });
    }

    function updateDaySelector() {
      if (!daySelector) return;
      const activeDate = activeWindowDate();
      let activeButton = null;
      daySelector.querySelectorAll("button[data-wind-date]").forEach((button) => {
        const isActive = button.dataset.windDate === activeDate;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
        button.tabIndex = isActive ? 0 : -1;
        if (isActive) activeButton = button;
      });
      window.requestAnimationFrame(() => keepActiveDayVisible(activeButton));
    }

    function renderDaySelector() {
      if (!daySelector) return;
      daySelector.innerHTML = timelineDates.map((date) => {
        const parts = timelineDayParts(date);
        return `<button type="button" role="tab" data-wind-date="${date}" aria-label="${timelineDateLabel(date)}" aria-selected="false"><span>${parts.weekday}</span><b>${parts.day}</b></button>`;
      }).join("");

      daySelector.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-wind-date]");
        if (!button) return;
        stopPlayback();
        moveToTimelineDate(button.dataset.windDate, true);
      });
      daySelector.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(daySelector.querySelectorAll("button[data-wind-date]"));
        const current = buttons.indexOf(document.activeElement);
        let next = current;
        if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
        if (event.key === "ArrowRight") next = Math.min(buttons.length - 1, current + 1);
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = buttons.length - 1;
        if (next < 0 || next === current) return;
        event.preventDefault();
        buttons[next].focus();
        stopPlayback();
        moveToTimelineDate(buttons[next].dataset.windDate, true);
      });
    }

    updateSliderBounds();
    updateActiveTime();
    renderTicks();
    renderDaySelector();
    updateDaySelector();

    async function applyFrame(index) {
      activeIndex = Math.max(0, Math.min(frames.length - 1, index));
      if (activeIndex < windowStartIndex || activeIndex > windowEndIndex()) {
        const dateStartIndex = startIndexForDate(frames[activeIndex]?.localDate);
        windowStartIndex = dateStartIndex >= 0 ? dateStartIndex : activeIndex;
      }
      const token = requestToken + 1;
      requestToken = token;
      const forecastFrame = frames[activeIndex];
      updateSliderBounds();
      updateActiveTime();
      syncForecastDate(forecastFrame);
      updateDaySelector();
      renderTicks();
      const frameIsCached = frameCache?.has(forecastFrame.path);
      if (!frameIsCached) {
        if (map) {
          map.__diveProSpotWindGrid = null;
          updateSpotProbe(map);
        }
        layer.setGrid(null);
      }
      try {
        const nextGrid = await fetchWindFrame(forecastFrame, frameCache);
        if (token !== requestToken) return;
        if (map) map.__diveProSpotWindGrid = nextGrid;
        layer.setGrid(nextGrid);
        const timelineWind = windAtLngLat(nextGrid, timelineCoordinates);
        updateActiveTime(timelineWind?.speedMph);
        if (map) updateSpotProbe(map);
      } catch (error) {
        stopPlayback();
      }
    }

    function stopPlayback() {
      window.clearInterval(playTimer);
      playTimer = null;
      playButton.textContent = "▶";
      playButton.setAttribute("aria-label", "Play wind forecast timeline");
    }

    function startPlayback() {
      if (frames.length < 2) return;
      playButton.textContent = "||";
      playButton.setAttribute("aria-label", "Pause wind forecast timeline");
      playTimer = window.setInterval(() => {
        const nextIndex = activeIndex + 1;
        if (nextIndex >= frames.length) {
          stopPlayback();
          return;
        }
        applyFrame(nextIndex);
      }, 1300);
    }

    function moveToTimelineDate(date, preferSunrise = false) {
      const startIndex = startIndexForDate(date);
      if (startIndex < 0) return false;
      windowStartIndex = startIndex;
      const targetIndex = preferSunrise ? sunriseFrameIndex(date) : startIndex;
      applyFrame(targetIndex >= 0 ? targetIndex : startIndex);
      return true;
    }

    slider.addEventListener("input", () => {
      stopPlayback();
      applyFrame(windowStartIndex + Number(slider.value));
    });
    playButton.addEventListener("click", () => {
      if (playTimer) stopPlayback();
      else startPlayback();
    });
    window.addEventListener("divepro:forecastDateSelected", (event) => {
      const date = event.detail?.date;
      if (!date) return;
      stopPlayback();
      moveToTimelineDate(date, true);
    });
    function scheduleResponsiveTimeline() {
      scheduleTickRender();
      window.requestAnimationFrame(() => {
        updateActiveTime(activeWindSpeed);
        updateDaySelector();
      });
    }

    window.addEventListener("resize", scheduleResponsiveTimeline);
    if (typeof ResizeObserver === "function") {
      tickResizeObserver = new ResizeObserver(scheduleResponsiveTimeline);
      tickResizeObserver.observe(ticks);
      if (sliderWrap) tickResizeObserver.observe(sliderWrap);
    }
    applyFrame(activeIndex);
    window.requestAnimationFrame(scheduleResponsiveTimeline);
  }

  function positionSpotProbe(map) {
    const probe = SPOT_PROBES.get(map);
    if (!probe?.element || !probe.lngLat) return;
    const point = map.project([probe.lngLat.lng, probe.lngLat.lat]);
    probe.element.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px) translate(-50%, -100%)`;
  }

  function updateSpotProbe(map) {
    const probe = SPOT_PROBES.get(map);
    const grid = map.__diveProSpotWindGrid;
    if (!probe?.element || !probe.lngLat) return;

    const markerLabel = probe.element.querySelector("span");
    if (!grid) {
      markerLabel.textContent = "Loading";
      probe.element.style.removeProperty("--wind-flow-rotation");
      probe.element.dataset.layer = "wind";
      probe.element.setAttribute("aria-label", "Dropped map pin: wind loading");
      probe.element.title = "Wind forecast loading";
      positionSpotProbe(map);
      return;
    }

    const wind = windAtLngLat(grid, probe.lngLat);
    const visibility = visibilityPotentialAtLngLat(grid, probe.lngLat);
    const windLabel = wind ? `${wind.speedMph.toFixed(1)} mph` : "No wind";
    const visibilityLabelText = visibility
      ? (visibility.calibrated ? visibility.calibratedRange : visibility.label)
      : "No viz";

    markerLabel.textContent = windLabel;
    if (wind?.directionDegrees !== undefined) {
      const flowBearing = (wind.directionDegrees + 180) % 360;
      const cssRotation = (flowBearing + 270) % 360;
      probe.element.style.setProperty("--wind-flow-rotation", `${Math.round(cssRotation)}deg`);
    } else {
      probe.element.style.removeProperty("--wind-flow-rotation");
    }
    probe.element.dataset.layer = "wind";
    probe.element.setAttribute("aria-label", `Dropped map pin: ${windLabel}, visibility ${visibilityLabelText}`);
    probe.element.title = [
      `Wind: ${windLabel}${wind?.direction ? ` ${wind.direction}` : ""}`,
      `Visibility: ${visibilityLabelText}${visibility && !visibility.calibrated ? ` (${Math.round(visibility.index)}/100 relative)` : ""}`,
      `${probe.lngLat.lat.toFixed(3)}, ${probe.lngLat.lng.toFixed(3)}`,
    ].join(" · ");
    positionSpotProbe(map);
  }

  function setSpotProbe(map, lngLat) {
    const normalized = normalizeLngLat(lngLat);
    if (!normalized) return;
    let probe = SPOT_PROBES.get(map);

    if (!probe) {
      const marker = document.createElement("button");
      marker.className = "map-wind-probe-pin";
      marker.type = "button";
      marker.innerHTML = '<span>Wind</span><i class="map-wind-probe-arrow" aria-hidden="true"></i>';
      marker.addEventListener("click", (event) => event.stopPropagation());
      map.getContainer().appendChild(marker);
      probe = { element: marker, lngLat: normalized };
      SPOT_PROBES.set(map, probe);
    }

    probe.lngLat = normalized;
    positionSpotProbe(map);
    updateSpotProbe(map);
  }

  function setupSpotProbe(map) {
    const ignoredClickSelector = ".wind-timeline, .wind-legend, .depth-legend, .map-layer-toggle, .visibility-legend, .maplibregl-ctrl, .map-spot-pin, .map-wind-probe-pin";
    const container = map.getContainer();
    let lastMapLibreProbeAt = 0;

    function shouldIgnoreClick(target) {
      return Boolean(target?.closest?.(ignoredClickSelector));
    }

    function dropProbe(lngLat) {
      if (container.closest(".map-frame")?.classList.contains("is-depth-mode")) return;
      lastMapLibreProbeAt = Date.now();
      setSpotProbe(map, lngLat);
    }

    map.on("click", (event) => {
      const target = event.originalEvent?.target;
      if (shouldIgnoreClick(target)) {
        return;
      }
      dropProbe(event.lngLat);
    });

    container.addEventListener("click", (event) => {
      if (Date.now() - lastMapLibreProbeAt < 80 || shouldIgnoreClick(event.target)) return;
      const rect = container.getBoundingClientRect();
      dropProbe(map.unproject([event.clientX - rect.left, event.clientY - rect.top]));
    });

    map.on("move", () => positionSpotProbe(map));
    map.on("resize", () => positionSpotProbe(map));
  }

  function addDepthLayer(map) {
    if (map.getSource(DEPTH_SOURCE_ID)) return;

    map.addSource(DEPTH_SOURCE_ID, {
      type: "raster",
      tiles: [DEPTH_TILE_URL],
      tileSize: 256,
      attribution: "Esri, GEBCO, NOAA, Garmin, FAO, NPS, NRCAN, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community",
    });
    map.addLayer({
      id: DEPTH_LAYER_ID,
      type: "raster",
      source: DEPTH_SOURCE_ID,
      layout: { visibility: "none" },
      paint: { "raster-opacity": 0.88 },
    });

    map.addSource(DEPTH_REFERENCE_SOURCE_ID, {
      type: "raster",
      tiles: [DEPTH_REFERENCE_TILE_URL],
      tileSize: 256,
    });
    map.addLayer({
      id: DEPTH_REFERENCE_LAYER_ID,
      type: "raster",
      source: DEPTH_REFERENCE_SOURCE_ID,
      layout: { visibility: "none" },
      paint: { "raster-opacity": 0.94 },
    });
  }

  function setupMapLayerToggle(map, frame) {
    if (!frame || frame.__diveProLayerToggleReady) return;
    frame.__diveProLayerToggleReady = true;
    frame.classList.add("is-wind-mode");

    const buttons = Array.from(frame.querySelectorAll("[data-map-layer]"));
    const setLayer = (layer) => {
      const isDepth = layer === "depth";
      frame.classList.toggle("is-depth-mode", isDepth);
      frame.classList.toggle("is-wind-mode", !isDepth);
      if (map.getLayer(DEPTH_LAYER_ID)) {
        map.setLayoutProperty(DEPTH_LAYER_ID, "visibility", isDepth ? "visible" : "none");
      }
      if (map.getLayer(DEPTH_REFERENCE_LAYER_ID)) {
        map.setLayoutProperty(DEPTH_REFERENCE_LAYER_ID, "visibility", isDepth ? "visible" : "none");
      }
      buttons.forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.mapLayer === layer ? "true" : "false");
      });
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => setLayer(button.dataset.mapLayer || "wind"));
    });
    setLayer("wind");
  }

  async function addWindLayer(map, mapEl, config) {
    const frameCache = new Map();
    const [manifest, waterResponse] = await Promise.all([
      loadWindManifest(),
      fetch(WATER_MASK_PATH, { cache: "no-store" }),
    ]);
    if (!waterResponse.ok) throw new Error("Wind water mask unavailable");
    const [grid, waterMask] = await Promise.all([
      fetchWindFrame(manifest.frames[0], frameCache),
      waterResponse.json(),
    ]);
    const frame = mapEl.closest(".spot-map-frame");
    frame?.querySelector(".spot-wind-legend")?.classList.remove("is-hidden");
    map.__diveProSpotWindGrid = grid;
    const layer = createWindCanvasLayer(map, grid, waterMask);
    const timelineCoordinates = config?.pins?.[0]?.lngLat || config?.center || [-117.255, 32.866];
    if (layer && frame) setupSpotWindTimeline(frame, layer, manifest, frameCache, map, timelineCoordinates);
    return layer;
  }

  function insertMapCard(config) {
    const waveCard = document.querySelector(".wave-card");
    const weatherCard = document.querySelector(".weather-card");
    if (!waveCard || !weatherCard || document.getElementById("spotRegionMap")) return null;

    const section = document.createElement("section");
    section.className = "model-card spot-map-card";
    section.innerHTML = `
      <div class="map-header">
        <h2>Region Map</h2>
        <span>${config.region}</span>
      </div>
      <div class="map-frame spot-map-frame">
        <div id="spotRegionMap" class="spot-region-map" role="img" aria-label="Interactive region map for ${config.region}"></div>
        <div class="map-layer-toggle spot-map-layer-toggle" aria-label="Map layer">
          <button type="button" data-map-layer="wind" aria-pressed="true">Wind</button>
          <button type="button" data-map-layer="depth" aria-pressed="false">Depth</button>
        </div>
        <div class="wind-legend spot-wind-legend is-hidden" aria-label="Wind speed legend">
          <span>Wind MPH</span>
          <div class="wind-legend-gradient"></div>
        <div class="wind-legend-labels"><b>0</b><b>5</b><b>10</b><b>20+</b></div>
        </div>
        <div class="depth-legend spot-depth-legend" aria-label="Ocean depth legend">
          <span>Depth</span>
          <div class="depth-legend-gradient"></div>
          <div class="depth-legend-labels"><b>Shallow</b><b>Deep</b></div>
        </div>
      </div>
    `;
    waveCard.after(section);
    return section.querySelector("#spotRegionMap");
  }

  async function initSpotMap() {
    const slug = document.body.dataset.spot || window.location.pathname.split("/").pop().replace(".html", "");
    const config = DETAIL_MAPS[slug] || DETAIL_MAPS["la-jolla"];
    if (!config) return;

    const mapEl = document.getElementById("spotRegionMap") || insertMapCard(config);
    const apiKey = window.MAPTILER_API_KEY;
    const maplibre = window.maplibregl || globalThis.maplibregl;
    if (!mapEl) return;
    if (!apiKey || !maplibre) {
      mapEl.classList.add("is-unavailable");
      mapEl.textContent = "Region map unavailable.";
      return;
    }

    try {
      const map = new maplibre.Map({
        container: mapEl,
        style: await getDiveProMapStyle(apiKey),
        center: config.center,
        zoom: config.zoom,
        attributionControl: false,
        maxBounds: [
          [config.center[0] - 4, config.center[1] - 3],
          [config.center[0] + 4, config.center[1] + 3],
        ],
      });
      map.addControl(new maplibre.AttributionControl({ compact: true }), "top-left");
      map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), "top-right");
      map.on("load", async () => {
        addPins(map, config.pins);
        setupSpotProbe(map);
        addDepthLayer(map);
        setupMapLayerToggle(map, mapEl.closest(".spot-map-frame"));
        try {
          await addWindLayer(map, mapEl, config);
        } catch (error) {
          mapEl.closest(".spot-map-frame")?.querySelector(".spot-wind-legend")?.classList.add("is-hidden");
        }
      });
      window.__diveProSpotRegionMap = map;
    } catch (error) {
      mapEl.classList.add("is-unavailable");
      mapEl.textContent = "Region map unavailable.";
    }
  }

  initSpotMap();
}());
