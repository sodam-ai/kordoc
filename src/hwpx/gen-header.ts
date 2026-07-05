/**
 * HWPX 패키지 구조 파일(container/manifest)과 head.xml 생성 (generator.ts에서 분리).
 */

import { type ResolvedGongmun, levelIndent } from "./gongmun.js"
import {
  NS_HEAD, NS_OPF, NS_HPF, NS_OCF, NS_PARA, NS_CORE,
  CHAR_TABLE_HEADER, CHAR_QUOTE,
  GONGMUN_BODY_RATIO, GONGMUN_LIST_BASE, GONGMUN_LIST_LEVELS, GONGMUN_CENTER,
  charPr, paraPr,
  type ResolvedTheme,
} from "./gen-ids.js"

// ─── HWPX 구조 파일 생성 ─────────────────────────────

export function generateContainerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<ocf:container xmlns:ocf="${NS_OCF}" xmlns:hpf="${NS_HPF}">
  <ocf:rootfiles>
    <ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>
  </ocf:rootfiles>
</ocf:container>`
}

export function generateManifest(chartParts: Array<{ name: string }> = []): string {
  const chartItems = chartParts
    .map((p, i) => `\n    <opf:item id="chart${i + 1}" href="${p.name}" media-type="application/xml"/>`)
    .join("")
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<opf:package xmlns:opf="${NS_OPF}" xmlns:hpf="${NS_HPF}" xmlns:hh="${NS_HEAD}">
  <opf:manifest>
    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>${chartItems}
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="header" linear="no"/>
    <opf:itemref idref="section0" linear="yes"/>
  </opf:spine>
</opf:package>`
}

// ─── charPr 생성 헬퍼 ───────────────────────────────

/** charProperties 블록 생성 — 공문서 모드면 본문/제목 height를 표준값으로 */
function buildCharProperties(theme: ResolvedTheme, gongmun: ResolvedGongmun | null, ratioVariants: number[] = []): string {
  // 비공문서(기존 동작): 본문 10pt
  let body = 1000, code = 900, h1 = 1800, h2 = 1400, h3 = 1200, h4 = 1100
  if (gongmun) {
    body = gongmun.bodyHeight
    code = Math.max(body - 200, 900)
    h1 = gongmun.preset === "report" || gongmun.preset === "plan" ? 2000 : 1700
    h2 = 1600
    h3 = body
    h4 = Math.max(body - 100, 1300)
  }
  // 공문서 본문 장평 95%(orphan 압축). 비공문서·제목은 100 유지.
  const bodyRatio = gongmun ? GONGMUN_BODY_RATIO : 100
  const rows = [
    charPr(0, body, false, false, 0, theme.body, bodyRatio),
    charPr(1, body, true, false, 0, theme.body, bodyRatio),
    charPr(2, body, false, true, 0, theme.body, bodyRatio),
    charPr(3, body, true, true, 0, theme.body, bodyRatio),
    charPr(4, code, false, false, 1),
    charPr(5, h1, true, false, 1, theme.h1),
    charPr(6, h2, true, false, 1, theme.h2),
    charPr(7, h3, true, false, 1, theme.h3),
    charPr(8, h4, true, false, 1, theme.h4),
    charPr(CHAR_TABLE_HEADER, body, theme.tableHeaderBold, false, 0, theme.tableHeader),
    charPr(CHAR_QUOTE, body, false, true, 0, theme.quote),
  ]
  // 자동 장평 변형 — 본문 계열(0~3)의 장평만 바꾼 복제본
  for (const r of ratioVariants) {
    rows.push(
      charPr(rows.length, body, false, false, 0, theme.body, r),
      charPr(rows.length + 1, body, true, false, 0, theme.body, r),
      charPr(rows.length + 2, body, false, true, 0, theme.body, r),
      charPr(rows.length + 3, body, true, true, 0, theme.body, r),
    )
  }
  return `<hh:charProperties itemCnt="${rows.length}">\n${rows.join("\n")}\n    </hh:charProperties>`
}

