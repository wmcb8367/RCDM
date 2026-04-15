import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const DATA_DIR = '/tmp/wind-calibration/extracted';
const OUTPUT_JSON = '/tmp/wind-metrics-study/results.json';
const OUTPUT_HTML = '/tmp/wind-metrics-study/report.html';
const PARSER_PATH = '/Users/mcbrideagents/.openclaw/workspace/projects/wind-analytics-platform/lib/parsers/index.js';

const EXPECTED_FILE_COUNT = 95;
const MIN_POINTS = 20;
const HIST_BINS = 12;

const METRIC_LABELS = {
  puffiness: ['Steady', 'Moderate', 'Puffy', 'Very Puffy'],
  shiftiness: ['Locked In', 'Moderate', 'Shifty', 'Very Shifty'],
};

const TRIMMING_STRATEGIES = {
  A: {
    code: 'A',
    name: 'No trimming',
    description: 'Use the full file.',
    select(points) {
      return points.slice();
    },
  },
  B: {
    code: 'B',
    name: 'Trim 10% each end',
    description: 'Keep the middle 80% of points.',
    select(points) {
      return trimFraction(points, 0.1);
    },
  },
  C: {
    code: 'C',
    name: 'Trim 15% each end',
    description: 'Keep the middle 70% of points.',
    select(points) {
      return trimFraction(points, 0.15);
    },
  },
  D: {
    code: 'D',
    name: 'Speed-gated',
    description: 'Only points where boatSpeedKts > 3.',
    select(points) {
      return points.filter((point) => finiteNumber(point.boatSpeedKts) && point.boatSpeedKts > 3);
    },
  },
  E: {
    code: 'E',
    name: 'Wind-gated',
    description: 'Only points where windSpeedKts > 3.',
    select(points) {
      return points.filter((point) => finiteNumber(point.windSpeedKts) && point.windSpeedKts > 3);
    },
  },
};

const PUFFINESS_METRICS = {
  cv: {
    key: 'cv',
    name: 'CV',
    shortName: 'CV',
    kind: 'puffiness',
    unit: 'ratio',
    higherIsMoreVariable: true,
    compute(points) {
      const values = numericSeries(points, 'windSpeedKts');
      if (values.length < MIN_POINTS) return null;
      const mean = average(values);
      if (!mean) return null;
      return safeRatio(stdDev(values), mean);
    },
  },
  iqrRatio: {
    key: 'iqrRatio',
    name: 'IQR Ratio',
    shortName: 'IQR Ratio',
    kind: 'puffiness',
    unit: 'ratio',
    higherIsMoreVariable: true,
    compute(points) {
      const values = numericSeries(points, 'windSpeedKts');
      if (values.length < MIN_POINTS) return null;
      const median = quantile(values, 0.5);
      if (!median) return null;
      return safeRatio(quantile(values, 0.75) - quantile(values, 0.25), median);
    },
  },
  gustFactor: {
    key: 'gustFactor',
    name: 'Gust Factor',
    shortName: 'Gust Factor',
    kind: 'puffiness',
    unit: 'ratio',
    higherIsMoreVariable: true,
    compute(points) {
      const windows = rollingTimeWindows(points, 5 * 60 * 1000, (point) => finiteNumber(point.windSpeedKts));
      if (!windows.length) return null;
      const values = windows
        .map((window) => {
          const speeds = window.map((point) => point.windSpeedKts).filter(finiteNumber);
          if (speeds.length < 5) return null;
          const mean = average(speeds);
          if (!mean) return null;
          return safeRatio(Math.max(...speeds) - Math.min(...speeds), mean);
        })
        .filter(finiteNumber);
      if (!values.length) return null;
      return average(values);
    },
  },
  lullPeakRatio: {
    key: 'lullPeakRatio',
    name: 'Lull-to-Peak Ratio',
    shortName: 'Lull-Peak',
    kind: 'puffiness',
    unit: 'ratio',
    higherIsMoreVariable: true,
    compute(points) {
      const values = numericSeries(points, 'windSpeedKts');
      if (values.length < MIN_POINTS) return null;
      const median = quantile(values, 0.5);
      if (!median) return null;
      const lowTail = tailAverage(values, 0.1, 'low');
      const highTail = tailAverage(values, 0.1, 'high');
      if (!finiteNumber(lowTail) || !finiteNumber(highTail)) return null;
      return safeRatio(highTail - lowTail, median);
    },
  },
  shortTermVariance: {
    key: 'shortTermVariance',
    name: 'Short-Term Variance',
    shortName: '30s Avg Std Dev',
    kind: 'puffiness',
    unit: 'kts',
    higherIsMoreVariable: true,
    compute(points) {
      const values = rollingTimeMean(points, 30 * 1000, 'windSpeedKts');
      if (values.length < MIN_POINTS) return null;
      return stdDev(values);
    },
  },
  detrendedCv: {
    key: 'detrendedCv',
    name: 'Detrended CV',
    shortName: 'Detrended CV',
    kind: 'puffiness',
    unit: 'ratio',
    higherIsMoreVariable: true,
    compute(points) {
      const pairs = numericPairs(points, 'windSpeedKts');
      if (pairs.length < MIN_POINTS) return null;
      const residuals = detrendLinear(pairs).map((value) => Math.abs(value));
      const mean = average(pairs.map((pair) => pair.value));
      if (!mean) return null;
      return safeRatio(stdDev(residuals), mean);
    },
  },
};

