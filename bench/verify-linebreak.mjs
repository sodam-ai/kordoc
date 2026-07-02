#!/usr/bin/env node
// 줄바꿈 시뮬레이터 검증 — 실제 한컴 산출 HWPX의 linesegarray(한컴이 계산한 줄 시작
// 오프셋)를 정답지로, 폭 테이블 + 줄바꿈 규칙(어절/글자, 공백폭, 금칙)이 한컴과 같은
// 위치에서 줄을 나누는지 대조한다. 글꼴·옵션 조합별 일치율을 그리드로 출력한다.
//
// 사용법: node bench/verify-linebreak.mjs [코퍼스디렉토리] [--verbose]
// 전제: npm run build (dist/ 최신)
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import JSZip from "jszip"
import { charWidthEm1000 } from "../dist/index.js"

const args = process.argv.slice(2)
const dir = args.find(a => !a.startsWith("--")) ?? new URL("./corpus/review", import.meta.url).pathname
const verbose = args.includes("--verbose")

const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1]
const num = (v, d = 0) => (v === undefined ? d : Number(v))

// ─── 글꼴별 폭 함수 (em×1000) ───
const fixedPitch = (hEm) => (cp) => (cp < 0x80 ? hEm / 2 : hEm) // 굴림체·바탕체·돋움체 (고정폭)
const hcr = (cp) => charWidthEm1000(cp)
function widthFnFor(face, fixedHEm) {
  if (/함초롬|HCR/i.test(face)) return { key: "함초롬", fn: hcr, exact: true }
  if (/^(굴림체|돋움체|바탕체|궁서체)$/.test(face)) return { key: face + "(고정폭)", fn: fixedPitch(fixedHEm), exact: true }
  return { key: `근사:${face}`, fn: hcr, exact: false } // 비례폭 타 글꼴 — HCR로 근사
}

// ─── 금칙 문자 (한컴 기본) ───
const FORBID_START = new Set([..."!%),.:;?]}¢°′″℃〉》」』】〕!%),.:;?]}₩~…·、。〃"])
const FORBID_END = new Set([..."$([{£¥〈《「『【〔$([{₩"])

/**
 * 줄바꿈 시뮬레이션 → 줄 시작 UTF-16 오프셋 배열.
 * mode: 'keep'(어절 단위) | 'break'(글자 단위, 라틴 단어 유지) | 'charAll'(전부 글자 단위)
 * kinsoku: 'none' | 'push' — 한컴 금칙 처리:
 *   시작금칙(닫는 문장부호가 줄머리 금지) → 직전 글자 1개를 동반해 다음 줄로(밀어내기),
 *   끝금칙(여는 괄호가 줄끝 금지) → 그 글자를 다음 줄로 내림.
 */
function simulate(text, firstWidth, contWidth, height, ratio, spacingPct, spaceEm, widthFn, mode, kinsoku) {
  const EPS = 0.5
  const k = (height * ratio) / 100 / 1000
  const cw = (cp) => (cp === 0x20 ? spaceEm : widthFn(cp)) * (1 + spacingPct / 100) * k
  const charW = (ch) => cw(ch.codePointAt(0))
  const rangeW = (from, to) => { let w = 0; for (const ch of text.slice(from, to)) w += charW(ch); return w }

  const units = []
  if (mode === "keep") {
    for (const m of text.matchAll(/ +|[^ ]+/g)) units.push(m[0])
  } else if (mode === "break") {
    for (const m of text.matchAll(/ +|[A-Za-z0-9]+|[^ A-Za-z0-9]/g)) units.push(m[0])
  } else {
    for (const m of text.matchAll(/ +|[^ ]/g)) units.push(m[0])
  }

  const starts = [0]
  let lineW = 0
  let avail = firstWidth
  let pos = 0
  let prevUnitStart = 0 // 시작금칙 밀어내기용 — 직전 비공백 유닛의 시작

  const lineStart = () => starts[starts.length - 1]

  /** 유닛(시작 pos, 폭 w)이 안 들어갈 때 줄바꿈 지점 산정 + 금칙 보정 */
  const breakBefore = (unitPos, w) => {
    let bp = unitPos
    if (kinsoku === "push") {
      // 시작금칙: 이 유닛이 줄머리 금지 문자면 직전 글자 1개를 함께 내린다
      const u = text[unitPos]
      if (u !== undefined && FORBID_START.has(u) && bp - 1 > lineStart() && text[bp - 1] !== " ") bp--
      // 끝금칙: 남는 줄의 끝이 여는 괄호류면 그 글자(들)도 함께 내린다
      while (bp - 1 > lineStart() && FORBID_END.has(text[bp - 1])) bp--
    }
    if (bp <= lineStart()) bp = unitPos // 보정 불가 — 원 지점 유지
    starts.push(bp)
    avail = contWidth
    lineW = rangeW(bp, unitPos) + w
  }

  for (const u of units) {
    if (u[0] === " ") {
      lineW += charW(" ") * u.length // 줄 끝 공백은 hang — 브레이크 유발 없음
      pos += u.length
      continue
    }
    const w = rangeW(pos, pos + u.length)
    if (lineW + w <= avail + EPS) {
      // 들어가더라도 끝금칙 선반영은 하지 않는다 — 다음 유닛 오버플로 시 breakBefore가 처리
      lineW += w
      prevUnitStart = pos
      pos += u.length
      continue
    }
    if (lineW === 0 || w > contWidth + EPS) {
      // 빈 줄이거나 다음 줄에도 안 들어가는 초장 유닛 — 글자 단위 강제 분해
      let sub = 0
      for (const ch of u) {
        const c = charW(ch)
        if (lineW + c > avail + EPS && lineW > 0) breakBefore(pos + sub, 0)
        lineW += c
        sub += ch.length
      }
      prevUnitStart = pos
      pos += u.length
      continue
    }
    breakBefore(pos, w)
    prevUnitStart = pos
    pos += u.length
  }
  return starts
}

