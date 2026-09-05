import { formatMoney } from '../lib/money'

/**
 * Render a monetary amount.
 *
 * Every inline amount goes through here so it always carries `.num`, which is
 * what the privacy blur targets. The previous approach — remembering to add the
 * class by hand at each site — leaked in seven places, including the dashboard
 * subtitle. A component cannot be forgotten in the same way.
 *
 * Chart axis ticks and tooltips are strings rather than elements, so they cannot
 * use this; they are covered by rules on the Recharts classes in index.css.
 */
export default function Money({
  amount, currency, compact = false, className = '',
}: {
  amount: number
  currency: string
  compact?: boolean
  className?: string
}) {
  return (
    <span className={`num ${className}`.trim()}>
      {formatMoney(amount, currency, { compact })}
    </span>
  )
}