const SHIFTINESS_METRICS = {
  circularStdDev: {
    key: 'circularStdDev',
    name: 'Circular Std Dev',
    shortName: 'Circ Std Dev',
    kind: 'shiftiness',
    unit: 'deg',
    higherIsMoreVariable: true,
    compute(points) {
      const values = numericSeries(points, 'windDirection');
      if (values.length < MIN_POINTS) return null;
      return circularStdDev(values);
    },
  },
  medianAbsAngularDeviation: {
    key: 'medianAbsAngularDeviation',
    name: 'Median Abs Angular Deviation',
    shortName: 'Median Abs Dev',
    kind: 'shiftiness',
    unit: 'deg',
    higherIsMoreVariable: true,
    compute(points) {
      const values = numericSeries(points, 'windDirection');
      if (values.length < MIN_POINTS) return null;
      const center = circularMean(values);
      return quantile(values.map((value) => Math.abs(angularDiff(center, value))), 0.5);
    },
  },
  rollingShiftFrequency: {
    key: 'rollingShiftFrequency',
    name: 'Rolling Shift Frequency',
    shortName: 'Shifts/hr',
    kind: 'shiftiness',
    unit: 'countPerHour',
    higherIsMoreVariable: true,
    compute(points) {
      const sequence = points
        .map((point) => ({ time: point._time, value: point.windDirection }))
        .filter((entry) => finiteNumber(entry.time) && finiteNumber(entry.value));
      if (sequence.length < MIN_POINTS) return null;
      let count = 0;
      let last = sequence[0].value;
      for (let index = 1; index < sequence.length; index += 1) {
        const current = sequence[index].value;
        if (Math.abs(angularDiff(last, current)) > 5) count += 1;
        last = current;
      }
      const hours = durationHours(sequence.map((entry) => entry.time));
      return hours > 0 ? count / hours : null;
    },
  },
  detrendedCircularStdDev: {
    key: 'detrendedCircularStdDev',
    name: 'Detrended Circular Std Dev',
    shortName: 'Detrended Circ SD',
    kind: 'shiftiness',
    unit: 'deg',
    higherIsMoreVariable: true,
    compute(points) {
      const pairs = numericPairs(points, 'windDirection');
      if (pairs.length < MIN_POINTS) return null;
      const unwrapped = unwrapAngles(pairs.map((pair) => pair.value));
      const trendPairs = pairs.map((pair, index) => ({ time: pair.time, value: unwrapped[index] }));
      const residuals = detrendLinear(trendPairs);
      const wrappedResiduals = residuals.map((value) => wrapDegreesSigned(value));
      return circularStdDev(wrappedResiduals.map((value) => (value + 360) % 360));
    },
  },
  oscillationIndex: {
    key: 'oscillationIndex',
    name: 'Oscillation Index',
    shortName: 'Zero Cross/hr',
    kind: 'shiftiness',
    unit: 'countPerHour',
    higherIsMoreVariable: true,
    compute(points) {
      const means = rollingTimeCircularMean(points, 2 * 60 * 1000, 'windDirection');
      if (means.length < MIN_POINTS) return null;
      let crossings = 0;
      let lastSign = 0;
      for (const entry of means) {
        const delta = angularDiff(entry.mean, entry.value);
        const sign = Math.abs(delta) < 1e-6 ? 0 : Math.sign(delta);
        if (sign && lastSign && sign !== lastSign) crossings += 1;
        if (sign) lastSign = sign;
      }
      const hours = durationHours(means.map((entry) => entry.time));
      return hours > 0 ? crossings / hours : null;
    },
  },
  phasePersistence: {
    key: 'phasePersistence',
    name: 'Phase Persistence',
    shortName: 'Persistence Min',
    kind: 'shiftiness',
    unit: 'minutes',
    higherIsMoreVariable: false,
    compute(points) {
      const means = rollingTimeCircularMean(points, 2 * 60 * 1000, 'windDirection');
      if (means.length < MIN_POINTS) return null;
      const phases = [];
      let currentSign = 0;
      let phaseStart = means[0].time;
      for (const entry of means) {
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
      if (!phases.length) return null;
      return average(phases);
    },
  },
};

const ALL_METRICS = { ...PUFFINESS_METRICS, ...SHIFTINESS_METRICS };

const BASELINE_THRESHOLDS = {
  cv: [0.1, 0.2, 0.35],
  circularStdDev: [5, 12, 25],
};

async function main() {
  const parserModule = await import(pathToFileURL(PARSER_PATH).href);
  const { parseNmea } = parserModule;
  if (typeof parseNmea !== 'function') {
    throw new Error(`parseNmea not found in ${PARSER_PATH}`);
  }

  const filenames = fs
    .readdirSync(DATA_DIR)
    .filter((name) => name.endsWith('.txt'))
    .sort((a, b) => a.localeCompare(b));

  if (filenames.length !== EXPECTED_FILE_COUNT) {
    throw new Error(`Expected ${EXPECTED_FILE_COUNT} files, found ${filenames.length}`);
  }

  const fileResults = [];
  for (const [index, filename] of filenames.entries()) {
    console.log(`[${index + 1}/${filenames.length}] Parsing ${filename}`);
    const rawText = fs.readFileSync(path.join(DATA_DIR, filename), 'utf8');
    const parsed = parseNmea(rawText);
    const points = normalizePoints(parsed.environmentalPoints ?? []);
    const venue = inferVenue(filename);
    const perStrategy = {};

    for (const strategy of Object.values(TRIMMING_STRATEGIES)) {
      const selected = strategy.select(points);
      perStrategy[strategy.code] = analyzeSelection(selected);
    }

    fileResults.push({
      filename,
      venue,
      pointCount: points.length,
      durationMinutes: points.length ? roundNumber((points.at(-1)._time - points[0]._time) / 60000, 2) : null,
      startTimestamp: points[0]?.timestamp ?? null,
      endTimestamp: points.at(-1)?.timestamp ?? null,
      strategies: perStrategy,
    });
  }

  const derived = deriveAggregates(fileResults);
  const results = {
    generatedAt: new Date().toISOString(),
    parserPath: PARSER_PATH,
    dataDir: DATA_DIR,
    expectedFileCount: EXPECTED_FILE_COUNT,
    filesAnalyzed: fileResults.length,
    strategies: Object.fromEntries(Object.values(TRIMMING_STRATEGIES).map((strategy) => [
      strategy.code,
      { code: strategy.code, name: strategy.name, description: strategy.description },
    ])),
    metrics: Object.fromEntries(Object.values(ALL_METRICS).map((metric) => [
      metric.key,
      {
        key: metric.key,
        name: metric.name,
        shortName: metric.shortName,
        kind: metric.kind,
        unit: metric.unit,
        higherIsMoreVariable: metric.higherIsMoreVariable,
        baselineThresholds: BASELINE_THRESHOLDS[metric.key] ?? null,
        calibratedThresholds: derived.calibratedThresholds[metric.key],
      },
    ])),
    fileResults,
    summaries: derived,
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2));
  fs.writeFileSync(OUTPUT_HTML, renderHtmlReport(results));
  console.log(`Wrote ${OUTPUT_JSON}`);
  console.log(`Wrote ${OUTPUT_HTML}`);
}