// ─── HWPX 파싱 (header/section) ───
function parseFonts(header) {
  const map = new Map()
  const hangulBlock = header.match(/<hh:fontface lang="HANGUL"[\s\S]*?<\/hh:fontface>/)?.[0] ?? ""
  for (const m of hangulBlock.matchAll(/<hh:font\b([^>]*)>/g)) map.set(attr(m[1], "id"), attr(m[1], "face") ?? "?")
  return map
}
function parseCharPrs(header) {
  const map = new Map()
  for (const m of header.matchAll(/<hh:charPr\b([^>]*)>([\s\S]*?)<\/hh:charPr>/g)) {
    const id = attr(m[1], "id")
    if (id === undefined) continue
    map.set(id, {
      height: num(attr(m[1], "height"), 1000),
      ratio: num(m[2].match(/<hh:ratio\b[^>]*hangul="(\d+)"/)?.[1], 100),
      spacing: num(m[2].match(/<hh:spacing\b[^>]*hangul="(-?\d+)"/)?.[1], 0),
      useFontSpace: attr(m[1], "useFontSpace") === "1",
      fontId: m[2].match(/<hh:fontRef\b[^>]*hangul="(\d+)"/)?.[1] ?? "0",
    })
  }
  return map
}
function parseParaPrs(header) {
  const map = new Map()
  for (const m of header.matchAll(/<hh:paraPr\b([^>]*)>([\s\S]*?)<\/hh:paraPr>/g)) {
    const id = attr(m[1], "id")
    if (id === undefined) continue
    const margin = m[2].match(/<hh:margin>([\s\S]*?)<\/hh:margin>/)?.[1] ?? ""
    const val = (name) => num(margin.match(new RegExp(`<hc:${name} value="(-?\\d+)"`))?.[1], 0)
    map.set(id, {
      left: val("left"), intent: val("intent"), right: val("right"),
      keepWord: /breakNonLatinWord="KEEP_WORD"/.test(m[2]),
      snapToGrid: attr(m[1], "snapToGrid") === "1",
      condense: num(attr(m[1], "condense"), 0),
    })
  }
  return map
}
function stripSubLists(xml) {
  let prev
  do {
    prev = xml
    xml = xml.replace(/<hp:subList\b[^>]*>(?:(?!<hp:subList\b)[\s\S])*?<\/hp:subList>/g, "")
  } while (xml !== prev)
  return xml
}
/** ctrl(머리말·각주 정의 등 비가시 컨테이너) 서브트리 제거 — 내부 subList 포함 balanced 제거 */
function stripCtrls(xml) {
  let prev
  do {
    prev = xml
    xml = xml.replace(/<hp:ctrl\b[^>]*>(?:(?!<hp:ctrl\b)[\s\S])*?<\/hp:ctrl>/g, "")
  } while (xml !== prev)
  return xml
}
function extractRuns(pXml) {
  let inner = pXml.replace(/<hp:linesegarray[\s\S]*?<\/hp:linesegarray>|<hp:linesegarray[^>]*\/>/g, "")
  inner = stripCtrls(inner)
  // 필드(누름틀)는 textpos 좌표계에 별도 기여 — 단순 오라클 대상에서 제외
  if (/<hp:(tbl|tab|pic|container|ole|equation|line|rect|ellipse|arc|polygon|curve|connectLine|textart|compose|dutmal|btn|br|fieldBegin|fieldEnd)\b/.test(inner)) return null
  const runs = []
  for (const rm of inner.matchAll(/<hp:run\b([^>]*)>([\s\S]*?)<\/hp:run>/g)) {
    const charPrId = attr(rm[1], "charPrIDRef")
    let text = ""
    for (const tm of rm[2].matchAll(/<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>|<hp:t\b[^>]*\/>/g)) {
      const t = tm[1] ?? ""
      if (/</.test(t)) return null
      text += t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    }
    if (text.length > 0) runs.push({ text, charPrId })
  }
  return runs
}
function extractLinesegs(pXml) {
  const seg = pXml.match(/<hp:linesegarray>([\s\S]*?)<\/hp:linesegarray>/)?.[1]
  if (!seg) return null
  const arr = [...seg.matchAll(/<hp:lineseg\b([^>]*)\/>/g)].map(m => ({ textpos: num(attr(m[1], "textpos")) }))
  return arr.length > 0 ? arr : null
}

