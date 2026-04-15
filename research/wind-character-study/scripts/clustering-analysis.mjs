import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const DATA_DIR = '/tmp/wind-calibration/extracted';
const METRICS_RESULTS = '/tmp/wind-metrics-study/results.json';
const OUTPUT_JSON = '/tmp/wind-clustering-study/results.json';
const OUTPUT_CLUSTER_PROFILES = '/tmp/wind-clustering-study/cluster-profiles.json';
const OUTPUT_HTML = '/tmp/wind-clustering-study/report.html';
const PARSER_PATH = '/Users/mcbrideagents/.openclaw/workspace/projects/wind-analytics-platform/lib/parsers/index.js';
const METERS_PER_SECOND_TO_KNOTS = 1.9438444924406;

const EXPECTED_FILE_COUNT = 95;
const MIN_POINTS = 20;
const PRIMARY_K = 4;
const FEATURE_KEYS = [
  'iqrRatio',
  'rollingShiftFrequency',
  'cv',
  'circularStdDev',
  'detrendedCv',
  'detrendedCircularStdDev',
  'gustFactor',
  'phasePersistence',
  'meanWindSpeed',
  'medianWindSpeed',
  'windRange',
  'speedTrendSlope',
  'directionTrendDeg',
  'oscillationRegularity',
  'pressureShiftCorrelation',
  'lullPeakSpread',
  'dominantOscillationPeriodMinutes',
  'speedDirectionCoherence',
];

const FEATURE_META = {
  iqrRatio: { label: 'IQR Ratio', kind: 'pressure', higher: 'more puffy' },
  rollingShiftFrequency: { label: 'Rolling Shift Frequency', kind: 'shift', higher: 'more shifty' },
  cv: { label: 'CV', kind: 'pressure', higher: 'more puffy' },
  circularStdDev: { label: 'Circular Std Dev', kind: 'shift', higher: 'more shifty' },
  detrendedCv: { label: 'Detrended CV', kind: 'pressure', higher: 'more puffy' },
  detrendedCircularStdDev: { label: 'Detrended Circular Std Dev', kind: 'shift', higher: 'more shifty' },
  gustFactor: { label: 'Gust Factor', kind: 'pressure', higher: 'gustier' },
  phasePersistence: { label: 'Phase Persistence', kind: 'structure', higher: 'more persistent' },
  meanWindSpeed: { label: 'Mean Wind Speed', kind: 'background', higher: 'stronger' },
  medianWindSpeed: { label: 'Median Wind Speed', kind: 'background', higher: 'stronger' },
  windRange: { label: 'Wind Range', kind: 'pressure', higher: 'wider spread' },
  speedTrendSlope: { label: 'Speed Trend Slope', kind: 'trend', higher: 'building' },
  directionTrendDeg: { label: 'Direction Trend', kind: 'trend', higher: 'more persistent trend' },
  oscillationRegularity: { label: 'Oscillation Regularity', kind: 'structure', higher: 'more periodic' },
  pressureShiftCorrelation: { label: 'Pressure/Shift Correlation', kind: 'coupling', higher: 'pressure-shift linked' },
  lullPeakSpread: { label: 'Lull/Peak Spread', kind: 'pressure', higher: 'bigger puff-lull gap' },
  dominantOscillationPeriodMinutes: { label: 'Dominant Oscillation Period', kind: 'structure', higher: 'longer cycle' },
  speedDirectionCoherence: { label: 'Speed/Direction Coherence', kind: 'coupling', higher: 'speed-direction linked' },
};

const RCDM_TYPES = [
  {
    type: 'Connect the Dots',
    spiritAnimal: 'Meerkat',
    description: 'Pressure dominates; low directional structure. Chase pressure and ignore most shifts.',
    score(cluster) {
      const p = cluster.axes.pressure;
      const s = cluster.axes.shift;
      const r = cluster.axes.regularity;
      const t = cluster.axes.trend;
      return 2.2 * p - 1.2 * s - 0.8 * r - 0.3 * t;
    },
  },
  {
    type: 'Inside Track',
    spiritAnimal: 'Owl',
    description: 'Shift-driven and structured, with readable oscillation and relatively even pressure.',
    score(cluster) {
      const p = cluster.axes.pressure;
      const s = cluster.axes.shift;
      const r = cluster.axes.regularity;
      return 2.0 * s + 1.3 * r - 1.2 * p;
    },
  },
  {
    type: 'Outside Track',
    spiritAnimal: 'Salmon',
    description: 'A side or trend matters. Persistent directional or pressure trend creates a place to race to.',
    score(cluster) {
      const p = cluster.axes.pressure;
      const s = cluster.axes.shift;
      const t = cluster.axes.trend;
      const r = cluster.axes.regularity;
      return 1.8 * t + 0.5 * p + 0.3 * s - 0.4 * r;
    },
  },
  {
    type: 'Edge Out',
    spiritAnimal: 'Wolf',
    description: 'Both pressure and shift matter, with neither overwhelmingly dominant.',
    score(cluster) {
      const p = cluster.axes.pressure;
      const s = cluster.axes.shift;
      return 1.6 * Math.min(p, s) + 0.5 * (p + s) - 0.7 * Math.abs(p - s);
    },
  },
  {
    type: 'Uncertain / Minimize Decisions',
    spiritAnimal: 'Crocodile',
    description: 'Low structure and low confidence. Randomness overwhelms readable pattern.',
    score(cluster) {
      const r = cluster.axes.regularity;
      const c = cluster.axes.coherence;
      const t = cluster.axes.trend;
      return -1.4 * r - 0.8 * c - 0.3 * t;
    },
  },
];