function analyzeSelection(points) {
  const metrics = {};
  for (const metric of Object.values(ALL_METRICS)) {
    const value = metric.compute(points);
    metrics[metric.key] = finiteNumber(value) ? roundNumber(value, 6) : null;
  }
  return {
    selectedPointCount: points.length,
    durationMinutes: points.length ? roundNumber((points.at(-1)._time - points[0]._time) / 60000, 2) : null,
    metrics,
  };
}

function deriveAggregates(fileResults) {
  const calibratedThresholds = {};
  for (const metric of Object.values(ALL_METRICS)) {
    const primaryValues = metricValues(fileResults, 'D', metric.key);
    calibratedThresholds[metric.key] = primaryValues.length >= 4
      ? [
          roundNumber(quantile(primaryValues, 0.35), 6),
          roundNumber(quantile(primaryValues, 0.65), 6),
          roundNumber(quantile(primaryValues, 0.85), 6),
        ]
      : null;
  }

  const perMetricPrimary = {};
  const perMetricStrategyDistributions = {};
  for (const metric of Object.values(ALL_METRICS)) {
    perMetricPrimary[metric.key] = buildMetricDistribution(fileResults, metric, 'D', calibratedThresholds[metric.key]);
    perMetricStrategyDistributions[metric.key] = Object.fromEntries(
      Object.keys(TRIMMING_STRATEGIES).map((strategyCode) => [
        strategyCode,
        buildMetricDistribution(fileResults, metric, strategyCode, calibratedThresholds[metric.key]),
      ]),
    );
  }

  const venueComparison = {};
  for (const venue of unique(fileResults.map((file) => file.venue))) {
    const venueFiles = fileResults.filter((file) => file.venue === venue);
    venueComparison[venue] = Object.fromEntries(
      Object.values(ALL_METRICS).map((metric) => [
        metric.key,
        roundNumber(average(metricValues(venueFiles, 'D', metric.key)), 6),
      ]),
    );
  }

  const trimmingComparison = {};
  for (const strategyCode of Object.keys(TRIMMING_STRATEGIES)) {
    trimmingComparison[strategyCode] = Object.fromEntries(
      Object.values(ALL_METRICS).map((metric) => [
        metric.key,
        {
          mean: roundNumber(average(metricValues(fileResults, strategyCode, metric.key)), 6),
          median: roundNumber(quantile(metricValues(fileResults, strategyCode, metric.key), 0.5), 6),
          validFiles: metricValues(fileResults, strategyCode, metric.key).length,
        },
      ]),
    );
  }

  const correlationMatrix = buildCorrelationMatrix(fileResults);
  const recommendations = buildRecommendations(fileResults, calibratedThresholds, venueComparison);

  return {
    calibratedThresholds,
    perMetricPrimary,
    perMetricStrategyDistributions,
    venueComparison,
    trimmingComparison,
    correlationMatrix,
    recommendations,
  };
}

