// Time rules for a super-slow set. Times are seconds after "0", the moment you start lifting.

export const COUNTDOWN_FROM = 10;

// A set in this window means the weight is right.
export const GOOD_FROM = 60;
export const GOOD_TO = 90;

// Each of these is called out once; after the last one, callouts go every STEP seconds.
const FIXED = [10, 20, 30, 40, 50, 60];
const STEP = 5;

// How long callouts continue when no recorded sound says otherwise.
export const DEFAULT_LAST_CALLOUT = 180;

// The seconds at which the elapsed time is spoken, up to and including `last`.
export function callouts(last = DEFAULT_LAST_CALLOUT) {
  const times = FIXED.filter((t) => t <= last);
  for (let t = FIXED[FIXED.length - 1] + STEP; t <= last; t += STEP) times.push(t);
  return times;
}

// Callouts run up to the highest recorded number past the fixed ones.
export function lastCallout(available) {
  const beyond = available.filter((n) => n >= FIXED[FIXED.length - 1]);
  return beyond.length ? Math.max(...beyond) : DEFAULT_LAST_CALLOUT;
}

// Everything spoken during a set, countdown included, in order:
// { at: seconds relative to "0", n: the number spoken }.
export function events(last = DEFAULT_LAST_CALLOUT) {
  const countdown = [];
  for (let n = COUNTDOWN_FROM; n >= 0; n--) countdown.push({ at: 0 - n, n });
  return [...countdown, ...callouts(last).map((t) => ({ at: t, n: t }))];
}

// The numbers a full set can speak, so missing sound files can be reported.
export function spokenNumbers(last = DEFAULT_LAST_CALLOUT) {
  return [...new Set(events(last).map((e) => e.n))].sort((a, b) => a - b);
}

// 'heavy' under the window, 'good' inside it (both ends included), 'light' over it.
export function verdict(seconds) {
  if (seconds < GOOD_FROM) return 'heavy';
  if (seconds > GOOD_TO) return 'light';
  return 'good';
}