async function main() {
  const parserModule = await import(pathToFileURL(PARSER_PATH).href);
  const { parseNmea } = parserModule;
  if (typeof parseNmea !== 'function') {
    throw new Error(`parseNmea not found in ${PARSER_PATH}`);
  }

  const metricsResults = JSON.parse(fs.readFileSync(METRICS_RESULTS, 'utf8'));
  const coreMetricByFile = new Map(
    metricsResults.fileResults.map((entry) => [entry.filename, entry.strategies?.E?.metrics ?? null]),
  );

  const filenames = fs.readdirSync(DATA_DIR).filter((name) => name.endsWith('.txt')).sort((a, b) => a.localeCompare(b));
  if (filenames.length !== EXPECTED_FILE_COUNT) {
    throw new Error(`Expected ${EXPECTED_FILE_COUNT} files, found ${filenames.length}`);
  }

  const sessions = [];
  for (const [index, filename] of filenames.entries()) {
    console.log(`[${index + 1}/${filenames.length}] ${filename}`);
    const raw = fs.readFileSync(path.join(DATA_DIR, filename), 'utf8');
    const parsed = parseNmea(raw);
    const enriched = enrichEnvironmentalPoints(parsed.environmentalPoints ?? [], raw);
    const normalized = normalizePoints(enriched);
    const selected = applyWindGate(normalized);
    if (selected.length < MIN_POINTS) {
      sessions.push({
        filename,
        venue: inferVenue(filename),
        selectedPointCount: selected.length,
        rawPointCount: normalized.length,
        activeDurationMinutes: selected.length ? roundNumber(selected.at(-1)._activeTime / 60000, 2) : null,
        rawDurationMinutes: normalized.length ? roundNumber((normalized.at(-1)._time - normalized[0]._time) / 60000, 2) : null,
        startTimestamp: normalized[0]?.timestamp ?? null,
        endTimestamp: normalized.at(-1)?.timestamp ?? null,
        features: null,
        imputation: {
          needed: true,
          reason: normalized.length ? `selection too small after wind-gating (${selected.length} points)` : 'no parseable environmental points',
        },
      });
      continue;
    }

    const coreMetrics = coreMetricByFile.get(filename) ?? {};
    const computedCoreMetrics = computeCoreMetrics(selected);

    const derived = computeDerivedMetrics(selected);
    const features = {};
    for (const key of FEATURE_KEYS) {
      const source = Object.prototype.hasOwnProperty.call(coreMetrics, key) && finiteNumber(coreMetrics[key])
        ? coreMetrics[key]
        : Object.prototype.hasOwnProperty.call(computedCoreMetrics, key) && finiteNumber(computedCoreMetrics[key])
          ? computedCoreMetrics[key]
          : derived[key];
      if (!finiteNumber(source)) {
        throw new Error(`Feature ${key} missing for ${filename}`);
      }
      features[key] = roundNumber(source, 6);
    }

    sessions.push({
      filename,
      venue: inferVenue(filename),
      selectedPointCount: selected.length,
      rawPointCount: normalized.length,
      activeDurationMinutes: roundNumber(selected.at(-1)._activeTime / 60000, 2),
      rawDurationMinutes: roundNumber((normalized.at(-1)._time - normalized[0]._time) / 60000, 2),
      startTimestamp: normalized[0]?.timestamp ?? null,
      endTimestamp: normalized.at(-1)?.timestamp ?? null,
      features,
      derivedDiagnostics: {
        medianStepSeconds: roundNumber(median(selected.slice(1).map((point, idx) => point._activeTime - selected[idx]._activeTime)) / 1000, 3),
      },
      imputation: null,
    });
  }

  imputeMissingSessions(sessions);

  const matrix = sessions.map((session) => FEATURE_KEYS.map((key) => session.features[key]));
  const normalization = zScoreMatrix(matrix);
  const kScan = {};
  for (const k of [2, 3, 4, 5, 6]) {
    const model = runKMeans(normalization.rows, k, 40, 12, 1337 + k);
    const silhouette = silhouetteScore(normalization.rows, model.assignments);
    kScan[k] = {
      k,
      inertia: roundNumber(model.inertia, 6),
      silhouetteScore: roundNumber(silhouette.average, 6),
      silhouetteByCluster: Object.fromEntries(
        Object.entries(silhouette.byCluster).map(([clusterId, value]) => [clusterId, roundNumber(value, 6)]),
      ),
    };
  }

  const primary = runKMeans(normalization.rows, PRIMARY_K, 60, 24, 4242);
  const pca = computePca(normalization.rows, FEATURE_KEYS);
  const hierarchical = buildHierarchicalClustering(normalization.rows, sessions.map((s) => s.filename));
  const clusters = summarizeClusters({
    sessions,
    normalizedRows: normalization.rows,
    primary,
    featureMeans: normalization.means,
    featureStdDevs: normalization.stdDevs,
  });

  const venueDistribution = buildVenueDistribution(sessions, primary.assignments);
  const decisionTree = buildDecisionTree(normalization.rows, primary.assignments, FEATURE_KEYS, 3, 6);
  const clusterProfiles = buildClusterProfiles(clusters, decisionTree);
  const results = {
    generatedAt: new Date().toISOString(),
    parserPath: PARSER_PATH,
    metricsSource: METRICS_RESULTS,
    dataDir: DATA_DIR,
    filesAnalyzed: sessions.length,
    featureKeys: FEATURE_KEYS,
    featureMeta: FEATURE_META,
    normalization: {
      means: objectFromKeys(FEATURE_KEYS, normalization.means.map((v) => roundNumber(v, 6))),
      stdDevs: objectFromKeys(FEATURE_KEYS, normalization.stdDevs.map((v) => roundNumber(v, 6))),
    },
    silhouette: kScan,
    primaryK: PRIMARY_K,
    pca,
    hierarchical,
    decisionTree,
    venueDistribution,
    rcdmTypes: clusters.map((cluster) => cluster.rcdmMapping),
    clusterCentroids: clusters.map((cluster) => ({
      id: cluster.id,
      size: cluster.size,
      name: cluster.name,
      centroid: cluster.centroid,
      normalizedCentroid: cluster.normalizedCentroid,
      representativeSessions: cluster.representativeSessions,
      distinctiveFeatures: cluster.distinctiveFeatures,
      description: cluster.description,
      rcdmMapping: cluster.rcdmMapping,
      axes: cluster.axes,
    })),
    sessions: sessions.map((session, index) => ({
      ...session,
      clusterId: primary.assignments[index],
      pca: {
        pc1: roundNumber(pca.scores[index][0], 6),
        pc2: roundNumber(pca.scores[index][1], 6),
      },
    })),
    clusterProfiles,
    analysis: buildAnalysisSummary(clusters, kScan, venueDistribution, decisionTree),
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2));
  fs.writeFileSync(OUTPUT_CLUSTER_PROFILES, JSON.stringify({ clusters: clusterProfiles }, null, 2));
  fs.writeFileSync(OUTPUT_HTML, renderHtml(results));
  console.log(`Wrote ${OUTPUT_JSON}`);
  console.log(`Wrote ${OUTPUT_CLUSTER_PROFILES}`);
  console.log(`Wrote ${OUTPUT_HTML}`);
}

function enrichEnvironmentalPoints(environmentalPoints, rawText) {
  const enriched = environmentalPoints.map((point) => ({ ...point }));
  let pointIndex = -1;
  let currentHeading = null;
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const sentence = line.startsWith('$') ? line.slice(1) : line;
    const [head, ...parts] = sentence.split(',');
    const type = head.slice(-3);
    if (type === 'RMC') {
      pointIndex += 1;
      currentHeading = enriched[pointIndex]?.heading ?? null;
      continue;
    }
    if (pointIndex < 0 || pointIndex >= enriched.length) continue;
    const point = enriched[pointIndex];
    if (type === 'HDG' && parts.length >= 1) {
      currentHeading = toNumberOrNull(parts[0]);
      point.heading = point.heading ?? currentHeading;
      continue;
    }
    if (type === 'MWD' && parts.length >= 7) {
      point.windDirection = point.windDirection ?? toNumberOrNull(parts[2] || parts[0]);
      point.windSpeedKts = point.windSpeedKts ?? toNumberOrNull(parts[4]);
      continue;
    }
    if (type === 'MWV' && parts.length >= 5) {
      const angle = toNumberOrNull(parts[0]);
      const reference = parts[1];
      const speed = convertSpeed(toNumberOrNull(parts[2]), parts[3]);
      if (!finiteNumber(point.windSpeedKts) && finiteNumber(speed) && speed > 0) point.windSpeedKts = speed;
      if (!finiteNumber(point.windDirection) && finiteNumber(currentHeading) && finiteNumber(angle) && reference === 'T') {
        point.windDirection = inferDirectionFromHeading(currentHeading, angle);
      }
      continue;
    }
    if (type === 'VWT' && parts.length >= 7) {
      const angle = toNumberOrNull(parts[0]);
      const side = parts[1];
      const speed = toNumberOrNull(parts[2]);
      if (!finiteNumber(point.windSpeedKts) && finiteNumber(speed)) point.windSpeedKts = speed;
      if (!finiteNumber(point.windDirection) && finiteNumber(currentHeading) && finiteNumber(angle)) {
        point.windDirection = inferDirectionFromHeading(currentHeading, side === 'L' ? 360 - angle : angle);
      }
    }
  }
  return enriched;
}

function computeCoreMetrics(points) {
  const speeds = points.map((point) => point.windSpeedKts).filter(finiteNumber);
  const dirs = points.map((point) => point.windDirection).filter(finiteNumber);
  const speedPairs = points.filter((point) => finiteNumber(point.windSpeedKts)).map((point) => ({ time: point._activeTime, value: point.windSpeedKts }));
  const dirPairs = points.filter((point) => finiteNumber(point.windDirection)).map((point) => ({ time: point._activeTime, value: point.windDirection }));
  const rollingDirMeans = rollingTimeCircularMean(points, 2 * 60 * 1000, 'windDirection');
  return {
    iqrRatio: speeds.length >= MIN_POINTS ? safeRatio(quantile(speeds, 0.75) - quantile(speeds, 0.25), quantile(speeds, 0.5)) : 0,
    rollingShiftFrequency: computeRollingShiftFrequency(points),
    cv: speeds.length >= MIN_POINTS ? safeRatio(stdDev(speeds), average(speeds)) : 0,
    circularStdDev: dirs.length >= MIN_POINTS ? computeCircularStdDev(dirs) : 0,
    detrendedCv: computeDetrendedCv(speedPairs),
    detrendedCircularStdDev: computeDetrendedCircularStdDev(dirPairs),
    gustFactor: computeGustFactor(points),
    phasePersistence: computePhasePersistence(rollingDirMeans),
  };
}

