/**
 * HWPX 생성 공유 상수·테마·XML 원자 (generator.ts에서 분리).
 * 네임스페이스, charPr/paraPr id 상수, 테마 해석, escapeXml, charPr/paraPr 조각.
 */

export const NS_SECTION = "http://www.hancom.co.kr/hwpml/2011/section"
export const NS_PARA = "http://www.hancom.co.kr/hwpml/2011/paragraph"
export const NS_HEAD = "http://www.hancom.co.kr/hwpml/2011/head"
export const NS_CORE = "http://www.hancom.co.kr/hwpml/2011/core"
export const NS_OPF = "http://www.idpf.org/2007/opf/"
export const NS_HPF = "http://www.hancom.co.kr/schema/2011/hpf"
export const NS_OCF = "urn:oasis:names:tc:opendocument:xmlns:container"

// ─── 스타일 ID 매핑 ─────────────────────────────────
// charPr: 0=본문, 1=볼드, 2=이탤릭, 3=볼드이탤릭, 4=인라인코드, 5=h1, 6=h2, 7=h3, 8=h4~h6, 9=표 헤더 셀, 10=인용문
// paraPr: 0=본문, 1=h1, 2=h2, 3=h3, 4=h4~h6, 5=코드블록, 6=인용문, 7=리스트

export const CHAR_NORMAL = 0
export const CHAR_BOLD = 1
export const CHAR_ITALIC = 2
export const CHAR_BOLD_ITALIC = 3
export const CHAR_CODE = 4
export const CHAR_H1 = 5
export const CHAR_H2 = 6
export const CHAR_H3 = 7
export const CHAR_H4 = 8
export const CHAR_TABLE_HEADER = 9
export const CHAR_QUOTE = 10

export const PARA_NORMAL = 0
export const PARA_H1 = 1
export const PARA_H2 = 2
export const PARA_H3 = 3
export const PARA_H4 = 4
export const PARA_CODE = 5
export const PARA_QUOTE = 6
export const PARA_LIST = 7

/** HWPX 생성 시 적용할 시각 테마 (모두 선택) */
export interface HwpxTheme {
  /**
   * 헤딩 레벨별 텍스트 색상. 미지정 시 검정.
   * 현재 charPr 매핑은 h1/h2/h3/h4 4단계 (h5, h6은 h4와 같은 charPr 공유)이므로
   * 키는 1~4만 받는다.
   */
  headingColors?: Partial<Record<1 | 2 | 3 | 4, string>>
  /** 본문 단락 텍스트 색상. 미지정 시 검정 */
  bodyColor?: string
  /**
   * 인용문 텍스트 색상. 미지정 시 검정.
   *
   * 주의: 이 옵션을 지정하면 인용문이 별도 charPr(이탤릭)로 렌더링된다.
   * 미지정 시 기존 동작 그대로 본문 charPr로 렌더링 (이탤릭 아님).
   */
  quoteColor?: string
  /** 표 첫 행 텍스트 색상. 미지정 시 본문과 동일 */
  tableHeaderColor?: string
  /** 표 첫 행 텍스트를 굵게 표시 (기본 false) */
  tableHeaderBold?: boolean
}

const DEFAULT_TEXT_COLOR = "#000000"

export function resolveTheme(theme?: HwpxTheme) {
  return {
    h1: theme?.headingColors?.[1] ?? DEFAULT_TEXT_COLOR,
    h2: theme?.headingColors?.[2] ?? DEFAULT_TEXT_COLOR,
    h3: theme?.headingColors?.[3] ?? DEFAULT_TEXT_COLOR,
    h4: theme?.headingColors?.[4] ?? theme?.headingColors?.[3] ?? DEFAULT_TEXT_COLOR,
    body: theme?.bodyColor ?? DEFAULT_TEXT_COLOR,
    quote: theme?.quoteColor ?? DEFAULT_TEXT_COLOR,
    /** quoteColor가 명시되었는지 — blockquote charPr 분기에 사용 (baseline 호환) */
    hasQuoteOption: theme?.quoteColor !== undefined,
    tableHeader: theme?.tableHeaderColor ?? theme?.bodyColor ?? DEFAULT_TEXT_COLOR,
    tableHeaderBold: !!theme?.tableHeaderBold,
  }
}

export type ResolvedTheme = ReturnType<typeof resolveTheme>

// ─── XML 생성 헬퍼 ───────────────────────────────────

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function headingParaPrId(level: number): number {
  if (level === 1) return PARA_H1
  if (level === 2) return PARA_H2
  if (level === 3) return PARA_H3
  return PARA_H4
}

