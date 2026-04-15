// @ts-nocheck
/**
 * Type of Day Classification Engine
 * 
 * Based on RCDM (Race Course Decision Making) framework by Willie McBride
 * Calibrated against 95 real-world NMEA sessions across 9 venues.
 * 
 * Uses two primary axes:
 *   - Puffiness (IQR Ratio): pressure variability
 *   - Shiftiness (Detrended Circular StdDev): direction variability after removing trend
 * 
 * With secondary modifiers:
 *   - Phase persistence: how long shifts hold
 *   - Wind trend: building or fading
 *   - Direction trend: veering or backing
 */

export type TypeOfDay = {
  type: string;           // "Inside Track" | "Connect the Dots" | "Edge Out" | "Outside Track" | "Uncertain"
  spiritAnimal: string;   // "Owl" | "Meerkat" | "Wolf" | "Salmon" | "Crocodile"
  emoji: string;          // 🦉 | 🐿️ | 🐺 | 🐟 | 🐊
  confidence: number;     // 0-100
  summary: string;        // One-line coaching summary
  strategy: string;       // Key strategic advice
  puffinessLabel: string;
  shiftinessLabel: string;
};

// Calibrated thresholds from 93-session dataset (quartile boundaries, strategy E)
const PUFFINESS_THRESHOLDS = [0.565, 0.612, 0.663]; // IQR Ratio: Steady | Moderate | Puffy | Very Puffy
const SHIFTINESS_THRESHOLDS = [50.5, 69.4, 96.3];    // Detrended Circ StdDev (°): Locked In | Moderate | Shifty | Very Shifty

const PUFFINESS_LABELS = ['Steady', 'Moderate', 'Puffy', 'Very Puffy'];
const SHIFTINESS_LABELS = ['Locked In', 'Moderate', 'Shifty', 'Very Shifty'];

function classify(value, thresholds) {
  if (value < thresholds[0]) return 0;
  if (value < thresholds[1]) return 1;
  if (value < thresholds[2]) return 2;
  return 3;
}

export function classifyTypeOfDay(stats: {
  iqrRatio?: number;
  detrendedCircularStdDev?: number;
  phasePersistence?: number;
  windTrendDeltaKts?: number;
  directionTrendDeltaDeg?: number;
  avgWindSpeed?: number;
  medianWindSpeed?: number;
}): TypeOfDay {
  const iqr = stats.iqrRatio ?? 0.6;
  const dcsd = stats.detrendedCircularStdDev ?? 60;
  
  const puffLevel = classify(iqr, PUFFINESS_THRESHOLDS);
  const shiftLevel = classify(dcsd, SHIFTINESS_THRESHOLDS);
  
  const puffinessLabel = PUFFINESS_LABELS[puffLevel];
  const shiftinessLabel = SHIFTINESS_LABELS[shiftLevel];
  
  // Primary classification on the 2x2 grid
  let type: string;
  let spiritAnimal: string;
  let emoji: string;
  let summary: string;
  let strategy: string;
  let confidence: number;
  
  const isPuffy = puffLevel >= 2;
  const isShifty = shiftLevel >= 2;
  const isSteady = puffLevel <= 1;
  const isLocked = shiftLevel <= 1;
  
  if (isSteady && isLocked) {
    // Low pressure variation, low shift variation = stable oscillation
    type = 'Inside Track';
    spiritAnimal = 'Owl';
    emoji = '🦉';
    summary = 'Stable conditions — shifts are the dominant feature. Stay in phase.';
    strategy = 'Use the compass religiously. Tack on the headers, stay lifted. Sail the shortest distance to the mark. "Do the average thing and let everyone else take themselves out."';
    confidence = 70 + (isSteady && isLocked ? 15 : 0);
  } else if (isPuffy && isLocked) {
    // High pressure variation, low shift variation = pressure is king
    type = 'Connect the Dots';
    spiritAnimal = 'Meerkat';
    emoji = '🐿️';
    summary = 'Pressure differences dominate — distinct puffs and lulls across the course.';
    strategy = 'Head on a swivel. Chase pressure, even through headers. The boat in more wind will always gain. Connect the puffs like dots on a map.';
    confidence = 65 + (puffLevel === 3 ? 10 : 0);
  } else if (isSteady && isShifty) {
    // Low pressure variation, high shift variation = persistent trend or geographic
    type = 'Outside Track';
    spiritAnimal = 'Salmon';
    emoji = '🐟';
    summary = 'Direction changes dominate — there is likely a favored side to race to.';
    strategy = 'Identify the favored side and commit. Fight for the end of the line that takes you there. Be stubborn like the salmon swimming upstream — the destination is worth the battle.';
    confidence = 60 + (shiftLevel === 3 ? 10 : 0);
  } else if (isPuffy && isShifty) {
    // Both pressure and shift matter
    type = 'Edge Out';
    spiritAnimal = 'Wolf';
    emoji = '🐺';
    summary = 'Both pressure and shift matter — the most common and most challenging condition.';
    strategy = 'Get to the edge of your group. Attack when strong (head back to center), retreat when weak (tack away). "Win your side." Leading into the first feature is critical.';
    confidence = 55 + (puffLevel === 3 && shiftLevel === 3 ? 10 : 0);
  } else {
    // Borderline cases
    type = 'Uncertain';
    spiritAnimal = 'Crocodile';
    emoji = '🐊';
    summary = 'Conditions are borderline — be patient and wait for clarity.';
    strategy = 'High percentage defaults. Start in low density for clean escape. Go fast for 3 of the first 5 minutes. Wait for the opportunity, then strike decisively.';
    confidence = 40;
  }
  
  // Modify confidence based on how far from boundaries
  const iqrDistFromBoundary = Math.min(...PUFFINESS_THRESHOLDS.map(t => Math.abs(iqr - t)));
  const dcsdDistFromBoundary = Math.min(...SHIFTINESS_THRESHOLDS.map(t => Math.abs(dcsd - t)));
  if (iqrDistFromBoundary < 0.02) confidence -= 10;
  if (dcsdDistFromBoundary < 5) confidence -= 10;
  
  confidence = Math.max(20, Math.min(95, confidence));
  
  return {
    type,
    spiritAnimal,
    emoji,
    confidence,
    summary,
    strategy,
    puffinessLabel,
    shiftinessLabel,
  };
}

