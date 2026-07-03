/**
 * 레이아웃 보존 렌더 — HWPX 조판 캐시(lineseg·cellAddr·hp:pos)를 SVG 절대배치로 그린다.
 *
 * 조판 엔진 없음: 한컴이 저장 시 기록한 좌표를 그대로 사용한다. 따라서
 * 한컴(또는 조판 캐시를 기록하는 편집기)에서 저장한 파일만 렌더 가능 —
 * markdownToHwpx 산출물엔 linesegarray가 없어 KordocError를 던진다.
 *
 * 좌표 산식(실측 검증 — .claude/plans/render-poc/findings.md):
 * - 단위 HWPUNIT(1/7200in), pt = /100. 최상위 문단 lineseg = 본문영역 로컬,
 *   셀 문단 = 셀 로컬. PARA 밀어내기 개체 anchor = 호스트vp − (omTop+h+omBottom) 역산.
 * - horzsize는 줄 "영역" 폭(텍스트 폭 아님) — 마지막 줄이 아닌 줄은 원본 줄바꿈에
 *   맞춰 textLength로 고정하고, 마지막 줄만 paraPr 정렬(LEFT 자연폭/CENTER/RIGHT/배분)을 적용.
 * - 좌표 속성엔 uint32로 저장된 음수가 섞여 있다(toInt32 필수).
 * - 표 열은 span 제약 경계 전파로, 행은 rs=1 max + 콘텐츠 초과 성장으로 푼다.
 *
 * 범위: 1페이지(section0) 한정, 수식·그리기개체 도형은 미지원(경고 수집).
 */

import JSZip from "jszip"
import { KordocError } from "../utils.js"
import { createXmlParser, findChildByLocalName, MAX_DECOMPRESS_SIZE } from "../hwpx/parser-shared.js"
import { toInt32, solveBoundaries, solveRowHeights, type SpanConstraint } from "./layout.js"
import { measureTextWidth } from "../hwpx/text-metrics.js"
import { parseRenderStyles, DEFAULT_CHAR, type RenderStyles, type RenderBorderEdge } from "./head-styles.js"

export interface RenderSvgOptions {
  /** 이미지 1장당 허용 최대 바이트 (기본 40MB) */
  maxImageBytes?: number
}

export interface RenderSvgResult {
  svg: string
  /** 페이지 크기 (pt) */
  width: number
  height: number
  warnings: string[]
  stats: { texts: number; images: number; tables: number }
}

// ─── XML 헬퍼 ─────────────────────────────────────

function ln(el: Element): string {
  return (el.tagName || "").replace(/^[^:]+:/, "")
}

function elements(el: Element): Element[] {
  const out: Element[] = []
  const children = el.childNodes
  if (!children) return out
  for (let i = 0; i < children.length; i++) {
    if (children[i].nodeType === 1) out.push(children[i] as Element)
  }
  return out
}

function num(el: Element | null, attr: string, fallback = 0): number {
  return el ? toInt32(el.getAttribute(attr) ?? undefined, fallback) : fallback
}

