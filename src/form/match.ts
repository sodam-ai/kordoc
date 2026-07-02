/** 양식 필드 매칭 공용 유틸 — filler.ts, filler-hwpx.ts에서 공유 */

import { LABEL_KEYWORDS } from "./recognize.js"

/**
 * 채울 값 — 문자열이면 같은 라벨 모든 등장에 동일값(단일 양식),
 * 배열이면 등장 순서대로 하나씩 소진(2~30장 반복 양식·명부형 표).
 */
export type FillValue = string | string[]

/**
 * 다중값 커서 — 라벨별 값 소비 상태를 추적한다.
 * 스칼라 값은 무한 반복(기존 동작), 배열 값은 적용 순서대로 소진되며
 * 다 쓰면 available=false가 되어 이후 등장은 채우지 않는다.
 */
export class ValueCursor {
  private nextIdx = new Map<string, number>()
  constructor(private values: Map<string, FillValue>) {}

  keys(): IterableIterator<string> {
    return this.values.keys()
  }

  has(key: string): boolean {
    return this.values.has(key)
  }

  isArray(key: string): boolean {
    return Array.isArray(this.values.get(key))
  }

  /** 남은 값이 있으면 true (스칼라는 항상 true) */
  available(key: string): boolean {
    const v = this.values.get(key)
    if (v === undefined) return false
    return typeof v === "string" || (this.nextIdx.get(key) ?? 0) < v.length
  }

  /** 현재 값 미리보기 (소진 없음) */
  peek(key: string): string | undefined {
    const v = this.values.get(key)
    if (v === undefined) return undefined
    if (typeof v === "string") return v
    const i = this.nextIdx.get(key) ?? 0
    return i < v.length ? v[i] : undefined
  }

  /** 값 소비 — 배열이면 커서 전진, 소진 시 undefined */
  consume(key: string): string | undefined {
    const v = this.values.get(key)
    if (v === undefined) return undefined
    if (typeof v === "string") return v
    const i = this.nextIdx.get(key) ?? 0
    if (i >= v.length) return undefined
    this.nextIdx.set(key, i + 1)
    return v[i]
  }
}

/** 라벨 정규화 — 콜론/공백/특수문자 제거, 비교용 */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/[:：\s()（）·]/g, "")
}

/**
 * 정규화된 셀 라벨과 입력 값 맵에서 최적 매칭 키를 찾음.
 *
 * 매칭 우선순위:
 * 1. 정확 매칭 (normalizedCellLabel === key)
 * 2. 접두사 기반 매칭 (60% 이상 겹침 필요)
 */
export function findMatchingKey(
  cellLabel: string,
  values: { has(key: string): boolean; keys(): Iterable<string> },
): string | undefined {
  // 1) 정확 매칭
  if (values.has(cellLabel)) return cellLabel

  // 2) 접두사 기반 매칭 — 가장 긴 매칭 우선 (= 가장 구체적)
  //    단, 길이 비율 60% 이상 겹쳐야 매칭 (오탐 방지)
  let bestKey: string | undefined
  let bestLen = 0

  for (const key of values.keys()) {
    if (cellLabel.startsWith(key)) {
      if (key.length >= cellLabel.length * 0.6 && key.length > bestLen) {
        bestLen = key.length
        bestKey = key
      }
    } else if (key.startsWith(cellLabel)) {
      if (cellLabel.length >= key.length * 0.6 && cellLabel.length > bestLen) {
        bestLen = cellLabel.length
        bestKey = key
      }
    }
  }

  return bestKey
}

/**
 * 값 셀이 키워드 라벨(섹션 헤더의 하위 라벨)인지 판별.
 * "성명", "주소" 같은 키워드 라벨이면 true → 스킵 대상.
 * "(한자：)" 같은 어노테이션이면 false → 채울 수 있음.
 */
export function isKeywordLabel(text: string): boolean {
  const trimmed = text.trim().replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰*※]+$/g, "").trim()
  if (!trimmed || trimmed.length > 15) return false
  for (const kw of LABEL_KEYWORDS) {
    if (trimmed.includes(kw)) return true
  }
  return false
}

/**
 * 셀 텍스트에서 인셀 패턴을 찾아 교체 — 체크박스 + 괄호 빈칸.
 *
 * 지원 패턴:
 * 1. 괄호 빈칸: `일반(  )통` → 키 "일반통" 또는 "일반" 매칭 시 → `일반(값)통`
 * 2. 체크박스: `□부` → 키 "부" 매칭 시 → `☑부` (값이 "☑","✓","v","V","true","1" 등)
 *
 * @returns 교체된 텍스트 + 매칭된 키 목록. null이면 교체 없음.
 */