/** paraProperties 블록 생성 — 공문서 모드면 본문 줄간격·제목 가운데 + 항목단계 8종 추가 */
function buildParaProperties(gongmun: ResolvedGongmun | null): string {
  if (!gongmun) {
    const base = [
      paraPr(0),
      paraPr(1, { align: "LEFT", spaceBefore: 800, spaceAfter: 200, lineSpacing: 180, outlineLevel: 0 }),
      paraPr(2, { align: "LEFT", spaceBefore: 600, spaceAfter: 150, lineSpacing: 170, outlineLevel: 1 }),
      paraPr(3, { align: "LEFT", spaceBefore: 400, spaceAfter: 100, lineSpacing: 160, outlineLevel: 2 }),
      paraPr(4, { align: "LEFT", spaceBefore: 300, spaceAfter: 100, lineSpacing: 160, outlineLevel: 3 }),
      paraPr(5, { align: "LEFT", lineSpacing: 130, indent: 400 }),
      paraPr(6, { align: "LEFT", lineSpacing: 150, indent: 600 }),
      paraPr(7, { align: "LEFT", lineSpacing: 160, indent: 600 }),
    ]
    return `<hh:paraProperties itemCnt="${base.length}">\n${base.join("\n")}\n    </hh:paraProperties>`
  }
  const ls = gongmun.lineSpacing
  const titleAlign = gongmun.centerTitle ? "CENTER" : "LEFT"
  // 공문서 모드 전 문단 어절 단위 줄바꿈(keepWord) — 한글이 단어 중간에서 끊기지 않음
  const base = [
    paraPr(0, { lineSpacing: ls, keepWord: true }),
    paraPr(1, { align: titleAlign, spaceBefore: 400, spaceAfter: 400, lineSpacing: ls, keepWord: true, outlineLevel: 0 }),
    paraPr(2, { align: "LEFT", spaceBefore: 600, spaceAfter: 150, lineSpacing: ls, keepWord: true, outlineLevel: 1 }),
    paraPr(3, { align: "LEFT", spaceBefore: 400, spaceAfter: 100, lineSpacing: ls, keepWord: true, outlineLevel: 2 }),
    paraPr(4, { align: "LEFT", spaceBefore: 300, spaceAfter: 100, lineSpacing: ls, keepWord: true, outlineLevel: 3 }),
    paraPr(5, { align: "LEFT", lineSpacing: 130, indent: 400, keepWord: true }),
    paraPr(6, { align: "LEFT", lineSpacing: ls, indent: 600, keepWord: true }),
    paraPr(7, { align: "LEFT", lineSpacing: ls, indent: 600, keepWord: true }),
  ]
  // 항목 단계별 paraPr (8 ~ 8+7): left/내어쓰기 indent
  for (let d = 0; d < GONGMUN_LIST_LEVELS; d++) {
    const { left, indent } = levelIndent(d, gongmun.bodyHeight, gongmun.numbering)
    // 보고서(□○-) 1단계 □ 앞에 단락 간격 — 정부 보고서의 섹션 구분 관행
    const sectionGap = gongmun.numbering === "report" && d === 0 ? Math.round(gongmun.bodyHeight * 0.5) : 0
    base.push(paraPr(GONGMUN_LIST_BASE + d, { align: "JUSTIFY", lineSpacing: ls, left, indent, spaceBefore: sectionGap, keepWord: true }))
  }
  // 가운데정렬 본문 단락(발신명의 등)
  base.push(paraPr(GONGMUN_CENTER, { align: "CENTER", lineSpacing: ls, keepWord: true }))
  return `<hh:paraProperties itemCnt="${base.length}">\n${base.join("\n")}\n    </hh:paraProperties>`
}

