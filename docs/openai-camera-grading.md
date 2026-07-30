# Hourly Scripps Camera Grading

The hourly daylight camera workflow grades every successfully validated frame
with the OpenAI API. It compares the frame to
`camera-reference/scripps-piling-distance-reference.png` and records the
visibility of the 4, 11, 14, and 30 ft pylons.

The grade is a Scripps Pier point observation only. It does not change the
forecast model, published forecast grade, camera coupling, or `camera-config`
mode. Screenshot publication continues when grading is unavailable.

## Required secret

Create an OpenAI API key in a dedicated API project, set a small monthly project
budget, then add it to this repository without pasting it into source or chat:

```bash
gh secret set OPENAI_API_KEY --repo patdudley/DivePro
```

The command prompts for the value securely. The hourly workflow reports
`grading_skipped_missing_key` until this secret exists.

## Stored result

Every successful capture creates:

- An immutable JPEG under
  `camera-snapshot-history/scripps-pier/YYYY-MM-DD/`.
- An adjacent immutable JSON file containing its image hash, pylon evidence,
  grade, confidence, model version, prompt version, and visual justification.
- The normal latest-attempt and last-valid status pointers used by the site.

The API receives only the annotated reference and current camera image. It does
not receive weather, tide, swell, forecast, filename, or prior-grade data.
