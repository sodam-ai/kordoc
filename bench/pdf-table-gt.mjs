#!/usr/bin/env node
// A-1: PDF 표 구조 채점 — 같은 문서 hwpx↔pdf 쌍(corpus/pairs/)에서 hwpx IR 표
// (hwpx 트랙 표 611/611·cellExact 1.0으로 신뢰 검증됨)를 GT로 pdf IR 표를 대조.
// coverage(텍스트 trigram)가 못 보는 구조 붕괴(2단 조판 사건 류)를 메우는 트랙.
//
// 주의: pdf는 페이지 단위로 표가 쪼개지고(분할표 병합 보정이 일부 흡수) 병합·머리글
// 표현이 hwpx와 다를 수 있어 만점이 목표가 아니다 — 무후퇴 플로어 감시.
//
// 기준선 (2026-07-03 9차: 개방변 합성 + 음영 스택 필터 + 중첩 bag 매칭, 2회 동일):
// ref 표 72 | 매칭 0.902778 | exact 0.583333 | cellF1 0.651787 | cellExact 0.673152 |
// contentNED 0.493889
// (직전 기준선 매칭 0.8472/exact 0.5417/F1 0.6324/NED 0.5008 — 3단 개선:
//  ①파서: pdf 좌우 개방형 표 가상 테두리 합성 → pair05 1p 열 찢김·쓰레기 표 완치,
//    exact +3 (2x6·담당업무 2x2 복원). ②파서: 글상자 그라디언트가 수평선 수십 개로
//    출력돼 병합 단계에서 실제 괘선을 삼키던 것을 스택 필터로 차단.
//  ③채점기: 다중 셀 부모의 중첩표 텍스트를 매칭 bag에 합산(bagExtra) — pdf가
//    평탄화한 동의서류 박스 4건 매칭 회복 (매칭 +5.5%p).
//  NED 플로어 0.5→0.49 하향은 의미 변화의 정직한 반영: 종전 미매칭 동의서의 빈
//  셀들이 "" vs (셀 없음) ""로 공짜 exact를 받던 것이, 매칭되면서 평탄화 그리드의
//  실좌표와 비교돼 감점된다. 표 발견(매칭)과 구조 충실도(exact/F1/NED)의 분해가
//  더 정확해진 것 — 전 쌍 before/after는 9차 세션 기록 참조.)
//
// 잔여 미달 성격 (2026-07-03 정밀 분석 — 개선 시도와 결론):
// ①병합 열 표현 차 = 1.5~3pt 미세 오프셋 경계를 GT(hwpx 그리드)가 문서마다 다르게
//   모델링 (pair06 응시원서는 12열로 분리 / pair08 신청서는 9열로 통합). 파서
//   tolerance를 내리면(coordMergeTol 8→1.5 실험) pair06 22x9→22x12로 GT 일치하지만
//   pair08 22x10→22x13 유령 열로 F1 0.373→0 붕괴 — pdf 쪽에서 두 경우를 구분할
//   증거가 없어 철회. 고정 임계값으론 원리적으로 불가한 표현 차로 분류.
// ②동의서류 평탄화 표현 차 — hwpx 외곽표+중첩표 vs pdf 단일 그리드 (매칭은 bagExtra로
//   회복, 셀 좌표 채점은 구조 차이를 그대로 반영. 결격사유 박스 3x2 vs 18x3 등)
// ③분할병합 보정 = 이 코퍼스에서 발동 대상 없음 (9차 실측: 페이지 분할 표가 없고,
//   파서 mergeCrossPageTables가 상류에서 흡수. rowsSum 머리글 가설은 기각 —
//   pair10 ref#15 +1행은 분할이 아니라 중첩표 평탄화였음)
// ④세그먼트 괘선 체이닝·컴포넌트 단위 합성은 실측 부작용(pair07 지원서 셀 이동,
//   pair10 반환청구서 demote 연쇄)으로 보류 — 9차 세션 기록 참조
//
// 사용법: node bench/pdf-table-gt.mjs [--gate] [--doc=부분문자열] [--verbose]

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { parse } from "../dist/index.js"
import { irAnchors, scoreTables } from "./lib/table-score.mjs"

const root = new URL(".", import.meta.url).pathname
const args = process.argv.slice(2)
const gateMode = args.includes("--gate")
const verbose = args.includes("--verbose")
const docFilter = (args.find(a => a.startsWith("--doc=")) ?? "").split("=")[1] ?? null

