import { useLayoutEffect, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
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
// comes from the supplier's deliveries, a ring when it's DMC's estimate.
function RangeLine({ x, y, width, height, background, payload, isActive, name }) {
  const left = Math.min(x, x + width)
  const span = Math.abs(width)
  const middle = y + height / 2
  const share = payload.slow > payload.quick ? (payload.usual - payload.quick) / (payload.slow - payload.quick) : 0
  const measured = payload.deliveries > 0

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

function StepTooltip({ active, payload }) {
  const step = active && payload?.[0]?.payload
  if (!step) return null

  return (
    <TooltipBox
      value={formatDays(step.typical)}
      name={step.label}
      lines={[
        `Likely ${formatDays(step.quick)} to ${formatDays(step.slow)}`,
        step.records
          ? `From ${count(step.records, 'finished order')}, blended with DMC's starting value`
          : "DMC's starting value, until there are finished orders",
      ]}
    />
  )
}

export function StepTimesChart({ steps }) {
  const [ref, compact] = useCompact()
  const longest = Math.max(...steps.map((step) => step.typical))
  const shape = (props) => (
    <HorizontalBar
      {...props}
      fill={props.payload.typical === longest ? CHART.series : CHART.muted}
      label={formatDays(props.payload.typical)}
      name={compact ? props.payload.label : null}
    />
  )

  return (
    <div ref={ref}>
      <ResponsiveContainer width="100%" height={steps.length * (compact ? 52 : 40) + 8}>
        <BarChart data={steps} layout="vertical" margin={{ top: compact ? 12 : 4, right: 76, bottom: 4, left: 0 }} barCategoryGap={compact ? 22 : 12}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis type="category" dataKey="label" hide={compact} width={156} axisLine={false} tickLine={false} tick={CATEGORY_TICK} />
          <Tooltip cursor={{ fill: CHART.hover }} content={<StepTooltip />} />
          <Bar dataKey="typical" barSize={16} isAnimationActive={false} shape={shape} activeBar={shape} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function StepTimesTable({ steps }) {
  return (
    <DataTable
      rows={steps}
      rowKey={(step) => step.key}
      columns={[
        { label: 'Step', value: (step) => step.label },
        { label: 'Usual', value: (step) => formatDays(step.typical), numeric: true },
        { label: 'Likely range', value: (step) => `${formatDays(step.quick)} to ${formatDays(step.slow)}`, numeric: true },
        { label: 'Finished orders', value: (step) => step.records || "None yet (DMC's value)", numeric: true },
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
        row.deliveries
          ? `From ${count(row.deliveries, 'delivery', 'deliveries')}${row.fromDmc ? ", blended with DMC's estimate" : ''}`
          : "DMC's estimate: no deliveries yet",
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
  if (data.some((row) => row.deliveries)) legend.push({ label: 'Usual, from its deliveries', mark: 'dot', color: CHART.series })
  if (data.some((row) => !row.deliveries)) legend.push({ label: "Usual, DMC's estimate (no deliveries yet)", mark: 'ring', color: CHART.series })

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
            label={{ value: `${MIN_PO_DELIVERY_DAYS}-day minimum`, position: 'top', fill: CHART.inkSecondary, fontSize: 11 }}
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
        { label: 'From', value: (row) => (row.deliveries ? count(row.deliveries, 'delivery', 'deliveries') : "DMC's estimate") },
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
  return <TooltipBox value={row.text} name={row.label} lines={[row.inUse ? 'The method in use' : 'The baseline: no records, starting values only']} />
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
  const daysOff = methods.map((method) => ({ ...method, value: method.averageDaysOff, text: formatDays(method.averageDaysOff) }))
  const within = methods.map((method) => ({ ...method, value: method.withinShare * 100, text: formatPercent(method.withinShare) }))

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <MethodBars title="Average days off" note="Lower is better" rows={daysOff} max={Math.max(1, ...daysOff.map((row) => row.value))} />
      <MethodBars title={`Within ${WITHIN_DAYS} days`} note="Higher is better" rows={within} max={100} />
    </div>
  )
}

export function AccuracyTable({ accuracy }) {
  return (
    <DataTable
      rows={accuracy.methods}
      rowKey={(method) => method.key}
      columns={[
        { label: 'Method', value: (method) => (method.inUse ? `${method.label} (in use)` : method.label) },
        { label: 'Average days off', value: (method) => formatDays(method.averageDaysOff), numeric: true },
        { label: `Within ${WITHIN_DAYS} days`, value: (method) => formatPercent(method.withinShare), numeric: true },
      ]}
    />
  )
}


// 7. A supplier's delivery history ---------------------------------------------------------------

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