// ─── 수집: 검증 가능한 문단 샘플 ───
const samples = []
const excluded = { object: 0, nonuniform: 0, marked: 0, noseg: 0, snap: 0, condense: 0, multicol: 0 }

for (const f of readdirSync(dir).filter(f => /\.hwpx$/i.test(f))) {
  let zip
  try { zip = await JSZip.loadAsync(readFileSync(join(dir, f))) } catch { continue }
  const headerFile = Object.keys(zip.files).find(n => /header\.xml$/i.test(n))
  const sectionFiles = Object.keys(zip.files).filter(n => /section\d+\.xml$/i.test(n)).sort()
  if (!headerFile || sectionFiles.length === 0) continue
  const header = await zip.file(headerFile).async("text")
  const fonts = parseFonts(header)
  const charPrs = parseCharPrs(header)
  const paraPrs = parseParaPrs(header)

  const collectParas = (scopeXml, availWidth, scope) => {
    for (const pm of scopeXml.matchAll(/<hp:p\b([^>]*)>((?:(?!<hp:p\b)[\s\S])*?)<\/hp:p>/g)) {
      const paraPr = paraPrs.get(attr(pm[1], "paraPrIDRef"))
      if (!paraPr) continue
      if (paraPr.snapToGrid) { excluded.snap++; continue }
      if (paraPr.condense > 0) { excluded.condense++; continue }
      const runs = extractRuns(pm[2])
      if (!runs) { excluded.object++; continue }
      if (runs.length === 0) continue
      const segs = extractLinesegs(pm[2])
      if (!segs) { excluded.noseg++; continue }
      const cpr = charPrs.get(runs[0].charPrId)
      if (!cpr) continue
      const uniform = runs.every(r => {
        const c = charPrs.get(r.charPrId)
        return c && c.height === cpr.height && c.ratio === cpr.ratio && c.spacing === cpr.spacing && c.fontId === cpr.fontId
      })
      if (!uniform) { excluded.nonuniform++; continue }
      const text = runs.map(r => r.text).join("")
      if (text.trim().length === 0) continue
      // 변환기가 원본 HWP의 인라인 컨트롤(8 WCHAR) 좌표를 승계한 파일 — textpos가
      // 실제 텍스트 길이를 벗어나면 좌표계가 달라 검증 불가
      if (segs.some(s => s.textpos > text.length)) { excluded.coordShift = (excluded.coordShift ?? 0) + 1; continue }
      samples.push({
        file: f, text, scope,
        firstWidth: availWidth - paraPr.left - paraPr.right - Math.max(paraPr.intent, 0),
        contWidth: availWidth - paraPr.left - paraPr.right - Math.max(-paraPr.intent, 0),
        height: cpr.height, ratio: cpr.ratio, spacing: cpr.spacing,
        useFontSpace: cpr.useFontSpace,
        face: fonts.get(cpr.fontId) ?? "?",
        keepWord: paraPr.keepWord,
        actual: segs.map(s => s.textpos),
      })
    }
  }

  for (const sf of sectionFiles) {
    const raw = await zip.file(sf).async("text")
    const pagePr = raw.match(/<hp:pagePr\b[^>]*>/)?.[0] ?? ""
    const pmargin = raw.match(/<hp:pagePr[\s\S]*?<hp:margin\b[^>]*\/>/)?.[0] ?? ""
    const pageWidth = num(attr(pagePr, "width"), 59528)
      - num(attr(pmargin, "left"), 0) - num(attr(pmargin, "right"), 0) - num(attr(pmargin, "gutter"), 0)

    // 1) 셀 문단 — 가장 안쪽 tbl부터: 그 표의 inMargin으로 각 tc를 셀폭 검증 후 제거
    //    (hasMargin=0 셀은 표의 inMargin, =1 셀은 자체 cellMargin — 한컴 규칙)
    let xml = raw
    const tblRe = /<hp:tbl\b(?:(?!<hp:tbl\b)[\s\S])*?<\/hp:tbl>/
    for (;;) {
      const m = xml.match(tblRe)
      if (!m) break
      const block = m[0]
      const im = block.match(/<hp:inMargin\b[^>]*\/>/)?.[0] ?? ""
      const tblL = num(attr(im, "left"), 510)
      const tblR = num(attr(im, "right"), 510)
      for (const tc of block.matchAll(/<hp:tc\b[\s\S]*?<\/hp:tc>/g)) {
        const cell = tc[0]
        const cellW = num(attr(cell.match(/<hp:cellSz\b[^>]*\/>/)?.[0] ?? "", "width"), 0)
        const hasMargin = /<hp:tc\b[^>]*hasMargin="1"/.test(cell)
        const cm = cell.match(/<hp:cellMargin\b[^>]*\/>/)?.[0] ?? ""
        const mL = hasMargin ? num(attr(cm, "left"), tblL) : tblL
        const mR = hasMargin ? num(attr(cm, "right"), tblR) : tblR
        if (cellW > 0) collectParas(cell, cellW - mL - mR, "cell")
      }
      xml = xml.slice(0, m.index) + xml.slice(m.index + block.length)
    }
    // 2) 본문 문단 — 남은 subList(머리말 등) 제거 후 페이지폭으로 (다단 섹션 제외)
    if (/<hp:colPr\b[^>]*colCount="([2-9]|\d{2,})"/.test(raw)) { excluded.multicol++; continue }
    collectParas(stripSubLists(xml), pageWidth, "body")
  }
}