/**
 * 개요(OUTLINE) 문단이 참조하는 numbering 정의 — 헤딩 paraPr(1~4)이 사용.
 * 실제 한컴 파일의 paraHead 속성을 미러하되 번호 서식 텍스트를 비워
 * 화면에는 번호가 붙지 않는다 (secPr outlineShapeIDRef="1"이 이 정의를 가리킴).
 */
function buildNumberings(): string {
  const heads = Array.from({ length: 7 }, (_, i) =>
    `        <hh:paraHead start="1" level="${i + 1}" align="LEFT" useInstWidth="1" autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="DIGIT" charPrIDRef="4294967295" checkable="0"/>`
  ).join("\n")
  return `<hh:numberings itemCnt="1">
      <hh:numbering id="1" start="0">
${heads}
      </hh:numbering>
    </hh:numberings>`
}

export function generateHeaderXml(theme: ResolvedTheme, gongmun: ResolvedGongmun | null, ratioVariants: number[] = []): string {
  // 본문 한글 글꼴 (공문서 gothic 프리셋이면 맑은 고딕)
  const bodyFace = gongmun?.bodyFont === "gothic" ? "맑은 고딕" : "함초롬바탕"
  const charPropsXml = buildCharProperties(theme, gongmun, ratioVariants)
  const paraPropsXml = buildParaProperties(gongmun)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<hh:head xmlns:hh="${NS_HEAD}" xmlns:hp="${NS_PARA}" xmlns:hc="${NS_CORE}" version="1.4" secCnt="1">
  <hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>
  <hh:refList>
    <hh:fontfaces itemCnt="7">
      <hh:fontface lang="HANGUL" fontCnt="3">
        <hh:font id="0" face="${bodyFace}" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>
        <hh:font id="1" face="함초롬돋움" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>
        <hh:font id="2" face="HY견고딕" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="9" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>
      </hh:fontface>
      <hh:fontface lang="LATIN" fontCnt="3">
        <hh:font id="0" face="Times New Roman" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_OLDSTYLE" weight="5" proportion="4" contrast="2" strokeVariation="0" armStyle="0" letterform="0" midline="0" xHeight="4"/>
        </hh:font>
        <hh:font id="1" face="Consolas" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_MODERN" weight="5" proportion="0" contrast="0" strokeVariation="0" armStyle="0" letterform="0" midline="0" xHeight="0"/>
        </hh:font>
        <hh:font id="2" face="Arial Black" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="9" proportion="0" contrast="0" strokeVariation="0" armStyle="0" letterform="0" midline="0" xHeight="0"/>
        </hh:font>
      </hh:fontface>
      <hh:fontface lang="HANJA" fontCnt="1">
        <hh:font id="0" face="함초롬바탕" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>
      </hh:fontface>
      <hh:fontface lang="JAPANESE" fontCnt="1">
        <hh:font id="0" face="굴림" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>
      </hh:fontface>
      <hh:fontface lang="OTHER" fontCnt="1">
        <hh:font id="0" face="굴림" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>
      </hh:fontface>
      <hh:fontface lang="SYMBOL" fontCnt="1">
        <hh:font id="0" face="Symbol" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>
      </hh:fontface>
      <hh:fontface lang="USER" fontCnt="1">
        <hh:font id="0" face="굴림" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>
      </hh:fontface>
    </hh:fontfaces>
    <hh:borderFills itemCnt="2">
      <hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/>
        <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/>
      </hh:borderFill>
      <hh:borderFill id="2" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/>
        <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
      </hh:borderFill>
    </hh:borderFills>
    ${charPropsXml}
    <hh:tabProperties itemCnt="0"/>
    ${buildNumberings()}
    <hh:bullets itemCnt="0"/>
    ${paraPropsXml}
    <hh:styles itemCnt="1">
      <hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langIDRef="1042" lockForm="0"/>
    </hh:styles>
  </hh:refList>
  <hh:compatibleDocument targetProgram="HWP2018"><hh:layoutCompatibility/></hh:compatibleDocument>
</hh:head>`
}

