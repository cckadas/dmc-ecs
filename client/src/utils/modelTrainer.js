// =============================================================================
// Training the prediction model (TensorFlow.js)
//
// For each of the two step times (utils/predictionModel.js):
//   1. Split by time, as the accuracy check does: the moment the newest 20% of
//      finished orders had their payments verified. The model learns from the
//      records finished before it, and is tested on those started after it.
//   2. Train a small network (8 hidden units) on the older records.
//   3. Compare it with the statistics on the newer records. It's put in use
//      only if it learned from at least 30 records and was closer on average.
//
// The TensorFlow.js libraries are passed in ({ tf, tfl }), so they load only
// when someone trains the model (services/modelService.js), and the tests can
// run the same code in Node.
// =============================================================================

import { HIDDEN_UNITS, MODEL_KEYS, MODEL_MIN_RECORDS, buildSpec, encode, labelingRecords, percentile, predictValue, scoreOf, statisticsFor, supplierRecords } from './predictionModel.js'
import { buildStageStatistics } from './predictions.js'
import { TEST_SHARE, finishedForAccuracy } from './analytics.js'

const SEED = 2026
const MIN_TEST_RECORDS = 5
const EPOCHS_PER_RUN = 50


// Fits one network and returns its weights as plain arrays. It learns to
// minimise the days it's off (absolute error, as the accuracy check measures),
// so a few very late deliveries don't pull it around, and a firm penalty on
// large weights keeps it steady on a small history.
export async function trainNetwork({ tf, tfl }, inputs, targets, { epochs = 800, seed = SEED, onProgress } = {}) {
  const network = tfl.sequential({
    layers: [
      tfl.layers.dense({
        units: HIDDEN_UNITS,
        activation: 'relu',
        inputShape: [inputs[0].length],
        kernelInitializer: tfl.initializers.glorotUniform({ seed }),
        kernelRegularizer: tfl.regularizers.l2({ l2: 0.01 }),
      }),
      tfl.layers.dense({ units: 1, kernelInitializer: tfl.initializers.glorotUniform({ seed: seed + 1 }) }),
    ],
  })

  network.compile({ optimizer: tf.train.adam(0.02), loss: 'meanAbsoluteError' })

  const xs = tf.tensor2d(inputs)
  const ys = tf.tensor2d(targets.map((value) => [value]))

  try {
    // In short runs with a pause between, so the page stays responsive and
    // training carries on even in a tab that isn't showing (TensorFlow.js's own
    // pauses wait for the screen to repaint, which a hidden tab never does).
    for (let done = 0; done < epochs; done += EPOCHS_PER_RUN) {
      await network.fit(xs, ys, { epochs: Math.min(EPOCHS_PER_RUN, epochs - done), batchSize: 32, shuffle: false, verbose: 0, yieldEvery: 'never' })
      onProgress?.(Math.min(1, (done + EPOCHS_PER_RUN) / epochs))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const [kernel1, bias1, kernel2, bias2] = network.getWeights().map((tensor) => tensor.arraySync())
    return { kernel1, bias1, kernel2, bias2 }
  } finally {
    xs.dispose()
    ys.dispose()
    network.dispose()
  }
}


// Trains both models. data: { lines, history, orders, items, locations, starting }
// (see predictionModel.js for each). onProgress(share done, 0 to 1). Returns,
// for each, what to save or why it couldn't be trained.
export async function trainModels(libs, { lines = [], history = [], orders = [], items = [], locations = [], starting = {} }, { epochs, onProgress } = {}) {
  const { historyByOrder } = buildStageStatistics(history)
  const finished = finishedForAccuracy(orders, historyByOrder)
  const tested = Math.max(1, Math.round(finished.length * TEST_SHARE))
  const cutoff = finished.length > tested ? finished[finished.length - tested].verifiedAt : null

  const results = []
  const kinds = ['supplier', 'labeling']

  for (const kind of kinds) {
    const part = kinds.indexOf(kind)
    const key = MODEL_KEYS[kind]
    const all = kind === 'supplier' ? supplierRecords(lines) : labelingRecords({ history, orders, items, locations })
    const train = cutoff ? all.filter((record) => record.knownAt < cutoff) : []
    const test = cutoff ? all.filter((record) => record.startedAt >= cutoff) : []

    if (train.length < MODEL_MIN_RECORDS || test.length < MIN_TEST_RECORDS) {
      results.push({ key, kind, trained: false, records: train.length, needed: MODEL_MIN_RECORDS, testRecords: test.length })
      continue
    }

    const spec = buildSpec(kind, train)
    const weights = await trainNetwork(
      libs,
      train.map((record) => encode(spec, record)),
      train.map((record) => (record.value - spec.target.mean) / spec.target.std),
      { epochs, onProgress: (share) => onProgress?.((part + share) / kinds.length) },
    )

    const model = { weights, spec }
    const actual = test.map((record) => record.value)
    const byModel = test.map((record) => predictValue(model, record))
    const byStatistics = statisticsFor(kind, train, test, starting)
    const modelScore = scoreOf(byModel, actual)
    const statisticsScore = scoreOf(byStatistics, actual)
    const residuals = test.map((record, index) => actual[index] - byModel[index])

    results.push({
      key,
      kind,
      trained: true,
      weights,
      spec,
      // In use only when it beat the statistics on records it didn't learn from.
      inUse: modelScore.averageDaysOff < statisticsScore.averageDaysOff,
      metrics: {
        records: train.length,
        testRecords: test.length,
        cutoff: new Date(cutoff).toISOString(),
        model: modelScore,
        statistics: statisticsScore,
        residuals: { low: percentile(residuals, 0.25), high: percentile(residuals, 0.75) },
      },
    })
  }

  return results
}
