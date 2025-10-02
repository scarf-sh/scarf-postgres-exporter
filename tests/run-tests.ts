import assert from 'assert';
import { computeRange } from '../src/logic';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`not ok - ${name}`);
    throw e;
  }
}

function dayAfter(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + 1);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Fixed reference date to make tests deterministic
const today = '2025-10-02';
const yesterday = '2025-10-01';

test('skip when lastImportedDate equals yesterday', () => {
  const plan = computeRange(yesterday, yesterday);
  assert.ok(plan.skip, 'should skip when already at yesterday');
});

test('skip when lastImportedDate is today', () => {
  const plan = computeRange(today, yesterday);
  assert.ok(plan.skip, 'should skip when last imported is today');
});

test('range when lastImportedDate two days ago', () => {
  const twoDaysAgo = '2025-09-30';
  const plan = computeRange(twoDaysAgo, yesterday);
  assert.strictEqual(plan.skip, false);
  if (!plan.skip) {
    assert.strictEqual(plan.start, dayAfter(twoDaysAgo));
    assert.strictEqual(plan.end, yesterday);
  }
});

test('skip when start would be after end (future lastImportedDate)', () => {
  const future = '2100-01-01';
  const plan = computeRange(future, yesterday);
  assert.ok(plan.skip, 'should skip when start > end');
});

console.log('All tests passed.');