function buildMetricDistribution(fileResults, metric, strategyCode, thresholds) {
  const values = metricValues(fileResults, strategyCode, metric.key);
  return {
    strategyCode,
    count: values.length,
    mean: roundNumber(average(values), 6),
    median: roundNumber(quantile(values, 0.5), 6),
    stdDev: roundNumber(stdDev(values), 6),
    min: roundNumber(values.length ? Math.min(...values) : null, 6),
    max: roundNumber(values.length ? Math.max(...values) : null, 6),
    quartiles: values.length
      ? {
          p25: roundNumber(quantile(values, 0.25), 6),
          p75: roundNumber(quantile(values, 0.75), 6),
        }
      : null,
    histogram: histogram(values, HIST_BINS),
    box: values.length ? boxPlot(values) : null,
    labelBuckets: thresholds ? bucketPercentages(values, thresholds, metric.kind, metric.higherIsMoreVariable) : null,
  };
}

function buildCorrelationMatrix(fileResults) {
  const metricKeys = Object.keys(ALL_METRICS);
  return metricKeys.map((rowKey) => ({
    metric: rowKey,
    correlations: Object.fromEntries(metricKeys.map((colKey) => [colKey, roundNumber(pearsonForFiles(fileResults, rowKey, colKey, 'D'), 6)])),
  }));
}

function buildRecommendations(fileResults, calibratedThresholds, venueComparison) {
  const puffinessWinner = chooseMetric(['cv', 'iqrRatio', 'gustFactor', 'lullPeakRatio', 'shortTermVariance', 'detrendedCv'], fileResults, venueComparison);
  const shiftinessWinner = chooseMetric(['circularStdDev', 'medianAbsAngularDeviation', 'rollingShiftFrequency', 'detrendedCircularStdDev', 'oscillationIndex', 'phasePersistence'], fileResults, venueComparison);

  const trimmingWinner = chooseBestTrimmingStrategy(fileResults);

  return {
    bestPuffinessMetric: {
      metricKey: puffinessWinner.metricKey,
      thresholds: calibratedThresholds[puffinessWinner.metricKey],
      reasoning: puffinessWinner.reasoning,
    },
    bestShiftinessMetric: {
      metricKey: shiftinessWinner.metricKey,
      thresholds: calibratedThresholds[shiftinessWinner.metricKey],
      reasoning: shiftinessWinner.reasoning,
    },
    bestTrimmingStrategy: trimmingWinner,
  };
}

function chooseMetric(metricKeys, fileResults, venueComparison) {
  const orderedVenues = ['Cagliari', 'Palma', 'Hyeres', 'Long Beach', 'Avon', 'Greece', 'Gdynia', 'Gorge'];
  const rankings = metricKeys.map((metricKey) => {
    const metric = ALL_METRICS[metricKey];
    const values = metricValues(fileResults, 'D', metricKey);
    const coverage = values.length;
    const spread = safeRatio(stdDev(values), average(values) || 1) || 0;
    const strategyGap = Math.abs(
      (average(metricValues(fileResults, 'A', metricKey)) || 0) -
      (average(metricValues(fileResults, 'D', metricKey)) || 0),
    );
    let venueOrderScore = 0;
    for (let index = 1; index < orderedVenues.length; index += 1) {
      const prev = venueComparison[orderedVenues[index - 1]]?.[metricKey];
      const current = venueComparison[orderedVenues[index]]?.[metricKey];
      if (!finiteNumber(prev) || !finiteNumber(current)) continue;
      if (metric.higherIsMoreVariable ? current >= prev : current <= prev) venueOrderScore += 1;
    }
    const score = coverage * 0.05 + spread * 2 + strategyGap * 0.1 + venueOrderScore;
    return { metricKey, coverage, spread, strategyGap, venueOrderScore, score };
  }).sort((a, b) => b.score - a.score);

  const winner = rankings[0];
  return {
    metricKey: winner.metricKey,
    reasoning: `Chosen for strongest combination of coverage (${winner.coverage} files), distribution spread (${roundNumber(winner.spread, 3)} normalized), harbor sensitivity gap (${roundNumber(winner.strategyGap, 3)}), and venue ordering signal (${winner.venueOrderScore}/7 ordered comparisons).`,
  };
}

function chooseBestTrimmingStrategy(fileResults) {
  const baseCoverage = average(fileResults.map((file) => file.strategies.A.selectedPointCount)) || 1;
  const baseCv = average(metricValues(fileResults, 'A', 'cv')) || 0;
  const baseCsd = average(metricValues(fileResults, 'A', 'circularStdDev')) || 0;
  const candidates = Object.keys(TRIMMING_STRATEGIES).map((strategyCode) => {
    const meanCv = average(metricValues(fileResults, strategyCode, 'cv')) || 0;
    const meanCsd = average(metricValues(fileResults, strategyCode, 'circularStdDev')) || 0;
    const coverage = average(fileResults.map((file) => file.strategies[strategyCode].selectedPointCount)) || 0;
    const coverageRatio = coverage / baseCoverage;
    const cvReduction = baseCv - meanCv;
    const csdReduction = baseCsd - meanCsd;
    const domainPrior = strategyCode === 'D' ? 0.04 : strategyCode === 'E' ? 0.01 : 0;
    const score = cvReduction * 1.8 + csdReduction * 0.03 + coverageRatio * 0.2 + domainPrior;
    return { strategyCode, coverage, coverageRatio, cvReduction, csdReduction, score };
  }).sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const rationale = best.strategyCode === 'D'
    ? 'It directly keys off the boat actually sailing, which is the cleanest way to strip harbor transit.'
    : best.strategyCode === 'E'
      ? 'It directly removes calm harbor periods while preserving much more of each session than speed-gating.'
      : 'It improves baseline inflation with a simple deterministic trim that is easy to explain and reproduce.';
  return {
    strategyCode: best.strategyCode,
    reasoning: `${TRIMMING_STRATEGIES[best.strategyCode].name} preserved ${(best.coverageRatio * 100).toFixed(1)}% of points on average while reducing mean baseline CV by ${roundNumber(best.cvReduction, 3)} and mean circular std dev by ${roundNumber(best.csdReduction, 3)} versus untrimmed data. ${rationale}`,
  };
}