function findFirst(el: Element, name: string, depth = 0): Element | null {
  if (depth > 64) return null
  for (const ch of elements(el)) {
    if (ln(ch) === name) return ch
    const found = findFirst(ch, name, depth + 1)
    if (found) return found
  }
  return null
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// ─── 내부 모델 ────────────────────────────────────

interface PageGeom { PW: number; PH: number; ML: number; MT: number; BODY_W: number; BODY_H: number }

interface Seg { textpos: number; vertpos: number; horzpos: number; horzsize: number; textheight: number; baseline: number }

interface ParaChar { ch: string; prId: string | null }

/** 렌더 대상 개체 태그 — 이 외(도형류)는 경고 후 생략 */
const OBJ_TAGS = new Set(["tbl", "pic", "container", "equation", "rect", "ellipse", "polygon", "curv", "line", "arc", "ole", "textart"])

interface ParaObj { el: Element; tag: string; index: number; inline: boolean; width: number; height: number }

interface ParaModel { chars: ParaChar[]; segs: Seg[]; objs: ParaObj[]; paraPrId: string | null }

interface Ctx {
  svg: string[]
  geom: PageGeom
  styles: RenderStyles
  images: Map<string, { dataUri: string; orgW?: number; orgH?: number }>
  warnings: string[]
  warned: Set<string>
  stats: { texts: number; images: number; tables: number }
}

const pt = (u: number): string => String(Math.round(u) / 100)

function warnOnce(ctx: Ctx, key: string, msg: string): void {
  if (ctx.warned.has(key)) return
  ctx.warned.add(key)
  ctx.warnings.push(msg)
}

// ─── 문단 모델 구축 ────────────────────────────────

function textOfT(t: Element): string {
  // hp:t 내부 텍스트 노드만 (markpen 등 자식 요소의 텍스트 포함)
  let s = ""
  const walk = (n: Node, d: number): void => {
    if (d > 32) return
    const kids = n.childNodes
    if (!kids) return
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i]
      if (c.nodeType === 3) s += c.textContent ?? ""
      else if (c.nodeType === 1) walk(c, d + 1)
    }
  }
  walk(t, 0)
  return s
}

function buildPara(p: Element): ParaModel {
  const chars: ParaChar[] = []
  const objs: ParaObj[] = []
  let segs: Seg[] = []
  for (const runEl of elements(p)) {
    const tag = ln(runEl)
    if (tag === "run") {
      const prId = runEl.getAttribute("charPrIDRef")
      for (const ch of elements(runEl)) {
        const cn = ln(ch)
        if (cn === "t") {
          for (const c of textOfT(ch)) chars.push({ ch: c, prId })
        } else if (OBJ_TAGS.has(cn)) {
          const sz = findChildByLocalName(ch, "sz")
          const pos = findChildByLocalName(ch, "pos")
          objs.push({
            el: ch, tag: cn, index: chars.length,
            inline: pos?.getAttribute("treatAsChar") === "1",
            width: num(sz, "width"), height: num(sz, "height"),
          })
        }
      }
    } else if (tag === "linesegarray") {
      segs = elements(runEl).filter(s => ln(s) === "lineseg").map(s => ({
        textpos: num(s, "textpos"), vertpos: num(s, "vertpos"), horzpos: num(s, "horzpos"),
        horzsize: num(s, "horzsize"), textheight: num(s, "textheight", 1000), baseline: num(s, "baseline", 850),
      }))
    }
  }
  return { chars, segs, objs, paraPrId: p.getAttribute("paraPrIDRef") }
}

// ─── 줄 렌더 (run별 charPr + 정렬) ──────────────────

interface LinePlan {
  seg: Seg
  /** 줄 시작 x 보정 (정렬) */
  xoff: number
  /** 텍스트 조각 폭 스케일 */
  scale: number
  start: number
  end: number
}

function charW(c: ParaChar, styles: RenderStyles): number {
  const st = (c.prId != null ? styles.charPr.get(c.prId) : undefined) ?? DEFAULT_CHAR
  return measureTextWidth(c.ch, st.height, st.ratio, { spacingPct: st.spacing })
}

/** 줄 자연폭 = 텍스트 조각 + 인라인 개체 폭 (개체 폭은 스케일 불변) */
function lineNaturalWidth(m: ParaModel, styles: RenderStyles, start: number, end: number): { text: number; obj: number } {
  let text = 0
  for (let i = start; i < end && i < m.chars.length; i++) text += charW(m.chars[i], styles)
  let obj = 0
  for (const o of m.objs) if (o.inline && o.index >= start && o.index < end) obj += o.width
  return { text, obj }
}

