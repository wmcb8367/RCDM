# RCDM Research

Ongoing quantitative research supporting Race Course Decision Making.

## Active Studies

### Wind Character Study (April 2026)
**Directory:** `wind-character-study/`

Quantitative analysis of wind characteristics across 95 NMEA sessions from 9 international venues, designed to:
1. Identify the best metrics for measuring puffiness, shiftiness, and other wind characteristics
2. Calibrate thresholds against real coaching data
3. Build and validate a "Type of Day" classification engine aligned with the RCDM framework
4. Explore whether data-driven clustering confirms or challenges the Five Types of Day

**Current status:** Initial calibration complete. Engine implemented in the wind analytics platform. See `wind-character-study/docs/` for the thesis and findings.

**Key insight:** The data supports the RCDM two-axis framework (puffiness × shiftiness) but the boundaries between types are gradual, not sharp. Unsupervised clustering (k-means) produced weak separation (silhouette score 0.22 at k=4), confirming that wind conditions exist on a continuous spectrum rather than in discrete buckets.

**Next steps:** See `wind-character-study/docs/ROADMAP.md`

## Research Principles

1. **Sample size matters.** Current studies use 95 sessions — enough for initial calibration, not enough for definitive conclusions. All findings should be treated as working hypotheses.
2. **Framework bias is real.** The current classification engine was designed to map to the RCDM Five Types. A future counter-study should approach the data without this framework to see what emerges purely from the statistics.
3. **Coaching utility > statistical purity.** The goal is actionable intelligence for coaches and sailors, not academic elegance. If a simpler framework helps make better decisions, it wins.
4. **Build over time.** Every new wind log added to the dataset improves the calibration. The LA28 Olympic cycle gives us a multi-year runway to build this out properly.