function renderHtmlReport(results) {
  const reportData = JSON.stringify(results).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Wind Metrics Calibration Study</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg: #f4f1e8;
      --panel: rgba(255,255,255,0.82);
      --ink: #1b2a2f;
      --muted: #5d6b70;
      --accent: #0e7490;
      --accent-2: #c2410c;
      --line: rgba(27,42,47,0.12);
      --shadow: 0 20px 50px rgba(14, 27, 36, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(14,116,144,0.16), transparent 30%),
        radial-gradient(circle at top right, rgba(194,65,12,0.12), transparent 26%),
        linear-gradient(180deg, #fcfbf7 0%, var(--bg) 100%);
    }
    main {
      width: min(1500px, calc(100vw - 32px));
      margin: 24px auto 80px;
    }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
      padding: 20px;
      margin: 18px 0;
      backdrop-filter: blur(10px);
    }
    h1, h2, h3 { margin: 0 0 12px; }
    h1 { font-size: 2.2rem; }
    h2 { font-size: 1.35rem; }
    p, li { color: var(--muted); line-height: 1.5; }
    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .card {
      padding: 12px 14px;
      border-radius: 12px;
      background: rgba(255,255,255,0.8);
      border: 1px solid var(--line);
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 18px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 18px;
    }
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.92rem;
      background: rgba(255,255,255,0.68);
    }
    th, td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      background: #f8f4ec;
      z-index: 1;
    }
    canvas {
      width: 100%;
      height: 320px;
    }
    .small { font-size: 0.88rem; color: var(--muted); }
    .recommendation {
      border-left: 4px solid var(--accent);
      padding-left: 14px;
      margin: 14px 0;
    }
    .pill {
      display: inline-block;
      padding: 4px 9px;
      border-radius: 999px;
      background: rgba(14,116,144,0.12);
      color: var(--accent);
      margin-right: 8px;
      font-size: 0.84rem;
    }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Wind Metrics Calibration Study</h1>
      <p>Calibration run over ${results.filesAnalyzed} NMEA logs using the platform parser at <code>${results.parserPath}</code>. Primary comparisons use strategy <strong>D</strong> (speed-gated &gt; 3 kts), with untrimmed <strong>A</strong> shown alongside to quantify harbor inflation.</p>
      <div class="meta">
        <div class="card"><strong>Generated</strong><br>${escapeHtml(results.generatedAt)}</div>
        <div class="card"><strong>Dataset</strong><br>${escapeHtml(results.dataDir)}</div>
        <div class="card"><strong>Files</strong><br>${results.filesAnalyzed}</div>
        <div class="card"><strong>Strategies</strong><br>${Object.keys(results.strategies).join(', ')}</div>
      </div>
    </section>

    <section>
      <h2>Recommendations</h2>
      <div class="recommendation">
        <div class="pill">Puffiness</div>
        <strong>${escapeHtml(results.metrics[results.summaries.recommendations.bestPuffinessMetric.metricKey].name)}</strong>
        <p>${escapeHtml(results.summaries.recommendations.bestPuffinessMetric.reasoning)}</p>
        <p class="small">Suggested thresholds: ${formatThresholds(results.summaries.recommendations.bestPuffinessMetric.thresholds, 'puffiness')}</p>
      </div>
      <div class="recommendation">
        <div class="pill">Shiftiness</div>
        <strong>${escapeHtml(results.metrics[results.summaries.recommendations.bestShiftinessMetric.metricKey].name)}</strong>
        <p>${escapeHtml(results.summaries.recommendations.bestShiftinessMetric.reasoning)}</p>
        <p class="small">Suggested thresholds: ${formatThresholds(results.summaries.recommendations.bestShiftinessMetric.thresholds, 'shiftiness')}</p>
      </div>
      <div class="recommendation">
        <div class="pill">Trimming</div>
        <strong>${escapeHtml(results.strategies[results.summaries.recommendations.bestTrimmingStrategy.strategyCode].name)}</strong>
        <p>${escapeHtml(results.summaries.recommendations.bestTrimmingStrategy.reasoning)}</p>
      </div>
    </section>

    <section>
      <h2>Per-File Summary</h2>
      <p class="small">Each row includes file metadata plus all candidate metrics for strategy D and strategy A.</p>
      <div class="table-wrap">
        <table id="file-summary-table"></table>
      </div>
    </section>

    <section>
      <h2>Distribution Analysis</h2>
      <div class="grid-2" id="distribution-charts"></div>
    </section>

    <section>
      <h2>Venue Comparison</h2>
      <div class="grid-2">
        <div class="card"><canvas id="venue-puffiness"></canvas></div>
        <div class="card"><canvas id="venue-shiftiness"></canvas></div>
      </div>
      <div class="table-wrap" style="margin-top:16px;">
        <table id="venue-table"></table>
      </div>
    </section>

    <section>
      <h2>Trimming Strategy Comparison</h2>
      <div class="grid-2">
        <div class="card"><canvas id="trim-cv"></canvas></div>
        <div class="card"><canvas id="trim-csd"></canvas></div>
      </div>
      <div class="table-wrap" style="margin-top:16px;">
        <table id="trim-table"></table>
      </div>
    </section>

    <section>
      <h2>Correlation Matrix</h2>
      <div class="table-wrap">
        <table id="correlation-table"></table>
      </div>
    </section>
  </main>

  <script>
    const REPORT = ${reportData};

    const format = (value, digits = 3) => value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits);
    const ctx = (id) => document.getElementById(id).getContext('2d');

    renderFileSummary();
    renderDistributionCharts();
    renderVenueSection();
    renderTrimmingSection();
    renderCorrelationTable();

    function renderFileSummary() {
      const table = document.getElementById('file-summary-table');
      const puffKeys = Object.values(REPORT.metrics).filter(m => m.kind === 'puffiness').map(m => m.key);
      const shiftKeys = Object.values(REPORT.metrics).filter(m => m.kind === 'shiftiness').map(m => m.key);
      const headers = ['File', 'Venue', 'Points', 'Duration Min']
        .concat(puffKeys.flatMap(key => [REPORT.metrics[key].shortName + ' D', REPORT.metrics[key].shortName + ' A']))
        .concat(shiftKeys.flatMap(key => [REPORT.metrics[key].shortName + ' D', REPORT.metrics[key].shortName + ' A']));

      const thead = '<thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead>';
      const tbody = '<tbody>' + REPORT.fileResults.map(file => {
        const cells = [
          file.filename,
          file.venue,
          file.pointCount,
          format(file.durationMinutes, 1),
          ...puffKeys.flatMap(key => [format(file.strategies.D.metrics[key]), format(file.strategies.A.metrics[key])]),
          ...shiftKeys.flatMap(key => [format(file.strategies.D.metrics[key]), format(file.strategies.A.metrics[key])]),
        ];
        return '<tr>' + cells.map(cell => '<td>' + cell + '</td>').join('') + '</tr>';
      }).join('') + '</tbody>';
      table.innerHTML = thead + tbody;
    }

    function renderDistributionCharts() {
      const mount = document.getElementById('distribution-charts');
      Object.values(REPORT.metrics).forEach(metric => {
        const summary = REPORT.summaries.perMetricPrimary[metric.key];
        const card = document.createElement('div');
        card.className = 'card';
        const canvasId = 'dist-' + metric.key;
        card.innerHTML = '<h3>' + metric.name + '</h3><p class="small">Strategy D. Mean ' + format(summary.mean) + ', median ' + format(summary.median) + ', labels ' + formatLabels(summary.labelBuckets) + '</p><p class="small">Spread: min ' + format(summary.box?.min) + ', p25 ' + format(summary.box?.p25) + ', median ' + format(summary.box?.median) + ', p75 ' + format(summary.box?.p75) + ', max ' + format(summary.box?.max) + '</p><canvas id="' + canvasId + '"></canvas>';
        mount.appendChild(card);

        new Chart(ctx(canvasId), {
          type: 'bar',
          data: {
            labels: summary.histogram.labels,
            datasets: [{
              label: metric.shortName,
              data: summary.histogram.counts,
              backgroundColor: metric.kind === 'puffiness' ? 'rgba(14,116,144,0.65)' : 'rgba(194,65,12,0.65)',
              borderColor: metric.kind === 'puffiness' ? 'rgb(14,116,144)' : 'rgb(194,65,12)',
              borderWidth: 1,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { maxRotation: 0, autoSkip: true } },
              y: { beginAtZero: true }
            }
          }
        });
      });
    }

    function renderVenueSection() {
      const venues = Object.keys(REPORT.summaries.venueComparison);
      const puffMetric = REPORT.summaries.recommendations.bestPuffinessMetric.metricKey;
      const shiftMetric = REPORT.summaries.recommendations.bestShiftinessMetric.metricKey;
      new Chart(ctx('venue-puffiness'), {
        type: 'bar',
        data: {
          labels: venues,
          datasets: [{
            label: REPORT.metrics[puffMetric].name,
            data: venues.map(venue => REPORT.summaries.venueComparison[venue][puffMetric]),
            backgroundColor: 'rgba(14,116,144,0.7)'
          }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
      new Chart(ctx('venue-shiftiness'), {
        type: 'bar',
        data: {
          labels: venues,
          datasets: [{
            label: REPORT.metrics[shiftMetric].name,
            data: venues.map(venue => REPORT.summaries.venueComparison[venue][shiftMetric]),
            backgroundColor: 'rgba(194,65,12,0.7)'
          }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });

      const table = document.getElementById('venue-table');
      const headers = ['Venue'].concat(Object.values(REPORT.metrics).map(metric => metric.shortName));
      table.innerHTML = '<thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
        venues.map(venue => '<tr>' + ['<td>' + venue + '</td>'].concat(
          Object.values(REPORT.metrics).map(metric => '<td>' + format(REPORT.summaries.venueComparison[venue][metric.key]) + '</td>')
        ).join('') + '</tr>').join('') + '</tbody>';
    }

    function renderTrimmingSection() {
      const strategies = Object.keys(REPORT.strategies);
      new Chart(ctx('trim-cv'), {
        type: 'bar',
        data: {
          labels: strategies,
          datasets: [{
            label: 'CV mean',
            data: strategies.map(code => REPORT.summaries.trimmingComparison[code].cv.mean),
            backgroundColor: 'rgba(14,116,144,0.7)'
          }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
      new Chart(ctx('trim-csd'), {
        type: 'bar',
        data: {
          labels: strategies,
          datasets: [{
            label: 'Circular Std Dev mean',
            data: strategies.map(code => REPORT.summaries.trimmingComparison[code].circularStdDev.mean),
            backgroundColor: 'rgba(194,65,12,0.7)'
          }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });

      const table = document.getElementById('trim-table');
      const headers = ['Strategy', 'Description'].concat(Object.values(REPORT.metrics).map(metric => metric.shortName + ' Mean'));
      table.innerHTML = '<thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
        strategies.map(code => {
          const strategy = REPORT.strategies[code];
          const cells = [code, strategy.name].concat(Object.values(REPORT.metrics).map(metric => format(REPORT.summaries.trimmingComparison[code][metric.key].mean)));
          return '<tr>' + cells.map(cell => '<td>' + cell + '</td>').join('') + '</tr>';
        }).join('') + '</tbody>';
    }

    function renderCorrelationTable() {
      const table = document.getElementById('correlation-table');
      const metricKeys = Object.keys(REPORT.metrics);
      const headers = ['Metric'].concat(metricKeys.map(key => REPORT.metrics[key].shortName));
      table.innerHTML = '<thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
        REPORT.summaries.correlationMatrix.map(row => {
          const cells = [REPORT.metrics[row.metric].shortName].concat(metricKeys.map(key => format(row.correlations[key], 2)));
          return '<tr>' + cells.map(cell => '<td>' + cell + '</td>').join('') + '</tr>';
        }).join('') + '</tbody>';
    }

    function formatLabels(buckets) {
      if (!buckets) return 'n/a';
      return Object.entries(buckets).map(([label, pct]) => label + ' ' + pct.toFixed(1) + '%').join(', ');
    }
  </script>
</body>
</html>`;
}

function numericSeries(points, key) {
  return points.map((point) => point[key]).filter(finiteNumber);
}

function numericPairs(points, key) {
  return points
    .map((point) => ({ time: point._time, value: point[key] }))
    .filter((entry) => finiteNumber(entry.time) && finiteNumber(entry.value));
}

function rollingTimeWindows(points, windowMs, predicate) {
  const filtered = points.filter(predicate);
  const windows = [];
  let start = 0;
  for (let end = 0; end < filtered.length; end += 1) {
    while (filtered[end]._time - filtered[start]._time > windowMs) start += 1;
    if (filtered[end]._time - filtered[start]._time >= windowMs * 0.5 && end - start + 1 >= 5) {
      windows.push(filtered.slice(start, end + 1));
    }
  }
  return windows;
}

function rollingTimeMean(points, windowMs, key) {
  const filtered = points.filter((point) => finiteNumber(point[key]));
  const means = [];
  let start = 0;
  let runningSum = 0;
  for (let end = 0; end < filtered.length; end += 1) {
    runningSum += filtered[end][key];
    while (filtered[end]._time - filtered[start]._time > windowMs) {
      runningSum -= filtered[start][key];
      start += 1;
    }
    const count = end - start + 1;
    if (count >= 3) means.push(runningSum / count);
  }
  return means;
}

function rollingTimeCircularMean(points, windowMs, key) {
  const filtered = points.filter((point) => finiteNumber(point[key]));
  const output = [];
  let start = 0;
  for (let end = 0; end < filtered.length; end += 1) {
    while (filtered[end]._time - filtered[start]._time > windowMs) start += 1;
    const slice = filtered.slice(start, end + 1);
    if (slice.length >= 5) {
      output.push({
        time: filtered[end]._time,
        value: filtered[end][key],
        mean: circularMean(slice.map((point) => point[key])),
      });
    }
  }
  return output;
}

function normalizePoints(points) {
  return points
    .map((point) => {
      const time = Date.parse(point.timestamp);
      if (!Number.isFinite(time)) return null;
      return {
        ...point,
        windSpeedKts: toNumberOrNull(point.windSpeedKts),
        windDirection: toNumberOrNull(point.windDirection),
        boatSpeedKts: toNumberOrNull(point.boatSpeedKts),
        _time: time,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a._time - b._time);
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
  if (upper.includes('LOG')) return 'Other';
  return 'Other';
}

function trimFraction(points, fraction) {
  if (!points.length) return [];
  const trim = Math.floor(points.length * fraction);
  return points.slice(trim, Math.max(trim, points.length - trim));
}

function metricValues(fileResults, strategyCode, metricKey) {
  return fileResults
    .map((file) => file.strategies[strategyCode]?.metrics?.[metricKey])
    .filter(finiteNumber);
}

function pearsonForFiles(fileResults, metricA, metricB, strategyCode) {
  const pairs = fileResults
    .map((file) => [file.strategies[strategyCode]?.metrics?.[metricA], file.strategies[strategyCode]?.metrics?.[metricB]])
    .filter(([a, b]) => finiteNumber(a) && finiteNumber(b));
  if (pairs.length < 3) return null;
  const xs = pairs.map(([a]) => a);
  const ys = pairs.map(([, b]) => b);
  const meanX = average(xs);
  const meanY = average(ys);
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let index = 0; index < pairs.length; index += 1) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den ? num / den : null;
}

function histogram(values, bins) {
  if (!values.length) return { labels: [], counts: [] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return { labels: [formatRange(min, max)], counts: [values.length] };
  }
  const width = (max - min) / bins;
  const counts = Array.from({ length: bins }, () => 0);
  for (const value of values) {
    const rawIndex = Math.floor((value - min) / width);
    const index = Math.min(bins - 1, Math.max(0, rawIndex));
    counts[index] += 1;
  }
  const labels = counts.map((_, index) => {
    const from = min + index * width;
    const to = from + width;
    return formatRange(from, to);
  });
  return { labels, counts };
}

function boxPlot(values) {
  return {
    min: roundNumber(Math.min(...values), 6),
    p25: roundNumber(quantile(values, 0.25), 6),
    median: roundNumber(quantile(values, 0.5), 6),
    p75: roundNumber(quantile(values, 0.75), 6),
    max: roundNumber(Math.max(...values), 6),
  };
}

function bucketPercentages(values, thresholds, kind, higherIsMoreVariable = true) {
  const labels = METRIC_LABELS[kind];
  const counts = [0, 0, 0, 0];
  for (const value of values) {
    if (higherIsMoreVariable) {
      if (value < thresholds[0]) counts[0] += 1;
      else if (value < thresholds[1]) counts[1] += 1;
      else if (value < thresholds[2]) counts[2] += 1;
      else counts[3] += 1;
    } else {
      if (value > thresholds[2]) counts[0] += 1;
      else if (value > thresholds[1]) counts[1] += 1;
      else if (value > thresholds[0]) counts[2] += 1;
      else counts[3] += 1;
    }
  }
  const total = values.length || 1;
  return Object.fromEntries(labels.map((label, index) => [label, roundNumber((counts[index] / total) * 100, 2)]));
}

function durationHours(times) {
  if (!times.length) return 0;
  return (times.at(-1) - times[0]) / 3600000;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values) {
  if (!values.length) return null;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
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

function tailAverage(values, fraction, side) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const count = Math.max(1, Math.floor(sorted.length * fraction));
  const slice = side === 'low' ? sorted.slice(0, count) : sorted.slice(sorted.length - count);
  return average(slice);
}

function detrendLinear(pairs) {
  const meanX = average(pairs.map((pair) => pair.time));
  const meanY = average(pairs.map((pair) => pair.value));
  let numerator = 0;
  let denominator = 0;
  for (const pair of pairs) {
    numerator += (pair.time - meanX) * (pair.value - meanY);
    denominator += (pair.time - meanX) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;
  return pairs.map((pair) => pair.value - (slope * pair.time + intercept));
}

function unwrapAngles(values) {
  if (!values.length) return [];
  const output = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    const prev = output[index - 1];
    const raw = values[index];
    const delta = angularDiff(prev % 360, raw);
    output.push(prev + delta);
  }
  return output;
}

function circularMean(values) {
  const rad = values.map((value) => value * Math.PI / 180);
  const sin = average(rad.map((angle) => Math.sin(angle)));
  const cos = average(rad.map((angle) => Math.cos(angle)));
  return ((Math.atan2(sin, cos) * 180 / Math.PI) + 360) % 360;
}

function angularDiff(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function circularStdDev(values) {
  const rad = values.map((value) => value * Math.PI / 180);
  const sin = average(rad.map((angle) => Math.sin(angle)));
  const cos = average(rad.map((angle) => Math.cos(angle)));
  const r = Math.sqrt(sin * sin + cos * cos);
  if (r <= 0) return 180;
  return Math.sqrt(-2 * Math.log(r)) * 180 / Math.PI;
}

function unique(values) {
  return [...new Set(values)];
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function toNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function safeRatio(numerator, denominator) {
  if (!finiteNumber(numerator) || !finiteNumber(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function wrapDegreesSigned(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function roundNumber(value, digits = 3) {
  if (!finiteNumber(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatRange(min, max) {
  return `${roundNumber(min, 2)}-${roundNumber(max, 2)}`;
}

function formatThresholds(thresholds, kind) {
  if (!thresholds) return 'n/a';
  const labels = METRIC_LABELS[kind];
  return `${labels[0]} < ${thresholds[0].toFixed(3)}, ${labels[1]} < ${thresholds[1].toFixed(3)}, ${labels[2]} < ${thresholds[2].toFixed(3)}, ${labels[3]} above`;
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