function planLines(m: ParaModel, styles: RenderStyles): LinePlan[] {
  const align = (m.paraPrId != null ? styles.paraAlign.get(m.paraPrId) : undefined) ?? "JUSTIFY"
  const plans: LinePlan[] = []
  for (let i = 0; i < m.segs.length; i++) {
    const seg = m.segs[i]
    const start = seg.textpos
    const end = i + 1 < m.segs.length ? m.segs[i + 1].textpos : Math.max(m.chars.length, start)
    const nat = lineNaturalWidth(m, styles, start, end)
    const isLast = i === m.segs.length - 1
    let xoff = 0
    let scale = 1
    const avail = seg.horzsize - nat.obj
    if (nat.text > 0 && (!isLast || align === "DISTRIBUTE" || align === "DISTRIBUTE_SPACE")) {
      // 줄바꿈이 고정된 중간 줄·배분정렬 — 줄 영역 폭에 맞춰 고정 (원본 조판 재현)
      scale = avail > 0 ? avail / nat.text : 1
    } else if (nat.text + nat.obj > 0 && isLast) {
      const w = nat.text + nat.obj
      if (align === "CENTER") xoff = Math.max(0, (seg.horzsize - w) / 2)
      else if (align === "RIGHT") xoff = Math.max(0, seg.horzsize - w)
    }
    if (!Number.isFinite(scale) || scale <= 0) scale = 1
    scale = Math.min(4, Math.max(0.25, scale))
    plans.push({ seg, xoff, scale, start, end })
  }
  return plans
}

/** 줄 안 [start, upto) 구간의 전진폭 (텍스트×스케일 + 인라인 개체) */
function advanceTo(m: ParaModel, styles: RenderStyles, plan: LinePlan, upto: number): number {
  let x = 0
  for (let i = plan.start; i < upto && i < m.chars.length; i++) x += charW(m.chars[i], styles) * plan.scale
  for (const o of m.objs) if (o.inline && o.index >= plan.start && o.index < upto) x += o.width
  return x
}

// ─── 문단 드로잉 ───────────────────────────────────

function drawPara(p: Element, ox: number, oy: number, areaW: number, ctx: Ctx, depth: number): void {
  if (depth > 16) { warnOnce(ctx, "depth", "중첩 깊이 16 초과 — 이하 생략"); return }
  const m = buildPara(p)
  if (m.segs.length === 0) {
    // 조판 캐시 없는 문단 — 개체만이라도 문단 원점에 배치
    for (const o of m.objs) drawObject(o, ox, oy, 0, areaW, ctx, depth)
    return
  }
  const plans = planLines(m, ctx.styles)
  const baseV = m.segs[0].vertpos

  for (const plan of plans) {
    const { seg } = plan
    // charPr 단위 조각으로 분할
    let i = plan.start
    let cursor = ox + seg.horzpos + plan.xoff
    const y = oy + seg.vertpos + seg.baseline
    while (i < plan.end && i < m.chars.length) {
      const prId = m.chars[i].prId
      let j = i
      let piece = ""
      while (j < plan.end && j < m.chars.length && m.chars[j].prId === prId) { piece += m.chars[j].ch; j++ }
      // 이 조각 구간에 걸친 인라인 개체 폭 반영을 위해 개체 경계에서도 절단
      for (const o of m.objs) {
        if (o.inline && o.index > i && o.index < j) { piece = piece.slice(0, o.index - i); j = o.index; break }
      }
      // 연속 공백(2+) 경계 절단 — 공백 폭 오차(한컴 0.5em 고정 vs 뷰어 폰트)를
      // 공백 구간에 가둔다 (공무원 스페이스 정렬 원문에서 글자 벌어짐 방지)
      {
        const cut = piece.search(/ {2,}/)
        if (cut > 0) { piece = piece.slice(0, cut); j = i + cut }
        else if (cut === 0) {
          const runEnd = piece.match(/^ +/)![0].length
          piece = piece.slice(0, runEnd); j = i + runEnd
        }
      }
      const st = (prId != null ? ctx.styles.charPr.get(prId) : undefined) ?? DEFAULT_CHAR
      const w = measureTextWidth(piece, st.height, st.ratio, { spacingPct: st.spacing }) * plan.scale
      if (piece.trim().length > 0) {
        const attrs: string[] = [`x="${pt(cursor)}"`, `y="${pt(y)}"`, `font-size="${pt(st.height)}"`]
        if ([...piece].length > 1 && w > 50) {
          attrs.push(`textLength="${pt(w)}"`, `lengthAdjust="${plan.scale < 1 ? "spacingAndGlyphs" : "spacing"}"`)
        }
        if (st.bold) attrs.push(`font-weight="bold"`)
        if (st.italic) attrs.push(`font-style="italic"`)
        if (st.underline) attrs.push(`text-decoration="underline"`)
        if (st.color) attrs.push(`fill="${escapeXml(st.color)}"`)
        ctx.svg.push(`<text ${attrs.join(" ")}>${escapeXml(piece)}</text>`)
        ctx.stats.texts++
      }
      cursor += w
      // 개체 경계에서 끊었으면 개체 폭만큼 전진
      for (const o of m.objs) if (o.inline && o.index === j) cursor += o.width
      i = j
    }
  }

  // 개체 배치 — 인라인은 소속 줄 위치, 앵커는 hp:pos 해석
  for (const o of m.objs) {
    if (o.inline) {
      let plan = plans[0]
      for (const pl of plans) if (pl.start <= o.index && (o.index < pl.end || pl === plans[plans.length - 1])) plan = pl
      const x = ox + plan.seg.horzpos + plan.xoff + advanceTo(m, ctx.styles, plan, o.index)
      // 개체가 줄보다 낮으면 baseline 위에 얹고, 줄을 채우는 개체(th==h)는 줄 상단
      const yTop = oy + plan.seg.vertpos + Math.max(0, plan.seg.baseline - o.height)
      drawObject(o, x, yTop, baseV, areaW, ctx, depth)
    } else {
      const { x, y } = anchorObject(o, ox, oy, baseV, areaW, ctx)
      drawObject(o, x, y, baseV, areaW, ctx, depth)
    }
  }
}

