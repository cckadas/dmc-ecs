import { useLayoutEffect, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { MIN_PO_DELIVERY_DAYS } from '../utils/dates'
import { ON_TIME_TARGET, WITHIN_DAYS } from '../utils/analytics'
import { CHART, count, formatDay, formatDays, formatMonth, formatPercent, shortMonth, shorten } from '../utils/chartFormat'
import SimulatedBadge from './SimulatedBadge'


// =============================================================================
// Predictive analytics charts
//
// One look for every chart: thin bars rounded at their end and square at the
// baseline, 2px lines, hairline grids, values in text colors (never the data
// color), a tooltip on hover or keyboard focus, and a table of the same numbers
// in every card. Red only ever appears with words beside it ("Below target",
// "late"), so color never carries a meaning alone. Colors: utils/chartFormat.js.
// =============================================================================

const TICK = { fill: CHART.inkSecondary, fontSize: 11 }
const CATEGORY_TICK = { fill: CHART.inkSecondary, fontSize: 12 }
const TARGET_PERCENT = Math.round(ON_TIME_TARGET * 100)

// A white outline behind label text, so a reference line passes behind it.
const HALO = { stroke: CHART.surface, strokeWidth: 3, strokeLinejoin: 'round', paintOrder: 'stroke' }

// In a narrow card (a phone), each name goes above its bar instead of beside
// it, so the bars keep the width.
const COMPACT_BELOW = 480

function useCompact() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined

    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return [ref, width > 0 && width < COMPACT_BELOW]
}

// The name above a bar, in a compact chart.
function NameAbove({ background, x, y, name }) {
  if (!name) return null
  return (
    <text x={background?.x ?? x} y={y - 7} fontSize={12} fill={CHART.inkSecondary} {...HALO}>
      {shorten(name, 40)}
    </text>
  )
}


// The card around every chart ---------------------------------------------------------

