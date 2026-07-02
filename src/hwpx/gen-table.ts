/**
 * HWPX 표 XML 생성 (generator.ts에서 분리) — GFM 그리드 표와
 * 병합(colspan/rowspan) HTML 표 경로.
 */

import { parseHtmlTable, htmlCellInnerToLines, extractTopLevelTables, type HtmlRowInfo } from "../roundtrip/markdown-units.js"
import { CHAR_NORMAL, CHAR_TABLE_HEADER, escapeXml, type ResolvedTheme } from "./gen-ids.js"
import { generateRuns } from "./md-runs.js"

// 기본 셀 크기 (HWPUnit) — A4 기준 적당한 기본값
const TABLE_ID_BASE = 1000
let tableIdCounter = TABLE_ID_BASE
function nextTableId(): number { return ++tableIdCounter }

export function generateTable(rows: string[][], theme: ResolvedTheme): string {
  const rowCnt = rows.length
  const colCnt = Math.max(...rows.map(r => r.length), 1)
  // A4 portrait: 폭 약 44000 HWPUnit 사용 가능 → colCnt로 균등 분배
  const cellW = Math.floor(44000 / colCnt)
  const cellH = 1500  // 기본 행 높이
  const tblW = cellW * colCnt
  const tblH = cellH * rowCnt

  const tblId = nextTableId()

  // theme.tableHeaderColor 또는 tableHeaderBold가 설정되면 첫 행 셀에 별도 charPr 사용
  const useHeaderStyle =
    theme.tableHeader !== theme.body || theme.tableHeaderBold

  const trElements = rows.map((row, rowIdx) => {
    // 부족한 셀은 빈 문자열로 채워 colCnt 맞춤
    const cells = row.length < colCnt ? [...row, ...Array(colCnt - row.length).fill("")] : row
    const isHeaderRow = rowIdx === 0
    const headerCharPr = isHeaderRow && useHeaderStyle ? CHAR_TABLE_HEADER : CHAR_NORMAL
    const tdElements = cells.map((cell, colIdx) => {
      const runs = generateRuns(cell, headerCharPr)
      const p = `<hp:p paraPrIDRef="0" styleIDRef="0">${runs}</hp:p>`
      // <hp:tc> 필수 속성 + subList + cellAddr + cellSpan + cellSz + cellMargin
      return `<hp:tc name="" header="${isHeaderRow ? 1 : 0}" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="2">`
        + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${p}</hp:subList>`
        + `<hp:cellAddr colAddr="${colIdx}" rowAddr="${rowIdx}"/>`
        + `<hp:cellSpan colSpan="1" rowSpan="1"/>`
        + `<hp:cellSz width="${cellW}" height="${cellH}"/>`
        + `<hp:cellMargin left="141" right="141" top="141" bottom="141"/>`
        + `</hp:tc>`
    }).join("")
    return `<hp:tr>${tdElements}</hp:tr>`
  }).join("")

  // <hp:tbl>에 필수 속성 + <hp:sz>/<hp:outMargin>/<hp:inMargin> (pos는 inline-level 기준)
  const tblInner = `<hp:sz width="${tblW}" widthRelTo="ABSOLUTE" height="${tblH}" heightRelTo="ABSOLUTE" protect="0"/>`
    + `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="0" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>`
    + `<hp:outMargin left="0" right="0" top="0" bottom="0"/>`
    + `<hp:inMargin left="510" right="510" top="141" bottom="141"/>`
    + trElements

  const tbl = `<hp:tbl id="${tblId}" zOrder="0" numberingType="TABLE" pageBreak="CELL" repeatHeader="0" rowCnt="${rowCnt}" colCnt="${colCnt}" cellSpacing="0" borderFillIDRef="2" noShading="0">${tblInner}</hp:tbl>`

  // 테이블은 paragraph 안의 run → 가 아니라 별도 p로 감쌈 (block-level inline-anchored)
  return `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">${tbl}</hp:run></hp:p>`
}

// ─── HTML 표 생성 (병합셀 colspan/rowspan + 중첩표 재귀) ───
//

// kordoc parse는 병합/중첩표를 <table><tr><th|td colspan rowspan>…</table> HTML로
// 내보낸다. 그 출력을 다시 HWPX로 만들 때 구조를 보존한다 — parse → 편집 →
// markdownToHwpx 라운드트립의 표 구멍을 막는 경로.

interface PlacedHtmlCell {
  r: number
  c: number
  colSpan: number
  rowSpan: number
  inner: string
  isHeader: boolean
}

/** HTML 행 목록 → 그리드 배치 (colspan/rowspan 점유 반영) */
function layoutHtmlRows(rows: HtmlRowInfo[]): { placed: PlacedHtmlCell[]; rowCnt: number; colCnt: number } {
  const occupied = new Set<string>()
  const placed: PlacedHtmlCell[] = []
  let colCnt = 0
  for (let r = 0; r < rows.length; r++) {
    let c = 0
    for (const cell of rows[r].cells) {
      while (occupied.has(`${r},${c}`)) c++
      const colSpan = Math.max(1, cell.colSpan)
      const rowSpan = Math.max(1, cell.rowSpan)
      placed.push({ r, c, colSpan, rowSpan, inner: cell.inner, isHeader: rows[r].tag === "th" })
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) occupied.add(`${r + dr},${c + dc}`)
      }
      c += colSpan
      colCnt = Math.max(colCnt, c)
    }
  }
  return { placed, rowCnt: rows.length, colCnt }
}

/** HTML 엔티티 복원 (sanitizeText 이스케이프의 역변환) — &amp;는 마지막에 */
function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
}

/**
 * HTML 표 원문 → <hp:tbl> XML. 병합셀은 cellSpan/cellAddr로, 셀 안 중첩표는
 * subList 안에 재귀 생성한다. 파싱 불가면 null (호출부가 문단 폴백).
 * @param totalWidth 표 전체 폭(HWPUNIT) — 중첩표는 부모 셀폭에 맞춰 축소
 */
export function generateHtmlTableXml(rawHtml: string, theme: ResolvedTheme, totalWidth: number = 44000): string | null {
  const rows = parseHtmlTable(rawHtml)
  if (!rows || rows.length === 0) return null
  const { placed, rowCnt, colCnt } = layoutHtmlRows(rows)
  if (rowCnt === 0 || colCnt === 0) return null

  const colW = Math.floor(totalWidth / colCnt)
  const cellH = 1500
  const tblW = colW * colCnt
  const tblId = nextTableId()
  const useHeaderStyle = theme.tableHeader !== theme.body || theme.tableHeaderBold

  const tcXmls = placed.map(cell => {
    const headerCharPr = cell.isHeader && useHeaderStyle ? CHAR_TABLE_HEADER : CHAR_NORMAL
    const { lines } = htmlCellInnerToLines(cell.inner)
    const paras: string[] = lines.map(line =>
      `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="${headerCharPr}"><hp:t>${escapeXml(unescapeHtml(line))}</hp:t></hp:run></hp:p>`,
    )
    // 중첩표 — 셀폭(마진 제외)에 맞춰 재귀 생성. 셀 높이는 중첩표만큼 키움
    // (한컴은 자동 확장하지만 초기 높이가 맞아야 다른 뷰어에서도 안 잘림)
    let nestedH = 0
    for (const nested of extractTopLevelTables(cell.inner)) {
      const nestedXml = generateHtmlTableXml(nested, theme, Math.max(colW * cell.colSpan - 1020, 4000))
      if (nestedXml) {
        paras.push(`<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">${nestedXml}</hp:run></hp:p>`)
        nestedH += ((nested.match(/<tr[\s>]/gi) ?? []).length) * cellH + 300
      }
    }
    if (paras.length === 0) {
      paras.push(`<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="${headerCharPr}"><hp:t></hp:t></hp:run></hp:p>`)
    }
    const cellHeight = Math.max(cellH * cell.rowSpan, Math.max(lines.length, 1) * 800 + nestedH)
    return `<hp:tc name="" header="${cell.isHeader ? 1 : 0}" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="2">`
      + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${paras.join("")}</hp:subList>`
      + `<hp:cellAddr colAddr="${cell.c}" rowAddr="${cell.r}"/>`
      + `<hp:cellSpan colSpan="${cell.colSpan}" rowSpan="${cell.rowSpan}"/>`
      + `<hp:cellSz width="${colW * cell.colSpan}" height="${cellHeight}"/>`
      + `<hp:cellMargin left="141" right="141" top="141" bottom="141"/>`
      + `</hp:tc>`
  })

  // 행별로 tr 묶기 (placed는 행 순서 유지)
  const trXmls: string[] = []
  for (let r = 0; r < rowCnt; r++) {
    const rowTcs = tcXmls.filter((_, i) => placed[i].r === r)
    trXmls.push(`<hp:tr>${rowTcs.join("")}</hp:tr>`)
  }

  return `<hp:tbl id="${tblId}" zOrder="0" numberingType="TABLE" pageBreak="CELL" repeatHeader="0" rowCnt="${rowCnt}" colCnt="${colCnt}" cellSpacing="0" borderFillIDRef="2" noShading="0">`
    + `<hp:sz width="${tblW}" widthRelTo="ABSOLUTE" height="${cellH * rowCnt}" heightRelTo="ABSOLUTE" protect="0"/>`
    + `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="0" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>`
    + `<hp:outMargin left="0" right="0" top="0" bottom="0"/>`
    + `<hp:inMargin left="510" right="510" top="141" bottom="141"/>`
    + trXmls.join("")
    + `</hp:tbl>`
}

// ─── 섹션 XML 생성 ──────────────────────────────────

/**
 * 공문서 모드 리스트 사전 처리 — 연속된 list_item run마다 단계별 부호 산출 +
 * 단일 형제 부호 생략. block 인덱스 → {marker, depth} 매핑 반환.
 */
