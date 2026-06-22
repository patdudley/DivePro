(function () {
  const WIND_MANIFEST_PATH = "data/wind-cropped/wind-san-diego-manifest.json?v=socal-crop-final";
  const WATER_MASK_PATH = "data/water-mask-san-diego.geojson?v=spot-wind-1";
  const WIND_PARTICLE_COUNT = 360;
  const WIND_COAST_FEATHER_PX = 52;
  const WIND_PARTICLE_SPEED = 0.000072;
  const MAPTILER_WATER_LAYER_ID = "Water";
  const MPS_TO_MPH = 2.23694;

  const DETAIL_MAPS = {
    "la-jolla": {
      region: "La Jolla, San Diego",
      center: [-117.255, 32.866],
      zoom: 12.25,
      pins: [
        { label: "Scripps Beach", detail: "San Diego", lngLat: [-117.255, 32.866], href: "la-jolla.html" },
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
      if (mapIsInteracting) {
        ctx.clearRect(0, 0, rect.width, rect.height);
        animationId = requestAnimationFrame(draw);
        return;
      }
      if (needsGradientDraw) drawGradient();
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.lineWidth = 1.15;
      ctx.lineCap = "round";
      particles.forEach((particle) => {
        const lngLat = map.unproject([particle.x, particle.y]);
        particle.lon = lngLat.lng;
        particle.lat = lngLat.lat;
        const wind = interpolateWindAtLonLat(grid, particle.lon, particle.lat);
        if (!wind || !isScreenPointOnWater(particle.x, particle.y) || particle.x < -40 || particle.x > rect.width + 40 || particle.y < -40 || particle.y > rect.height + 40 || particle.age > 150) {
          resetParticle(particle);
          return;
        }
        const end = map.project([particle.lon + wind.u * WIND_PARTICLE_SPEED, particle.lat + wind.v * WIND_PARTICLE_SPEED]);
        if (!isScreenPointOnWater(end.x, end.y)) {
          resetParticle(particle);
          return;
        }
        const alpha = Math.max(0.28, Math.min(0.7, wind.speedMph / 16));
        ctx.strokeStyle = `rgba(226, 242, 255, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(end.x, end.y);
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

  function setupSpotWindTimeline(frame, layer, manifest, frameCache) {
    const frames = manifest.frames || [];
    const timeline = frame.querySelector(".spot-wind-timeline");
    const playButton = frame.querySelector(".spot-wind-play");
    const nextDayButton = frame.querySelector(".spot-wind-next-day");
    const slider = frame.querySelector(".spot-wind-slider");
    const ticks = frame.querySelector(".spot-wind-ticks");
    if (!timeline || !playButton || !slider || !ticks || !frames.length) {
      timeline?.classList.add("is-hidden");
      return;
    }

    let activeIndex = 0;
    let playTimer;
    let requestToken = 0;
    timeline.classList.toggle("is-hidden", frames.length < 2);
    slider.min = "0";
    slider.max = String(Math.max(0, frames.length - 1));
    slider.value = "0";

    frames.forEach((forecastFrame) => {
      forecastFrame.localDate = frameDate(forecastFrame);
    });

    function visibleTickIndexes() {
      if (frames.length <= 1) return [0];
      const indexes = new Set([0, frames.length - 1]);
      const divisions = frames.length >= 20 ? 4 : 3;
      for (let step = 1; step < divisions; step += 1) {
        indexes.add(Math.round((frames.length - 1) * (step / divisions)));
      }
      frames.forEach((forecastFrame, index) => {
        if (index > 0 && forecastFrame.localDate !== frames[index - 1].localDate) indexes.add(index);
      });
      return [...indexes].sort((a, b) => a - b);
    }

    function renderTicks() {
      const visible = new Set(visibleTickIndexes());
      ticks.innerHTML = frames.map((forecastFrame, index) => {
        const left = frames.length <= 1 ? 0 : (index / (frames.length - 1)) * 100;
        const label = index === 0 ? "Now" : (forecastFrame.tickLabel || forecastFrame.label);
        return `<span class="${visible.has(index) ? "is-visible" : ""}" style="left:${left}%">${label}</span>`;
      }).join("");
    }

    function syncForecastDate(forecastFrame) {
      if (!forecastFrame.localDate) return;
      window.dispatchEvent(new CustomEvent("divepro:selectForecastDate", {
        detail: { date: forecastFrame.localDate, source: "wind_map_timeline" },
      }));
    }

    function updateNextDayButton() {
      if (!nextDayButton) return;
      const activeDate = frames[activeIndex]?.localDate;
      const hasNextDate = frames.some((forecastFrame) => forecastFrame.localDate && forecastFrame.localDate > activeDate);
      nextDayButton.hidden = !hasNextDate;
    }

    renderTicks();
    updateNextDayButton();

    async function applyFrame(index) {
      activeIndex = Math.max(0, Math.min(frames.length - 1, index));
      const token = requestToken + 1;
      requestToken = token;
      const forecastFrame = frames[activeIndex];
      slider.value = String(activeIndex);
      syncForecastDate(forecastFrame);
      updateNextDayButton();
      try {
        const nextGrid = await fetchWindFrame(forecastFrame, frameCache);
        if (token !== requestToken) return;
        layer.setGrid(nextGrid);
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
        applyFrame((activeIndex + 1) % frames.length);
      }, 1300);
    }

    slider.addEventListener("input", () => {
      stopPlayback();
      applyFrame(Number(slider.value));
    });
    playButton.addEventListener("click", () => {
      if (playTimer) stopPlayback();
      else startPlayback();
    });

    nextDayButton?.addEventListener("click", () => {
      stopPlayback();
      const activeDate = frames[activeIndex]?.localDate;
      const nextIndex = frames.findIndex((forecastFrame) => forecastFrame.localDate && forecastFrame.localDate > activeDate);
      if (nextIndex >= 0) applyFrame(nextIndex);
    });
  }

  async function addWindLayer(map, mapEl) {
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
    const layer = createWindCanvasLayer(map, grid, waterMask);
    if (layer && frame) setupSpotWindTimeline(frame, layer, manifest, frameCache);
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
        <div class="wind-legend spot-wind-legend is-hidden" aria-label="Wind speed legend">
          <span>Wind MPH</span>
          <div class="wind-legend-gradient"></div>
          <div class="wind-legend-labels"><b>0</b><b>5</b><b>10</b><b>20+</b></div>
        </div>
        <div class="wind-timeline spot-wind-timeline is-hidden" aria-label="Wind forecast timeline">
          <button class="spot-wind-play" type="button" aria-label="Play wind forecast timeline">▶</button>
          <input class="spot-wind-slider" type="range" min="0" max="0" value="0" aria-label="Wind forecast hour">
          <div class="wind-time-ticks spot-wind-ticks"></div>
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
        maxBounds: [
          [config.center[0] - 4, config.center[1] - 3],
          [config.center[0] + 4, config.center[1] + 3],
        ],
      });
      map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), "top-right");
      map.on("load", async () => {
        addPins(map, config.pins);
        try {
          await addWindLayer(map, mapEl);
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
