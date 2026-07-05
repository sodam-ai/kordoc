/**
 * Markdown → HWPX 역변환
 *
 * 지원: 헤딩(h1~h6), 단락, 볼드, 이탤릭, 인라인코드, 코드블록,
 *       순서/비순서 리스트, 수평선, 인용문, 테이블
 * jszip으로 HWPX ZIP 패키징.
 *
 * 엔트리(markdownToHwpx)와 재수출만 남김 — 구현은 목적별 모듈로 분리:
 *   gen-ids.ts        — NS/charPr/paraPr id 상수·테마 해석·XML 원자(escapeXml, charPr/paraPr)
 *   md-runs.ts        — 마크다운 블록/인라인 파싱 + run/문단 XML + PrvText
 *   gen-header.ts     — container/manifest/head.xml 생성
 *   gen-gongmun-fit.ts — 공문 자동장평 계획 + 리스트 항목부호 선계산
 *   gen-table.ts      — GFM/HTML(병합) 표 XML
 *   gen-section.ts    — secPr + 본문 section0.xml 조립
 */

import JSZip from "jszip"
import { type GongmunOptions, resolveGongmun } from "./gongmun.js"
import { type HwpxTheme, resolveTheme } from "./gen-ids.js"
import { buildPrvText, parseMarkdownToBlocks } from "./md-runs.js"
import { generateContainerXml, generateManifest, generateHeaderXml } from "./gen-header.js"
import { computeGongmunFitPlan, precomputeGongmunList } from "./gen-gongmun-fit.js"
import { blocksToSectionXml, type ChartPart } from "./gen-section.js"

export { type HwpxTheme } from "./gen-ids.js"

/** markdownToHwpx 옵션 */
export interface MarkdownToHwpxOptions {
  theme?: HwpxTheme
  /**
   * 공문서 모드 — 지정 시 한국 행정 공문서 표준 서식으로 렌더링한다.
   * (공식 여백, 명조 15pt 본문, 항목부호 8단계 행갈굼 정렬, 줄간격 등)
   * 미지정 시 기존 범용 마크다운 변환 동작 그대로 유지.
   */
  gongmun?: GongmunOptions
}


/**
 * 마크다운 텍스트를 HWPX (ArrayBuffer)로 변환.
 */
export async function markdownToHwpx(
  markdown: string,
  options?: MarkdownToHwpxOptions,
): Promise<ArrayBuffer> {
  const theme = resolveTheme(options?.theme)
  const gongmun = options?.gongmun ? resolveGongmun(options.gongmun) : null
  const blocks = parseMarkdownToBlocks(markdown)
  const gongmunList = gongmun ? precomputeGongmunList(blocks, gongmun) : null
  const fit = gongmun && gongmunList ? computeGongmunFitPlan(blocks, gongmun, gongmunList) : null
  const chartParts: ChartPart[] = []
  const sectionXml = blocksToSectionXml(blocks, theme, gongmun, gongmunList, fit, chartParts)

  const zip = new JSZip()
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" })
  zip.file("META-INF/container.xml", generateContainerXml())
  zip.file("Contents/content.hpf", generateManifest(chartParts))
  zip.file("Contents/header.xml", generateHeaderXml(theme, gongmun, fit?.variants ?? []))
  zip.file("Contents/section0.xml", sectionXml)
  for (const part of chartParts) zip.file(part.name, part.xml)
  // Preview/ — 한글 프로그램의 일부 버전(특히 macOS)이 존재 여부를 확인함
  zip.file("Preview/PrvText.txt", buildPrvText(blocks))

  return await zip.generateAsync({ type: "arraybuffer" })
}
