# Scripps camera grading

## Runtime contract

`.github/workflows/scripps-camera-grade.yml` evaluates candidate UTC schedules
against `America/Los_Angeles` and runs at the 08:00, 12:00, and 16:00 local
slots. The capture opens `https://coollab.ucsd.edu/pierviz/`, enters the camera
frame embedded by that UCSD page, verifies that playback advances, and saves
only the 16:9 video pixels. It does not navigate directly to a vendor stream or
screenshot the UCSD page header and player controls.

Rollout is controlled by `camera-config.json`. Screenshot publishing and grade
coupling are deliberately independent switches:

- `publish_screenshots` (boolean): when true, every validated capture replaces
  the public Release asset and commits the small status document. This depends
  only on capture success plus local image validation (dimensions, playback
  advancement, blank-frame checks) — never on grading results, grading mode, or
  grading secrets. The grader can veto only a frame it judges `unusable`.
- `mode` (grading rollout, fails closed):
  - `off`: no grading or private evaluation records run.
  - `shadow`: captures are graded and private evaluation records are written,
    but grades never influence the public forecast card.
  - `live`: camera grades may couple into today's displayed forecast, gated by
    the shadow review threshold below.

The committed default is `publish_screenshots: true` with `mode: off`:
the site shows the latest scheduled photo while automated grading is disabled.
Moving `mode` to `shadow` begins private evaluation only; moving it to `live`
is a separate reviewed configuration change after real grader results pass the
validation gate below.

The public site retains only:

- a single replace-in-place GitHub Release asset at the URL in
  `camera-config.json`; old frames are not committed to public Git history;
- `camera-snapshots/scripps-pier-latest.json`, a small latest-status document
  committed whenever screenshot publishing is enabled.

Failed or invalid captures do not replace the release asset. Their status
document still publishes so the UI can fall back to the algorithm reference
image (a prior-day frame is never shown; the front end requires a same-local-day
`capture_ok` status). `.gitignore` blocks accidental commits of all
`camera-snapshots/scripps-pier*` image files.

A reviewed `manual_observation` can temporarily replace today's displayed
grade and range. The next successful automated capture replaces the latest
status with `grading_skipped`, refreshes the photo, and returns the grade and
report to the algorithm. Manual grades are intentionally not sticky.

With `mode: off`, capture and publishing run without grading secrets and the
workflow finishes successfully with status `grading_skipped`. If grading is
later enabled without `ANTHROPIC_API_KEY`, the image still publishes before the
workflow fails loudly so the missing secret is visible.

The private `patdudley/DivePro-evaluation-data` repository stores timestamped
images, structured camera grades, and reconstructable display-coupling audits.
Its monthly workflow includes those paths in the encrypted append-only backup
copied to Jackson's VM.

Public-repository secrets (required for shadow grading, not for screenshot
publishing):

- `ANTHROPIC_API_KEY`
- `EVAL_REPO_TOKEN`: a fine-grained token restricted to
  `patdudley/DivePro-evaluation-data` with Contents read/write only.

Optional repository variable:

- `SCRIPPS_GRADER_MODEL` (defaults to `claude-sonnet-4-20250514`)

## Grader compatibility

The current prompt is versioned as `scripps-piling-rubric-v1-reconstructed`.
It implements the archived piling-distance rubric but is not represented as a
byte-for-byte copy of Jackson's private prompt because that repository was not
accessible during the port. When Jackson supplies the original, compare both
graders on the same historical feed-only images before changing the version.
The capture/status/private-record contracts do not need to change.

The grader receives image pixels and grader configuration only. It receives no
weather, swell, season, forecast, or model output.

## Shadow validation gate

Shadow mode means the complete scheduled capture/grading/private-archive path
runs while `app.js` deliberately never couples grades into the forecast card.
The public card may still display the latest photo (screenshot publishing is a
separate switch), but no camera grade can change any public grade or forecast.

Before changing `camera-config.json` from `shadow` to `live`:

1. Configure both required secrets and manually dispatch all three slots.
2. Collect at least nine real captures spanning at least three local dates.
3. Review every capture with the private human-review tool and the same piling
   rubric. Black, frozen, loading, obscured, or player-chrome frames must be
   marked unusable.
4. Require zero false-valid unusable frames and at least 80% of valid automated
   grades within one grade step of the human review.
5. Confirm each status points to the expected image SHA-256 and that the private
   append-only record was written.
6. On the reviewed live-mode branch, run
   `python scripts/camera_production_preflight.py --require-live --require-secrets --eval-data-dir ../DivePro-evaluation-data`;
   it must prove the private review threshold before grade coupling can go
   live. The actual secret values are never printed.

Human reviews are stored only in the private evaluation repository. They are a
launch check and future evaluation label, never an input to the current grader
or forecast model.

## Display coupling

`camera-coupling-v1` is a display transform, not a forecast feature. The raw
algorithm forecast and `forecast_log.csv` stay unchanged.

- minimum confidence: `0.65`
- maximum normal pull: `5.0 ft`
- maximum grade slew: `2` grade steps per day
- day +1 weight: `0.35`
- day +2 weight: `0.15`
- day +3 weight: `0.05`
- day +4 onward: `0.00`

Effective weight is lead weight times camera confidence. The continuous score
is blended and pull-capped before bucketing. The sequential two-grade slew rail
is then applied. The slew rail is the explicit safety backstop and may exceed
the normal pull cap; such cases are logged with `slew_override=true` and
`slew_exceeded_pull_cap=true`.

Camera coupling is disabled when the current local-date capture is missing,
unusable, failed, or below the minimum confidence. Before 08:00 the UI states
that it is awaiting the camera; afterward it states that the camera is
unavailable. A prior-day image is never used.
