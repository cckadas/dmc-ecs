import { useEffect, useRef, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { ALL_PARTS, HISTORY_PARTS, PREDICTION_PARTS, loadAnalytics } from '../services/analyticsService'
import { modelIsStale, retrainModels } from '../services/modelService'
import { MODEL_KEYS } from '../utils/predictionModel'
import { AheadNumbers } from '../components/PredictionNumbers'
import { DeliveriesAheadTable, OrdersAheadTable, ProductSales, ReorderTable } from '../components/PredictionTables'
import SimulatedBadge from '../components/SimulatedBadge'
import {
  AccuracyChart,
  AccuracyTable,
  AtSeaChart,
  AtSeaTable,
  BusyMonthsChart,
  DemandChart,
  DemandTable,
  TopProductsList,
  BusyMonthsTable,
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
// Two tabs (services/analyticsService.js loads them):
//   Predictions  what's ahead: each order's ship and arrival dates, each
//                supplier delivery still to come, what's ready each week, when
//                each customer will likely order next, the demand forecast
//                with sales by product, and how close the predictions have come
//   What the predictions learn from  descriptive: the records behind them,
//                such as how long each step took and how suppliers delivered
// Each role sees the parts that help its work: admin and management all of
// them, sales its customers' orders and what they'll order, procurement
// deliveries, demand and suppliers, and the warehouse what's coming in and
// going out.
// =============================================================================

const PARTS_BY_ROLE = {
  admin: ALL_PARTS,
  management: ALL_PARTS,
  sales: ['ahead', 'orders', 'reorders', 'demand', 'labels'],
  procurement: ['ahead', 'deliveries', 'demand', 'suppliers'],
  warehouse: ['ahead', 'weeks', 'deliveries', 'labels'],
}

// Who sees sales in pesos.
const SEES_MONEY = ['admin', 'management', 'sales']

const TABS = [
  { key: 'predictions', label: 'Predictions', parts: PREDICTION_PARTS },
  { key: 'history', label: 'What the predictions learn from', parts: HISTORY_PARTS },
]

// The page trains the model by itself only once there's enough to learn from:
// 30 records before the newest 20% held back for testing.
const AUTO_TRAIN_FROM = 40

const whenFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })


export default function PredictiveAnalytics() {
  const { profile } = useAuth()
  const role = profile?.role?.toLowerCase()
  const parts = PARTS_BY_ROLE[role] || []
  const has = (part) => parts.includes(part)
  const tabs = TABS.filter((tab) => tab.parts.some(has))

  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [training, setTraining] = useState(null)
  const [tab, setTab] = useState('predictions')
  const autoTrained = useRef(false)
  const canTrain = role === 'admin' || role === 'management'
  const shownTab = tabs.find((entry) => entry.key === tab) ? tab : tabs[0]?.key

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

  const historyCards = ['steps', 'steps', 'labels', 'suppliers', 'suppliers', 'suppliers', 'months'].filter(has).length

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Predictive Analytics
        </h1>

        <p className="mt-1 text-gray-500">
          When orders will ship and arrive, when supplier deliveries will come, when and what customers will likely order next, and how close these predictions have been.
        </p>
      </div>

      {tabs.length > 1 && (
        <div role="tablist" aria-label="Predictive Analytics" className="mb-6 flex flex-wrap gap-2 border-b border-gray-200">
          {tabs.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={shownTab === entry.key}
              onClick={() => setTab(entry.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                shownTab === entry.key ? 'border-[#2D5A42] text-[#2D5A42]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

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

          {shownTab === 'predictions' && (
            <>
              <MethodNote data={data} canTrain={canTrain} training={training} onRetrain={() => retrain('manual')} />

              {has('ahead') && data.ahead && (
                <div className="mb-6">
                  <AheadNumbers ahead={data.ahead} />
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {has('orders') && <OrdersAheadCard orders={data.orders} simulated={data.simulated} />}
                {has('deliveries') && <DeliveriesAheadCard deliveries={data.deliveries} simulated={data.simulated} />}
                {has('weeks') && <WeeksCard weeks={data.weeks} simulated={data.simulated} />}
                {has('accuracy') && <AccuracyCard accuracy={data.accuracy} simulated={data.simulated} />}
                {has('reorders') && <ReordersCard reorders={data.reorders} simulated={data.simulated} />}
                {has('demand') && <DemandCard demand={data.demand} simulated={data.simulated} wide />}
                {has('demand') && data.demand?.enough && <ProductSalesCard demand={data.demand} showMoney={SEES_MONEY.includes(role)} simulated={data.simulated} />}
              </div>
            </>
          )}

          {shownTab === 'history' && (
            <>
              <div className="mb-6 rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm">
                <p className="font-semibold text-gray-800">What the predictions learn from</p>
                <p className="mt-1">
                  These charts are descriptive: they show what has happened in the system's records, such as how long each
                  step took and how each supplier delivered. The Predictions tab is worked out from these same records.
                </p>
              </div>

              <div className={`grid grid-cols-1 gap-6 ${historyCards > 1 ? 'lg:grid-cols-2' : ''}`}>
                {has('steps') && <StepsCard steps={data.steps} simulated={data.simulated} />}
                {has('steps') && <AtSeaCard atSea={data.atSea} simulated={data.simulated} />}
                {has('labels') && <LabelStepsCard labelSteps={data.labelSteps} simulated={data.simulated} />}
                {has('suppliers') && <OnTimeCard onTime={data.onTime} simulated={data.simulated} />}
                {has('suppliers') && <LeadTimeCard leadTimes={data.leadTimes} simulated={data.simulated} />}
                {has('suppliers') && <BusyMonthsCard months={data.busyMonths} simulated={data.simulated} />}
                {has('months') && <MonthsCard months={data.months} simulated={data.simulated} />}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}


// Each order under way, soonest to ship first.
function OrdersAheadCard({ orders, simulated }) {
  return (
    <div className="lg:col-span-2">
      <ChartCard
        simulated={simulated}
        title="Orders under way: when they'll ship"
        question="When will each order ship and arrive, and will it make its requested date?"
        footnote="Each order's dates come from how long each of its remaining steps usually takes, its suppliers' deliveries and the days at sea to its country, all from the system's records. At risk: it's expected after the date the customer asked for, or a step or delivery is running late."
      >
        <OrdersAheadTable orders={orders} />
      </ChartCard>
    </div>
  )
}


// Each supplier delivery still to come, soonest first.
function DeliveriesAheadCard({ deliveries, simulated }) {
  return (
    <div className="lg:col-span-2">
      <ChartCard
        simulated={simulated}
        title="Supplier deliveries still to come"
        question="When will each delivery arrive, and which are likely late?"
        footnote="Each delivery is expected around its promised day, moved by how early or late that supplier's deliveries have been (leaning on every supplier's while it has few). Likely late: late at least half the time."
      >
        <DeliveriesAheadTable deliveries={deliveries} />
      </ChartCard>
    </div>
  )
}


// Each customer's next order, soonest expected first.
function ReordersCard({ reorders, simulated }) {
  const check = reorders.check

  return (
    <div className="lg:col-span-2">
      <ChartCard
        simulated={simulated}
        title="Customers likely to order next"
        question="When will each customer order again, and who is later than usual?"
        footnote={
          <>
            From the system's own orders: the days between each customer's orders. Its next order is expected its
            usual gap after its last one: the middle of its last 4 gaps, with the shortest and longest of them as its
            likely dates, so the prediction follows a customer as it orders sooner or later through the year. A
            customer with fewer than {reorders.needed} gaps leans on every customer's
            {reorders.everyone ? ` (usually ${formatDays(reorders.everyone.usual)})` : ''}. Orders placed on the same
            day count as one, and cancelled orders don't count.
            {check && ` Checked on the latest ${check.tested} gaps, each predicted from the orders before it: ${formatDays(check.averageDaysOff)} off on average, against ${formatDays(check.sameForAllDaysOff)} for giving every customer the same gap.`}
            {reorders.quiet > 0 && ` ${count(reorders.quiet, 'customer')} with no order in the last 12 months ${reorders.quiet === 1 ? 'is' : 'are'} left out.`}
          </>
        }
      >
        {reorders.enough
          ? <ReorderTable customers={reorders.customers} />
          : (
            <ChartEmpty>
              This needs {reorders.needed} gaps between customers' orders to go by; there {reorders.gaps === 1 ? 'is' : 'are'} {reorders.gaps} so far.
            </ChartEmpty>
          )}
      </ChartCard>
    </div>
  )
}


// Sales by product, with how each product's sales make its forecast.
function ProductSalesCard({ demand, showMoney, simulated }) {
  return (
    <div className="lg:col-span-2">
      <ChartCard
        simulated={simulated}
        title="Sales by product"
        question="How much has each product sold, and how much is it expected to sell?"
        footnote="From the system's own orders past their down payment, by the month they were placed. A product's expected cases are its share of its category over the last 6 months times the category's forecast."
      >
        <ProductSales sales={demand.productSales} showMoney={showMoney} />
      </ChartCard>
    </div>
  )
}


// How each step is estimated (statistics, or the model where it did better),
// and Retrain.
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
        Each estimate adds up the time each step usually takes, learned only from the system's own records
        ({count(data.learnedFrom, 'finished order')} so far), with no numbers typed in by hand. A supplier with few
        deliveries leans on every supplier's, busy months are found in the deliveries, and arrival dates come from
        the arrivals staff record. Labeling goes by where an order's labels are once it's in the warehouse, and by how
        quickly its customer usually sends designs. A step with too few finished orders has no estimate yet. Where the
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
      footnote={`From finished orders only. The longest bar is the step to work on first. A step needs ${steps[0]?.needed ?? 3} finished orders before it has numbers. The down payment isn't included, since it waits on the customer.`}
    >
      <StepTimesChart steps={steps} />
    </ChartCard>
  )
}


// How long each piece of labeling takes, from every finished order's labels.
function LabelStepsCard({ labelSteps, simulated }) {
  const { available, steps } = labelSteps
  const recorded = steps.some((step) => step.records > 0)

  return (
    <ChartCard
      simulated={simulated}
      title="Labeling steps"
      question="Who does an order's labeling wait on the longest?"
      table={recorded ? <StepTimesTable steps={steps} counts="label" /> : null}
      footnote={`From finished orders' labels, saved step by step: an order is past a step once all its labels are, so each bar is the time from one step to the next. It shows who labeling waits on the longest, such as how long customers take to send their translated design. The estimates go by these same times for an order in labeling. A step needs ${steps[0]?.needed ?? 3} orders before it has numbers; orders whose labels were started before their steps were saved aren't counted.`}
    >
      {!available
        ? <ChartEmpty>Each label step's time is saved once db/migrations/026 has been run in Supabase.</ChartEmpty>
        : recorded
          ? <StepTimesChart steps={steps} counts="label" />
          : <ChartEmpty>No order has finished labeling since its labels' steps began to be saved.</ChartEmpty>}
    </ChartCard>
  )
}


function AtSeaCard({ atSea, simulated }) {
  const { rows, tooFew, needed } = atSea

  return (
    <ChartCard
      simulated={simulated}
      title="Days at sea, by country"
      question="How long do containers take to reach each country?"
      table={rows.length ? <AtSeaTable rows={rows} /> : null}
      footnote={
        <>
          From recorded arrivals: the day staff record a container arrived, minus the day it shipped. The arrival
          estimates come from these. A country needs {needed} arrivals to be shown; until then its estimates go by the
          nearest country that has them.
          {tooFew.length > 0 && ` Not enough arrivals yet: ${tooFew.map((country) => `${country.name} (${country.arrivals})`).join(', ')}.`}
        </>
      }
    >
      {rows.length
        ? <AtSeaChart rows={rows} />
        : <ChartEmpty>No arrivals recorded yet. Staff record the day a shipped order's container arrives; the arrival estimates start once there are {needed} for a country.</ChartEmpty>}
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
  const { rows, noDeliveries, allDays } = leadTimes

  return (
    <ChartCard
      simulated={simulated}
      title="Lead time by supplier"
      question="Which suppliers are slow, and how predictable are they?"
      table={rows.length ? <LeadTimeTable rows={rows} /> : null}
      footnote={
        <>
          Days from PO to delivery, from each supplier's deliveries. The dot is the usual time and the line the likely
          range: a long line means an unpredictable supplier, even if its usual time looks fine. A supplier with few
          deliveries leans on every supplier's (hollow dot). The dashed line is the shortest delivery a PO may ask
          for ({MIN_PO_DELIVERY_DAYS} days).
          {rows.length > 0 && noDeliveries > 0 && allDays !== null && ` ${count(noDeliveries, 'supplier')} with no deliveries yet ${noDeliveries === 1 ? 'goes' : 'go'} by every supplier's usual ${formatDays(allDays)}.`}
        </>
      }
    >
      {rows.length
        ? <LeadTimeChart rows={rows} />
        : <ChartEmpty>No supplier has finished deliveries yet. Supplier estimates start once deliveries are recorded.</ChartEmpty>}
    </ChartCard>
  )
}


function BusyMonthsCard({ months, simulated }) {
  const found = months.filter((month) => month.deliveries > 0)

  return (
    <ChartCard
      simulated={simulated}
      title="Busy months, found in the deliveries"
      question="In which months do suppliers take longer?"
      table={found.length ? <BusyMonthsTable months={months} /> : null}
      footnote="For POs sent in each month: how many days longer (above the line) or shorter than usual their deliveries took. A month with few deliveries counts for less. The estimates add these days for a supplier not ordered from yet, so nobody has to say which months are busy."
    >
      {found.length
        ? <BusyMonthsChart months={months} />
        : <ChartEmpty>No supplier deliveries are recorded yet, so no busy months can be found.</ChartEmpty>}
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


function DemandCard({ demand, simulated, wide }) {
  const [category, setCategory] = useState('all')
  const percent = (share) => `${Math.round(share * 100)}%`

  if (!demand.enough) {
    return (
      <div className={wide ? 'lg:col-span-2' : ''}>
        <ChartCard simulated={simulated} title="Demand forecast" question="How many cases will customers likely order in the coming months?">
          <ChartEmpty>
            The forecast needs {demand.needed} full months of orders; there {demand.months === 1 ? 'is' : 'are'} {demand.months} so far.
          </ChartEmpty>
        </ChartCard>
      </div>
    )
  }

  const key = demand.history[category] ? category : 'all'
  const products = demand.topProducts.filter((product) => key === 'all' || product.category === key).slice(0, 5)
  const check = demand.check

  return (
    <div className={wide ? 'lg:col-span-2' : ''}>
      <ChartCard
        simulated={simulated}
        title="Demand forecast"
        question="How many cases will customers likely order in the coming months?"
        table={<DemandTable history={demand.history[key]} forecast={demand.forecast[key]} />}
        footnote={
          <>
            From the system's own orders: the cases in orders past their down payment, by the month they were placed.
            The forecast is the last 6 months' level times each month's season
            {demand.seasons ? ' (how that month compared with the average month a year before)' : ' (seasons are used once there are 12 months of orders)'},
            with a likely range from how much months have varied. It helps procurement plan supplier orders and the
            warehouse its space.
            {check && ` Checked on the last ${check.tests.length} months, each forecast from the months before it: ${percent(check.forecastOff)} off on average, against ${percent(check.lastMonthOff)} for repeating the month before; ${check.tests.filter((test) => test.inRange).length} of ${check.tests.length} within the likely range.`}
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="demand-category" className="text-sm text-gray-600">Show</label>
          <select
            id="demand-category"
            value={key}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="all">All products</option>
            {demand.categories.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        {demand.forecast[key]
          ? <DemandChart history={demand.history[key]} forecast={demand.forecast[key]} />
          : <ChartEmpty>Too few months of orders in this category for a forecast.</ChartEmpty>}

        <TopProductsList products={products} />
      </ChartCard>
    </div>
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
        ? `Tested on the newest ${accuracy.tested} of ${accuracy.finished} finished orders, each predicted as of the day its payment was verified, learning only from the ${accuracy.learnedFrom} before them. "Same for every order" is the baseline: every order gets the usual ${formatDays(accuracy.usualDays)} from payment to shipping. "Statistics" works it out step by step for each order. Customers see a likely range, so the first chart is how often the real ship date fell inside it. A single date is often off by days, because no one knows at payment which supplier will be late.${accuracy.methods.some((method) => method.key === 'model') ? ' "Statistics + model" adds the TensorFlow.js model, which learned only from records before these orders.' : ''}${accuracy.labeling?.enough ? ` Once an order is in labeling, its ready date goes by each label's saved steps (who it's waiting on, and how long that customer usually takes to send designs). Tested on the newest ${accuracy.labeling.testedOrders} orders whose labels were saved step by step, each predicted every time its labels moved on, against going by labeling as a whole.` : ''}`
        : '"Same for every order" will be the baseline to beat: every order given the usual days from payment to shipping.'}
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