/** hp:pos 기준계 해석 → 개체 좌상단 절대좌표 (tac=0) */
function anchorObject(o: ParaObj, ox: number, oy: number, baseV: number, areaW: number, ctx: Ctx): { x: number; y: number } {
  const { PW, PH, ML, MT, BODY_W, BODY_H } = ctx.geom
  const pos = findChildByLocalName(o.el, "pos")
  const om = findChildByLocalName(o.el, "outMargin")
  const omT = num(om, "top"), omB = num(om, "bottom")
  const w = o.width, h = o.height
  if (!pos) return { x: ox, y: oy + baseV }
  const vo = num(pos, "vertOffset")
  const ho = num(pos, "horzOffset")
  const vrel = pos.getAttribute("vertRelTo") ?? "PARA"
  const hrel = pos.getAttribute("horzRelTo") ?? "PARA"
  const va = pos.getAttribute("vertAlign") ?? "TOP"
  const ha = pos.getAttribute("horzAlign") ?? "LEFT"
  const wrap = o.el.getAttribute("textWrap") ?? "TOP_AND_BOTTOM"

  let y: number
  if (vrel === "PAPER") {
    y = va === "BOTTOM" ? PH - h - vo : va === "CENTER" ? (PH - h) / 2 + vo : vo
  } else if (vrel === "PAGE") {
    y = va === "BOTTOM" ? MT + BODY_H - h - vo : va === "CENTER" ? MT + (BODY_H - h) / 2 + vo : MT + vo
  } else if (wrap === "TOP_AND_BOTTOM") {
    // PARA 밀어내기 역산 — 호스트 문단 vp가 개체(여백 포함)만큼 밀렸다는 모델 (실측 일치).
    // 음수면 밀지 않은 개체(빈 호스트 줄 등)로 보고 현재 흐름 y 사용.
    const pushed = baseV - (omT + h + omB)
    const anchor = pushed >= -100 ? pushed : baseV
    y = oy + anchor + omT + vo
  } else {
    // BEHIND_TEXT/IN_FRONT/SQUARE — 문단을 밀지 않는 개체는 문단 원점 흐름 배치
    y = oy + baseV + vo
  }

  let x: number
  if (hrel === "PAGE") {
    x = ha === "RIGHT" ? ML + BODY_W - w - ho : ha === "CENTER" ? ML + (BODY_W - w) / 2 + ho : ML + ho
  } else if (hrel === "PAPER") {
    x = ha === "RIGHT" ? PW - w - ho : ha === "CENTER" ? (PW - w) / 2 + ho : ho
  } else {
    // PARA/COLUMN — 현재 텍스트 영역 기준 (셀 안이면 셀 내부 폭. COLUMN을 페이지
    // 단으로 읽으면 셀 안 개체가 페이지 왼쪽으로 튄다 — 사진대지 우측 셀 실측)
    x = ha === "RIGHT" ? ox + areaW - w - ho : ha === "CENTER" ? ox + (areaW - w) / 2 + ho : ox + ho
  }
  return { x, y }
}