function normalizePoints(points) {
  const withTimes = points
    .map((point) => {
      const time = Date.parse(point.timestamp);
      if (!Number.isFinite(time)) return null;
      return {
        timestamp: point.timestamp,
        windSpeedKts: toNumberOrNull(point.windSpeedKts),
        windDirection: wrapDegrees(toNumberOrNull(point.windDirection)),
        boatSpeedKts: toNumberOrNull(point.boatSpeedKts),
        _time: time,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a._time - b._time);

  if (!withTimes.length) return [];
  const deltas = [];
  for (let i = 1; i < withTimes.length; i += 1) {
    const delta = withTimes[i]._time - withTimes[i - 1]._time;
    if (delta > 0 && delta < 30000) deltas.push(delta);
  }
  const medianDelta = median(deltas) ?? 2000;
  const clampDelta = Math.max(medianDelta * 3, 10000);
  let active = 0;
  for (let i = 0; i < withTimes.length; i += 1) {
    if (i > 0) {
      const delta = withTimes[i]._time - withTimes[i - 1]._time;
      active += Math.max(0, Math.min(delta, clampDelta));
    }
    withTimes[i]._activeTime = active;
  }
  return withTimes;
}

function applyWindGate(points) {
  return points.filter((point) => finiteNumber(point.windSpeedKts) && point.windSpeedKts > 3);
}

function computeDerivedMetrics(points) {
  const speeds = points.map((point) => point.windSpeedKts).filter(finiteNumber);
  const dirs = points.map((point) => point.windDirection).filter(finiteNumber);
  const speedPairs = points.filter((point) => finiteNumber(point.windSpeedKts)).map((point) => ({ time: point._activeTime, value: point.windSpeedKts }));
  const dirPairs = points.filter((point) => finiteNumber(point.windDirection)).map((point) => ({ time: point._activeTime, value: point.windDirection }));
  const meanDirection = circularMean(dirs);
  const deviationSeries = dirs.map((dir) => Math.abs(angularDiff(meanDirection, dir)));
  const pressureShiftCorrelation = pearson(speeds, deviationSeries);
  const speedChanges = [];
  const directionChanges = [];
  for (let i = 1; i < points.length; i += 1) {
    if (!finiteNumber(points[i].windSpeedKts) || !finiteNumber(points[i - 1].windSpeedKts)) continue;
    if (!finiteNumber(points[i].windDirection) || !finiteNumber(points[i - 1].windDirection)) continue;
    speedChanges.push(Math.abs(points[i].windSpeedKts - points[i - 1].windSpeedKts));
    directionChanges.push(Math.abs(angularDiff(points[i - 1].windDirection, points[i].windDirection)));
  }
  const oscillation = computeOscillationFeatures(dirPairs);

  return {
    meanWindSpeed: average(speeds),
    medianWindSpeed: quantile(speeds, 0.5),
    windRange: Math.max(...speeds) - Math.min(...speeds),
    speedTrendSlope: computeLinearSlope(speedPairs, 3600000),
    directionTrendDeg: computeDirectionTrend(dirPairs),
    oscillationRegularity: oscillation.regularity,
    pressureShiftCorrelation,
    lullPeakSpread: computeLullPeakSpread(speeds),
    dominantOscillationPeriodMinutes: oscillation.periodMinutes,
    speedDirectionCoherence: pearson(speedChanges, directionChanges),
  };
}

function computeRollingShiftFrequency(points) {
  const sequence = points.filter((point) => finiteNumber(point.windDirection));
  if (sequence.length < MIN_POINTS) return 0;
  let count = 0;
  for (let i = 1; i < sequence.length; i += 1) {
    if (Math.abs(angularDiff(sequence[i - 1].windDirection, sequence[i].windDirection)) > 5) count += 1;
  }
  const hours = (sequence.at(-1)._activeTime - sequence[0]._activeTime) / 3600000;
  return hours > 0 ? count / hours : 0;
}

function computeDetrendedCv(pairs) {
  if (pairs.length < MIN_POINTS) return 0;
  const residuals = detrendLinearPairs(pairs).map((value) => Math.abs(value));
  const mean = average(pairs.map((pair) => pair.value));
  return safeRatio(stdDev(residuals), mean);
}

function computeDetrendedCircularStdDev(pairs) {
  if (pairs.length < MIN_POINTS) return 0;
  const unwrapped = unwrapAngles(pairs.map((pair) => pair.value));
  const trendPairs = pairs.map((pair, index) => ({ time: pair.time, value: unwrapped[index] }));
  const residuals = detrendLinearPairs(trendPairs).map((value) => wrapDegrees(wrapDegreesSigned(value)));
  return computeCircularStdDev(residuals);
}

function computeGustFactor(points) {
  const windows = rollingTimeWindows(points, 5 * 60 * 1000, (point) => finiteNumber(point.windSpeedKts));
  if (!windows.length) return 0;
  const values = windows.map((window) => {
    const speeds = window.map((point) => point.windSpeedKts).filter(finiteNumber);
    const mean = average(speeds);
    return safeRatio(Math.max(...speeds) - Math.min(...speeds), mean);
  }).filter(finiteNumber);
  return average(values);
}

function computePhasePersistence(rollingDirMeans) {
  if (rollingDirMeans.length < MIN_POINTS) return 0;
  const phases = [];
  let currentSign = 0;
  let phaseStart = rollingDirMeans[0].time;
  for (const entry of rollingDirMeans) {
    const delta = angularDiff(entry.mean, entry.value);
    const sign = Math.abs(delta) < 1e-6 ? 0 : Math.sign(delta);
    if (!sign) continue;
    if (!currentSign) {
      currentSign = sign;
      phaseStart = entry.time;
      continue;
    }
    if (sign !== currentSign) {
      phases.push((entry.time - phaseStart) / 60000);
      currentSign = sign;
      phaseStart = entry.time;
    }
  }
  return average(phases);
}

function computeLullPeakSpread(values) {
  const medianValue = quantile(values, 0.5);
  const high = tailAverage(values, 0.1, 'high');
  const low = tailAverage(values, 0.1, 'low');
  return safeRatio(high - low, medianValue);
}

function computeLinearSlope(pairs, scaleMs) {
  if (pairs.length < 2) return 0;
  const origin = pairs[0].time;
  const xs = pairs.map((pair) => (pair.time - origin) / scaleMs);
  const ys = pairs.map((pair) => pair.value);
  return linearSlope(xs, ys);
}

function computeDirectionTrend(pairs) {
  if (pairs.length < 4) return 0;
  const values = unwrapAngles(pairs.map((pair) => pair.value));
  const quarter = Math.max(1, Math.floor(values.length / 4));
  const first = average(values.slice(0, quarter));
  const last = average(values.slice(values.length - quarter));
  return wrapDegreesSigned(last - first);
}

function computeOscillationFeatures(pairs) {
  if (pairs.length < 12) {
    return { regularity: 0, periodMinutes: 0 };
  }
  const unwrapped = unwrapAngles(pairs.map((pair) => pair.value));
  const xs = pairs.map((pair) => pair.time);
  const slope = linearSlope(xs, unwrapped);
  const intercept = average(unwrapped) - slope * average(xs);
  const residuals = unwrapped.map((value, index) => value - (slope * xs[index] + intercept));
  const lagStep = median(xs.slice(1).map((time, index) => time - xs[index])) ?? 2000;
  const maxLag = Math.min(Math.floor(residuals.length / 3), 300);
  let bestLag = 0;
  let bestAcf = -Infinity;
  for (let lag = 2; lag <= maxLag; lag += 1) {
    const acf = autocorrelation(residuals, lag);
    if (acf > bestAcf) {
      bestAcf = acf;
      bestLag = lag;
    }
  }
  return {
    regularity: Number.isFinite(bestAcf) ? bestAcf : 0,
    periodMinutes: bestLag > 0 ? (bestLag * lagStep) / 60000 : 0,
  };
}

function zScoreMatrix(matrix) {
  const columns = matrix[0].length;
  const means = [];
  const stdDevs = [];
  for (let col = 0; col < columns; col += 1) {
    const values = matrix.map((row) => row[col]);
    const mean = average(values);
    const std = stdDev(values) || 1;
    means.push(mean);
    stdDevs.push(std || 1);
  }
  const rows = matrix.map((row) => row.map((value, col) => (value - means[col]) / (stdDevs[col] || 1)));
  return { rows, means, stdDevs };
}

function runKMeans(rows, k, maxIterations, restarts, seedBase) {
  let best = null;
  for (let restart = 0; restart < restarts; restart += 1) {
    const rng = createRng(seedBase + restart * 17);
    let centroids = initializeKMeansPlusPlus(rows, k, rng);
    let assignments = new Array(rows.length).fill(-1);
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const nextAssignments = rows.map((row) => nearestCentroid(row, centroids));
      const changed = nextAssignments.some((value, index) => value !== assignments[index]);
      assignments = nextAssignments;
      const nextCentroids = Array.from({ length: k }, (_, idx) => centroidOf(rows.filter((_, rowIndex) => assignments[rowIndex] === idx), rows[0].length));
      for (let idx = 0; idx < k; idx += 1) {
        if (!nextCentroids[idx]) {
          nextCentroids[idx] = rows[Math.floor(rng() * rows.length)].slice();
        }
      }
      centroids = nextCentroids;
      if (!changed) break;
    }
    const inertia = computeInertia(rows, assignments, centroids);
    if (!best || inertia < best.inertia) best = { assignments, centroids, inertia };
  }
  return best;
}

function initializeKMeansPlusPlus(rows, k, rng) {
  const centroids = [rows[Math.floor(rng() * rows.length)].slice()];
  while (centroids.length < k) {
    const distances = rows.map((row) => {
      const nearest = Math.min(...centroids.map((centroid) => squaredDistance(row, centroid)));
      return nearest;
    });
    const total = distances.reduce((sum, value) => sum + value, 0);
    let pick = rng() * total;
    let index = 0;
    for (; index < distances.length; index += 1) {
      pick -= distances[index];
      if (pick <= 0) break;
    }
    centroids.push(rows[Math.min(index, rows.length - 1)].slice());
  }
  return centroids;
}

function computeInertia(rows, assignments, centroids) {
  let total = 0;
  for (let i = 0; i < rows.length; i += 1) {
    total += squaredDistance(rows[i], centroids[assignments[i]]);
  }
  return total;
}

function silhouetteScore(rows, assignments) {
  const byCluster = {};
  const scores = rows.map((row, index) => {
    const ownCluster = assignments[index];
    const ownMembers = rows.filter((_, rowIndex) => assignments[rowIndex] === ownCluster && rowIndex !== index);
    if (!ownMembers.length) {
      byCluster[ownCluster] = byCluster[ownCluster] ?? [];
      byCluster[ownCluster].push(0);
      return 0;
    }
    const a = ownMembers.length ? average(ownMembers.map((other) => euclideanDistance(row, other))) : 0;
    let b = Infinity;
    for (const clusterId of unique(assignments)) {
      if (clusterId === ownCluster) continue;
      const clusterMembers = rows.filter((_, rowIndex) => assignments[rowIndex] === clusterId);
      if (!clusterMembers.length) continue;
      const dist = average(clusterMembers.map((other) => euclideanDistance(row, other)));
      if (dist < b) b = dist;
    }
    const score = b === Infinity && a === 0 ? 0 : (b - a) / Math.max(a, b);
    byCluster[ownCluster] = byCluster[ownCluster] ?? [];
    byCluster[ownCluster].push(score);
    return score;
  });
  return {
    average: average(scores),
    byCluster: Object.fromEntries(Object.entries(byCluster).map(([clusterId, values]) => [clusterId, average(values)])),
  };
}

function computePca(rows, featureKeys) {
  const covariance = covarianceMatrix(rows);
  const eig1 = powerIteration(covariance, 100);
  const deflated = deflateMatrix(covariance, eig1.vector, eig1.value);
  const eig2 = powerIteration(deflated, 100, orthogonalUnitVector(eig1.vector.length, eig1.vector));
  const components = [eig1.vector, eig2.vector];
  const scores = rows.map((row) => components.map((component) => dot(row, component)));
  const totalVariance = trace(covariance) || 1;
  return {
    explainedVariance: [roundNumber(eig1.value / totalVariance, 6), roundNumber(eig2.value / totalVariance, 6)],
    components: components.map((component, index) => ({
      component: `PC${index + 1}`,
      loadings: objectFromKeys(featureKeys, component.map((value) => roundNumber(value, 6))),
    })),
    scores: scores.map((pair) => pair.map((value) => roundNumber(value, 6))),
  };
}

function summarizeClusters({ sessions, normalizedRows, primary, featureMeans, featureStdDevs }) {
  const clusters = [];
  for (let clusterId = 0; clusterId < PRIMARY_K; clusterId += 1) {
    const indices = primary.assignments.map((assignment, index) => ({ assignment, index })).filter((entry) => entry.assignment === clusterId).map((entry) => entry.index);
    const size = indices.length;
    const centroid = objectFromKeys(FEATURE_KEYS, FEATURE_KEYS.map((key, keyIndex) => {
      const rawValue = featureMeans[keyIndex] + primary.centroids[clusterId][keyIndex] * featureStdDevs[keyIndex];
      return roundNumber(rawValue, 6);
    }));
    const normalizedCentroid = objectFromKeys(FEATURE_KEYS, primary.centroids[clusterId].map((value) => roundNumber(value, 6)));
    const distances = indices.map((index) => ({
      index,
      distance: euclideanDistance(normalizedRows[index], primary.centroids[clusterId]),
    })).sort((a, b) => a.distance - b.distance);
    const distinctive = FEATURE_KEYS
      .map((key, keyIndex) => ({ key, value: primary.centroids[clusterId][keyIndex], abs: Math.abs(primary.centroids[clusterId][keyIndex]) }))
      .sort((a, b) => b.abs - a.abs)
      .slice(0, 5)
      .map((entry) => ({
        key: entry.key,
        label: FEATURE_META[entry.key].label,
        zScore: roundNumber(entry.value, 6),
        interpretation: entry.value >= 0 ? `higher than fleet mean: ${FEATURE_META[entry.key].higher}` : `lower than fleet mean`,
      }));
    const axes = deriveAxes(normalizedCentroid);
    const name = proposeClusterName(axes, clusterId);
    const description = describeCluster(axes);
    const rcdmMapping = mapClusterToRcdm({ id: clusterId, axes, normalizedCentroid, distinctiveFeatures: distinctive, centroid });
    clusters.push({
      id: clusterId,
      size,
      name,
      description,
      centroid,
      normalizedCentroid,
      distinctiveFeatures: distinctive,
      representativeSessions: distances.slice(0, 5).map((entry) => ({
        filename: sessions[entry.index].filename,
        venue: sessions[entry.index].venue,
        distanceToCentroid: roundNumber(entry.distance, 6),
      })),
      axes,
      rcdmMapping,
      sessionFilenames: indices.map((index) => sessions[index].filename),
    });
  }
  return clusters;
}

function deriveAxes(normalizedCentroid) {
  const get = (key) => normalizedCentroid[key] ?? 0;
  return {
    pressure: average([get('iqrRatio'), get('cv'), get('gustFactor'), get('lullPeakSpread'), get('windRange')]),
    shift: average([get('rollingShiftFrequency'), get('circularStdDev'), get('detrendedCircularStdDev')]),
    regularity: average([get('oscillationRegularity'), get('phasePersistence')]) - 0.3 * Math.abs(get('dominantOscillationPeriodMinutes')),
    trend: average([Math.abs(get('directionTrendDeg')), Math.abs(get('speedTrendSlope'))]),
    coherence: average([get('pressureShiftCorrelation'), get('speedDirectionCoherence')]),
  };
}

function proposeClusterName(axes, clusterId) {
  if (axes.trend > 0.7) return `Trend Lane ${clusterId + 1}`;
  if (axes.pressure > 0.6 && axes.shift < 0.2) return `Pressure Hunt ${clusterId + 1}`;
  if (axes.shift > 0.6 && axes.regularity > 0) return `Oscillating Shift ${clusterId + 1}`;
  if (axes.pressure > 0.3 && axes.shift > 0.3) return `Mixed Edge ${clusterId + 1}`;
  return `Unsettled Blend ${clusterId + 1}`;
}

function describeCluster(axes) {
  const parts = [];
  if (axes.pressure > 0.5) parts.push('pressure variation is above average');
  if (axes.shift > 0.5) parts.push('directional movement is above average');
  if (axes.regularity > 0.3) parts.push('the shifts show useful repeatability');
  if (axes.regularity < -0.3) parts.push('the pattern is structurally messy');
  if (axes.trend > 0.7) parts.push('persistent trend matters more than pure oscillation');
  if (axes.coherence > 0.3) parts.push('speed and direction are meaningfully linked');
  if (!parts.length) parts.push('the session sits near the center of the fleet distribution');
  return capitalize(parts.join(', ')) + '.';
}

function mapClusterToRcdm(cluster) {
  const ranked = RCDM_TYPES.map((rcdm) => ({
    type: rcdm.type,
    spiritAnimal: rcdm.spiritAnimal,
    description: rcdm.description,
    score: rcdm.score(cluster),
  })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  return {
    clusterId: cluster.id,
    rcdmType: best.type,
    spiritAnimal: best.spiritAnimal,
    confidenceGap: roundNumber(best.score - second.score, 6),
    rationale: buildRcdmRationale(cluster, best),
    rankedCandidates: ranked.map((entry) => ({
      type: entry.type,
      spiritAnimal: entry.spiritAnimal,
      score: roundNumber(entry.score, 6),
    })),
  };
}

function buildRcdmRationale(cluster, best) {
  const axes = cluster.axes;
  if (best.type === 'Connect the Dots') {
    return `Pressure axis (${roundNumber(axes.pressure, 2)} z) clearly exceeds shift axis (${roundNumber(axes.shift, 2)} z), so pressure cues dominate more than directional phase work.`;
  }
  if (best.type === 'Inside Track') {
    return `Shift axis (${roundNumber(axes.shift, 2)} z) and regularity (${roundNumber(axes.regularity, 2)} z) are strong while pressure is relatively quieter, matching an oscillating phase-oriented day.`;
  }
  if (best.type === 'Outside Track') {
    return `Trend strength (${roundNumber(axes.trend, 2)} z) is the defining axis, implying a persistent side or build/fade story rather than a pure oscillation.`;
  }
  if (best.type === 'Edge Out') {
    return `Pressure (${roundNumber(axes.pressure, 2)} z) and shift (${roundNumber(axes.shift, 2)} z) are both material and reasonably balanced, which matches classic edge-management racing.`;
  }
  return `Regularity (${roundNumber(axes.regularity, 2)} z) and coherence (${roundNumber(axes.coherence, 2)} z) are weak, so the cluster reads as low-confidence and decision-minimizing.`;
}

function buildVenueDistribution(sessions, assignments) {
  const venues = unique(sessions.map((session) => session.venue)).sort((a, b) => a.localeCompare(b));
  const output = {};
  for (const venue of venues) {
    const relevant = sessions.map((session, index) => ({ session, assignment: assignments[index] })).filter((entry) => entry.session.venue === venue);
    const total = relevant.length || 1;
    output[venue] = {
      totalSessions: relevant.length,
      clusters: Object.fromEntries(
        Array.from({ length: PRIMARY_K }, (_, clusterId) => {
          const count = relevant.filter((entry) => entry.assignment === clusterId).length;
          return [clusterId, { count, share: roundNumber((count / total) * 100, 2) }];
        }),
      ),
    };
  }
  return output;
}

function buildDecisionTree(rows, labels, featureKeys, maxDepth, minLeaf) {
  const root = growDecisionTree(rows.map((row, index) => ({ row, label: labels[index], index })), featureKeys, 0, maxDepth, minLeaf);
  return {
    maxDepth,
    minLeaf,
    rules: flattenDecisionTree(root),
    tree: root,
  };
}

function growDecisionTree(items, featureKeys, depth, maxDepth, minLeaf) {
  const labelCounts = counts(items.map((item) => item.label));
  const prediction = majorityLabel(labelCounts);
  const node = {
    depth,
    size: items.length,
    prediction,
    labelCounts,
  };
  if (depth >= maxDepth || items.length <= minLeaf || Object.keys(labelCounts).length === 1) {
    node.leaf = true;
    return node;
  }

  const split = bestSplit(items, featureKeys, minLeaf);
  if (!split) {
    node.leaf = true;
    return node;
  }
  node.leaf = false;
  node.feature = split.feature;
  node.threshold = roundNumber(split.threshold, 6);
  node.left = growDecisionTree(split.left, featureKeys, depth + 1, maxDepth, minLeaf);
  node.right = growDecisionTree(split.right, featureKeys, depth + 1, maxDepth, minLeaf);
  return node;
}

function bestSplit(items, featureKeys, minLeaf) {
  const dimensions = featureKeys.length;
  const baseImpurity = giniImpurity(counts(items.map((item) => item.label)));
  let best = null;
  for (let dim = 0; dim < dimensions; dim += 1) {
    const sorted = items.slice().sort((a, b) => a.row[dim] - b.row[dim]);
    for (let i = minLeaf; i <= sorted.length - minLeaf; i += 1) {
      const leftValue = sorted[i - 1].row[dim];
      const rightValue = sorted[i].row[dim];
      if (leftValue === rightValue) continue;
      const threshold = (leftValue + rightValue) / 2;
      const left = sorted.slice(0, i);
      const right = sorted.slice(i);
      const impurity = (left.length / sorted.length) * giniImpurity(counts(left.map((item) => item.label)))
        + (right.length / sorted.length) * giniImpurity(counts(right.map((item) => item.label)));
      const gain = baseImpurity - impurity;
      if (!best || gain > best.gain) {
        best = { feature: featureKeys[dim], threshold, left, right, gain };
      }
    }
  }
  return best;
}

function flattenDecisionTree(root) {
  const rules = [];
  walkDecisionTree(root, [], rules);
  return rules;
}

function walkDecisionTree(node, path, rules) {
  if (node.leaf) {
    rules.push({
      path,
      prediction: node.prediction,
      size: node.size,
      purity: roundNumber((node.labelCounts[node.prediction] || 0) / node.size, 6),
    });
    return;
  }
  walkDecisionTree(node.left, path.concat(`${node.feature} <= ${roundNumber(node.threshold, 3)}`), rules);
  walkDecisionTree(node.right, path.concat(`${node.feature} > ${roundNumber(node.threshold, 3)}`), rules);
}

function buildClusterProfiles(clusters, decisionTree) {
  return clusters.map((cluster) => ({
    id: cluster.id,
    name: cluster.name,
    rcdmType: cluster.rcdmMapping.rcdmType,
    spiritAnimal: cluster.rcdmMapping.spiritAnimal,
    description: cluster.description,
    centroid: cluster.centroid,
    thresholds: deriveClusterThresholds(cluster.id, decisionTree),
  }));
}

function deriveClusterThresholds(clusterId, decisionTree) {
  const matchingRules = decisionTree.rules.filter((rule) => rule.prediction === clusterId).sort((a, b) => b.size - a.size);
  const thresholds = {};
  for (const rule of matchingRules.slice(0, 1)) {
    for (const condition of rule.path) {
      const match = condition.match(/^(.+?)\s+(<=|>)\s+(-?\d+(?:\.\d+)?)$/);
      if (!match) continue;
      const [, feature, op, rawValue] = match;
      thresholds[feature] = thresholds[feature] ?? {};
      thresholds[feature][op === '<=' ? 'maxZ' : 'minZ'] = Number(rawValue);
    }
  }
  return thresholds;
}

function buildHierarchicalClustering(rows, labels) {
  let nextId = rows.length;
  let clusters = rows.map((row, index) => ({
    id: index,
    members: [index],
    centroid: row,
    label: labels[index],
  }));
  const merges = [];
  while (clusters.length > 1) {
    let best = null;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const distance = averageLinkage(rows, clusters[i].members, clusters[j].members);
        if (!best || distance < best.distance) {
          best = { i, j, distance };
        }
      }
    }
    const left = clusters[best.i];
    const right = clusters[best.j];
    const merged = {
      id: nextId,
      members: left.members.concat(right.members),
      centroid: centroidOf(left.members.concat(right.members).map((member) => rows[member]), rows[0].length),
      label: null,
    };
    merges.push({
      id: nextId,
      left: left.id,
      right: right.id,
      distance: roundNumber(best.distance, 6),
      size: merged.members.length,
    });
    clusters = clusters.filter((_, idx) => idx !== best.i && idx !== best.j).concat(merged);
    nextId += 1;
  }
  return {
    labels,
    merges,
  };
}

