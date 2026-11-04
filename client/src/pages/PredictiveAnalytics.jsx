import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'

import { useAuth } from '../context/AuthContext'
import { ALL_PARTS, loadAnalytics } from '../services/analyticsService'
import { modelIsStale, retrainModels } from '../services/modelService'
import { MODEL_KEYS } from '../utils/predictionModel'
import { PredictionNumbers } from '../components/PredictionNumbers'
import SimulatedBadge from '../components/SimulatedBadge'
import {
  AccuracyChart,
  AccuracyTable,
  ChartCard,
  ChartEmpty,
  ComingUpChart,
  ComingUpTable,
  LeadTimeChart,
  LeadTimeTable,
  MonthlyOnTimeChart,
  MonthlyOnTimeTable,
  OnTimeChart,
  OnTimeTable,
  StepTimesChart,
  StepTimesTable,
} from '../components/AnalyticsCharts'
import { ON_TIME_TARGET } from '../utils/analytics'
import { MIN_DELIVERIES } from '../utils/supplierScores'
import { MIN_PO_DELIVERY_DAYS } from '../utils/dates'
import { count, formatDays } from '../utils/chartFormat'


// =============================================================================
// Predictive Analytics
//
// The charts behind the estimates (utils/analytics.js, loaded by
// services/analyticsService.js). Each role sees the charts that help its work:
// admin and management all of them and the four numbers, procurement the
// supplier charts, and the warehouse what's coming up.
// =============================================================================

const PARTS_BY_ROLE = {
  admin: ALL_PARTS,
  management: ALL_PARTS,
  procurement: ['suppliers'],
  warehouse: ['weeks'],
}

// The page trains the model by itself only once there's enough to learn from:
// 30 records before the newest 20% held back for testing.
const AUTO_TRAIN_FROM = 40

const whenFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })


export default function PredictiveAnalytics() {
  const { profile } = useAuth()
  const role = profile?.role?.toLowerCase()
  const parts = PARTS_BY_ROLE[role] || []
  const has = (part) => parts.includes(part)

  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [training, setTraining] = useState(null)
  const autoTrained = useRef(false)
  const canTrain = role === 'admin' || role === 'management'

  useEffect(() => {
    if (!PARTS_BY_ROLE[role]) return

    let active = true
    setError(null)

    loadAnalytics(PARTS_BY_ROLE[role])
      .then((result) => {
        if (active) setData(result)
      })
      .catch((loadError) => {
        console.error('Failed to load predictive analytics:', loadError)
        if (active) setError(loadError.message || 'The analytics could not be loaded.')
      })

    return () => {
      active = false
    }
  }, [role, reload])

  // Trains the model (about 20 seconds), saves it, then reloads the page's figures.
  async function retrain(reason) {
    setTraining({ state: 'running', reason })
    try {
      const results = await retrainModels(profile?.id, (share) => {
        setTraining((current) => (current?.state === 'running' ? { ...current, progress: share } : current))
      })
      setTraining({ state: 'done', results })
      setReload((times) => times + 1)
    } catch (trainError) {
      console.error('Failed to train the model:', trainError)
      setTraining({ state: 'failed', message: trainError.message || 'The model could not be trained.' })
    }
  }

  // By itself, once a visit: never trained, or trained over 7 days ago.
  useEffect(() => {
    if (!canTrain || !data?.models?.available || autoTrained.current) return
    if (data.learnedFrom < AUTO_TRAIN_FROM || !modelIsStale(data.models.rows)) return
    autoTrained.current = true
    retrain(data.models.rows.length ? 'stale' : 'first')
  }, [data, canTrain])

  const cards = ['steps', 'suppliers', 'suppliers', 'months', 'weeks', 'accuracy'].filter(has).length

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Predictive Analytics
        </h1>

        <p className="mt-1 text-gray-500">
          How long orders take, how suppliers deliver, what's coming up, and how close the estimates are.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!data && !error && (
        <p className="text-sm text-gray-500">Loading the analytics…</p>
      )}

      {data && (
        <>
          {data.simulated && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              <SimulatedBadge />
              <p>
                These figures include the made-up history added for the demo (orders numbered SIM-ORD-…, POs SIM-PO-…),
                so they show how the predictions work, not DMC's real performance.
              </p>
            </div>
          )}

          {has('numbers') && <MethodNote data={data} canTrain={canTrain} training={training} onRetrain={() => retrain('manual')} />}

          {has('numbers') && (
            <div className="mb-6">
              <PredictionNumbers numbers={data.numbers} />
            </div>
          )}

          <div className={`grid grid-cols-1 gap-6 ${cards > 1 ? 'lg:grid-cols-2' : ''}`}>
            {has('steps') && <StepsCard steps={data.steps} simulated={data.simulated} />}
            {has('suppliers') && <OnTimeCard onTime={data.onTime} simulated={data.simulated} />}
            {has('suppliers') && <LeadTimeCard leadTimes={data.leadTimes} simulated={data.simulated} />}
            {has('months') && <MonthsCard months={data.months} simulated={data.simulated} />}
            {has('weeks') && <WeeksCard weeks={data.weeks} simulated={data.simulated} />}
            {has('accuracy') && <AccuracyCard accuracy={data.accuracy} simulated={data.simulated} />}
          </div>
        </>
      )}
    </div>
  )
}