export function headingCharPrId(level: number): number {
  if (level === 1) return CHAR_H1
  if (level === 2) return CHAR_H2
  if (level === 3) return CHAR_H3
  return CHAR_H4
}


export function charPr(
  id: number,
  height: number,
  bold: boolean,
  italic: boolean,
  fontId: number = 0,
  textColor: string = DEFAULT_TEXT_COLOR,
  ratioPct: number = 100,
): string {
  const boldAttr = bold ? ` bold="1"` : ""
  const italicAttr = italic ? ` italic="1"` : ""
  // 볼드면 fontfaces의 bold variant(id=2: HY견고딕/Arial Black, weight=9) 참조해
  // macOS 한컴에서 합성 굵기 안 되는 케이스 커버. 코드(fontId=1)는 bold 아닌 경우에만
  // 원본 id 유지 (Consolas/함초롬돋움).
  const effFont = bold ? 2 : fontId
  // 장평(ratio): 공문서 본문은 95%로 가로 압축 — 한두 글자만 다음 줄로 넘어가는
  // orphan을 줄여 한 줄에 담는다(실제 공문서 관행). 한글·라틴만, 나머지는 100.
  return `      <hh:charPr id="${id}" height="${height}" textColor="${textColor}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"${boldAttr}${italicAttr}>
        <hh:fontRef hangul="${effFont}" latin="${effFont}" hanja="${effFont}" japanese="${effFont}" other="${effFont}" symbol="${effFont}" user="${effFont}"/>
        <hh:ratio hangul="${ratioPct}" latin="${ratioPct}" hanja="${ratioPct}" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>`
}

// ─── paraPr 생성 헬퍼 ───────────────────────────────

export function paraPr(id: number, opts: { align?: string; spaceBefore?: number; spaceAfter?: number; lineSpacing?: number; indent?: number; left?: number; keepWord?: boolean } = {}): string {
  const { align = "JUSTIFY", spaceBefore = 0, spaceAfter = 0, lineSpacing = 160, indent = 0, left = 0, keepWord = false } = opts
  // keepWord=true면 한글도 어절(단어) 단위로만 줄바꿈 — 단어 중간에서 끊기지 않음.
  // 단, snapToGrid="1"(글자 격자 강제 정렬)이 켜져 있으면 한컴이 격자에 맞추려고
  // 어절을 깨버린다. 어절 단위 줄나눔에는 반드시 격자를 꺼야 한다(실제 공문서도 0).
  const breakNonLatin = keepWord ? "KEEP_WORD" : "BREAK_WORD"
  const snapGrid = keepWord ? "0" : "1"
  return `      <hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="${snapGrid}" suppressLineNumbers="0" checked="0" textDir="AUTO">
        <hh:align horizontal="${align}" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="${breakNonLatin}" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:autoSpacing eAsianEng="0" eAsianNum="0"/>
        <hh:margin><hc:intent value="${indent}" unit="HWPUNIT"/><hc:left value="${left}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="${spaceBefore}" unit="HWPUNIT"/><hc:next value="${spaceAfter}" unit="HWPUNIT"/></hh:margin>
        <hh:lineSpacing type="PERCENT" value="${lineSpacing}"/>
        <hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>`
}

// ─── 공문서 모드 paraPr ID 매핑 ──────────────────────
// 공문서 모드에서는 기존 0~7 paraPr 뒤에 항목 단계별(8단계) paraPr를 추가한다.
// 단계 d(0~7) → paraPrIDRef = GONGMUN_LIST_BASE + d
export const GONGMUN_LIST_BASE = 8
export const GONGMUN_LIST_LEVELS = 8
// 본문 크기 가운데정렬 단락(발신명의 등) — 항목단계 paraPr 다음 id
export const GONGMUN_CENTER = GONGMUN_LIST_BASE + GONGMUN_LIST_LEVELS

// ─── 공문서 자동 장평(orphan 축소) ───────────────────
// 기본 charPr 11종(0~10) 뒤에, 자동 장평이 필요한 문단용 변형 charPr를 붙인다.
// 변형 vi번째 장평 r → charPr id = CHAR_VARIANT_BASE + vi×4 + (0 본문|1 볼드|2 이탤릭|3 볼드이탤릭)
export const CHAR_VARIANT_BASE = 11
/** 공문서 본문 기본 장평(%) — 실제 공문서 관행 (v3.5.3) */
export const GONGMUN_BODY_RATIO = 95