function averageLinkage(rows, leftMembers, rightMembers) {
  const distances = [];
  for (const left of leftMembers) {
    for (const right of rightMembers) {
      distances.push(euclideanDistance(rows[left], rows[right]));
    }
  }
  return average(distances);
}

function buildAnalysisSummary(clusters, kScan, venueDistribution, decisionTree) {
  const silhouetteRanking = Object.values(kScan).sort((a, b) => b.silhouetteScore - a.silhouetteScore);
  const bestSilhouette = silhouetteRanking[0];
  const clusterTypeSet = new Set(clusters.map((cluster) => cluster.rcdmMapping.rcdmType));
  const mergedTypes = RCDM_TYPES.map((type) => type.type).filter((type) => !clusterTypeSet.has(type));
  return {
    silhouetteInterpretation: `Highest silhouette occurs at k=${bestSilhouette.k} (${bestSilhouette.silhouetteScore}). Primary reporting remains fixed at k=4 per spec.`,
    rcdmComparison: mergedTypes.length
      ? `The data-driven solution recovers ${clusterTypeSet.size} of the 5 RCDM archetypes directly. Missing standalone types: ${mergedTypes.join(', ')}.`
      : 'All five RCDM archetypes appear as nearest-neighbor concepts across the four clusters, implying one practical merge rather than a complete miss.',
    venueHighlights: Object.entries(venueDistribution).map(([venue, data]) => {
      const top = Object.entries(data.clusters).sort((a, b) => b[1].count - a[1].count)[0];
      return `${venue}: cluster ${top[0]} accounts for ${top[1].share}% of ${data.totalSessions} sessions.`;
    }),
    sailorDecisionTree: decisionTree.rules
      .sort((a, b) => b.size - a.size)
      .slice(0, 6)
      .map((rule) => `${rule.path.length ? rule.path.join(' AND ') : 'Always'} => Cluster ${rule.prediction} (${(rule.purity * 100).toFixed(0)}% purity, n=${rule.size})`),
  };
}

