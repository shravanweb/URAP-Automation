const NAMES = { minute: 0, hour: 1, day: 2, month: 3, weekday: 4 };
const RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  day: [1, 31],
  month: [1, 12],
  weekday: [0, 7],
};

function fieldMatch(expr, value) {
  if (expr === '*') return true;
  return expr.split(',').some((part) => {
    const [base, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : null;
    if (base === '*') return step ? value % step === 0 : true;
    if (base.includes('-')) {
      const [start, end] = base.split('-').map(Number);
      if (value < start || value > end) return false;
      return step ? (value - start) % step === 0 : true;
    }
    const exact = Number(base);
    if (step) return value >= exact && (value - exact) % step === 0;
    return value === exact;
  });
}

export function parseCron(expression) {
  const parts = String(expression || '').trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error('Cron expression must contain 5 fields');
  }
  for (const [name, index] of Object.entries(NAMES)) {
    const [min, max] = RANGES[name];
    const sample = parts[index];
    if (!/^[\d*/,\-]+$/.test(sample)) throw new Error(`Invalid cron field ${name}`);
    for (const piece of sample.split(',')) {
      const base = piece.split('/')[0];
      if (base === '*') continue;
      const bounds = base.split('-').map(Number);
      if (bounds.some((item) => Number.isNaN(item) || item < min || item > max)) {
        throw new Error(`Cron field ${name} is out of range`);
      }
    }
  }
  return parts;
}

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const bag = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[bag.weekday];
  return {
    minute: Number(bag.minute),
    hour: Number(bag.hour),
    day: Number(bag.day),
    month: Number(bag.month),
    weekday,
  };
}

export function matchesCron(expression, date, timeZone = 'UTC') {
  const parts = parseCron(expression);
  const zoned = zonedParts(date, timeZone);
  const checks = ['minute', 'hour', 'month'].every((name) => fieldMatch(parts[NAMES[name]], zoned[name]));
  const dayMatch = parts[2] === '*' || fieldMatch(parts[2], zoned.day);
  const weekMatch = parts[4] === '*' || fieldMatch(parts[4], zoned.weekday) || fieldMatch(parts[4], zoned.weekday === 0 ? 7 : zoned.weekday);
  const dayRule = parts[2] !== '*' && parts[4] !== '*' ? (dayMatch || weekMatch) : (dayMatch && weekMatch);
  return checks && dayRule;
}

export function nextRun(expression, from, timeZone = 'UTC') {
  parseCron(expression);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(from);
  } catch {
    throw new Error('Unknown time zone');
  }
  let cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor = new Date(cursor.getTime() + 60000);
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (matchesCron(expression, cursor, timeZone)) return cursor;
    cursor = new Date(cursor.getTime() + 60000);
  }
  throw new Error('No matching schedule run in the next year');
}
