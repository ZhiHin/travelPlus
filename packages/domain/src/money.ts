/**
 * Money arithmetic.
 *
 *   BR-M1  numeric with an ISO 4217 code, never floating point
 *   BR-M5  splits are computed in integer minor units and sum EXACTLY to the total
 *   BR-M6  the remainder minor unit is assigned deterministically, never dropped
 *
 * Amounts are handled as integer minor units (sen, cents, yen) throughout. A
 * float never touches a monetary value: 0.1 + 0.2 !== 0.3 is a rounding curiosity
 * in most software and a lost cent in an expense split between friends.
 */

/** Currencies whose minor unit is not 1/100. Extend as regions are added. */
const MINOR_UNIT_EXPONENT: Readonly<Record<string, number>> = Object.freeze({
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  BHD: 3,
  JOD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
})

const DEFAULT_MINOR_UNIT_EXPONENT = 2

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENT[currency.toUpperCase()] ?? DEFAULT_MINOR_UNIT_EXPONENT
}

/** An exact monetary amount. `minorUnits` is an integer; `currency` is ISO 4217. */
export interface Money {
  readonly minorUnits: number
  readonly currency: string
}

export function money(minorUnits: number, currency: string): Money {
  if (!Number.isInteger(minorUnits)) {
    throw new TypeError(`Money requires integer minor units, received ${minorUnits}`)
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError(`Currency must be a 3-letter ISO 4217 code, received "${currency}"`)
  }
  return { minorUnits, currency }
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    // BR-M2. Summing across currencies requires an explicit conversion carrying
    // a rate, a rate date and a rate source — never an implicit one here.
    throw new TypeError(
      `Cannot combine ${a.currency} with ${b.currency} without an explicit conversion`,
    )
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.minorUnits + b.minorUnits, a.currency)
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.minorUnits - b.minorUnits, a.currency)
}

export function sum(amounts: readonly Money[], currency: string): Money {
  return amounts.reduce((acc, m) => add(acc, m), money(0, currency))
}

export function isNegative(m: Money): boolean {
  return m.minorUnits < 0
}

/**
 * Split an amount into `parts` shares that sum exactly to the original.
 *
 * The remainder is distributed one minor unit at a time to the earliest shares,
 * so nothing is created or destroyed and the outcome is deterministic rather
 * than dependent on rounding mode. Splitting 10.00 three ways gives
 * 3.34 / 3.33 / 3.33 — never 3.33 x 3 with a cent quietly lost.
 *
 * Negative totals (a refund) distribute the remainder in the same direction.
 */
export function splitEvenly(total: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new RangeError(`Split requires a positive integer part count, received ${parts}`)
  }

  const sign = total.minorUnits < 0 ? -1 : 1
  const magnitude = Math.abs(total.minorUnits)
  const base = Math.floor(magnitude / parts)
  const remainder = magnitude - base * parts

  return Array.from({ length: parts }, (_, i) =>
    money(sign * (base + (i < remainder ? 1 : 0)), total.currency),
  )
}

/**
 * Split by weights (for example, a group where one traveller covers two shares).
 *
 * Largest-remainder apportionment: floor every share, then hand the leftover
 * units to the largest fractional remainders. Ties break toward the lower index
 * so the result is stable for identical inputs.
 */
export function splitByWeights(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new RangeError('Split requires at least one weight')
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new RangeError('Weights must be finite and non-negative')
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0)
  if (totalWeight <= 0) throw new RangeError('Weights must sum to more than zero')

  const sign = total.minorUnits < 0 ? -1 : 1
  const magnitude = Math.abs(total.minorUnits)

  const exact = weights.map((w) => (magnitude * w) / totalWeight)
  const floors = exact.map(Math.floor)
  let leftover = magnitude - floors.reduce((a, b) => a + b, 0)

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index)

  const result = [...floors]
  for (const { index } of order) {
    if (leftover <= 0) break
    result[index] = (result[index] ?? 0) + 1
    leftover -= 1
  }

  return result.map((units) => money(sign * units, total.currency))
}

/** Format for display. Presentation only — never used for arithmetic. */
export function formatMoney(m: Money, locale = 'en-US'): string {
  const exp = minorUnitExponent(m.currency)
  const value = m.minorUnits / 10 ** exp
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(value)
}
