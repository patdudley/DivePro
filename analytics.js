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
  });
  window.DIVEPRO_ANALYTICS_STATUS = "configured";

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