function drawObject(o: ParaObj, x: number, y: number, baseV: number, areaW: number, ctx: Ctx, depth: number): void {
  if (o.tag === "tbl") drawTable(o.el, x, y, ctx, depth + 1)
  else if (o.tag === "pic") drawPic(o.el, x, y, ctx)
  else if (o.tag === "container") {
    // 그리기개체 묶음 — 자식 개체를 컨테이너 원점 기준으로 재귀 배치
    for (const ch of elements(o.el)) {
      const tag = ln(ch)
      if (!OBJ_TAGS.has(tag)) continue
      const sz = findChildByLocalName(ch, "sz")
      const off = findChildByLocalName(ch, "offset")
      const sub: ParaObj = { el: ch, tag, index: 0, inline: true, width: num(sz, "width"), height: num(sz, "height") }
      drawObject(sub, x + num(off, "x"), y + num(off, "y"), baseV, areaW, ctx, depth + 1)
    }
  } else if (o.tag === "equation") {
    warnOnce(ctx, "equation", "수식 개체는 렌더 미지원 — 생략")
  } else {
    warnOnce(ctx, `shape:${o.tag}`, `도형 개체(${o.tag}) 렌더 미지원 — 생략`)
  }
}

// ─── 표 ───────────────────────────────────────────

interface CellModel {
  el: Element
  ca: number; ra: number; cs: number; rs: number
  w: number; h: number
  bfId: string | null
  sub: Element | null
  marginL: number; marginR: number; marginT: number; marginB: number
}

/** 셀 콘텐츠 세로 범위 — 줄(vp+th)과 PARA 앵커 개체(anchor+h) 최대값 */
function cellContentExtent(cell: CellModel, ctx: Ctx): number {
  if (!cell.sub) return 0
  let ext = 0
  for (const p of elements(cell.sub)) {
    if (ln(p) !== "p") continue
    const m = buildPara(p)
    for (const s of m.segs) ext = Math.max(ext, s.vertpos + s.textheight)
    const baseV = m.segs[0]?.vertpos ?? 0
    for (const o of m.objs) {
      if (o.inline) continue
      const pos = findChildByLocalName(o.el, "pos")
      if ((pos?.getAttribute("vertRelTo") ?? "PARA") !== "PARA") continue
      const om = findChildByLocalName(o.el, "outMargin")
      const pushed = baseV - (num(om, "top") + o.height + num(om, "bottom"))
      const anchor = pushed >= -100 ? pushed : baseV
      ext = Math.max(ext, anchor + num(om, "top") + num(pos, "vertOffset") + o.height)
    }
  }
  return ext
}

function edgeLine(x1: number, y1: number, x2: number, y2: number, e: RenderBorderEdge): string {
  const dash = /DASH|DOT/.test(e.type) ? ` stroke-dasharray="${e.type.includes("DOT") ? "1,1.5" : "3,1.5"}"` : ""
  return `<line x1="${pt(x1)}" y1="${pt(y1)}" x2="${pt(x2)}" y2="${pt(y2)}" stroke="${escapeXml(e.color)}" stroke-width="${e.widthPt.toFixed(2)}"${dash}/>`
}