export function ChartCard({ number, title, question, footnote, table, simulated = false, children }) {
  const [showTable, setShowTable] = useState(false)

  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 font-semibold text-gray-800">
            <span>{number ? `${number}. ` : ''}{title}</span>
            {simulated && <SimulatedBadge />}
          </h2>
          {question && <p className="mt-0.5 text-xs text-gray-500">{question}</p>}
        </div>

        {table && (
          <button
            type="button"
            onClick={() => setShowTable((shown) => !shown)}
            aria-pressed={showTable}
            className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-[#B8D5C3] hover:text-[#2D5A42]"
          >
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>

      <div className="flex-1 px-5 py-4">
        {showTable && table ? table : children}
      </div>

      {footnote && (
        <div className="border-t border-gray-100 px-5 py-3 text-xs leading-relaxed text-gray-500">
          {footnote}
        </div>
      )}
    </section>
  )
}


export function ChartEmpty({ children }) {
  return (
    <div className="flex min-h-[160px] items-center justify-center px-4 text-center text-sm text-gray-500">
      <p className="max-w-sm">{children}</p>
    </div>
  )
}


// columns: [{ label, value: (row) => text, numeric }]
export function DataTable({ columns, rows, rowKey }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs text-gray-500">
            {columns.map((column) => (
              <th key={column.label} className={`py-2 pr-4 font-medium ${column.numeric ? 'text-right' : ''}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-gray-50">
          {rows.map((row, index) => (
            <tr key={rowKey ? rowKey(row) : index}>
              {columns.map((column) => (
                <td key={column.label} className={`py-2 pr-4 text-gray-700 ${column.numeric ? 'text-right tabular-nums' : ''}`}>
                  {column.value(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


// The value first, then what it is.
function TooltipBox({ value, name, lines = [] }) {
  return (
    <div className="max-w-[280px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="text-sm font-semibold text-gray-800">{value}</p>
      {name && <p className="text-gray-500">{name}</p>}
      {lines.filter(Boolean).map((line) => (
        <p key={line} className="mt-1 text-gray-500">{line}</p>
      ))}
    </div>
  )
}


// items: [{ label, mark: 'bar' | 'line' | 'dot' | 'ring', color }]
function Legend({ items }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <svg width="14" height="10" aria-hidden="true">
            {item.mark === 'bar' && <rect x="1" y="1" width="12" height="8" rx="2" fill={item.color} />}
            {item.mark === 'line' && <line x1="1" x2="13" y1="5" y2="5" stroke={item.color} strokeWidth="2" strokeLinecap="round" />}
            {item.mark === 'dot' && <circle cx="7" cy="5" r="4" fill={item.color} />}
            {item.mark === 'ring' && <circle cx="7" cy="5" r="3.5" fill={CHART.surface} stroke={item.color} strokeWidth="2" />}
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  )
}


// Bar shapes -----------------------------------------------------------------------------

// A horizontal bar: rounded at its end, square at the baseline, its value just
// past the end. alert adds an icon and words after the value.
function HorizontalBar({ x, y, width, height, background, isActive, fill, label, alert, name }) {
  const length = Math.max(Number(width) || 0, 0)
  const corner = Math.min(4, length / 2, height / 2)
  const middle = y + height / 2
  const textX = x + length + 8
  const alertX = textX + String(label).length * 7 + 6

  return (
    <g>
      <NameAbove background={background} x={x} y={y} name={name} />

      {length > 0 && (
        <path
          d={`M${x},${y} H${x + length - corner} Q${x + length},${y} ${x + length},${y + corner} V${y + height - corner} Q${x + length},${y + height} ${x + length - corner},${y + height} H${x} Z`}
          fill={fill}
          fillOpacity={isActive ? 0.8 : 1}
        />
      )}

      <text x={textX} y={middle} dominantBaseline="central" fontSize={12} fill={CHART.ink} {...HALO}>{label}</text>

      {alert && (
        <g>
          <circle cx={alertX + 5} cy={middle} r={5} fill={CHART.critical} />
          <text x={alertX + 5} y={middle} dominantBaseline="central" textAnchor="middle" fontSize={8} fontWeight={700} fill="#ffffff">!</text>
          <text x={alertX + 14} y={middle} dominantBaseline="central" fontSize={11} fill={CHART.inkSecondary} {...HALO}>{alert}</text>
        </g>
      )}
    </g>
  )
}


// The likely range as a line, with a dot at the usual time: filled when it
// comes mostly from the supplier's own deliveries, a ring when it has few and
// leans on every supplier's.
function RangeLine({ x, y, width, height, background, payload, isActive, name }) {
  const left = Math.min(x, x + width)
  const span = Math.abs(width)
  const middle = y + height / 2
  const share = payload.slow > payload.quick ? (payload.usual - payload.quick) / (payload.slow - payload.quick) : 0
  const measured = !payload.leansOnEveryone

  return (
    <g opacity={isActive ? 0.85 : 1}>
      <NameAbove background={background} x={left} y={y} name={name} />
      <line x1={left} x2={left + span} y1={middle} y2={middle} stroke={CHART.series} strokeWidth={2} strokeLinecap="round" />
      <circle
        cx={left + share * span}
        cy={middle}
        r={5}
        fill={measured ? CHART.series : CHART.surface}
        stroke={measured ? CHART.surface : CHART.series}
        strokeWidth={2}
      />
      <text x={left + span + 10} y={middle} dominantBaseline="central" fontSize={12} fill={CHART.ink} {...HALO}>
        {formatDays(payload.usual)}
      </text>
    </g>
  )
}


// A column above zero when late, below when early, rounded at its end; a dot on
// the line when it came on the promised day.
function SignedBar({ x, y, width, height, payload, isActive }) {
  const days = payload.lateness
  const breadth = Math.max(Number(width) || 0, 0)

  if (!days) {
    return <circle cx={x + breadth / 2} cy={y} r={4} fill={CHART.onDay} stroke={CHART.surface} strokeWidth={2} opacity={isActive ? 0.8 : 1} />
  }

  const top = Math.min(y, y + height)
  const size = Math.abs(height)
  const corner = Math.min(4, breadth / 2, size)
  const path = days > 0
    ? `M${x},${top + size} V${top + corner} Q${x},${top} ${x + corner},${top} H${x + breadth - corner} Q${x + breadth},${top} ${x + breadth},${top + corner} V${top + size} Z`
    : `M${x},${top} H${x + breadth} V${top + size - corner} Q${x + breadth},${top + size} ${x + breadth - corner},${top + size} H${x + corner} Q${x},${top + size} ${x},${top + size - corner} Z`

  return <path d={path} fill={days > 0 ? CHART.late : CHART.early} fillOpacity={isActive ? 0.8 : 1} />
}


// 1. Where the time goes -----------------------------------------------------------------

// What a step's records are: finished orders, or labels (utils/labelHistory.js).
const STEP_UNITS = {
  order: { one: 'finished order', many: 'finished orders', short: 'orders', heading: 'Finished orders' },
  label: { one: 'label', many: 'labels', short: 'labels', heading: 'Labels' },
}

// A step with too few records has no numbers yet.
const notYet = (step, unit) => `Needs ${step.needed} ${unit.many}; ${step.records} so far`

function StepTooltip({ active, payload, unit }) {
  const step = active && payload?.[0]?.payload
  if (!step) return null

  if (step.typical === null) {
    return <TooltipBox value={`Not enough ${unit.short} yet`} name={step.label} lines={[notYet(step, unit)]} />
  }

  return (
    <TooltipBox
      value={formatDays(step.typical)}
      name={step.label}
      lines={[
        `Likely ${formatDays(step.quick)} to ${formatDays(step.slow)}`,
        `From ${count(step.records, unit.one)}`,
      ]}
    />
  )
}

// counts: what the steps' records are, 'order' or 'label'.
export function StepTimesChart({ steps, counts = 'order' }) {
  const [ref, compact] = useCompact()
  const unit = STEP_UNITS[counts]
  const data = steps.map((step) => ({ ...step, days: step.typical ?? 0 }))
  const longest = Math.max(...data.map((step) => step.days))
  const shape = (props) => (
    <HorizontalBar
      {...props}
      fill={props.payload.days === longest ? CHART.series : CHART.muted}
      label={props.payload.typical === null ? `Not enough ${unit.short} yet` : formatDays(props.payload.typical)}
      name={compact ? props.payload.label : null}
    />
  )

  return (
    <div ref={ref}>
      <ResponsiveContainer width="100%" height={data.length * (compact ? 52 : 40) + 8}>
        <BarChart data={data} layout="vertical" margin={{ top: compact ? 12 : 4, right: 76, bottom: 4, left: 0 }} barCategoryGap={compact ? 22 : 12}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis type="category" dataKey="label" hide={compact} width={156} axisLine={false} tickLine={false} tick={CATEGORY_TICK} />
          <Tooltip cursor={{ fill: CHART.hover }} content={<StepTooltip unit={unit} />} />
          <Bar dataKey="days" barSize={16} isAnimationActive={false} shape={shape} activeBar={shape} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function StepTimesTable({ steps, counts = 'order' }) {
  const unit = STEP_UNITS[counts]

  return (
    <DataTable
      rows={steps}
      rowKey={(step) => step.key}
      columns={[
        { label: 'Step', value: (step) => step.label },
        { label: 'Usual', value: (step) => (step.typical === null ? `Not enough ${unit.short} yet` : formatDays(step.typical)), numeric: true },
        { label: 'Likely range', value: (step) => (step.typical === null ? '—' : `${formatDays(step.quick)} to ${formatDays(step.slow)}`), numeric: true },
        { label: unit.heading, value: (step) => step.records || 'None yet', numeric: true },
      ]}
    />
  )
}


// 1b. Days at sea, by country ---------------------------------------------------------------

function AtSeaTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload
  if (!row) return null

  return (
    <TooltipBox
      value={`Usually ${formatDays(row.usual)} at sea`}
      name={row.name}
      lines={[
        `Likely ${formatDays(row.quick)} to ${formatDays(row.slow)} from shipping to arriving`,
        `From ${count(row.arrivals, 'recorded arrival')}`,
      ]}
    />
  )
}

export function AtSeaChart({ rows }) {
  const data = rows.map((row) => ({ ...row, span: [row.quick, row.slow] }))
  const max = Math.ceil((Math.max(7, ...data.map((row) => row.slow)) + 1) / 7) * 7
  const ticks = Array.from({ length: max / 7 + 1 }, (_, index) => index * 7)
  const [ref, compact] = useCompact()
  const shape = (props) => <RangeLine {...props} name={compact ? props.payload.name : null} />

  return (
    <div ref={ref}>
      <ResponsiveContainer width="100%" height={data.length * (compact ? 50 : 36) + 40}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 80, bottom: 4, left: 0 }} barCategoryGap={compact ? 18 : 10}>
          <CartesianGrid horizontal={false} stroke={CHART.grid} />
          <XAxis type="number" domain={[0, max]} ticks={ticks} tick={TICK} tickLine={false} axisLine={{ stroke: CHART.axis }} tickFormatter={(days) => `${days}d`} />
          <YAxis type="category" dataKey="name" hide={compact} width={168} axisLine={false} tickLine={false} tick={CATEGORY_TICK} tickFormatter={(name) => shorten(name)} />
          <Tooltip cursor={{ fill: CHART.hover }} content={<AtSeaTooltip />} />
          <Bar dataKey="span" barSize={12} isAnimationActive={false} shape={shape} activeBar={shape} />
        </BarChart>
      </ResponsiveContainer>

      <Legend items={[
        { label: 'Likely range', mark: 'line', color: CHART.series },
        { label: 'Usual days at sea, from its recorded arrivals', mark: 'dot', color: CHART.series },
      ]} />
    </div>
  )
}

export function AtSeaTable({ rows }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      columns={[
        { label: 'Country', value: (row) => row.name },
        { label: 'Usual', value: (row) => formatDays(row.usual), numeric: true },
        { label: 'Likely range', value: (row) => `${formatDays(row.quick)} to ${formatDays(row.slow)}`, numeric: true },
        { label: 'Arrivals', value: (row) => row.arrivals, numeric: true },
      ]}
    />
  )
}


// 2. On-time rate by supplier ------------------------------------------------------------

function OnTimeTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload
  if (!row) return null

  return (
    <TooltipBox
      value={`${row.percent}% on time`}
      name={row.name}
      lines={[
        `${row.onTimeCount} of ${count(row.judged, 'delivery', 'deliveries')} by the promised date, last 12 months`,
        row.belowTarget ? `Below the ${TARGET_PERCENT}% target` : `At or above the ${TARGET_PERCENT}% target`,
      ]}
    />
  )
}

export function OnTimeChart({ rated }) {
  const [ref, compact] = useCompact()
  const data = rated.map((row) => ({ ...row, percent: Math.round(row.onTimeRate * 100) }))
  const shape = (props) => (
    <HorizontalBar
      {...props}
      fill={props.payload.belowTarget ? CHART.critical : CHART.series}
      label={`${props.payload.percent}%`}
      alert={props.payload.belowTarget ? 'Below target' : null}
      name={compact ? props.payload.name : null}
    />
  )

  return (
    <div ref={ref}>
      <ResponsiveContainer width="100%" height={data.length * (compact ? 50 : 36) + 32}>
        <BarChart data={data} layout="vertical" margin={{ top: 24, right: 132, bottom: 4, left: 0 }} barCategoryGap={compact ? 20 : 10}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis type="category" dataKey="name" hide={compact} width={168} axisLine={false} tickLine={false} tick={CATEGORY_TICK} tickFormatter={(name) => shorten(name)} />
          <Tooltip cursor={{ fill: CHART.hover }} content={<OnTimeTooltip />} />
          <ReferenceLine
            x={TARGET_PERCENT}
            stroke={CHART.inkSecondary}
            strokeDasharray="4 4"
            label={{ value: `Target ${TARGET_PERCENT}%`, position: 'top', fill: CHART.inkSecondary, fontSize: 11 }}
          />
          <Bar dataKey="percent" barSize={16} isAnimationActive={false} shape={shape} activeBar={shape} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function OnTimeTable({ rated }) {
  return (
    <DataTable
      rows={rated}
      rowKey={(row) => row.id}
      columns={[
        { label: 'Supplier', value: (row) => row.name },
        { label: 'On time', value: (row) => formatPercent(row.onTimeRate), numeric: true },
        { label: 'Deliveries', value: (row) => `${row.onTimeCount} of ${row.judged}`, numeric: true },
        { label: `Target ${TARGET_PERCENT}%`, value: (row) => (row.belowTarget ? 'Below' : 'Met') },
      ]}
    />
  )
}


// 3. Lead time by supplier --------------------------------------------------------------

function LeadTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload
  if (!row) return null

  return (
    <TooltipBox
      value={`Usually ${formatDays(row.usual)}`}
      name={row.name}
      lines={[
        `Likely ${formatDays(row.quick)} to ${formatDays(row.slow)} from PO to delivery`,
        `From ${count(row.deliveries, 'delivery', 'deliveries')}${row.leansOnEveryone ? ", leaning on every supplier's" : ''}`,
      ]}
    />
  )
}

export function LeadTimeChart({ rows }) {
  const data = rows.map((row) => ({ ...row, span: [row.quick, row.slow] }))
  const top = Math.max(MIN_PO_DELIVERY_DAYS, ...data.map((row) => row.slow))
  const max = Math.ceil((top + 1) / 7) * 7
  const ticks = Array.from({ length: max / 7 + 1 }, (_, index) => index * 7)
  const [ref, compact] = useCompact()
  const shape = (props) => <RangeLine {...props} name={compact ? props.payload.name : null} />

  const legend = [{ label: 'Likely range', mark: 'line', color: CHART.series }]
  if (data.some((row) => !row.leansOnEveryone)) legend.push({ label: 'Usual, from its deliveries', mark: 'dot', color: CHART.series })
  if (data.some((row) => row.leansOnEveryone)) legend.push({ label: "Usual, few deliveries: leaning on every supplier's", mark: 'ring', color: CHART.series })

  return (
    <div ref={ref}>
      <ResponsiveContainer width="100%" height={data.length * (compact ? 50 : 36) + 56}>
        <BarChart data={data} layout="vertical" margin={{ top: 24, right: 80, bottom: 4, left: 0 }} barCategoryGap={compact ? 18 : 10}>
          <CartesianGrid horizontal={false} stroke={CHART.grid} />
          <XAxis type="number" domain={[0, max]} ticks={ticks} tick={TICK} tickLine={false} axisLine={{ stroke: CHART.axis }} tickFormatter={(days) => `${days}d`} />
          <YAxis type="category" dataKey="name" hide={compact} width={168} axisLine={false} tickLine={false} tick={CATEGORY_TICK} tickFormatter={(name) => shorten(name)} />
          <Tooltip cursor={{ fill: CHART.hover }} content={<LeadTooltip />} />
          <ReferenceLine
            x={MIN_PO_DELIVERY_DAYS}
            stroke={CHART.inkSecondary}
            strokeDasharray="4 4"
            label={{ value: `${MIN_PO_DELIVERY_DAYS}-day PO minimum`, position: 'top', fill: CHART.inkSecondary, fontSize: 11 }}
          />
          <Bar dataKey="span" barSize={12} isAnimationActive={false} shape={shape} activeBar={shape} />
        </BarChart>
      </ResponsiveContainer>

      <Legend items={legend} />
    </div>
  )
}

export function LeadTimeTable({ rows }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      columns={[
        { label: 'Supplier', value: (row) => row.name },
        { label: 'Usual', value: (row) => formatDays(row.usual), numeric: true },
        { label: 'Likely range', value: (row) => `${formatDays(row.quick)} to ${formatDays(row.slow)}`, numeric: true },
        { label: 'From', value: (row) => `${count(row.deliveries, 'delivery', 'deliveries')}${row.leansOnEveryone ? " + every supplier's" : ''}` },
      ]}
    />
  )
}


// 3b. Busy months -------------------------------------------------------------------------

const MONTH_NAMES = Array.from({ length: 12 }, (_, index) =>
  new Date(Date.UTC(2026, index, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }))
const FULL_MONTH_NAMES = Array.from({ length: 12 }, (_, index) =>
  new Date(Date.UTC(2026, index, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }))

const extraText = (days) => {
  if (days === null) return 'No deliveries'
  const rounded = Math.round(days * 10) / 10
  if (Math.abs(rounded) < 0.5) return 'As usual'
  return rounded > 0 ? `+${formatDays(rounded)}` : `−${formatDays(-rounded)}`
}

function BusyMonthTooltip({ active, payload }) {
  const month = active && payload?.[0]?.payload
  if (!month) return null

  return (
    <TooltipBox
      value={extraText(month.extraDays)}
      name={`POs sent in ${FULL_MONTH_NAMES[month.month - 1]}`}
      lines={[month.deliveries ? `From ${count(month.deliveries, 'delivery', 'deliveries')}` : 'No deliveries yet']}
    />
  )
}

// A column above the line when deliveries took longer than usual, below when
// quicker; its days on top.
function MonthBar({ x, y, width, height, payload, isActive }) {
  const days = payload.extraDays
  const breadth = Math.max(Number(width) || 0, 0)
  if (days === null || Math.abs(days) < 0.05) return null

  const top = Math.min(y, y + height)
  const size = Math.abs(height)
  const corner = Math.min(4, breadth / 2, size)
  const path = days > 0
    ? `M${x},${top + size} V${top + corner} Q${x},${top} ${x + corner},${top} H${x + breadth - corner} Q${x + breadth},${top} ${x + breadth},${top + corner} V${top + size} Z`
    : `M${x},${top} H${x + breadth} V${top + size - corner} Q${x + breadth},${top + size} ${x + breadth - corner},${top + size} H${x + corner} Q${x},${top + size} ${x},${top + size - corner} Z`

  return (
    <g opacity={isActive ? 0.85 : 1}>
      <path d={path} fill={days > 0 ? CHART.series : CHART.muted} />
      {Math.abs(days) >= 0.5 && (
        <text x={x + breadth / 2} y={days > 0 ? top - 5 : top + size + 13} textAnchor="middle" fontSize={11} fill={CHART.ink} {...HALO}>
          {days > 0 ? `+${Math.round(days)}` : `−${Math.round(-days)}`}
        </text>
      )}
    </g>
  )
}

export function BusyMonthsChart({ months }) {
  const data = months.map((month) => ({ ...month, label: MONTH_NAMES[month.month - 1], value: month.extraDays ?? 0 }))
  const step = Math.max(2, Math.ceil(Math.max(...data.map((month) => Math.abs(month.value))) / 2))
  const extent = step * 2
  const shape = (props) => <MonthBar {...props} />

  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={TICK} interval={0} />
          <YAxis
            domain={[-extent, extent]}
            ticks={[-extent, -step, 0, step, extent]}
            width={36}
            axisLine={false}
            tickLine={false}
            tick={TICK}
            tickFormatter={(days) => (days > 0 ? `+${days}` : days)}
          />
          <ReferenceLine y={0} stroke={CHART.axis} />
          <Tooltip cursor={{ fill: CHART.hover }} content={<BusyMonthTooltip />} />
          <Bar dataKey="value" maxBarSize={28} isAnimationActive={false} shape={shape} activeBar={shape} />
        </BarChart>
      </ResponsiveContainer>

      <Legend items={[
        { label: 'Longer than usual (days)', mark: 'bar', color: CHART.series },
        { label: 'Quicker than usual', mark: 'bar', color: CHART.muted },
      ]} />
    </>
  )
}

export function BusyMonthsTable({ months }) {
  return (
    <DataTable
      rows={months}
      rowKey={(month) => month.month}
      columns={[
        { label: 'POs sent in', value: (month) => FULL_MONTH_NAMES[month.month - 1] },
        { label: 'Against usual', value: (month) => extraText(month.extraDays), numeric: true },
        { label: 'Deliveries', value: (month) => month.deliveries || 'None', numeric: true },
      ]}
    />
  )
}


// 4. Shipping on time, by month ------------------------------------------------------------

function MonthTooltip({ active, payload }) {
  const month = active && payload?.[0]?.payload
  if (!month) return null

  return month.shipped ? (
    <TooltipBox
      value={`${month.percent}% on time`}
      name={formatMonth(month.month)}
      lines={[`${month.onTime} of ${count(month.shipped, 'order')} shipped by the requested date`]}
    />
  ) : (
    <TooltipBox value="No orders" name={formatMonth(month.month)} lines={['None shipped with a requested date']} />
  )
}

export function MonthlyOnTimeChart({ months }) {
  const data = months.map((month) => ({ ...month, label: shortMonth(month.month), percent: month.rate === null ? null : Math.round(month.rate * 100) }))
  const last = data.findLastIndex((month) => month.percent !== null)

  const endLabel = ({ x, y, index, value }) => (index === last && value !== null && value !== undefined
    ? <text x={x + 10} y={y} dominantBaseline="central" fontSize={12} fill={CHART.ink} {...HALO}>{value}%</text>
    : null)

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 16, right: 44, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: CHART.axis }} tick={TICK} interval="preserveStartEnd" />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value) => `${value}%`} width={44} axisLine={false} tickLine={false} tick={TICK} />
        <Tooltip cursor={{ stroke: CHART.axis, strokeWidth: 1 }} content={<MonthTooltip />} />
        <Line
          type="linear"
          dataKey="percent"
          stroke={CHART.series}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          connectNulls={false}
          dot={{ r: 4, fill: CHART.series, stroke: CHART.surface, strokeWidth: 2 }}
          activeDot={{ r: 6, fill: CHART.series, stroke: CHART.surface, strokeWidth: 2 }}
          isAnimationActive={false}
        >
          <LabelList dataKey="percent" content={endLabel} />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  )
}

export function MonthlyOnTimeTable({ months }) {
  return (
    <DataTable
      rows={months}
      rowKey={(month) => month.month}
      columns={[
        { label: 'Month', value: (month) => formatMonth(month.month) },
        { label: 'On time', value: (month) => formatPercent(month.rate), numeric: true },
        { label: 'Orders', value: (month) => (month.shipped ? `${month.onTime} of ${month.shipped}` : 'None'), numeric: true },
      ]}
    />
  )
}


// 5. Coming up, by week ---------------------------------------------------------------------

const weekName = (week, index) => (index === 0 ? 'This week, and orders already ready' : `Week of ${formatDay(week.weekStart)}`)

function WeekTooltip({ active, payload }) {
  const week = active && payload?.[0]?.payload
  if (!week) return null

  const shown = week.orders.slice(0, 6)
  const more = week.orders.length - shown.length

  return (
    <TooltipBox
      value={count(week.count, 'order')}
      name={weekName(week, week.index)}
      lines={week.count ? [`${shown.join(', ')}${more ? `, and ${more} more` : ''}`] : ['None due to be ready']}
    />
  )
}

export function ComingUpChart({ weeks }) {
  const [ref, compact] = useCompact()
  const data = weeks.map((week, index) => ({ ...week, index, label: index === 0 ? (compact ? 'Now' : 'This week') : formatDay(week.weekStart) }))

  return (
    <div ref={ref}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: CHART.axis }} tick={TICK} interval={compact ? 1 : 0} />
          <YAxis allowDecimals={false} width={32} axisLine={false} tickLine={false} tick={TICK} />
          <Tooltip cursor={{ fill: CHART.hover }} content={<WeekTooltip />} />
          <Bar dataKey="count" maxBarSize={24} radius={[4, 4, 0, 0]} fill={CHART.series} isAnimationActive={false} activeBar={{ fillOpacity: 0.8 }}>
            <LabelList dataKey="count" position="top" fill={CHART.ink} fontSize={12} formatter={(value) => (value ? value : '')} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ComingUpTable({ weeks }) {
  return (
    <DataTable
      rows={weeks.map((week, index) => ({ ...week, index }))}
      rowKey={(week) => week.weekStart}
      columns={[
        { label: 'Week', value: (week) => weekName(week, week.index) },
        { label: 'Orders', value: (week) => week.count, numeric: true },
        { label: 'Which', value: (week) => week.orders.join(', ') || '—' },
      ]}
    />
  )
}


// 6. Prediction accuracy --------------------------------------------------------------------

function MethodTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload
  if (!row) return null
  const what = row.inUse ? 'The method in use'
    : row.key === 'average' ? 'The baseline: the same estimate for every order'
      : 'Not in use: the method in use did better'
  return <TooltipBox value={row.text} name={row.label} lines={[what]} />
}

function MethodBars({ title, note, rows, max }) {
  const [ref, compact] = useCompact()
  const shape = (props) => (
    <HorizontalBar {...props} fill={props.payload.inUse ? CHART.series : CHART.muted} label={props.payload.text} name={compact ? props.payload.name : null} />
  )

  return (
    <div ref={ref} className="min-w-0">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      <p className="text-xs text-gray-500">{note}</p>

      <ResponsiveContainer width="100%" height={rows.length * (compact ? 52 : 40) + 8}>
        <BarChart data={rows} layout="vertical" margin={{ top: compact ? 16 : 8, right: 64, bottom: 0, left: 0 }} barCategoryGap={compact ? 22 : 12}>
          <XAxis type="number" hide domain={[0, max]} />
          <YAxis type="category" dataKey="name" hide={compact} width={128} axisLine={false} tickLine={false} tick={CATEGORY_TICK} />
          <Tooltip cursor={{ fill: CHART.hover }} content={<MethodTooltip />} />
          <Bar dataKey="value" barSize={16} isAnimationActive={false} shape={shape} activeBar={shape} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function AccuracyChart({ accuracy }) {
  const methods = accuracy.methods.map((method) => ({ ...method, name: method.inUse ? `${method.label} (in use)` : method.label }))
  const inRange = methods.map((method) => ({ ...method, value: method.withinRangeShare * 100, text: formatPercent(method.withinRangeShare) }))
  const within = methods.map((method) => ({ ...method, value: method.withinShare * 100, text: formatPercent(method.withinShare) }))
  const daysOff = methods.map((method) => ({ ...method, value: method.averageDaysOff, text: formatDays(method.averageDaysOff) }))

  return (
    <>
      <div className="grid gap-6 sm:grid-cols-2">
        <MethodBars title="Shipped within the likely range" note="Higher is better" rows={inRange} max={100} />
        <MethodBars title={`Within ${WITHIN_DAYS} days of the date`} note="Higher is better" rows={within} max={100} />
        <MethodBars title="Average days off the date" note="Lower is better" rows={daysOff} max={Math.max(1, ...daysOff.map((row) => row.value))} />
      </div>
      {accuracy.labeling?.enough && <LabelingAccuracy check={accuracy.labeling} />}
    </>
  )
}

// Once an order is in labeling: its ready date from its labels' steps, against
// labeling as a whole (utils/analytics.js labelingCheck).
function LabelingAccuracy({ check }) {
  const methods = check.methods.map((method) => ({ ...method, name: method.inUse ? `${method.label} (in use)` : method.label }))
  const daysOff = methods.map((method) => ({ ...method, value: method.averageDaysOff, text: formatDays(method.averageDaysOff) }))
  const inRange = methods.map((method) => ({ ...method, value: method.withinRangeShare * 100, text: formatPercent(method.withinRangeShare) }))

  return (
    <div className="mt-6 border-t border-gray-100 pt-4">
      <p className="text-sm font-semibold text-gray-800">Ready date, once an order is in labeling</p>
      <p className="mb-2 text-xs text-gray-500">
        {count(check.testedOrders, 'order')} it didn't learn from, each predicted as its labels moved on
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <MethodBars title="Ready within the likely range" note="Higher is better" rows={inRange} max={100} />
        <MethodBars title="Average days off the ready date" note="Lower is better" rows={daysOff} max={Math.max(1, ...daysOff.map((row) => row.value))} />
      </div>
    </div>
  )
}

export function AccuracyTable({ accuracy }) {
  return (
    <>
      <DataTable
        rows={accuracy.methods}
        rowKey={(method) => method.key}
        columns={[
          { label: 'Method', value: (method) => (method.inUse ? `${method.label} (in use)` : method.label) },
          { label: 'Within the likely range', value: (method) => formatPercent(method.withinRangeShare), numeric: true },
          { label: `Within ${WITHIN_DAYS} days`, value: (method) => formatPercent(method.withinShare), numeric: true },
          { label: 'Average days off', value: (method) => formatDays(method.averageDaysOff), numeric: true },
        ]}
      />

      {accuracy.labeling?.enough && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-gray-800">Ready date, once an order is in labeling</p>
          <DataTable
            rows={accuracy.labeling.methods}
            rowKey={(method) => method.key}
            columns={[
              { label: 'Method', value: (method) => (method.inUse ? `${method.label} (in use)` : method.label) },
              { label: 'Within the likely range', value: (method) => formatPercent(method.withinRangeShare), numeric: true },
              { label: 'Average days off', value: (method) => formatDays(method.averageDaysOff), numeric: true },
            ]}
          />
        </div>
      )}
    </>
  )
}


// 7. Demand forecast ---------------------------------------------------------------------------

const casesText = (cases) => `${Math.round(cases).toLocaleString('en-US')} cases`

// The months on record (the last 12) and the forecast, one row each. The
// forecast's first month is the month under way, live: moved by what's been
// placed so far (utils/demandForecast.js), with the forecast made before it.
const demandRows = (history = [], forecast = []) => [
  ...history.slice(-12).map((row) => ({ month: row.month, cases: row.cases, forecast: false })),
  ...(forecast || []).map((row) => ({
    month: row.month, cases: row.cases, quick: row.quick, slow: row.slow, forecast: true, range: [row.cases - row.quick, row.slow - row.cases],
    live: Boolean(row.live), placed: row.placed ?? null, before: row.before?.cases ?? null,
  })),
].map((row) => ({ ...row, label: shortMonth(row.month) }))

function DemandTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload
  if (!row) return null

  const lines = !row.forecast ? ['Ordered (orders past their down payment)']
    : row.live ? [
      `Live: likely ${casesText(row.quick)} to ${casesText(row.slow)}`,
      `${casesText(row.placed)} placed so far; about ${casesText(row.before)} forecast before the month`,
    ]
      : [`Forecast: likely ${casesText(row.quick)} to ${casesText(row.slow)}`]

  return (
    <TooltipBox
      value={row.forecast ? `About ${casesText(row.cases)}` : casesText(row.cases)}
      name={formatMonth(row.month)}
      lines={lines}
    />
  )
}

export function DemandChart({ history, forecast }) {
  const data = demandRows(history, forecast)

  return (
    <>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: CHART.axis }} tick={TICK} interval={0} />
          <YAxis width={52} axisLine={false} tickLine={false} tick={TICK} tickFormatter={(cases) => Number(cases).toLocaleString('en-US')} />
          <Tooltip cursor={{ fill: CHART.hover }} content={<DemandTooltip />} />
          <Bar dataKey="cases" maxBarSize={34} isAnimationActive={false} radius={[4, 4, 0, 0]}>
            {data.map((row) => (
              <Cell key={row.month} fill={row.forecast ? CHART.series : CHART.muted} />
            ))}
            <ErrorBar dataKey="range" width={8} strokeWidth={1.5} stroke={CHART.ink} direction="y" />
            <LabelList
              dataKey="cases"
              position="top"
              offset={14}
              content={({ x, y, width, value, index }) => (data[index]?.forecast
                ? <text x={x + width / 2} y={y - 14} textAnchor="middle" fontSize={11} fill={CHART.ink} {...HALO}>{Math.round(value).toLocaleString('en-US')}</text>
                : null)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <Legend items={[
        { label: 'Ordered', mark: 'bar', color: CHART.muted },
        { label: 'Forecast, with its likely range', mark: 'bar', color: CHART.series },
      ]} />
    </>
  )
}

export function DemandTable({ history, forecast }) {
  return (
    <DataTable
      rows={demandRows(history, forecast)}
      rowKey={(row) => row.month}
      columns={[
        { label: 'Month', value: (row) => `${formatMonth(row.month)}${row.live ? ' (live)' : ''}` },
        { label: 'Cases', value: (row) => (row.forecast ? `About ${casesText(row.cases)}` : casesText(row.cases)), numeric: true },
        { label: 'Likely range', value: (row) => (row.forecast ? `${casesText(row.quick)} to ${casesText(row.slow)}` : 'Ordered'), numeric: true },
      ]}
    />
  )
}

// The products most likely ordered this month (the forecast's first month).
export function TopProductsList({ products }) {
  if (!products.length) return null

  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <p className="text-sm font-medium text-gray-700">Most likely ordered this month</p>
      <ol className="mt-2 space-y-1.5 text-sm">
        {products.map((product, index) => (
          <li key={product.id} className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 text-gray-700">
              <span className="mr-2 text-gray-400 tabular-nums">{index + 1}.</span>
              {product.name || 'A product'}
              <span className="ml-1.5 text-xs text-gray-400">{product.category}</span>
            </span>
            <span className="shrink-0 text-gray-800 tabular-nums">about {casesText(product.nextMonth)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}


// 7b. A supplier's delivery history ---------------------------------------------------------------

const latenessText = (days) => {
  if (!days) return 'On the promised day'
  return days > 0 ? `${count(days, 'day')} late` : `${count(-days, 'day')} early`
}

function DeliveryTooltip({ active, payload }) {
  const delivery = active && payload?.[0]?.payload
  if (!delivery) return null

  return (
    <TooltipBox
      value={latenessText(delivery.lateness)}
      name={delivery.poNumber || 'A purchase order'}
      lines={[`Received ${formatDay(delivery.receivedOn)}, promised ${formatDay(delivery.promised)}`]}
    />
  )
}

export function DeliveryHistoryChart({ deliveries }) {
  const data = deliveries.map((delivery) => ({ ...delivery, label: formatDay(delivery.receivedOn) }))
  // An even scale around zero: e.g. -4, -2, 0, +2, +4.
  const step = Math.ceil(Math.max(3, ...data.map((delivery) => Math.abs(delivery.lateness))) / 2)
  const extent = step * 2
  const shape = (props) => <SignedBar {...props} />

  const legend = []
  if (data.some((delivery) => delivery.lateness > 0)) legend.push({ label: 'Late (days after the promised date)', mark: 'bar', color: CHART.late })
  if (data.some((delivery) => delivery.lateness < 0)) legend.push({ label: 'Early', mark: 'bar', color: CHART.early })
  if (data.some((delivery) => !delivery.lateness)) legend.push({ label: 'On the promised day', mark: 'dot', color: CHART.onDay })

  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={TICK} interval="preserveStartEnd" minTickGap={24} />
          <YAxis
            domain={[-extent, extent]}
            ticks={[-extent, -step, 0, step, extent]}
            width={36}
            axisLine={false}
            tickLine={false}
            tick={TICK}
            tickFormatter={(days) => (days > 0 ? `+${days}` : days)}
          />
          <ReferenceLine y={0} stroke={CHART.axis} />
          <Tooltip cursor={{ fill: CHART.hover }} content={<DeliveryTooltip />} />
          <Bar dataKey="lateness" maxBarSize={24} isAnimationActive={false} shape={shape} activeBar={shape} />
        </BarChart>
      </ResponsiveContainer>

      <Legend items={legend} />
    </>
  )
}

export function DeliveryHistoryTable({ deliveries }) {
  return (
    <DataTable
      rows={deliveries}
      rowKey={(delivery) => `${delivery.purchaseOrderId}:${delivery.receivedOn}`}
      columns={[
        { label: 'PO', value: (delivery) => delivery.poNumber || '—' },
        { label: 'Received', value: (delivery) => formatDay(delivery.receivedOn) },
        { label: 'Promised', value: (delivery) => formatDay(delivery.promised) },
        { label: 'Result', value: (delivery) => latenessText(delivery.lateness) },
      ]}
    />
  )
}