// Metric tooltips for coaching UI
export const METRIC_TOOLTIPS: Record<string, { label: string; what: string; why: string; how: string }> = {
  medianWindSpeed: {
    label: 'Wind Median',
    what: 'The middle value of all wind speed readings — half the readings are above, half below.',
    why: 'More stable than average because it ignores extreme gusts and lulls. Tells you what "typical" pressure feels like.',
    how: 'Sort all wind speed values, take the middle one.',
  },
  puffinessLabel: {
    label: 'Puffiness',
    what: 'How much the wind speed varies between puffs and lulls.',
    why: 'High puffiness means pressure differences on the course are large — chasing puffs becomes important. Low puffiness means speed is consistent and shifts matter more.',
    how: 'IQR Ratio: (75th percentile speed - 25th percentile speed) / median speed. Calibrated against 93 real sessions.',
  },
  shiftinessLabel: {
    label: 'Shiftiness',
    what: 'How much the wind direction oscillates after removing any persistent trend.',
    why: 'High shiftiness means the wind is oscillating unpredictably — tacking on shifts and fleet management become critical. Low shiftiness means the compass is steady or trending.',
    how: 'Detrended Circular StdDev: remove the linear direction trend, then measure how much the remaining direction bounces around.',
  },
  windTrendLabel: {
    label: 'Wind Trend',
    what: 'Is the wind building (getting stronger), fading (dying), or holding steady over the session?',
    why: 'A building breeze often brings new pressure from a different direction. Fading breeze may signal a thermal dying or a gradient weakening — be ready for the type of day to change.',
    how: 'Linear regression of wind speed over time. Positive slope = building, negative = fading.',
  },
  directionTrendLabel: {
    label: 'Direction Trend',
    what: 'The persistent shift in wind direction over the session — veering (clockwise) or backing (counter-clockwise).',
    why: 'A persistent veer or back often indicates geographic influence, thermal development, or frontal passage. Knowing the trend helps you anticipate which side will pay next.',
    how: 'Circular mean of first quarter vs last quarter of direction readings.',
  },
  typeOfDay: {
    label: 'Type of Day',
    what: 'The strategic classification of wind conditions based on the RCDM framework.',
    why: 'Each type of day has a specific winning strategy. Identifying the type correctly is the foundation of race course decision making.',
    how: 'Classified by puffiness (IQR Ratio) and shiftiness (Detrended Circular StdDev), calibrated against 93 sessions across 9 international venues.',
  },
  windLullAvg: {
    label: 'Lull Average',
    what: 'Average wind speed in the bottom 10% of readings — what the lightest patches feel like.',
    why: 'On Connect the Dots days, knowing the lull speed helps you judge how much you gain by staying in pressure. Big lull-to-peak differences = pressure matters more.',
    how: 'Average of the bottom 10% of wind speed readings.',
  },
  windPeakAvg: {
    label: 'Peak Average',
    what: 'Average wind speed in the top 10% of readings — what the strongest puffs deliver.',
    why: 'Combined with lull average, tells you the "puff-to-lull ratio." If peaks are 2x lulls, pressure dominates. If peaks are only 20% above lulls, focus on shifts instead.',
    how: 'Average of the top 10% of wind speed readings.',
  },
  phasePersistence: {
    label: 'Phase Persistence',
    what: 'How many minutes a wind shift typically holds before the wind swings back.',
    why: 'Short persistence (< 2 min) means quick oscillations — tack frequently. Long persistence (> 3.5 min) means shifts hold — commit to the tack and ride it out.',
    how: 'Average duration between direction reversals greater than 5°.',
  },
  coverage: {
    label: 'Coverage',
    what: 'Total duration of usable wind data in this session.',
    why: 'Longer coverage gives more confidence in all metrics. Short sessions may not capture the full character of the day.',
    how: 'Time between first and last valid wind reading.',
  },
};