const round = (x, d = 6) => (x === null || x === undefined ? null : +x.toFixed(d))

// 무후퇴 플로어 (기준선 2026-07-03 9차: 매칭 0.902778 / exact 0.583333 / cellF1 0.651787
// / cellExact 0.673152 / NED 0.493889 — 2회 안정 확인 후 잠금. NED 하향 사유는 헤더 참조)
const GATES = { matchedRate: 0.90, exactRate: 0.58, cellF1: 0.65, cellExactRate: 0.67, contentNED: 0.49, parseErrors: 0 }

const t0 = performance.now()
const dir = join(root, "corpus", "pairs")
const names = await readdir(dir)
const pairs = names
  .filter(n => n.endsWith(".pdf"))
  .map(n => n.replace(/\.pdf$/, ""))
  .filter(base => names.includes(base + ".hwpx"))
  .filter(base => !docFilter || base.includes(docFilter))
  .sort()

const rows = []
let parseErrors = 0
const agg = { refTables: 0, matched: 0, exact: 0, cellTotal: 0, cellExact: 0, contentNum: 0, contentDen: 0, f1Sum: 0 }

for (const base of pairs) {
  const row = { pair: base }
  try {
    const hwpx = await parse(await readFile(join(dir, base + ".hwpx")), { filename: base + ".hwpx" })
    const pdf = await parse(await readFile(join(dir, base + ".pdf")), { filename: base + ".pdf" })
    if (!hwpx.success) throw new Error(`hwpx 파싱 실패: ${hwpx.error}`)
    if (!pdf.success) throw new Error(`pdf 파싱 실패: ${pdf.error}`)

    // 비교 모수 = 최상위 표 중 2행×2열 이상 (양쪽 동일 규칙).
    // 1×1은 래퍼/안내박스 관행이라 제외하되, 셀 안에 중첩표를 담은 래퍼(공문
    // "표 안에 표")는 중첩표를 비교 단위로 승격 (pdf는 래퍼 없이 안쪽 표를 감지).
    // N×1/1×N 스트립은 글상자·머리띠 관행으로 hwpx/pdf 표 의미가 갈리는 지점이라
    // 제외 — 구조 붕괴 신호는 2×2+ 그리드에서 나타나고, 텍스트 자체는 coverage
    // 트랙이 감시한다. 다중 셀 표의 중첩은 pdf가 부모 그리드로 평탄화하므로
    // 승격하지 않는다.
    // 다중 셀 표의 중첩표 텍스트 수집 (재귀) — 매칭 bag 보강용. pdf는 중첩을 부모
    // 그리드로 평탄화하므로 ref(hwpx) 쪽 bag에 중첩 텍스트를 합쳐야 같은 표로 본다.
    const nestedBagTexts = table => {
      const texts = []
      const seen = new Set()
      const walk = (t, depth = 0) => {
        if (depth > 12) return
        for (const row of t.cells ?? []) {
          for (const cell of row ?? []) {
            if (!cell || seen.has(cell)) continue
            seen.add(cell)
            for (const b of cell.blocks ?? []) {
              if (b.type === "table" && b.table) {
                for (const a of irAnchors(b.table).anchors) if (a.text) texts.push(a.text)
                walk(b.table, depth + 1)
              }
            }
          }
        }
      }
      walk(table)
      return texts
    }
    const topGrids = blocks => {
      const out = []
      const push = (table, depth = 0) => {
        if (depth > 12) return
        const { rows, cols, cells } = table
        if (rows === 1 && cols === 1) {
          for (const b of cells[0]?.[0]?.blocks ?? []) {
            if (b.type === "table" && b.table) push(b.table, depth + 1)
          }
          return
        }
        if (rows < 2 || cols < 2) return
        out.push({ ...irAnchors(table), bagExtra: nestedBagTexts(table) })
      }
      for (const b of blocks ?? []) if (b.type === "table" && b.table) push(b.table)
      return out
    }
    // ref = hwpx IR 그리드 (irAnchors의 anchors를 scoreTables ref 형태 cells로)
    const refGrids = topGrids(hwpx.blocks).map(g => ({ rows: g.rows, cols: g.cols, cells: g.anchors, bagExtra: g.bagExtra }))
    const irGrids = topGrids(pdf.blocks)
    const s = scoreTables(refGrids, irGrids)

    row.ok = true
    row.refTables = s.tableCount
    row.pdfTables = s.irTableCount
    row.matched = s.tableCount - s.unmatchedRef
    row.exact = s.exactCount
    row.splitMerged = s.splitTables
    row.reordered = s.reordered
    row.cellF1 = round(s.cellF1)
    row.cellExactRate = round(s.cellExactRate)
    row.contentNED = round(s.contentNED)
    row.unmatchedRef = s.unmatchedRef
    row.unmatchedIr = s.unmatchedIr
    if (verbose) row.details = s.details

    agg.refTables += s.tableCount
    agg.matched += row.matched
    agg.exact += s.exactCount
    agg.cellTotal += s.cellTotal
    agg.cellExact += s.cellExact
    agg.contentNum += s.contentNum
    agg.contentDen += s.contentDen
    agg.f1Sum += s.cellF1 * s.tableCount
  } catch (err) {
    parseErrors++
    row.ok = false
    row.error = String(err?.message ?? err).slice(0, 160)
  }
  rows.push(row)
}

