// ABOUTME: Client-side MapTiler config for the wind region map.
// ABOUTME: The key below is public by design (it ships to the browser) and is
// ABOUTME: only safe because it is domain-restricted to diveprosd.com in MapTiler.
//
// SECURITY CAVEAT — this key is intentionally committed and publicly visible.
// A MapTiler map key cannot be hidden from the browser, so its protection comes
// entirely from the dashboard restriction, NOT from secrecy:
//   1. In the MapTiler dashboard, restrict this key's Allowed Origins to
//      https://diveprosd.com/* (and any preview domains you use).
//   2. Rotate the key if it was ever used before being restricted, then revoke
//      the old one.
// With the origin restriction in place, a scraped key will not work on any other
// site. If the key is missing or rejected, spot-map.js degrades to
// "Region map unavailable" rather than erroring.
window.MAPTILER_API_KEY = "QiiaiIZNzRpo51mrKitf";