export function fillInCellPatterns(
  cellText: string,
  values: ValueCursor,
  matchedLabels: Set<string>,
): { text: string; matches: Array<{ key: string; label: string; value: string }> } | null {
  let text = cellText
  const matches: Array<{ key: string; label: string; value: string }> = []

  // 1) 괄호 빈칸: keyword(\s+)suffix → keyword(value)suffix
  text = text.replace(
    /([가-힣A-Za-z]+)\(\s{1,}\)([가-힣A-Za-z]*)/g,
    (match, prefix: string, suffix: string) => {
      const label = prefix + suffix  // "일반" + "통" = "일반통"
      const normalizedLabel = normalizeLabel(label)
      // 정확 매칭 → 접두사만 매칭 순
      const matchKey = values.available(normalizedLabel)
        ? normalizedLabel
        : values.available(normalizeLabel(prefix))
          ? normalizeLabel(prefix)
          : undefined
      if (matchKey === undefined) return match

      const newValue = values.consume(matchKey)!
      matchedLabels.add(matchKey)
      matches.push({ key: matchKey, label, value: newValue })
      return `${prefix}(${newValue})${suffix}`
    },
  )

  // 2) 체크박스: □keyword → ☑keyword (값이 truthy)
  text = text.replace(
    /□([가-힣A-Za-z]+)/g,
    (match, keyword: string) => {
      const normalizedKw = normalizeLabel(keyword)
      const matchKey = values.available(normalizedKw) ? normalizedKw : undefined
      if (matchKey === undefined) return match

      const val = values.peek(matchKey)!
      const isTruthy = ["☑", "✓", "✔", "v", "V", "true", "1", "yes", "o", "O"].includes(val.trim()) || val.trim() === ""
      if (!isTruthy) return match

      values.consume(matchKey)
      matchedLabels.add(matchKey)
      matches.push({ key: matchKey, label: `□${keyword}`, value: "☑" })
      return `☑${keyword}`
    },
  )

  // 3) 어노테이션 빈칸: (keyword：\s+) → (keyword：value)
  //    예: "(한자：                  )" → "(한자：金民秀)"
  //    예: "(성명:        )" → "(성명: 홍길동)"
  text = text.replace(
    /\(([가-힣A-Za-z]+)[:：]\s{1,}\)/g,
    (match, keyword: string) => {
      const normalizedKw = normalizeLabel(keyword)
      const matchKey = values.available(normalizedKw) ? normalizedKw : undefined
      if (matchKey === undefined) return match

      const newValue = values.consume(matchKey)!
      matchedLabels.add(matchKey)
      matches.push({ key: matchKey, label: keyword, value: newValue })
      return `(${keyword}：${newValue})`
    },
  )

  return matches.length > 0 ? { text, matches } : null
}

// ─── 인라인 "라벨: 값" 세그먼트 분해 ─────────────────

export interface InlineSegment {
  /** 라벨 (콜론 제외) */
  label: string
  /** 라벨 시작 오프셋 */
  labelStart: number
  /** 값 시작 오프셋 (콜론·공백 뒤) */
  valueStart: number
  /** 값 끝 오프셋 (다음 라벨/구분자 직전, 우측 공백 제외) */
  valueEnd: number
  /** text.slice(valueStart, valueEnd) */
  value: string
}

const INLINE_LABEL_RE = /([가-힣A-Za-z]{2,10})\s*[:：]/g

/**
 * 인라인 양식 한 줄을 라벨 단위로 분해 — 한 줄에 라벨이 여러 개인 양식
 * ("자문위원 성명:   작성일자:  ") 지원. 값은 다음 라벨 직전(또는
 * 구분자 [,;\n] / 100자 / 줄끝)에서 끝난다. 값이 빈 라벨도 세그먼트로
 * 반환한다 (value="", valueStart===valueEnd — 채움 대상).
 * "http://" 류 URL 스킴의 콜론은 라벨로 보지 않는다.
 */
export function scanInlineSegments(text: string): InlineSegment[] {
  const labels: Array<{ label: string; start: number; end: number }> = []
  INLINE_LABEL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_LABEL_RE.exec(text)) !== null) {
    if (text[INLINE_LABEL_RE.lastIndex] === "/") continue // "://" — URL 스킴
    labels.push({ label: m[1], start: m.index, end: INLINE_LABEL_RE.lastIndex })
  }

  const segments: InlineSegment[] = []
  for (let i = 0; i < labels.length; i++) {
    const cur = labels[i]
    let vs = cur.end
    while (vs < text.length && (text[vs] === " " || text[vs] === "\t")) vs++
    let ve = i + 1 < labels.length ? labels[i + 1].start : text.length
    if (ve < vs) ve = vs // 다음 라벨이 공백 스킵 구간 안에서 시작하는 경우
    const sep = text.slice(vs, ve).search(/[\n,;]/)
    if (sep !== -1) ve = vs + sep
    if (ve - vs > 100) ve = vs + 100
    while (ve > vs && /\s/.test(text[ve - 1])) ve--
    segments.push({
      label: cur.label,
      labelStart: cur.start,
      valueStart: vs,
      valueEnd: ve,
      value: text.slice(vs, ve),
    })
  }
  return segments
}

/** 빈 자리(valueStart===valueEnd) 삽입 시 콜론·다음 라벨과 붙지 않게 공백 부착 */
export function padInsertion(text: string, pos: number, value: string): string {
  const lead = pos > 0 && !/\s/.test(text[pos - 1]) ? " " : ""
  const trail = pos < text.length && !/\s/.test(text[pos]) ? " " : ""
  return lead + value + trail
}

/** 입력 values 맵을 정규화된 키로 변환 */
export function normalizeValues(values: Record<string, FillValue>): Map<string, FillValue> {
  const map = new Map<string, FillValue>()
  for (const [label, value] of Object.entries(values)) {
    map.set(normalizeLabel(label), value)
  }
  return map
}

/** 매칭 안 된 라벨을 원본 키로 복원 */
export function resolveUnmatched(
  normalizedValues: Map<string, FillValue>,
  matchedLabels: Set<string>,
  originalValues: Record<string, FillValue>,
): string[] {
  return [...normalizedValues.keys()]
    .filter(k => !matchedLabels.has(k))
    .map(k => {
      for (const orig of Object.keys(originalValues)) {
        if (normalizeLabel(orig) === k) return orig
      }
      return k
    })
}
