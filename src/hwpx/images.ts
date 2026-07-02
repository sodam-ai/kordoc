/**
 * HWPX 이미지 추출 (parser.ts에서 분리).
 * blocks의 image ref를 ZIP 바이너리로 해제 — ref 단위 dedupe·실패 캐시·ZIP bomb 가드.
 */

import type JSZip from "jszip"
import { KordocError, isPathTraversal } from "../utils.js"
import type { ExtractedImage, IRBlock, IRCell, ParseWarning } from "../types.js"
import { MAX_DECOMPRESS_SIZE, MAX_XML_DEPTH } from "./parser-shared.js"

// ─── 이미지 추출 ───────────────────────────────────

/** 확장자 → MIME 타입 */
function imageExtToMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case "jpg": case "jpeg": return "image/jpeg"
    case "png": return "image/png"
    case "gif": return "image/gif"
    case "bmp": return "image/bmp"
    case "tif": case "tiff": return "image/tiff"
    case "wmf": return "image/wmf"
    case "emf": return "image/emf"
    case "svg": return "image/svg+xml"
    default: return "application/octet-stream"
  }
}

/** MIME → 확장자 */
function mimeToExt(mime: string): string {
  if (mime.includes("jpeg")) return "jpg"
  if (mime.includes("png")) return "png"
  if (mime.includes("gif")) return "gif"
  if (mime.includes("bmp")) return "bmp"
  if (mime.includes("tiff")) return "tif"
  if (mime.includes("wmf")) return "wmf"
  if (mime.includes("emf")) return "emf"
  if (mime.includes("svg")) return "svg"
  return "bin"
}

/** 이미지 블록 재귀 수집 — 표 셀 내부(IRCell.blocks)에 중첩된 이미지 포함 (v3.0) */
function collectImageBlocks(blocks: IRBlock[], out: { block: IRBlock; ownerCell?: IRCell }[], ownerCell?: IRCell, depth = 0): void {
  if (depth > MAX_XML_DEPTH) return
  for (const block of blocks) {
    if (block.type === "image") {
      out.push({ block, ownerCell })
    } else if (block.type === "table" && block.table) {
      for (const row of block.table.cells) {
        for (const cell of row) {
          if (cell.blocks?.length) collectImageBlocks(cell.blocks, out, cell, depth + 1)
        }
      }
    }
  }
}

/** blocks에서 type="image" 블록의 참조를 ZIP에서 실제 바이너리로 변환 */
export async function extractImagesFromZip(
  zip: JSZip,
  blocks: IRBlock[],
  decompressed: { total: number },
  warnings?: ParseWarning[],
): Promise<ExtractedImage[]> {
  const images: ExtractedImage[] = []
  let imageIndex = 0

  const imageBlocks: { block: IRBlock; ownerCell?: IRCell }[] = []
  collectImageBlocks(blocks, imageBlocks)

  // 같은 ref를 참조하는 개체가 수천 개일 수 있다(도형 반복 등) — ref당 1회만
  // 해제·변환하고 데이터 버퍼를 공유한다 (블록마다 zip 재해제하면 메모리 폭발).
  // 실패도 캐시해 경고는 1회만. 캐시 히트는 새 해제가 아니므로 ZIP bomb 가드에 가산하지 않는다.
  const resolved = new Map<string, ExtractedImage | null>()

  for (const { block, ownerCell } of imageBlocks) {
    if (block.type !== "image" || !block.text) continue

    const ref = block.text
    let img = resolved.get(ref)
    if (img === undefined) {
      img = null
      // BinData/ 폴더 내에서 참조 파일 찾기
      // HWPX binaryItemIDRef는 확장자 없이 오는 경우가 많음 (예: "image1" → "BinData/image1.bmp")
      const candidates = [
        `BinData/${ref}`,
        `Contents/BinData/${ref}`,
        ref, // 절대 경로일 수도 있음
      ]

      // 확장자 없는 ref인 경우 ZIP에서 매칭 파일 탐색
      let resolvedPath: string | null = null
      if (!ref.includes(".")) {
        const prefixes = [`BinData/${ref}`, `Contents/BinData/${ref}`]
        for (const prefix of prefixes) {
          const match = zip.file(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[a-zA-Z0-9]+$`))
          if (match.length > 0) { resolvedPath = match[0].name; break }
        }
      }

      const allCandidates = resolvedPath ? [resolvedPath, ...candidates] : candidates
      for (const path of allCandidates) {
        if (isPathTraversal(path)) continue
        const file = zip.file(path)
        if (!file) continue

        try {
          const data = await file.async("uint8array")
          decompressed.total += data.length
          if (decompressed.total > MAX_DECOMPRESS_SIZE) throw new KordocError("ZIP 압축 해제 크기 초과 (ZIP bomb 의심)")

          const ext = path.includes(".") ? (path.split(".").pop() || "png") : "png"
          const mimeType = imageExtToMime(ext)
          imageIndex++
          const filename = `image_${String(imageIndex).padStart(3, "0")}.${mimeToExt(mimeType)}`

          img = { filename, data, mimeType }
          images.push(img)
          break
        } catch (err) {
          if (err instanceof KordocError) throw err
          // 개별 이미지 실패는 경고로 처리
        }
      }

      if (!img) warnings?.push({ page: block.pageNumber, message: `이미지 파일 없음: ${ref}`, code: "SKIPPED_IMAGE" })
      resolved.set(ref, img)
    }

    if (!img) {
      // image 블록을 paragraph로 전환 (참조만 남김 — 사용자 그림설명이 있으면 함께)
      block.type = "paragraph"
      block.text = `[이미지: ${ref}]`
      if (ownerCell) ownerCell.text = ownerCell.text.replace(`![image](${ref})`, `[이미지: ${ref}]`)
      continue
    }

    // 블록 텍스트를 참조 파일명으로 교체
    block.text = img.filename
    block.imageData = { data: img.data, mimeType: img.mimeType, filename: ref }
    // 셀 내부 이미지 — 셀 평탄화 텍스트의 참조도 파일명으로 갱신
    if (ownerCell) ownerCell.text = ownerCell.text.replace(`![image](${ref})`, `![image](${img.filename})`)
  }

  return images
}
