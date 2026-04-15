# Quantifying Wind Character for Race Course Decision Making

## A Data-Driven Framework for Classifying Sailing Conditions

### Introduction

Every sailing coach knows the feeling: you arrive at the venue, look at the water, and within minutes you're making a judgment call about what kind of day it will be. Is it a "play the shifts" day? A "chase the puffs" day? Or one of those maddening days where both pressure and shift matter and the fleet splits with boats coming from everywhere?

In *Race Course Decision Making*, five "Types of Day" provide a framework for this decision — each with a distinct strategy, mindset, and spirit animal. But until now, the classification has been intuitive: coaches pattern-match based on experience and visual observation. 

This study asks: **can we measure the character of the wind precisely enough to classify conditions automatically, and in doing so, provide coaches and sailors with quantitative insights that sharpen their decision-making?**

Using 95 NMEA wind log sessions spanning 9 international venues — from the thermal sea breezes of Long Beach to the gradient-driven chaos of Gdynia — we calibrated a set of wind metrics against real coaching data and built a classification engine that maps directly to the RCDM framework.

### The Two Axes That Define a Day

The RCDM framework is built on a fundamental insight: the character of a racing day is defined by the interaction of two independent variables:

1. **Pressure variability** — how much the wind speed fluctuates between puffs and lulls
2. **Shift variability** — how much the wind direction oscillates

These two axes create a 2×2 grid that maps cleanly to four of the five RCDM types:

| | Low Shiftiness | High Shiftiness |
|---|---|---|
| **Low Puffiness** | Inside Track 🦉 | Outside Track 🐟 |
| **High Puffiness** | Connect the Dots 🐿️ | Edge Out 🐺 |

The fifth type — Uncertain (Crocodile 🐊) — represents conditions near the boundaries where classification confidence is low.

### Choosing the Right Metrics

Not all statistical measures of variability are equally useful for coaching. Our calibration study tested 12 candidate metrics across 5 data-trimming strategies on the full 95-session dataset. The key findings:

**For Puffiness: IQR Ratio wins.**

The Interquartile Range Ratio — (75th percentile wind speed − 25th percentile) ÷ median — outperformed the traditional Coefficient of Variation (standard deviation / mean) for three reasons:

1. **Robustness to outliers.** A single 25-knot gust in a 10-knot day inflates the CV dramatically. The IQR ratio ignores the top and bottom 25%, focusing on the "working range" of the breeze.

2. **Intuitive interpretation.** An IQR ratio of 0.60 means the middle half of puffs and lulls span 60% of the median wind speed. A sailor can feel that directly.

3. **Better venue discrimination.** Across our dataset, the IQR ratio correctly ordered venues by known puffiness characteristics: Long Beach (0.51, steady thermal) < Gorge (0.56, channeled) < Cagliari (0.59, Mediterranean gradient) < Gdynia (0.65, Baltic gradient).

**For Shiftiness: Detrended Circular Standard Deviation wins.**

Raw circular standard deviation conflates two different phenomena: persistent trends (a steady veer from 200° to 240° over three hours) and true oscillation (the wind bouncing back and forth around a mean). Coaches need to distinguish between these — a persistent trend is an Outside Track day, while pure oscillation is an Inside Track day.

By removing the linear direction trend before computing circular standard deviation, we isolate the oscillation component. This "detrended" metric correctly separates:

- **Long Beach thermal** (low detrended CSD — steady oscillation within a narrow band)
- **Gdynia gradient** (high detrended CSD — chaotic direction changes with no clear pattern)

**For Harbor Filtering: Wind-Gating wins.**

Many sessions include transit data from the harbor to the race area and back. This artificially inflates variability metrics. Wind-gating (excluding points where wind < 3 knots) preserved 89% of data while reducing harbor contamination more effectively than percentage-based trimming.

### Calibrated Thresholds

Using the quartile distribution across all 93 valid sessions:

**Puffiness (IQR Ratio):**
- Steady: < 0.565 (bottom quartile — think Long Beach thermal)
- Moderate: 0.565–0.612
- Puffy: 0.612–0.663
- Very Puffy: > 0.663 (top quartile — think Gdynia NE'ly)

**Shiftiness (Detrended Circular StdDev):**
- Locked In: < 50.5° (bottom quartile — stable oscillation)
- Moderate: 50.5°–69.4°
- Shifty: 69.4°–96.3°
- Very Shifty: > 96.3° (top quartile — chaotic direction)

### The Classification in Practice

Applied to our 95 sessions, the distribution is:

- **Edge Out (Wolf):** 29% — the most common type, consistent with RCDM's observation that gradient conditions dominate most venues
- **Inside Track (Owl):** 27% — stable thermal days
- **Connect the Dots (Meerkat):** 23% — pressure-dominant, often lighter air
- **Outside Track (Salmon):** 22% — direction-dominant, often featuring persistent geographic effects

This closely matches the coaching intuition in RCDM: Edge Out is described as "the most common type" and "the most misunderstood strategy."

### Venue Signatures

Each venue has a characteristic wind personality that emerges from the data:

**Long Beach** — The poster child for thermal sailing. Low IQR ratio (0.51), low shift frequency. The afternoon westerly fills predictably, oscillates within a narrow band, and rewards compass-driven Inside Track sailing. Phase persistence is long — shifts hold for minutes, not seconds.

**Gorge** — Channeled wind with low shiftiness but moderate puffiness. The geographic constraints of the Columbia River Gorge lock the direction while creating distinct pressure bands. All 7 sessions classified as Inside Track, which makes sense — the wind is steady in direction but the pressure differences create an element of tactical play.

**Palma** — A versatile venue. All 8 sessions fell in the Inside Track category in our dataset, reflecting the Mediterranean thermal pattern, but coaches know that Palma can produce every type of day depending on the synoptic setup.

**Gdynia** — The wild card. High shiftiness, high puffiness, with half the sessions in Connect the Dots territory and the other half in Edge Out. The Baltic gradient delivers chaotic conditions that demand alert, reactive sailing.

**Cagliari** — Split between Inside Track and Edge Out, reflecting the dual nature of Sardinian conditions: sometimes the Mistral delivers stable gradient racing, other times the local effects create a more complex picture.

### The Metrics That Matter for Coaches

From the full analysis, three metrics provide the most coaching value:

1. **Puffiness (IQR Ratio)** — Answers: "How much do I gain or lose by being in a puff vs. a lull?" When puffiness is high, pressure-based decision-making (chasing puffs, connecting dots) becomes important. When low, the emphasis shifts to shift management.

2. **Shiftiness (Detrended Circular StdDev)** — Answers: "How unpredictable are the direction changes?" When high, fleet management and positioning become critical (Edge Out or Outside Track). When low, compass work and timing become the edge (Inside Track).

3. **Phase Persistence** — Answers: "How long does a shift hold before reversing?" This metric bridges the gap between puffiness and shiftiness. Short persistence (< 2 min) with moderate shiftiness suggests quick oscillations — tack frequently. Long persistence (> 3.5 min) suggests the wind is trending — commit and ride the shift.

Two trend metrics provide context:

4. **Wind Trend** — Is the breeze building or fading? A building breeze may signal a shift from one type of day to another — critical for mid-day strategic adjustments.

5. **Direction Trend** — Is the wind veering or backing overall? Persistent trends suggest geographic or synoptic influence that may favor one side of the course.

### Why This Matters

The RCDM framework has always been about giving sailors a systematic way to approach the inherently uncertain environment of a race course. The contribution of this quantitative analysis is threefold:

**1. Objectivity.** Instead of "I think it's puffy and shifty today," a coach can say "IQR ratio is 0.68 with detrended CSD of 85° — this is a clear Edge Out day. Get to the edge of your group."

**2. Real-time adaptation.** As the wind changes during a session, the metrics update. A day that starts as Inside Track may transition to Edge Out as the gradient fills in. The quantitative framework catches this transition before intuition does.

**3. Venue preparation.** Before arriving at a venue, a team can analyze historical wind data to understand the typical distribution of day types. If Gdynia is 50% Edge Out and 50% Connect the Dots, the team arrives prepared for both.

### Conclusion

Wind has character. Every experienced sailor knows this — the way a thermal fills smoothly from the shore, the way a gradient punches down in random puffs, the way a dying breeze becomes progressively more shifty. What this study demonstrates is that these characteristics are measurable, classifiable, and — most importantly — actionable.

The five spirit animals of RCDM are not just metaphors. They represent real, distinct patterns in the data. When you feel the Owl's precision in a thermal oscillation, or the Wolf's aggression on a puffy, shifty gradient day, you are responding to quantifiable differences in the wind's character.

Now we can measure it. And what you can measure, you can master.

---

*Calibrated against 95 NMEA sessions across Avon, Cagliari, Gdynia, Gorge, Greece, Hyeres, Long Beach, and Palma. Analysis by Sebastian DeClaw for McBride Racing, April 2026.*