function drawTable(tbl: Element, tx: number, ty: number, ctx: Ctx, depth: number): void {
  if (depth > 16) { warnOnce(ctx, "depth", "중첩 깊이 16 초과 — 이하 생략"); return }
  ctx.stats.tables++
  const tblSz = findChildByLocalName(tbl, "sz")
  const inMargin = findChildByLocalName(tbl, "inMargin")
  const defL = num(inMargin, "left", 141), defR = num(inMargin, "right", 141)
  const defT = num(inMargin, "top", 141), defB = num(inMargin, "bottom", 141)

  const cells: CellModel[] = []
  for (const tr of elements(tbl)) {
    if (ln(tr) !== "tr") continue
    for (const tc of elements(tr)) {
      if (ln(tc) !== "tc") continue
      const addr = findChildByLocalName(tc, "cellAddr")
      const span = findChildByLocalName(tc, "cellSpan")
      const csz = findChildByLocalName(tc, "cellSz")
      const cm = findChildByLocalName(tc, "cellMargin")
      if (!addr || !csz) continue
      cells.push({
        el: tc,
        ca: num(addr, "colAddr"), ra: num(addr, "rowAddr"),
        cs: Math.max(1, num(span, "colSpan", 1)), rs: Math.max(1, num(span, "rowSpan", 1)),
        w: num(csz, "width"), h: num(csz, "height"),
        bfId: tc.getAttribute("borderFillIDRef"),
        sub: findChildByLocalName(tc, "subList"),
        marginL: cm ? num(cm, "left", defL) : defL, marginR: cm ? num(cm, "right", defR) : defR,
        marginT: cm ? num(cm, "top", defT) : defT, marginB: cm ? num(cm, "bottom", defB) : defB,
      })
    }
  }
  if (cells.length === 0 || cells.length > 4096) return

  const nCols = Math.max(...cells.map(c => c.ca + c.cs))
  const nRows = Math.max(...cells.map(c => c.ra + c.rs))
  const colCons: SpanConstraint[] = cells.map(c => ({ a: c.ca, b: c.ca + c.cs, size: c.w }))
  const colX = solveBoundaries(colCons, nCols, num(tblSz, "width") || undefined)
  const rowH = solveRowHeights(
    cells.map(c => ({ rowAddr: c.ra, rowSpan: c.rs, height: c.h, contentH: c.rs === 1 ? cellContentExtent(c, ctx) : undefined })),
    nRows,
  )
  const rowY: number[] = [0]
  for (let r = 0; r < nRows; r++) rowY.push(rowY[r] + rowH[r])

  // 1패스: 배경 → 2패스: 콘텐츠 → 3패스: 테두리 (테두리가 배경/콘텐츠 위)
  const geom = cells.map(c => ({
    c,
    x: tx + colX[c.ca], y: ty + rowY[c.ra],
    w: colX[Math.min(c.ca + c.cs, nCols)] - colX[c.ca],
    h: rowY[Math.min(c.ra + c.rs, nRows)] - rowY[c.ra],
  }))
  for (const g of geom) {
    const bf = g.c.bfId != null ? ctx.styles.borderFill.get(g.c.bfId) : undefined
    if (bf?.fill) ctx.svg.push(`<rect x="${pt(g.x)}" y="${pt(g.y)}" width="${pt(g.w)}" height="${pt(g.h)}" fill="${escapeXml(bf.fill)}"/>`)
  }
  for (const g of geom) {
    const { c } = g
    if (!c.sub) continue
    const innerH = g.h - c.marginT - c.marginB
    const extent = cellContentExtent(c, ctx)
    const va = c.sub.getAttribute("vertAlign") ?? "TOP"
    let yoff = 0
    if (va === "CENTER") yoff = Math.max(0, (innerH - extent) / 2)
    else if (va === "BOTTOM") yoff = Math.max(0, innerH - extent)
    for (const p of elements(c.sub)) {
      if (ln(p) !== "p") continue
      drawPara(p, g.x + c.marginL, g.y + c.marginT + yoff, g.w - c.marginL - c.marginR, ctx, depth + 1)
    }
  }
  for (const g of geom) {
    const bf = g.c.bfId != null ? ctx.styles.borderFill.get(g.c.bfId) : undefined
    if (!bf) continue
    if (bf.top) ctx.svg.push(edgeLine(g.x, g.y, g.x + g.w, g.y, bf.top))
    if (bf.bottom) ctx.svg.push(edgeLine(g.x, g.y + g.h, g.x + g.w, g.y + g.h, bf.bottom))
    if (bf.left) ctx.svg.push(edgeLine(g.x, g.y, g.x, g.y + g.h, bf.left))
    if (bf.right) ctx.svg.push(edgeLine(g.x + g.w, g.y, g.x + g.w, g.y + g.h, bf.right))
  }
}

