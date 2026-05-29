# DiveProSD Analytics + SEO

## Analytics

DiveProSD is wired for Google Analytics 4, but tracking stays off until a real Measurement ID is added.

1. Go to Google Analytics and create a GA4 property for `diveprosd.com`.
2. Create a Web data stream for `https://diveprosd.com`.
3. Copy the Measurement ID. It starts with `G-`.
4. Paste it into `analytics-config.js`:

```js
window.DIVEPRO_ANALYTICS = {
  ga4MeasurementId: "G-XXXXXXXXXX",
};
```

5. Commit and push the change to GitHub Pages.

Once configured, GA4 will show users, new users, returning users, traffic sources, engagement, and page views. DiveProSD also sends a few useful custom events:

- `forecast_loaded`: forecast date, grade, visibility range, and surf range.
- `forecast_day_select`: selected forecast date and grade.
- `fish_detail_open`: species name, prize score, and abundance score.
- `outbound_link_click`: destination URL for external links.

## SEO

Current SEO setup:

- Search-focused page title and meta description.
- Canonical URL: `https://diveprosd.com/`.
- Open Graph and Twitter preview tags.
- `WebSite` JSON-LD structured data.
- `robots.txt` allowing crawlers.
- `sitemap.xml` pointing at the live homepage.

Next manual step: add `diveprosd.com` to Google Search Console and submit:

```text
https://diveprosd.com/sitemap.xml
```

For now, the best SEO lever is keeping the homepage useful and fresh: current La Jolla visibility, waves, wind, tides, weather, and shore-dive context in plain language.
