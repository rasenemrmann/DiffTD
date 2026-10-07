// Line matching shared by the diff view and the 3-way merge.

const MAX_CELLS = 4_000_000;

/**
 * Longest-common-subsequence matches between two arrays of strings.
 * Returns [[indexInA, indexInB], ...] in ascending order.
 * Very large inputs fall back to prefix/suffix matching only, so the UI stays responsive.
 */
export function matchLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const out = [];
  for (let i = 0; i < start; i += 1) out.push([i, i]);

  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && (n + 1) * (m + 1) <= MAX_CELLS) {
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i * w + j] = a[start + i] === b[start + j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        out.push([start + i, start + j]);
        i += 1;
        j += 1;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i += 1;
      else j += 1;
    }
  }
  for (let k = 0; k < a.length - endA; k += 1) out.push([endA + k, endB + k]);
  return out;
}

/**
 * Changed regions between two line arrays.
 * Hunk: { beforeStart, beforeCount, afterStart, afterCount, before: [...], after: [...] }
 */
export function diffLines(before, after) {
  const matches = matchLines(before, after);
  const hunks = [];
  let i = 0;
  let j = 0;
  const flush = (ni, nj) => {
    if (ni > i || nj > j) {
      hunks.push({
        beforeStart: i,
        beforeCount: ni - i,
        afterStart: j,
        afterCount: nj - j,
        before: before.slice(i, ni),
        after: after.slice(j, nj),
      });
    }
  };
  for (const [mi, mj] of matches) {
    flush(mi, mj);
    i = mi + 1;
    j = mj + 1;
  }
  flush(before.length, after.length);
  return hunks;
}