// How each step is estimated (statistics, or the model where it did better),
// whether DMC's numbers are in yet, and Retrain.
function MethodNote({ data, canTrain, training, onRetrain }) {
  const rows = data.models?.rows || []
  const available = Boolean(data.models?.available)
  const trainedAt = rows.map((row) => row.trainedAt).filter(Boolean).sort().at(-1)
  const lastRun = training?.state === 'done' ? training.results : []
  const running = training?.state === 'running'

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm">
      <p className="font-semibold text-gray-800">How the estimates are made</p>
      <p className="mt-1">
        Each estimate adds up the time each step usually takes: the system's own records
        ({count(data.learnedFrom, 'finished order')} so far) blended with DMC staff's starting values. Where the
        TensorFlow.js model predicted past orders better, it's used for that step instead.
      </p>

      <ul className="mt-3 space-y-2">
        <ModelLine label="Supplier delivery timing" row={rows.find((row) => row.key === MODEL_KEYS.supplier)} result={lastRun.find((result) => result.key === MODEL_KEYS.supplier)} available={available} />
        <ModelLine label="Labeling time" row={rows.find((row) => row.key === MODEL_KEYS.labeling)} result={lastRun.find((result) => result.key === MODEL_KEYS.labeling)} available={available} />
      </ul>

      {available && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
          <span>
            {running
              ? `Training the model${training.reason === 'stale' ? ' (the saved one was over 7 days old)' : training.reason === 'first' ? ' for the first time' : ''}… ${Math.round((training.progress || 0) * 100)}%`
              : trainedAt ? `Model trained ${whenFormat.format(new Date(trainedAt))}. It retrains by itself after 7 days.` : "The model hasn't been trained yet."}
          </span>

          {canTrain && (
            <button
              type="button"
              onClick={onRetrain}
              disabled={running}
              className="rounded-lg border border-gray-200 px-2.5 py-1 font-medium text-gray-600 transition hover:border-[#B8D5C3] hover:text-[#2D5A42] disabled:cursor-wait disabled:opacity-60"
            >
              {running ? 'Training…' : 'Retrain'}
            </button>
          )}

          {training?.state === 'failed' && <span className="text-red-600">{training.message}</span>}
        </div>
      )}

      {!available && canTrain && (
        <p className="mt-2 text-xs text-gray-500">To train the model, run db/migrations/019 in Supabase first.</p>
      )}

      {data.placeholders && (
        <p className="mt-2 flex items-start gap-2 text-amber-700">
          <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>The starting values are still placeholders. Enter DMC's own numbers on Prediction Settings.</span>
        </p>
      )}
    </div>
  )
}


