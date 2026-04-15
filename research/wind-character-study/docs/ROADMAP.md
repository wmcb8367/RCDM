# Wind Character Study — Research Roadmap

## Current State (April 2026)
- **Dataset:** 95 NMEA sessions across 9 venues (Avon, Cagliari, Gdynia, Gorge, Greece, Hyeres, Long Beach, Palma)
- **Metrics calibrated:** IQR Ratio (puffiness), Detrended Circular StdDev (shiftiness), Phase Persistence, Wind/Direction Trends
- **Classification engine:** Implemented in wind analytics platform, quartile-based thresholds
- **Clustering validation:** k-means silhouette of 0.22 at k=4 — weak natural clustering

## Short-term (2026)

### Expand the dataset
- [ ] Target: 200+ sessions across 15+ venues
- [ ] Priority venues: Long Beach (LA28), Marseille (post-Paris), Cascais, Kiel
- [ ] Include sessions with known Type of Day labels from coaching notes (ground truth)
- [ ] Systematically collect thermal vs gradient samples to build a better thermal detection model

### Counter-thesis: Purely statistical classification
- [ ] Run unsupervised analysis WITHOUT the RCDM framework as a prior
- [ ] Use spectral clustering, DBSCAN, or Gaussian mixture models as alternatives to k-means
- [ ] Determine if the data naturally suggests 3, 4, 5, or some other number of types
- [ ] Compare data-driven types against RCDM types — where do they agree, where do they diverge?
- [ ] Requires 200+ sessions minimum for meaningful results

### Improve the classification engine
- [ ] Add thermal vs gradient detection based on wind fill pattern (onshore→offshore vs offshore→onshore)
- [ ] Incorporate time-of-day effects (morning gradient → afternoon thermal transition)
- [ ] Build confidence intervals, not just point estimates
- [ ] Add "transition detection" — identify when a session shifts from one type to another mid-day

## Medium-term (2026–2027)

### LA28 Long Beach Playbook
- [ ] Collect 50+ Long Beach sessions across different seasons and conditions
- [ ] Build Long Beach-specific thresholds and type distributions
- [ ] Map wind types to geographic features (Catalina shadow, harbor effects, thermal fill direction)
- [ ] Create a Long Beach callbook with type-of-day probability by month, wind direction, and forecast setup
- [ ] Integrate with PredictWind and Windy forecasts for pre-race type prediction

### Real-time classification
- [ ] iOS wind app integration — live Type of Day classification on the water
- [ ] Rolling window analysis: classify the last 30 minutes, detect transitions
- [ ] Push notifications when conditions change type (e.g., "Thermal filling in — switching from Edge Out to Inside Track")
- [ ] Coach-to-sailor communication: share the classification and strategy recommendation

### Cross-venue transfer learning
- [ ] Test whether thresholds calibrated at one venue generalize to others
- [ ] Identify venue-specific adjustments needed (e.g., Gorge channeling effects)
- [ ] Build venue profiles that modify classification confidence

## Long-term (2027–2028)

### Ground truth validation
- [ ] Partner with coached teams to label sessions with actual Type of Day used in racing
- [ ] Compare classification accuracy against expert labels
- [ ] Measure whether using the engine improves race outcomes vs intuition alone

### Publication
- [ ] Write a formal paper combining the quantitative framework with RCDM coaching methodology
- [ ] Target World Sailing or coaching education audiences
- [ ] Consider a RCDM v3 edition incorporating the quantitative framework

## Key Questions to Answer

1. **Is 4 the right number?** The RCDM framework has 5 types (4 + Uncertain). The data may suggest 3 is sufficient or 6 is better. Only larger sample sizes will tell.

2. **Does the thermal/gradient distinction map to different classification thresholds?** Thermal days may have systematically different IQR ratios and shift patterns than gradient days, even within the same "type."

3. **How does the classification perform in real-time vs post-session?** The current engine analyzes a full session. On the water, you have 30 minutes of data. How stable is the classification at different time horizons?

4. **Can we predict Type of Day from forecasts alone?** If we can correlate forecast features (temperature differential, gradient at 100m/300m, cloud cover) with observed Type of Day, we could classify before arriving at the venue.

5. **What is the actual competitive value?** If a team uses this system, how many points do they gain over a regatta compared to intuition-based classification?