const multi = samples.filter(s => s.actual.length > 1)
console.log(`샘플 문단 ${samples.length}개 (여러 줄 ${multi.length}개) / 제외:`, JSON.stringify(excluded))
const byFace = new Map()
for (const s of multi) byFace.set(s.face, (byFace.get(s.face) ?? 0) + (s.actual.length - 1))
console.log("여러 줄 문단 글꼴 분포(줄바꿈점 수):", [...byFace.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}:${n}`).join(" "))

// ─── 옵션 그리드 평가 ───
// modeOpt 'para'=paraPr 선언대로(keep/break) / 'forceBreak'=전부 글자단위
// (서울시 전자결재 변환기는 KEEP_WORD 선언을 무시하고 글자단위로 lineseg를 계산함이 실측 확인됨)
for (const modeOpt of ["para", "charAll"]) {
for (const spaceOpt of [500, 300]) {
  for (const kinsoku of ["none", "push"]) {
  for (const fixedHEm of [1000]) {
    const buckets = new Map()
    const mismatches = []
    for (const s of samples) {
      const { key, fn, exact } = widthFnFor(s.face, fixedHEm)
      const bkey = `${exact ? "정밀" : "근사"}|${key}`
      let b = buckets.get(bkey)
      if (!b) buckets.set(bkey, (b = { paras: 0, ok: 0, breaks: 0, breakOk: 0 }))
      const se = s.useFontSpace ? 300 : spaceOpt
      const mode = modeOpt === "charAll" ? "charAll" : (s.keepWord ? "keep" : "break")
      const sim = simulate(s.text, s.firstWidth, s.contWidth, s.height, s.ratio, s.spacing, se, fn, mode, kinsoku)
      b.paras++
      b.breaks += s.actual.length - 1
      const same = sim.length === s.actual.length && s.actual.every((v, i) => v === sim[i])
      if (same) { b.ok++; b.breakOk += s.actual.length - 1 }
      else {
        const a = new Set(s.actual)
        b.breakOk += sim.filter((v, i) => i > 0 && a.has(v)).length
        if (s.actual.length > 1 && mismatches.length < 8) mismatches.push({ s, sim })
      }
    }
    const line = [...buckets.entries()]
      .filter(([, b]) => b.breaks > 0)
      .sort((a, b) => b[1].breaks - a[1].breaks)
      .map(([k, b]) => `${k} ${b.breakOk}/${b.breaks}(${(b.breakOk / b.breaks * 100).toFixed(0)}%)`)
      .join("  ")
    console.log(`mode=${modeOpt} space=${spaceOpt} kinsoku=${kinsoku}: ${line}`)
    if (verbose && modeOpt === "charAll" && spaceOpt === 500 && kinsoku === "push" && fixedHEm === 1000) {
      for (const { s, sim } of mismatches) {
        console.log("--", s.file.slice(0, 24), `[${s.face}${s.keepWord ? "/keep" : "/break"}/${s.scope} h=${s.height} r=${s.ratio} sp=${s.spacing} fw=${s.firstWidth} cw=${s.contWidth}]`)
        console.log("   text:", JSON.stringify(s.text.slice(0, 70)))
        console.log("   actual:", s.actual.join(","), " sim:", sim.join(","))
      }
    }
  }
  }
}
}
