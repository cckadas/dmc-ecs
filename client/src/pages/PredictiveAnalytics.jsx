import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'

import { useAuth } from '../context/AuthContext'
import { ALL_PARTS, loadAnalytics } from '../services/analyticsService'
import { PredictionNumbers } from '../components/PredictionNumbers'
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
import { count } from '../utils/chartFormat'


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


export default function PredictiveAnalytics() {
  const { profile } = useAuth()
  const role = profile?.role?.toLowerCase()
  const parts = PARTS_BY_ROLE[role] || []
  const has = (part) => parts.includes(part)

  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

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
  }, [role])

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
          {has('numbers') && <MethodNote data={data} />}

          {has('numbers') && (
            <div className="mb-6">
              <PredictionNumbers numbers={data.numbers} />
            </div>
          )}

          <div className={`grid grid-cols-1 gap-6 ${cards > 1 ? 'lg:grid-cols-2' : ''}`}>
            {has('steps') && <StepsCard steps={data.steps} />}
            {has('suppliers') && <OnTimeCard onTime={data.onTime} />}
            {has('suppliers') && <LeadTimeCard leadTimes={data.leadTimes} />}
            {has('months') && <MonthsCard months={data.months} />}
            {has('weeks') && <WeeksCard weeks={data.weeks} />}
            {has('accuracy') && <AccuracyCard accuracy={data.accuracy} />}
          </div>
        </>
      )}
    </div>
  )
}


// Which method makes the estimates, and whether DMC's numbers are in yet.
function MethodNote({ data }) {
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm">
      <p>
        <span className="font-semibold text-gray-800">Method in use: statistics.</span>{' '}
        Each estimate blends the system's own records ({count(data.learnedFrom, 'finished order')} so far) with
        DMC staff's starting values. The more finished orders there are, the more the records count.
      </p>

      {data.placeholders && (
        <p className="mt-2 flex items-start gap-2 text-amber-700">
          <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>The starting values are still placeholders. Enter DMC's own numbers on Prediction Settings.</span>
        </p>
      )}
    </div>
  )
}


function StepsCard({ steps }) {
  return (
    <ChartCard
      title="Where the time goes"
      question="Which step holds orders up the longest?"
      table={<StepTimesTable steps={steps} />}
      footnote="The longest bar is the step to work on first. The down payment isn't included, since it waits on the customer."
    >
      <StepTimesChart steps={steps} />
    </ChartCard>
  )
}


function OnTimeCard({ onTime }) {
  const { rated, tooFew } = onTime

  return (
    <ChartCard
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


function LeadTimeCard({ leadTimes }) {
  const { rows, onDefault, defaultDays } = leadTimes

  return (
    <ChartCard
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


function MonthsCard({ months }) {
  return (
    <ChartCard
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


function WeeksCard({ weeks }) {
  const total = weeks.weeks.reduce((sum, week) => sum + week.count, 0)

  return (
    <ChartCard
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


function AccuracyCard({ accuracy }) {
  return (
    <ChartCard
      title="Prediction accuracy"
      question="How far off are the estimates, and which method is best?"
      table={accuracy.enough ? <AccuracyTable accuracy={accuracy} /> : null}
      footnote={accuracy.enough
        ? `Tested on the newest ${accuracy.tested} of ${accuracy.finished} finished orders, each predicted as of the day its payment was verified, learning only from the ${accuracy.learnedFrom} before them. "Starting values only" is the baseline: what DMC would guess with no records.`
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
