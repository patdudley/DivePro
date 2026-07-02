export function gradeFromScore(score) {
  if (score >= 94) return "A+";
  if (score >= 88) return "A";
  if (score >= 75) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function visibilityRangeFromScore(score) {
  if (score >= 94) return [35, 40];
  if (score >= 88) return [25, 35];
  if (score >= 75) return [15, 24];
  if (score >= 55) return [10, 14];
  if (score >= 40) return [5, 9];
  return [0, 4];
}

function value(features, key, fallback) {
  const raw = features?.[key];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function scoreVisibility(features = {}) {
  const totalSwell = value(features, "total_swell_height_mean_ft", 3);
  const surfMax = value(features, "surf_height_max_ft", 3);
  const shortEnergy = value(features, "short_period_swell_energy", 15);
  const windMax = value(features, "wind_speed_max_mph", 8);
  const mixed = value(features, "mixed_swell_score", 2);
  const energy = value(features, "wave_energy_mean_kj", 70);

  let score = 70;
  score -= Math.max(0, totalSwell - 3) * 6;
  score -= Math.max(0, surfMax - 2.5) * 6;
  score -= Math.max(0, shortEnergy - 24) * 0.1;
  score -= Math.max(0, windMax - 8) * 1.6;
  score -= Math.max(0, mixed - 2) * 3;
  score -= Math.max(0, energy - 90) * 0.06;
  score += Math.max(0, 3 - totalSwell) * 8;
  score += Math.max(0, 7 - windMax) * 1;
  score += Math.max(0, 70 - energy) * 0.08;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function forecastFromFeatures(features = {}) {
  const score = scoreVisibility(features);
  const [min, max] = visibilityRangeFromScore(score);
  const riskFactors = [];
  const positiveFactors = [];

  if (value(features, "surf_height_max_ft", 0) >= 3) riskFactors.push("Elevated surf can stir up shallow entries.");
  if (value(features, "short_period_swell_energy", 0) >= 18) riskFactors.push("Short-period swell adds churn near the bottom.");
  if (value(features, "wind_speed_max_mph", 0) >= 9) riskFactors.push("Wind may texture the surface later in the day.");
  if (value(features, "total_swell_height_mean_ft", 9) <= 3) positiveFactors.push("Overall swell load is modest.");
  if (value(features, "wind_speed_max_mph", 99) <= 8) positiveFactors.push("Morning wind looks manageable.");
  if (value(features, "wave_energy_mean_kj", 999) <= 70) positiveFactors.push("Wave energy is on the lower side.");

  return {
    score,
    grade: gradeFromScore(score),
    visibilityRange: [min, max],
    visibilityMid: (min + max) / 2,
    confidence: features.date ? "medium" : "low",
    bestWindow: "Early morning to late morning",
    riskFactors: riskFactors.length ? riskFactors : ["No major model risk factors in the parsed feature set."],
    positiveFactors: positiveFactors.length ? positiveFactors : ["Parsed live features are limited."],
  };
}