// One step: which method estimates it, and why.
function ModelLine({ label, row, result, available }) {
  let inUse = false
  let text = "the model hasn't been trained yet."

  if (!available) {
    text = 'the model needs db/migrations/019.'
  } else if (row?.metrics?.model) {
    const { model, statistics, records, testRecords } = row.metrics
    inUse = row.inUse
    text = row.inUse
      ? `the model, ${formatDays(model.averageDaysOff)} off on average on ${testRecords} records it hadn't seen, against ${formatDays(statistics.averageDaysOff)} for the statistics. It learned from ${records}.`
      : `the statistics. The model was ${formatDays(model.averageDaysOff)} off on ${testRecords} records it hadn't seen, against ${formatDays(statistics.averageDaysOff)}, so it isn't used yet.`
  } else if (result && !result.trained) {
    text = `the statistics. The model needs ${result.needed} finished records to learn from; there are ${result.records} so far.`
  }

  return (
    <li className="flex items-start gap-2">
      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${inUse ? 'bg-[#E8F3EC] text-[#2D5A42]' : 'bg-gray-100 text-gray-600'}`}>
        {inUse ? 'Model' : 'Statistics'}
      </span>
      <span>
        <span className="font-medium text-gray-800">{label}:</span> {text}
        {row?.metrics?.simulated && <> <SimulatedBadge label="Learned from simulated data" /></>}
      </span>
    </li>
  )
}


function StepsCard({ steps, simulated }) {
  return (
    <ChartCard
      simulated={simulated}
      title="Where the time goes"
      question="Which step holds orders up the longest?"
      table={<StepTimesTable steps={steps} />}
      footnote="The longest bar is the step to work on first. The down payment isn't included, since it waits on the customer."
    >
      <StepTimesChart steps={steps} />
    </ChartCard>
  )
}


function OnTimeCard({ onTime, simulated }) {
  const { rated, tooFew } = onTime

  return (
    <ChartCard
      simulated={simulated}
      title="On-time rate by supplier"
      question="Which suppliers break their promised dates?"
      table={rated.length ? <OnTimeTable rated={rated} /> : null}
      footnote={
        <>
          Deliveries by the promised date over the last 12 months. Red bars are below the {Math.round(ON_TIME_TARGET * 100)}% target.
          A supplier needs {MIN_DELIVERIES} deliveries to be shown.
          {tooFew.length > 0 && ` Not enough deliveries yet: ${tooFew.map((supplier) => `${supplier.name} (${supplier.deliveries})`).join(', ')}.`}
        </>
      }
    >
      {rated.length
        ? <OnTimeChart rated={rated} />
        : <ChartEmpty>No supplier has {MIN_DELIVERIES} finished deliveries in the last 12 months yet.</ChartEmpty>}
    </ChartCard>
  )
}


function LeadTimeCard({ leadTimes, simulated }) {
  const { rows, onDefault, defaultDays } = leadTimes

  return (
    <ChartCard
      simulated={simulated}
      title="Lead time by supplier"
      question="Which suppliers are slow, and how predictable are they?"
      table={rows.length ? <LeadTimeTable rows={rows} /> : null}
      footnote={
        <>
          Days from PO to delivery. The dot is the usual time and the line the likely range: a long line means an
          unpredictable supplier, even if its usual time looks fine. The dashed line is DMC's {MIN_PO_DELIVERY_DAYS}-day
          minimum for a PO's promised date.
          {rows.length > 0 && onDefault > 0 && ` ${count(onDefault, 'supplier')} with no deliveries or usual time from DMC yet ${onDefault === 1 ? 'uses' : 'use'} the default ${defaultDays} days.`}
        </>
      }
    >
      {rows.length
        ? <LeadTimeChart rows={rows} />
        : <ChartEmpty>No supplier has deliveries or a usual time from DMC yet. Until then, the estimates use the default {defaultDays} days.</ChartEmpty>}
    </ChartCard>
  )
}


function MonthsCard({ months, simulated }) {
  return (
    <ChartCard
      simulated={simulated}
      title="Shipping on time, by month"
      question="Are more orders shipping by the requested date than before?"
      table={months.length ? <MonthlyOnTimeTable months={months} /> : null}
      footnote="The share of orders shipped by the customer's requested date, one point per month. A busy season shows up as a dip."
    >
      {months.length
        ? <MonthlyOnTimeChart months={months} />
        : <ChartEmpty>No orders with a requested ship date have shipped yet.</ChartEmpty>}
    </ChartCard>
  )
}


function WeeksCard({ weeks, simulated }) {
  const total = weeks.weeks.reduce((sum, week) => sum + week.count, 0)

  return (
    <ChartCard
      simulated={simulated}
      title="Coming up, by week"
      question="How many orders will be ready to ship each week?"
      table={total ? <ComingUpTable weeks={weeks.weeks} /> : null}
      footnote={
        <>
          Orders under way, by their estimated ready date. It shows ahead of time when staging space and containers
          will be busiest.
          {weeks.later > 0 && ` ${count(weeks.later, 'more order')} after that.`}
        </>
      }
    >
      {total || weeks.later
        ? <ComingUpChart weeks={weeks.weeks} />
        : <ChartEmpty>No orders are under way.</ChartEmpty>}
    </ChartCard>
  )
}


function AccuracyCard({ accuracy, simulated }) {
  return (
    <ChartCard
      simulated={simulated}
      title="Prediction accuracy"
      question="How far off are the estimates, and which method is best?"
      table={accuracy.enough ? <AccuracyTable accuracy={accuracy} /> : null}
      footnote={accuracy.enough
        ? `Tested on the newest ${accuracy.tested} of ${accuracy.finished} finished orders, each predicted as of the day its payment was verified, learning only from the ${accuracy.learnedFrom} before them. "Starting values only" is the baseline: what DMC would guess with no records.${accuracy.methods.some((method) => method.key === 'model') ? ' "Statistics + model" adds the TensorFlow.js model, which learned only from records before these orders.' : ''}`
        : '"Starting values only" will be the baseline to beat: what DMC would guess with no records.'}
    >
      {accuracy.enough
        ? <AccuracyChart accuracy={accuracy} />
        : (
          <ChartEmpty>
            Accuracy is checked on finished orders the estimates didn't learn from. It needs at least {accuracy.needed} finished
            orders (paid, then shipped); there {accuracy.finished === 1 ? 'is' : 'are'} {accuracy.finished} so far.
          </ChartEmpty>
        )}
    </ChartCard>
  )
}