function imputeMissingSessions(sessions) {
  const available = sessions.filter((session) => session.features);
  if (!available.length) {
    throw new Error('No sessions with computed features were available for imputation.');
  }
  const globalMeans = objectFromKeys(
    FEATURE_KEYS,
    FEATURE_KEYS.map((key) => average(available.map((session) => session.features[key]).filter(finiteNumber))),
  );
  for (const session of sessions) {
    if (session.features) continue;
    const prefix = session.filename.slice(0, 4);
    const companion = available.find((candidate) => candidate.filename !== session.filename && candidate.filename.startsWith(prefix));
    const source = companion?.features ?? globalMeans;
    session.features = { ...source };
    session.imputation = {
      ...session.imputation,
      strategy: companion ? `same-date companion session ${companion.filename}` : 'global feature means',
      sourceFilename: companion?.filename ?? null,
    };
    if ((!session.venue || session.venue === 'Other') && companion) session.venue = companion.venue;
  }
}

function renderHtml(results) {
  const reportData = JSON.stringify(results).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Wind Clustering Analysis</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg: #f6efe4;
      --panel: rgba(255,255,255,0.82);
      --ink: #19252c;
      --muted: #59666d;
      --line: rgba(25,37,44,0.12);
      --accent: #0f766e;
      --accent-2: #b45309;
      --accent-3: #1d4ed8;
      --cluster-0: #0f766e;
      --cluster-1: #b45309;
      --cluster-2: #1d4ed8;
      --cluster-3: #b91c1c;
      --shadow: 0 18px 44px rgba(25,37,44,0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at 12% 8%, rgba(15,118,110,0.16), transparent 25%),
        radial-gradient(circle at 92% 4%, rgba(180,83,9,0.16), transparent 24%),
        linear-gradient(180deg, #fdfaf5 0%, var(--bg) 100%);
    }
    main {
      width: min(1500px, calc(100vw - 28px));
      margin: 20px auto 60px;
    }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 20px;
      box-shadow: var(--shadow);
      margin: 16px 0;
      backdrop-filter: blur(8px);
    }
    h1, h2, h3 { margin: 0 0 12px; }
    h1 { font-size: 2.3rem; }
    h2 { font-size: 1.35rem; }
    p, li, td, th { line-height: 1.45; }
    p, li { color: var(--muted); }
    .meta, .grid-2, .grid-3, .cluster-grid {
      display: grid;
      gap: 16px;
    }
    .meta { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    .grid-2 { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }
    .grid-3 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .cluster-grid { grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); }
    .card {
      background: rgba(255,255,255,0.8);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.93rem;
    }
    th, td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th { background: #faf5ed; position: sticky; top: 0; }
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .pill {
      display: inline-block;
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 0.8rem;
      background: rgba(15,118,110,0.12);
      color: var(--accent);
      margin-right: 6px;
      margin-bottom: 6px;
    }
    canvas {
      width: 100%;
      height: 340px;
    }
    .small { font-size: 0.88rem; color: var(--muted); }
    .cluster-card h3 { margin-bottom: 8px; }
    .tree-rule {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.86rem;
      padding: 8px 10px;
      background: rgba(25,37,44,0.04);
      border-radius: 10px;
      border: 1px solid var(--line);
      margin: 8px 0;
      color: var(--ink);
    }
    svg text {
      font-size: 9px;
      fill: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    @media (max-width: 720px) {
      h1 { font-size: 1.8rem; }
      section { padding: 16px; }
    }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Wind Clustering & Types of Day</h1>
      <p>All 95 sessions were analyzed using the platform parser, strategy <strong>E</strong> wind-gating, the calibrated core metrics from the prior study, and fresh derived features for clustering. Time-based derived metrics use a gap-clamped active-time axis so long logging gaps do not distort within-session structure.</p>
      <div class="meta">
        <div class="card"><strong>Generated</strong><br>${escapeHtml(results.generatedAt)}</div>
        <div class="card"><strong>Files</strong><br>${results.filesAnalyzed}</div>
        <div class="card"><strong>Primary k</strong><br>${results.primaryK}</div>
        <div class="card"><strong>Feature Count</strong><br>${results.featureKeys.length}</div>
      </div>
    </section>

    <section>
      <h2>Silhouette Analysis</h2>
      <div class="grid-2">
        <div class="card"><canvas id="silhouette-chart"></canvas></div>
        <div class="card">
          <p>${escapeHtml(results.analysis.silhouetteInterpretation)}</p>
          <div id="silhouette-table"></div>
        </div>
      </div>
    </section>

    <section>
      <h2>PCA Map</h2>
      <div class="grid-2">
        <div class="card"><canvas id="pca-chart"></canvas></div>
        <div class="card">
          <h3>PC Loadings</h3>
          <div class="table-wrap"><table id="loadings-table"></table></div>
        </div>
      </div>
    </section>

    <section>
      <h2>Cluster Profiles</h2>
      <div class="cluster-grid" id="cluster-cards"></div>
    </section>

    <section>
      <h2>Venue Distribution</h2>
      <div class="grid-2">
        <div class="card"><canvas id="venue-chart"></canvas></div>
        <div class="card">
          ${results.analysis.venueHighlights.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
        </div>
      </div>
    </section>

    <section>
      <h2>Decision Boundaries</h2>
      <div class="grid-2">
        <div class="card">
          <h3>Simple Sailor Decision Tree</h3>
          <div id="decision-tree-rules"></div>
        </div>
        <div class="card">
          <h3>Cluster to RCDM Mapping</h3>
          <div class="table-wrap"><table id="rcdm-table"></table></div>
        </div>
      </div>
    </section>

    <section>
      <h2>Hierarchical Validation</h2>
      <p class="small">Average-linkage dendrogram on normalized 18-feature vectors.</p>
      <div class="card" id="dendrogram"></div>
    </section>

    <section>
      <h2>Per-Session Assignments</h2>
      <div class="table-wrap"><table id="sessions-table"></table></div>
    </section>
  </main>

  <script>
    const REPORT = ${reportData};
    const COLORS = ['#0f766e', '#b45309', '#1d4ed8', '#b91c1c'];
    const ctx = (id) => document.getElementById(id).getContext('2d');
    const fmt = (value, digits = 3) => value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits);

    renderSilhouette();
    renderLoadings();
    renderPca();
    renderClusters();
    renderVenueChart();
    renderDecisionRules();
    renderRcdmTable();
    renderDendrogram();
    renderSessionsTable();

    function renderSilhouette() {
      const data = Object.values(REPORT.silhouette).sort((a, b) => a.k - b.k);
      new Chart(ctx('silhouette-chart'), {
        type: 'line',
        data: {
          labels: data.map(d => 'k=' + d.k),
          datasets: [{
            label: 'Silhouette Score',
            data: data.map(d => d.silhouetteScore),
            borderColor: '#0f766e',
            backgroundColor: 'rgba(15,118,110,0.15)',
            fill: true,
            tension: 0.25,
            pointRadius: 4
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: false } } }
      });
      const rows = data.map(d => '<tr><td>' + d.k + '</td><td>' + fmt(d.silhouetteScore, 4) + '</td><td>' + fmt(d.inertia, 2) + '</td></tr>').join('');
      document.getElementById('silhouette-table').innerHTML = '<div class="table-wrap"><table><thead><tr><th>k</th><th>Silhouette</th><th>Inertia</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function renderLoadings() {
      const rows = REPORT.pca.components.map(component => {
        const cells = ['<td>' + component.component + '</td>'].concat(
          REPORT.featureKeys.map(key => '<td>' + fmt(component.loadings[key], 3) + '</td>')
        );
        return '<tr>' + cells.join('') + '</tr>';
      }).join('');
      document.getElementById('loadings-table').innerHTML =
        '<thead><tr><th>Component</th>' + REPORT.featureKeys.map(key => '<th>' + REPORT.featureMeta[key].label + '</th>').join('') + '</tr></thead>' +
        '<tbody>' + rows + '</tbody>';
    }

    function renderPca() {
      const datasets = [0,1,2,3].map(clusterId => ({
        label: 'Cluster ' + clusterId,
        data: REPORT.sessions.filter(s => s.clusterId === clusterId).map(s => ({ x: s.pca.pc1, y: s.pca.pc2, label: s.filename + ' (' + s.venue + ')' })),
        backgroundColor: COLORS[clusterId]
      }));
      new Chart(ctx('pca-chart'), {
        type: 'scatter',
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              callbacks: {
                label: (context) => context.raw.label + ': (' + fmt(context.raw.x, 2) + ', ' + fmt(context.raw.y, 2) + ')'
              }
            }
          },
          scales: {
            x: { title: { display: true, text: 'PC1' } },
            y: { title: { display: true, text: 'PC2' } }
          }
        }
      });
    }

    function renderClusters() {
      const mount = document.getElementById('cluster-cards');
      REPORT.clusterCentroids.forEach(cluster => {
        const card = document.createElement('div');
        card.className = 'card cluster-card';
        const radarId = 'radar-' + cluster.id;
        const reps = cluster.representativeSessions.map(s => s.filename + ' (' + s.venue + ')').join(', ');
        const distinct = cluster.distinctiveFeatures.map(f => f.label + ' ' + fmt(f.zScore, 2)).join(', ');
        card.innerHTML = '<h3 style="color:' + COLORS[cluster.id] + ';">Cluster ' + cluster.id + ': ' + cluster.name + '</h3>' +
          '<p><span class="pill">' + cluster.size + ' sessions</span><span class="pill">' + cluster.rcdmMapping.rcdmType + ' / ' + cluster.rcdmMapping.spiritAnimal + '</span></p>' +
          '<p>' + cluster.description + '</p>' +
          '<p class="small"><strong>Distinctive:</strong> ' + distinct + '</p>' +
          '<p class="small"><strong>Representative:</strong> ' + reps + '</p>' +
          '<canvas id="' + radarId + '"></canvas>' +
          '<div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>Feature</th><th>z</th></tr></thead><tbody>' +
            Object.entries(cluster.normalizedCentroid).map(([key, value]) => '<tr><td>' + REPORT.featureMeta[key].label + '</td><td>' + fmt(value, 2) + '</td></tr>').join('') +
          '</tbody></table></div>';
        mount.appendChild(card);
        new Chart(ctx(radarId), {
          type: 'radar',
          data: {
            labels: REPORT.featureKeys.map(key => REPORT.featureMeta[key].label),
            datasets: [{
              label: cluster.name,
              data: REPORT.featureKeys.map(key => cluster.normalizedCentroid[key]),
              borderColor: COLORS[cluster.id],
              backgroundColor: COLORS[cluster.id] + '22'
            }]
          },
          options: { responsive: true, maintainAspectRatio: false, scales: { r: { min: -2.5, max: 2.5 } } }
        });
      });
    }

    function renderVenueChart() {
      const venues = Object.keys(REPORT.venueDistribution);
      const datasets = [0,1,2,3].map(clusterId => ({
        label: 'Cluster ' + clusterId,
        data: venues.map(venue => REPORT.venueDistribution[venue].clusters[clusterId].share),
        backgroundColor: COLORS[clusterId]
      }));
      new Chart(ctx('venue-chart'), {
        type: 'bar',
        data: { labels: venues, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { x: { stacked: true }, y: { stacked: true, max: 100, title: { display: true, text: 'Share of venue sessions (%)' } } }
        }
      });
    }

    function renderDecisionRules() {
      const mount = document.getElementById('decision-tree-rules');
      REPORT.analysis.sailorDecisionTree.forEach(rule => {
        const div = document.createElement('div');
        div.className = 'tree-rule';
        div.textContent = rule;
        mount.appendChild(div);
      });
    }

    function renderRcdmTable() {
      const table = document.getElementById('rcdm-table');
      table.innerHTML = '<thead><tr><th>Cluster</th><th>RCDM Type</th><th>Animal</th><th>Confidence Gap</th><th>Rationale</th></tr></thead><tbody>' +
        REPORT.clusterCentroids.map(cluster => '<tr><td>' + cluster.id + ' · ' + cluster.name + '</td><td>' + cluster.rcdmMapping.rcdmType + '</td><td>' + cluster.rcdmMapping.spiritAnimal + '</td><td>' + fmt(cluster.rcdmMapping.confidenceGap, 2) + '</td><td>' + cluster.rcdmMapping.rationale + '</td></tr>').join('') +
        '</tbody>';
    }

    function renderDendrogram() {
      const labels = REPORT.hierarchical.labels;
      const merges = REPORT.hierarchical.merges;
      const width = Math.max(1400, labels.length * 14);
      const height = 480;
      const margin = { top: 20, right: 10, bottom: 140, left: 40 };
      const maxDist = Math.max(...merges.map(m => m.distance), 1);
      const xMap = {};
      const yMap = {};
      labels.forEach((label, index) => {
        xMap[index] = margin.left + index * ((width - margin.left - margin.right) / Math.max(1, labels.length - 1));
        yMap[index] = height - margin.bottom;
      });
      const parts = [];
      merges.forEach(merge => {
        const leftX = xMap[merge.left];
        const rightX = xMap[merge.right];
        const leftY = yMap[merge.left];
        const rightY = yMap[merge.right];
        const y = margin.top + (1 - merge.distance / maxDist) * (height - margin.top - margin.bottom);
        parts.push('<line x1="' + leftX + '" y1="' + leftY + '" x2="' + leftX + '" y2="' + y + '" stroke="#475569" stroke-width="1"/>');
        parts.push('<line x1="' + rightX + '" y1="' + rightY + '" x2="' + rightX + '" y2="' + y + '" stroke="#475569" stroke-width="1"/>');
        parts.push('<line x1="' + leftX + '" y1="' + y + '" x2="' + rightX + '" y2="' + y + '" stroke="#475569" stroke-width="1"/>');
        xMap[merge.id] = (leftX + rightX) / 2;
        yMap[merge.id] = y;
      });
      labels.forEach((label, index) => {
        parts.push('<text x="' + xMap[index] + '" y="' + (height - margin.bottom + 12) + '" transform="rotate(60 ' + xMap[index] + ' ' + (height - margin.bottom + 12) + ')">' + escapeXml(label) + '</text>');
      });
      document.getElementById('dendrogram').innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" style="width:100%;height:auto;">' + parts.join('') + '</svg>';
    }

    function renderSessionsTable() {
      const table = document.getElementById('sessions-table');
      const headers = ['File', 'Venue', 'Cluster', 'PC1', 'PC2'].concat(REPORT.featureKeys.map(key => REPORT.featureMeta[key].label));
      const rows = REPORT.sessions.map(session => {
        const cells = [session.filename, session.venue, session.clusterId, fmt(session.pca.pc1, 2), fmt(session.pca.pc2, 2)]
          .concat(REPORT.featureKeys.map(key => fmt(session.features[key], 3)));
        return '<tr>' + cells.map(cell => '<td>' + cell + '</td>').join('') + '</tr>';
      }).join('');
      table.innerHTML = '<thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody>';
    }

    function escapeXml(value) {
      return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  </script>
</body>
</html>`;
}

function centroidOf(rows, dimensions) {
  if (!rows.length) return null;
  const centroid = Array.from({ length: dimensions }, () => 0);
  for (const row of rows) {
    for (let i = 0; i < dimensions; i += 1) centroid[i] += row[i];
  }
  return centroid.map((value) => value / rows.length);
}

function rollingTimeWindows(points, windowMs, predicate) {
  const filtered = points.filter(predicate);
  const windows = [];
  let start = 0;
  for (let end = 0; end < filtered.length; end += 1) {
    while (filtered[end]._activeTime - filtered[start]._activeTime > windowMs) start += 1;
    if (filtered[end]._activeTime - filtered[start]._activeTime >= windowMs * 0.5 && end - start + 1 >= 5) {
      windows.push(filtered.slice(start, end + 1));
    }
  }
  return windows;
}

function rollingTimeCircularMean(points, windowMs, key) {
  const filtered = points.filter((point) => finiteNumber(point[key]));
  const output = [];
  let start = 0;
  for (let end = 0; end < filtered.length; end += 1) {
    while (filtered[end]._activeTime - filtered[start]._activeTime > windowMs) start += 1;
    const slice = filtered.slice(start, end + 1);
    if (slice.length >= 5) {
      output.push({
        time: filtered[end]._activeTime,
        value: filtered[end][key],
        mean: circularMean(slice.map((point) => point[key])),
      });
    }
  }
  return output;
}

function nearestCentroid(row, centroids) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < centroids.length; i += 1) {
    const distance = squaredDistance(row, centroids[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function covarianceMatrix(rows) {
  const columns = rows[0].length;
  const matrix = Array.from({ length: columns }, () => Array.from({ length: columns }, () => 0));
  for (let i = 0; i < columns; i += 1) {
    for (let j = i; j < columns; j += 1) {
      let sum = 0;
      for (const row of rows) sum += row[i] * row[j];
      const value = sum / Math.max(1, rows.length - 1);
      matrix[i][j] = value;
      matrix[j][i] = value;
    }
  }
  return matrix;
}

function powerIteration(matrix, iterations, initialVector = null) {
  let vector = initialVector ? initialVector.slice() : Array.from({ length: matrix.length }, () => 1 / Math.sqrt(matrix.length));
  for (let iter = 0; iter < iterations; iter += 1) {
    const next = multiplyMatrixVector(matrix, vector);
    const norm = Math.sqrt(dot(next, next)) || 1;
    vector = next.map((value) => value / norm);
  }
  const mv = multiplyMatrixVector(matrix, vector);
  const value = dot(vector, mv);
  return { vector, value };
}

function deflateMatrix(matrix, vector, eigenvalue) {
  return matrix.map((row, i) => row.map((value, j) => value - eigenvalue * vector[i] * vector[j]));
}

function orthogonalUnitVector(length, against) {
  const vector = Array.from({ length }, (_, index) => (index === 0 ? 1 : 0));
  const projection = dot(vector, against);
  const residual = vector.map((value, index) => value - projection * against[index]);
  const norm = Math.sqrt(dot(residual, residual)) || 1;
  return residual.map((value) => value / norm);
}

function multiplyMatrixVector(matrix, vector) {
  return matrix.map((row) => dot(row, vector));
}

function trace(matrix) {
  let sum = 0;
  for (let i = 0; i < matrix.length; i += 1) sum += matrix[i][i];
  return sum;
}

function counts(values) {
  const output = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return output;
}

function majorityLabel(labelCounts) {
  return Number(Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0][0]);
}

function giniImpurity(labelCounts) {
  const total = Object.values(labelCounts).reduce((sum, value) => sum + value, 0) || 1;
  let impurity = 1;
  for (const value of Object.values(labelCounts)) {
    const p = value / total;
    impurity -= p * p;
  }
  return impurity;
}

function objectFromKeys(keys, values) {
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}

function linearSlope(xs, ys) {
  if (xs.length < 2 || ys.length < 2) return 0;
  const meanX = average(xs);
  const meanY = average(ys);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < xs.length; i += 1) {
    numerator += (xs[i] - meanX) * (ys[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  return denominator ? numerator / denominator : 0;
}

function detrendLinearPairs(pairs) {
  if (pairs.length < 2) return pairs.map(() => 0);
  const xs = pairs.map((pair) => pair.time);
  const ys = pairs.map((pair) => pair.value);
  const slope = linearSlope(xs, ys);
  const intercept = average(ys) - slope * average(xs);
  return pairs.map((pair) => pair.value - (slope * pair.time + intercept));
}

function autocorrelation(values, lag) {
  if (lag <= 0 || lag >= values.length) return 0;
  const mean = average(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i += 1) {
    const centered = values[i] - mean;
    denominator += centered * centered;
    if (i + lag < values.length) numerator += centered * (values[i + lag] - mean);
  }
  return denominator ? numerator / denominator : 0;
}

function unwrapAngles(values) {
  if (!values.length) return [];
  const output = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    output.push(output[i - 1] + angularDiff(values[i - 1], values[i]));
  }
  return output;
}

function circularMean(values) {
  const s = average(values.map((value) => Math.sin(value * Math.PI / 180)));
  const c = average(values.map((value) => Math.cos(value * Math.PI / 180)));
  return wrapDegrees(Math.atan2(s, c) * 180 / Math.PI);
}

function computeCircularStdDev(values) {
  if (!values.length) return 0;
  const sin = average(values.map((value) => Math.sin(value * Math.PI / 180)));
  const cos = average(values.map((value) => Math.cos(value * Math.PI / 180)));
  const r = Math.sqrt(sin * sin + cos * cos);
  if (r <= 0) return 180;
  return Math.sqrt(-2 * Math.log(r)) * 180 / Math.PI;
}

function angularDiff(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function pearson(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return 0;
  const meanX = average(xs);
  const meanY = average(ys);
  let numerator = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    numerator += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const denom = Math.sqrt(denX * denY);
  return denom ? numerator / denom : 0;
}

function squaredDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] - b[i]) ** 2;
  return sum;
}

function euclideanDistance(a, b) {
  return Math.sqrt(squaredDistance(a, b));
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

function median(values) {
  return quantile(values, 0.5);
}

function tailAverage(values, fraction, side) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const count = Math.max(1, Math.floor(sorted.length * fraction));
  return average(side === 'low' ? sorted.slice(0, count) : sorted.slice(sorted.length - count));
}

function safeRatio(numerator, denominator) {
  return finiteNumber(numerator) && finiteNumber(denominator) && denominator !== 0 ? numerator / denominator : 0;
}

function inferVenue(filename) {
  const upper = filename.toUpperCase();
  if (upper.includes('AVON') || upper.includes('AVN')) return 'Avon';
  if (upper.includes('CAGLIARI')) return 'Cagliari';
  if (upper.includes('GDYNIA')) return 'Gdynia';
  if (upper.includes('GORGE')) return 'Gorge';
  if (upper.includes('GREECE')) return 'Greece';
  if (upper.includes('HYERES')) return 'Hyeres';
  if (upper.includes('LONGBEACH')) return 'Long Beach';
  if (upper.includes('PALMA')) return 'Palma';
  return 'Other';
}

function convertSpeed(value, unit) {
  if (!finiteNumber(value)) return null;
  if (unit === 'N') return value;
  if (unit === 'M') return value * METERS_PER_SECOND_TO_KNOTS;
  if (unit === 'K') return value / 1.852;
  return value;
}

function inferDirectionFromHeading(heading, angle) {
  return wrapDegrees(heading + angle);
}

function wrapDegrees(value) {
  if (!finiteNumber(value)) return null;
  return ((value % 360) + 360) % 360;
}

function wrapDegreesSigned(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function toNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function roundNumber(value, digits = 3) {
  if (!finiteNumber(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values) {
  return [...new Set(values)];
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