const summary = {
  pairs: rows.length,
  parseErrors,
  refTables: agg.refTables,
  matchedRate: round(agg.refTables ? agg.matched / agg.refTables : 1),
  exactRate: round(agg.refTables ? agg.exact / agg.refTables : 1),
  cellF1: round(agg.refTables ? agg.f1Sum / agg.refTables : 1),
  cellExactRate: round(agg.cellTotal ? agg.cellExact / agg.cellTotal : 1),
  contentNED: round(agg.contentDen ? agg.contentNum / agg.contentDen : 1),
}

const elapsed = ((performance.now() - t0) / 1000).toFixed(0)
console.log(`\n══ PDF 표 구조 GT — hwpx↔pdf ${rows.length}쌍 (${elapsed}s) ══`)
console.log(`  ref 표 ${summary.refTables} | 매칭 ${round(summary.matchedRate * 100, 2)}% | exact ${round(summary.exactRate * 100, 2)}%`)
console.log(`  cellF1 ${summary.cellF1} | cellExact ${summary.cellExactRate} | contentNED ${summary.contentNED}`)
for (const r of rows) {
  if (!r.ok) { console.log(`  ❌ ${r.pair}: ${r.error}`); continue }
  console.log(`  ${r.pair}: ref ${r.refTables} → 매칭 ${r.matched} (분할병합 ${r.splitMerged}·순서구제 ${r.reordered}) exact ${r.exact} | F1 ${r.cellF1} NED ${r.contentNED} | pdf잉여 ${r.unmatchedIr}`)
}

// 게이트 판정 — 무후퇴 플로어 (2026-07-03 bench:gate 편입)
const gates = {
  matchedRate: { value: summary.matchedRate, threshold: GATES.matchedRate, pass: summary.matchedRate >= GATES.matchedRate },
  exactRate: { value: summary.exactRate, threshold: GATES.exactRate, pass: summary.exactRate >= GATES.exactRate },
  cellF1: { value: summary.cellF1, threshold: GATES.cellF1, pass: summary.cellF1 >= GATES.cellF1 },
  cellExactRate: { value: summary.cellExactRate, threshold: GATES.cellExactRate, pass: summary.cellExactRate >= GATES.cellExactRate },
  contentNED: { value: summary.contentNED, threshold: GATES.contentNED, pass: summary.contentNED >= GATES.contentNED },
  parseErrors: { value: parseErrors, threshold: GATES.parseErrors, pass: parseErrors <= GATES.parseErrors },
}
const pass = Object.values(gates).every(g => g.pass)
for (const [k, g] of Object.entries(gates)) {
  if (!g.pass) console.log(`  ❌ ${k} ${g.value} (기준 ${g.threshold})`)
}

await mkdir(join(root, "out"), { recursive: true })
await writeFile(join(root, "out", "pdf-table.json"), JSON.stringify({ generatedAt: new Date().toISOString(), summary, pass, gates, rows }, null, 1))
console.log(`report → bench/out/pdf-table.json | ${pass ? "PASS ✅" : "FAIL ❌"}${gateMode ? "" : " (보고 전용 — --gate 시 exit code 반영)"}`)
if (gateMode && !pass) process.exit(1)
