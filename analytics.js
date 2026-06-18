(function () {
  const config = window.DIVEPRO_ANALYTICS || {};
  const measurementId = String(config.ga4MeasurementId || "").trim();
  const isConfigured = /^G-[A-Z0-9]+$/i.test(measurementId);

  window.diveproTrack = function (eventName, params) {
    if (!isConfigured || typeof window.gtag !== "function") return;
    window.gtag("event", eventName, params || {});
  };

  if (!isConfigured) {
    window.DIVEPRO_ANALYTICS_STATUS = "not_configured";
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    send_page_view: true,
    page_path: window.location.pathname,
    page_location: `${window.location.origin}${window.location.pathname}`,
  });
  window.DIVEPRO_ANALYTICS_STATUS = "configured";

  const scrollDepths = [25, 50, 75];
  const firedScrollDepths = new Set();
  let ticking = false;
  const trackScrollDepth = () => {
    ticking = false;
    const scrollable = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    const viewportBottom = window.scrollY + window.innerHeight;
    const scrolled = scrollable > 0 ? (viewportBottom / scrollable) * 100 : 0;
    scrollDepths.forEach((percent) => {
      if (scrolled >= percent && !firedScrollDepths.has(percent)) {
        firedScrollDepths.add(percent);
        window.diveproTrack("scroll_depth", {
          percent,
          page_path: window.location.pathname,
        });
      }
    });
  };
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(trackScrollDepth);
  }, { passive: true });
  window.addEventListener("load", trackScrollDepth);

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) {
      window.diveproTrack("outbound_link_click", {
        link_url: url.href,
        link_text: link.textContent.trim().slice(0, 80),
      });
    }
  });
}());
