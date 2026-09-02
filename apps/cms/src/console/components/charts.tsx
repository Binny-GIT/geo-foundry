import type { ReactNode } from "react"

/**
 * Server-rendered SVG charts for the Console dashboard. Zero client
 * JavaScript and zero external chart dependencies; values come pre-aggregated
 * from permission-scoped server queries.
 */

export type ChartSegment = {
  readonly color: string
  readonly label: string
  readonly value: number
}

export const DonutChart = ({
  segments,
  size = 168,
  thickness = 26,
}: {
  readonly segments: readonly ChartSegment[]
  readonly size?: number
  readonly thickness?: number
}) => {
  const visible = segments.filter((segment) => segment.value > 0)
  const total = visible.reduce((sum, segment) => sum + segment.value, 0)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2
  let offset = 0

  return (
    <svg
      aria-label="状态分布"
      height={size}
      role="img"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
    >
      <circle
        cx={center}
        cy={center}
        fill="none"
        r={radius}
        stroke="var(--console-surface-muted)"
        strokeWidth={thickness}
      />
      {total > 0 &&
        visible.map((segment) => {
          const length = (segment.value / total) * circumference
          const dash = `${Math.max(length - 2, 0)} ${circumference - Math.max(length - 2, 0)}`
          const element = (
            <circle
              cx={center}
              cy={center}
              fill="none"
              key={segment.label}
              r={radius}
              stroke={segment.color}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeWidth={thickness}
              transform={`rotate(-90 ${center} ${center})`}
            />
          )
          offset += length
          return element
        })}
      <text
        dominantBaseline="middle"
        fill="var(--console-ink)"
        fontSize={30}
        fontWeight={700}
        textAnchor="middle"
        x={center}
        y={center - 6}
      >
        {total}
      </text>
      <text
        dominantBaseline="middle"
        fill="var(--console-ink-muted)"
        fontSize={12}
        textAnchor="middle"
        x={center}
        y={center + 20}
      >
        篇文章
      </text>
    </svg>
  )
}

export type TrendPoint = {
  readonly date: string
  readonly value: number
}

export const TrendBars = ({
  data,
  color = "#6366f1",
  emptyLabel = "近 30 天暂无数据",
}: {
  readonly data: readonly TrendPoint[]
  readonly color?: string
  readonly emptyLabel?: string
}) => {
  const width = 640
  const height = 150
  const top = 12
  const bottom = 26
  const max = Math.max(...data.map((point) => point.value), 0)
  const chartHeight = height - top - bottom
  const step = data.length > 0 ? width / data.length : width
  const barWidth = Math.max(step - 3, 2)

  if (max === 0) {
    return (
      <div className="grid h-[150px] place-items-center rounded-md border border-dashed border-[var(--console-border)]">
        <span className="text-sm text-[var(--console-ink-muted)]">{emptyLabel}</span>
      </div>
    )
  }

  return (
    <svg
      aria-label="趋势图"
      height={height}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
    >
      {data.map((point, index) => {
        const barHeight = (point.value / max) * chartHeight
        return (
          <rect
            fill={point.value === 0 ? "var(--console-surface-muted)" : color}
            height={Math.max(point.value === 0 ? 2 : barHeight, 2)}
            key={point.date}
            rx={2}
            width={barWidth}
            x={index * step + 1.5}
            y={top + chartHeight - Math.max(point.value === 0 ? 2 : barHeight, 2)}
          />
        )
      })}
      <line
        stroke="var(--console-border)"
        x1={0}
        x2={width}
        y1={top + chartHeight}
        y2={top + chartHeight}
      />
      <text fill="var(--console-ink-muted)" fontSize={11} x={2} y={height - 8}>
        {data[0]?.date.slice(5) ?? ""}
      </text>
      <text
        fill="var(--console-ink-muted)"
        fontSize={11}
        textAnchor="end"
        x={width - 2}
        y={height - 8}
      >
        {data[data.length - 1]?.date.slice(5) ?? ""}
      </text>
      <text
        fill="var(--console-ink-muted)"
        fontSize={11}
        textAnchor="end"
        x={width - 2}
        y={top + 8}
      >
        峰值 {max}
      </text>
    </svg>
  )
}

export const RankedBars = ({
  items,
  color = "#6366f1",
  emptyLabel = "暂无数据",
}: {
  readonly color?: string
  readonly emptyLabel?: string
  readonly items: readonly { readonly label: string; readonly value: number }[]
}) => {
  if (items.length === 0) {
    return (
      <div className="grid min-h-24 place-items-center rounded-md border border-dashed border-[var(--console-border)]">
        <span className="text-sm text-[var(--console-ink-muted)]">{emptyLabel}</span>
      </div>
    )
  }
  const max = Math.max(...items.map((item) => item.value), 1)
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {items.map((item) => (
        <li className="grid gap-1.5" key={item.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium text-[var(--console-ink)]">
              {item.label}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--console-ink)]">
              {item.value}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--console-surface-muted)]">
            <div
              className="h-full rounded-full"
              style={{ backgroundColor: color, width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

export const ChartCard = ({
  action,
  children,
  title,
}: {
  readonly action?: ReactNode
  readonly children: ReactNode
  readonly title: string
}) => (
  <section className="gf-console-card grid gap-4 p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
        {title}
      </h2>
      {action}
    </div>
    {children}
  </section>
)
