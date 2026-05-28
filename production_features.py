#!/usr/bin/env python3
"""
production_features.py  —  DivePro SD1
========================================
Shared production feature computations.

Used by ALL three paths that touch energy/swell-count features:
  - train_model.py       engineer_features()
  - train_soft_model.py  (via train_model.py import)
  - evaluate_forward.py  (via train_model.py import)
  - build_location_forecasts.py  _build_lajolla_feat_map()

Having one shared implementation guarantees that training and runtime
compute identical feature values for the same inputs.  Any change to
energy/n_swells formulas MUST be made here and nowhere else.

Phase 3 contract (exact_served_contract_audit_v3.py):
  p1_energy_raw = swell_energy(p1_h, p1_per)
  p2_energy_raw = swell_energy(p2_h, p2_per)
  ww_energy_raw = swell_energy(ww_h, ww_per)
  total_energy  = p1_energy_raw + p2_energy_raw + ww_energy_raw
  n_swells      = int(p1_h > 0.3) + int(p2_h > 0.3) + int(ww_h > 0.5)
"""


def swell_energy(h_ft, per_s):
    """
    Approximate wave energy proxy (kJ-equivalent).

    Formula: h^2 * max(per, 1.0) * 0.72

    This matches the energy scalar used by build_location_forecasts.py:
        energy = wave_ft * wave_ft * max(1, swell_period) * 0.72

    Arguments:
        h_ft    swell height in feet  (None treated as 0)
        per_s   swell period in seconds  (None or 0 treated as 1 for non-zero h)

    Returns float >= 0.
    """
    h = float(h_ft or 0.0)
    p = max(float(per_s or 0.0), 1.0)
    return h * h * p * 0.72


def swell_energy_vec(h_array, per_array):
    """
    Vectorized swell energy proxy for numpy/pandas use in engineer_features().

    Computes h^2 * max(per, 1.0) * 0.72 element-wise.

    Arguments:
        h_array   numpy array of swell heights in feet
        per_array numpy array of swell periods in seconds

    Returns numpy array of floats >= 0.
    Requires numpy to be imported by caller.
    """
    import numpy as _np
    h = _np.asarray(h_array, dtype=float)
    p = _np.maximum(_np.asarray(per_array, dtype=float), 1.0)
    return h * h * p * 0.72


def production_feat_bundle(p1_h, p1_per, p2_h, p2_per, ww_h, ww_per):
    """
    Compute the three derived features that MUST be identical at
    training time and runtime.

    Arguments:
        p1_h    primary swell height (ft)
        p1_per  primary swell period (s)
        p2_h    secondary swell height (ft)
        p2_per  secondary swell period (s)
        ww_h    wind wave height (ft)
        ww_per  wind wave period (s)

    Returns dict with keys:
        p1_energy_raw   float — primary swell energy proxy
        total_energy    float — sum of all three component energies
        n_swells        int   — count of active swell components (0–3, clipped to 4)
    """
    p1_h = float(p1_h or 0.0)
    p2_h = float(p2_h or 0.0)
    ww_h = float(ww_h or 0.0)

    p1_e = swell_energy(p1_h, p1_per)
    p2_e = swell_energy(p2_h, p2_per)
    ww_e = swell_energy(ww_h, ww_per)

    n_sw = int(p1_h > 0.3) + int(p2_h > 0.3) + int(ww_h > 0.5)

    return {
        "p1_energy_raw": p1_e,
        "total_energy":  p1_e + p2_e + ww_e,
        "n_swells":      min(4, n_sw),
    }