// ─── 이미지 ───────────────────────────────────────

function drawPic(pic: Element, x: number, y: number, ctx: Ctx): void {
  const sz = findChildByLocalName(pic, "sz")
  const w = num(sz, "width", 5669), h = num(sz, "height", 5669)
  const img = findFirst(pic, "img")
  const ref = img?.getAttribute("binaryItemIDRef")
  const loaded = ref != null ? ctx.images.get(ref) : undefined
  if (!loaded) {
    ctx.svg.push(`<rect x="${pt(x)}" y="${pt(y)}" width="${pt(w)}" height="${pt(h)}" fill="#eee" stroke="#c00" stroke-width="0.5"/>`)
    warnOnce(ctx, `img:${ref}`, `이미지 바이너리 누락: ${ref ?? "(ref 없음)"}`)
    return
  }
  ctx.stats.images++
  const orgSz = findChildByLocalName(pic, "orgSz")
  const clip = findChildByLocalName(pic, "imgClip")
  const orgW = num(orgSz, "width"), orgH = num(orgSz, "height")
  const cl = num(clip, "left"), ct = num(clip, "top")
  const cr = num(clip, "right", orgW), cb = num(clip, "bottom", orgH)
  const cropped = orgW > 0 && orgH > 0 && clip != null && (cl > 0 || ct > 0 || cr < orgW || cb < orgH) && cr > cl && cb > ct
  if (cropped) {
    // 원본 좌표계 viewBox로 크롭 창을 내고, 이미지는 원본 크기로 깐다
    ctx.svg.push(
      `<svg x="${pt(x)}" y="${pt(y)}" width="${pt(w)}" height="${pt(h)}" viewBox="${pt(cl)} ${pt(ct)} ${pt(cr - cl)} ${pt(cb - ct)}" preserveAspectRatio="none">` +
      `<image x="0" y="0" width="${pt(orgW)}" height="${pt(orgH)}" preserveAspectRatio="none" href="${loaded.dataUri}"/></svg>`,
    )
  } else {
    ctx.svg.push(`<image x="${pt(x)}" y="${pt(y)}" width="${pt(w)}" height="${pt(h)}" preserveAspectRatio="none" href="${loaded.dataUri}"/>`)
  }
}

function sniffMime(name: string, bytes: Uint8Array): string {
  const lower = name.toLowerCase()
  if (lower.endsWith(".png") || (bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50)) return "image/png"
  if (lower.endsWith(".bmp") || (bytes.length > 2 && bytes[0] === 0x42 && bytes[1] === 0x4d)) return "image/bmp"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".svg")) return "image/svg+xml"
  return "image/jpeg"
}

// ─── 엔트리 ───────────────────────────────────────

/**
 * HWPX(한컴 저장본) → 레이아웃 보존 SVG (1페이지).
 * 조판 캐시(linesegarray)가 없는 파일(예: markdownToHwpx 산출물)은 KordocError.
 */
