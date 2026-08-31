import type { CategoryGroup } from './types'

/**
 * Chart colour.
 *
 * Colour is keyed to the **group**, never to a category's rank. Two consequences,
 * both deliberate:
 *
 *   * Equity/debt/real-estate read as families rather than 20 unrelated hues.
 *   * A filter or a changed ordering never repaints the survivors — a reader who
 *     learned "equity is blue" stays right.
 *
 * Groups are listed in the palette's own slot order, and charts render segments
 * in this order, so on-screen adjacency matches the adjacency the validator
 * checked. Both modes pass all six checks (worst adjacent CVD ΔE 9.1 light /
 * 8.4 dark; normal-vision 19.6 / 19.3).
 *
 * Light mode WARNs on contrast for three slots, which obliges relief: every
 * chart here ships beside a table listing the same numbers.
 */
export const GROUP_ORDER: CategoryGroup[] = [
  'equity',       // slot 1  blue
  'real-estate',  // slot 2  orange
  'debt',         // slot 3  aqua
  'commodity',    // slot 4  yellow
  'alternative',  // slot 5  magenta
  'cash',         // slot 6  green
  'liability',    // slot 8  red — rendered in its own block, never mixed in
]

const LIGHT: Record<CategoryGroup, string> = {
  equity: '#2a78d6',
  'real-estate': '#eb6834',
  debt: '#1baf7a',
  commodity: '#eda100',
  alternative: '#e87ba4',
  cash: '#008300',
  liability: '#e34948',
}

const DARK: Record<CategoryGroup, string> = {
  equity: '#3987e5',
  'real-estate': '#d95926',
  debt: '#199e70',
  commodity: '#c98500',
  alternative: '#d55181',
  cash: '#008300',
  liability: '#e66767',
}

/**
 * Dark steps are *selected* for the dark surface, not an automatic flip of the
 * light ones — they were validated as their own set.
 */
export function groupColor(group: CategoryGroup, dark: boolean): string {
  return (dark ? DARK : LIGHT)[group] ?? (dark ? '#8a8a8a' : '#767676')
}

export const GROUP_LABEL: Record<CategoryGroup, string> = {
  equity: 'Equity',
  'real-estate': 'Real estate',
  debt: 'Debt & fixed income',
  commodity: 'Commodities',
  alternative: 'Alternatives',
  cash: 'Cash',
  liability: 'Liabilities',
}

/** Surface colour, for the 2px gaps and rings that separate touching marks. */
export const surface = (dark: boolean) => (dark ? '#1f1e1b' : '#ffffff')
