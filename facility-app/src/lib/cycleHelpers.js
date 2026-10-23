// Given an inspection cycle, return the Date at the start of the current
// period. Equipment is "due" for the period if it hasn't been inspected
// since this date. Daily is handled separately on the home screen.

export function periodStart(cycle, now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)

  switch (cycle) {
    case 'Weekly':
    case 'Bi-weekly': {
      // start of this week (Monday)
      const day = (d.getDay() + 6) % 7 // Mon=0 .. Sun=6
      d.setDate(d.getDate() - day)
      return d
    }
    case 'Monthly':
    case 'Bi-monthly': {
      d.setDate(1)
      return d
    }
    case 'Quarterly': {
      const q = Math.floor(d.getMonth() / 3) * 3
      d.setMonth(q, 1)
      return d
    }
    case 'Semi-annual': {
      const h = d.getMonth() < 6 ? 0 : 6
      d.setMonth(h, 1)
      return d
    }
    case 'Yearly': {
      d.setMonth(0, 1)
      return d
    }
    default:
      return d // Daily or unknown: today
  }
}

// Nice label for a "due" section header per cycle.
export function dueLabel(cycle) {
  switch (cycle) {
    case 'Weekly': return 'Due this week'
    case 'Bi-weekly': return 'Due this fortnight'
    case 'Monthly': return 'Due this month'
    case 'Bi-monthly': return 'Due this period'
    case 'Quarterly': return 'Due this quarter'
    case 'Semi-annual': return 'Due this half-year'
    case 'Yearly': return 'Due this year'
    default: return `Due (${cycle})`
  }
}
