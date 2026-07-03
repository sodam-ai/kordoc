/**
 * 레이아웃 보존 렌더 — 순수 계산 유틸 (XML 무접촉).
 * 좌표 산식은 .claude/plans/render-poc/findings.md에서 실측 검증된 모델.
 * 단위: HWPUNIT(1/7200in), pt 변환은 /100.
 */

/** HWPX 좌표 속성은 uint32로 저장된 음수가 섞여 있다 (예: vertOffset=4294967103 = -193) */
export function toInt32(v: string | undefined, fallback = 0): number {
  if (v == null || v === "") return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return n > 0x7fffffff ? n - 0x100000000 : n
}

/** 셀 하나가 주는 경계 제약: boundary[a] + size = boundary[b] */
export interface SpanConstraint {
  a: number
  b: number
  size: number
}

/**
 * 표 열 경계 솔버 — 경계 전파.
 * 결재문서 트레일러처럼 41열 그리드에 span-1 셀이 거의 없어도,
 * x[ca+cs] = x[ca] + w 제약을 고정점까지 전파하면 전 경계가 풀린다 (실측 검증).
 * 미해결 경계는 인접 확정 경계 사이 균등 보간.
 */
export function solveBoundaries(constraints: SpanConstraint[], count: number, total?: number): number[] {
  const x = new Array<number | undefined>(count + 1).fill(undefined)
  x[0] = 0
  if (total != null && total > 0) x[count] = total
  let changed = true
  let guard = 0
  while (changed && guard++ < count + 8) {
    changed = false
    for (const c of constraints) {
      if (c.a < 0 || c.b > count || c.a >= c.b) continue
      const xa = x[c.a]
      const xb = x[c.b]
      if (xa != null && xb == null) {
        x[c.b] = xa + c.size
        changed = true
      } else if (xb != null && xa == null) {
        x[c.a] = xb - c.size
        changed = true
      }
    }
  }
  // 잔여 미해결 경계 — 좌우 확정 경계 사이 균등 보간
  let i = 0
  while (i <= count) {
    if (x[i] != null) { i++; continue }
    let lo = i - 1
    let hi = i
    while (hi <= count && x[hi] == null) hi++
    const loV = x[lo] as number
    const hiV = hi <= count ? (x[hi] as number) : loV + (hi - lo) * 1000
    const n = hi - lo
    for (let k = 1; k < n; k++) x[lo + k] = loV + ((hiV - loV) * k) / n
    if (hi > count) x[count] = hiV
    i = hi
  }
  // 단조 보정 (모순 제약 방어)
  const out = x as number[]
  for (let k = 1; k <= count; k++) if (out[k] < out[k - 1]) out[k] = out[k - 1]
  return out
}

/**
 * 표 행 높이 솔버 — rowSpan=1 셀의 max가 기본, rowSpan>1은 잔여 균등분배.
 * h=1 더미 셀(헤어라인 행 장식)이 섞이므로 열과 달리 max 방식이 안전.
 * grow: 셀 콘텐츠(사진 등)가 설계 높이를 넘으면 초과분만큼 행이 자란다 —
 * 사진대지 실측: 설계 16441 + 사진 22209 → 행 22209, 표 sz 합치 정확 일치.
 */
export function solveRowHeights(
  cells: { rowAddr: number; rowSpan: number; height: number; contentH?: number }[],
  rowCount: number,
): number[] {
  const h = new Array<number>(rowCount).fill(0)
  for (const c of cells) {
    if (c.rowSpan === 1 && c.rowAddr >= 0 && c.rowAddr < rowCount) {
      h[c.rowAddr] = Math.max(h[c.rowAddr], c.height)
    }
  }
  // rowSpan>1 셀 — 포함 행 중 미확정(0) 행에 잔여 균등분배
  for (const c of cells) {
    if (c.rowSpan <= 1) continue
    const rows: number[] = []
    for (let r = c.rowAddr; r < Math.min(c.rowAddr + c.rowSpan, rowCount); r++) rows.push(r)
    const known = rows.reduce((s, r) => s + h[r], 0)
    const missing = rows.filter(r => h[r] === 0)
    if (missing.length > 0 && c.height > known) {
      const each = (c.height - known) / missing.length
      for (const r of missing) h[r] = each
    }
  }
  // 콘텐츠 초과 성장 (rowSpan=1 셀만 — 사진 셀 케이스)
  for (const c of cells) {
    if (c.rowSpan === 1 && c.contentH != null && c.rowAddr >= 0 && c.rowAddr < rowCount) {
      if (c.contentH > h[c.rowAddr]) h[c.rowAddr] = c.contentH
    }
  }
  return h
}

// 자연폭 계산은 hwpx/text-metrics.ts의 함초롬바탕 실측 advance 테이블(measureTextWidth)을 재사용한다.
