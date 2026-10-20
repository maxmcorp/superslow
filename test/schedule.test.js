import test from 'node:test';
import assert from 'node:assert/strict';
import { callouts, events, lastCallout, spokenNumbers, verdict, DEFAULT_LAST_CALLOUT } from '../schedule.js';

test('callouts go every 10 s up to 60, then every 5 s', () => {
  assert.deepEqual(callouts(100), [10, 20, 30, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100]);
});

test('callouts stop at the last one asked for', () => {
  assert.deepEqual(callouts(40), [10, 20, 30, 40]);
  assert.equal(callouts().at(-1), DEFAULT_LAST_CALLOUT);
});

test('the highest recorded number past 60 sets the last callout', () => {
  assert.equal(lastCallout([0, 1, 10, 20, 60, 65, 120]), 120);
  assert.equal(lastCallout([0, 1, 10, 20, 30]), DEFAULT_LAST_CALLOUT);
  assert.equal(lastCallout([]), DEFAULT_LAST_CALLOUT);
});

test('a set speaks 10 down to 0, then the callouts', () => {
  const all = events(70);
  assert.deepEqual(
    all.map((e) => e.n),
    [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 10, 20, 30, 40, 50, 60, 65, 70],
  );
  assert.deepEqual(all.slice(0, 3).map((e) => e.at), [-10, -9, -8]);
  assert.equal(all.find((e) => e.n === 0).at, 0);
  assert.equal(all.findLast((e) => e.n === 10).at, 10);
  assert.equal(all.find((e) => e.n === 65).at, 65);
});

test('the spoken numbers are the files a set needs', () => {
  assert.deepEqual(spokenNumbers(75), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 65, 70, 75]);
});

test('verdict: under 60 too heavy, 60 to 90 good, over 90 too light', () => {
  assert.equal(verdict(0), 'heavy');
  assert.equal(verdict(59), 'heavy');
  assert.equal(verdict(60), 'good');
  assert.equal(verdict(90), 'good');
  assert.equal(verdict(91), 'light');
});
