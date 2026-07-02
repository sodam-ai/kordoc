/**
 * HWPX 메타데이터 추출 (parser.ts에서 분리) — Dublin Core best-effort.
 */

import JSZip from "jszip"
import { KordocError, stripDtd } from "../utils.js"
import type { DocumentMetadata } from "../types.js"
import { createXmlParser, MAX_DECOMPRESS_SIZE } from "./parser-shared.js"
import { resolveSectionPaths } from "./zip-sections.js"

// ─── 메타데이터 추출 (best-effort) ───────────────────

/**
 * HWPX ZIP 내 메타데이터 파일에서 Dublin Core 정보 추출.
 * 표준 경로: meta.xml, docProps/core.xml, META-INF/container.xml
 */
export async function extractHwpxMetadata(zip: JSZip, metadata: DocumentMetadata, decompressed?: { total: number }): Promise<void> {
  try {
    // meta.xml (HWPX 표준) 또는 docProps/core.xml (OOXML 호환)
    const metaPaths = ["meta.xml", "META-INF/meta.xml", "docProps/core.xml"]
    for (const mp of metaPaths) {
      const file = zip.file(mp) || Object.values(zip.files).find(f => f.name.toLowerCase() === mp.toLowerCase()) || null
      if (!file) continue
      const xml = await file.async("text")
      if (decompressed) {
        decompressed.total += xml.length * 2
        if (decompressed.total > MAX_DECOMPRESS_SIZE) throw new KordocError("ZIP 압축 해제 크기 초과 (ZIP bomb 의심)")
      }
      parseDublinCoreMetadata(xml, metadata)
      if (metadata.title || metadata.author) return
    }
  } catch {
    // best-effort
  }
}

/** Dublin Core (dc:) 메타데이터 XML 파싱 */
function parseDublinCoreMetadata(xml: string, metadata: DocumentMetadata): void {
  const parser = createXmlParser()
  const doc = parser.parseFromString(stripDtd(xml), "text/xml")
  if (!doc.documentElement) return

  const getText = (tagNames: string[]): string | undefined => {
    for (const tag of tagNames) {
      const els = doc.getElementsByTagName(tag)
      if (els.length > 0) {
        const text = els[0].textContent?.trim()
        if (text) return text
      }
    }
    return undefined
  }

  metadata.title = metadata.title || getText(["dc:title", "title"])
  metadata.author = metadata.author || getText(["dc:creator", "creator", "cp:lastModifiedBy"])
  metadata.description = metadata.description || getText(["dc:description", "description", "dc:subject", "subject"])
  metadata.createdAt = metadata.createdAt || getText(["dcterms:created", "meta:creation-date"])
  metadata.modifiedAt = metadata.modifiedAt || getText(["dcterms:modified", "meta:date"])

  const keywords = getText(["dc:keyword", "cp:keywords", "meta:keyword"])
  if (keywords && !metadata.keywords) {
    metadata.keywords = keywords.split(/[,;]/).map(k => k.trim()).filter(Boolean)
  }
}

/** 메타데이터만 추출 (전체 파싱 없이) — MCP parse_metadata용 */
export async function extractHwpxMetadataOnly(buffer: ArrayBuffer): Promise<DocumentMetadata> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new KordocError("HWPX ZIP을 열 수 없습니다")
  }

  const metadata: DocumentMetadata = {}
  await extractHwpxMetadata(zip, metadata)

  const sectionPaths = await resolveSectionPaths(zip)
  metadata.pageCount = sectionPaths.length

  return metadata
}