export async function renderHwpxToSvg(input: ArrayBuffer | Uint8Array, options?: RenderSvgOptions): Promise<RenderSvgResult> {
  const maxImg = options?.maxImageBytes ?? 40 * 1024 * 1024
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(input)
  } catch {
    throw new KordocError("HWPX(ZIP) 형식이 아닙니다 — 렌더는 HWPX만 지원")
  }
  const secFile = zip.file("Contents/section0.xml") ??
    zip.file(/Contents\/section\d+\.xml$/i).sort((a, b) => a.name.localeCompare(b.name))[0]
  if (!secFile) throw new KordocError("Contents/section0.xml 없음 — HWPX가 아니거나 손상됨")
  const secXml = await secFile.async("string")
  if (secXml.length > MAX_DECOMPRESS_SIZE) throw new KordocError("섹션 XML이 허용 크기를 초과")
  if (!secXml.includes("linesegarray")) {
    throw new KordocError("조판 캐시(linesegarray) 없음 — 한컴에서 저장한 HWPX만 렌더 가능")
  }

  const warnings: string[] = []
  const headFile = zip.file("Contents/header.xml") ?? zip.file("Contents/head.xml")
  const styles: RenderStyles = headFile
    ? parseRenderStyles(await headFile.async("string"))
    : { charPr: new Map(), paraAlign: new Map(), borderFill: new Map() }
  if (!headFile) warnings.push("header.xml 없음 — 기본 스타일로 렌더")

  // BinData 매니페스트 (id → href) — content.hpf 우선, 파일명 휴리스틱 폴백
  const binmap = new Map<string, string>()
  const hpf = zip.file(/content\.hpf$/i)[0]
  if (hpf) {
    const man = await hpf.async("string")
    for (const m of man.matchAll(/<[^>]*\bid="([^"]+)"[^>]*\bhref="(BinData\/[^"]+)"[^>]*>/g)) binmap.set(m[1], m[2])
    for (const m of man.matchAll(/<[^>]*\bhref="(BinData\/[^"]+)"[^>]*\bid="([^"]+)"[^>]*>/g)) binmap.set(m[2], m[1])
  }
  // 참조된 이미지만 선로딩 (섹션 문자열 정규식 — DOM 워크 전에 async 구간 종료)
  const images = new Map<string, { dataUri: string }>()
  const refs = new Set<string>()
  for (const m of secXml.matchAll(/binaryItemIDRef="([^"]+)"/g)) refs.add(m[1])
  for (const ref of refs) {
    let href = binmap.get(ref)
    if (!href) {
      const cand = zip.file(new RegExp(`BinData/.*${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"))[0]
      href = cand?.name
    }
    if (!href) continue
    const f = zip.file(href) ?? zip.file("Contents/" + href)
    if (!f) continue
    const bytes = await f.async("uint8array")
    if (bytes.length > maxImg) {
      warnings.push(`이미지 ${href} ${(bytes.length / 1048576).toFixed(1)}MB — 한도 초과로 생략`)
      continue
    }
    images.set(ref, { dataUri: `data:${sniffMime(href, bytes)};base64,${Buffer.from(bytes).toString("base64")}` })
  }

  const doc = createXmlParser().parseFromString(secXml, "text/xml")
  const root = doc.documentElement as unknown as Element
  if (!root) throw new KordocError("섹션 XML 파싱 실패")

  const pagePr = findFirst(root, "pagePr")
  const margin = pagePr ? findChildByLocalName(pagePr, "margin") : null
  const PW = num(pagePr, "width", 59528), PH = num(pagePr, "height", 84188)
  const ML = num(margin, "left", 8504)
  const MT = num(margin, "top", 5668) + num(margin, "header", 0)
  const BODY_H = PH - MT - num(margin, "bottom", 4252) - num(margin, "footer", 0)
  const BODY_W = PW - ML - num(margin, "right", 8504)

  const ctx: Ctx = {
    svg: [], geom: { PW, PH, ML, MT, BODY_W, BODY_H }, styles, images,
    warnings, warned: new Set(), stats: { texts: 0, images: 0, tables: 0 },
  }

  // 최상위 문단 — 1페이지 분량만 (본문영역을 벗어난 문단은 이후 페이지)
  for (const p of elements(root)) {
    if (ln(p) !== "p") continue
    const segs = findChildByLocalName(p, "linesegarray")
    const first = segs ? elements(segs)[0] : null
    if (first && num(first, "vertpos") > BODY_H) continue
    drawPara(p, ML, MT, BODY_W, ctx, 0)
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pt(PW)} ${pt(PH)}" width="${pt(PW)}" height="${pt(PH)}" font-family="'HCR Batang','함초롬바탕','Hancom Batang',AppleMyungjo,'Noto Serif CJK KR',serif" xml:space="preserve">\n` +
    `<rect width="100%" height="100%" fill="white"/>\n${ctx.svg.join("\n")}\n</svg>`
  return { svg, width: Math.round(PW) / 100, height: Math.round(PH) / 100, warnings, stats: ctx.stats }
}
