/**
 * DOCX 파서 단위 테스트
 *
 * jszip으로 합성 DOCX 파일 생성 → 파싱 검증
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import JSZip from "jszip"
import { parse, detectZipFormat } from "../src/index.js"

/** 최소 DOCX 파일 생성 */
async function createDocx(bodyXml: string, opts?: {
  styles?: string
  numbering?: string
  footnotes?: string
}): Promise<ArrayBuffer> {
  const zip = new JSZip()

  // [Content_Types].xml
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)

  // _rels/.rels
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)

  // word/document.xml
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${bodyXml}</w:body>
</w:document>`)

  // word/_rels/document.xml.rels
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`)

  if (opts?.styles) zip.file("word/styles.xml", opts.styles)
  if (opts?.numbering) zip.file("word/numbering.xml", opts.numbering)
  if (opts?.footnotes) zip.file("word/footnotes.xml", opts.footnotes)

  return await zip.generateAsync({ type: "arraybuffer" })
}

describe("DOCX 파서", () => {
  it("기본 단락 파싱", async () => {
    const buffer = await createDocx(`
      <w:p><w:r><w:t>안녕하세요 DOCX 테스트입니다.</w:t></w:r></w:p>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.equal(result.fileType, "docx")
    assert.ok(result.markdown.includes("안녕하세요 DOCX 테스트입니다."))
  })

  it("여러 단락 파싱", async () => {
    const buffer = await createDocx(`
      <w:p><w:r><w:t>첫 번째 문단</w:t></w:r></w:p>
      <w:p><w:r><w:t>두 번째 문단</w:t></w:r></w:p>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.markdown.includes("첫 번째 문단"))
    assert.ok(result.markdown.includes("두 번째 문단"))
  })

  it("헤딩 스타일 감지 (outlineLvl)", async () => {
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:outlineLvl w:val="1"/></w:pPr>
  </w:style>
</w:styles>`

    const buffer = await createDocx(`
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>제1장 총칙</w:t></w:r></w:p>
      <w:p><w:r><w:t>본문 텍스트</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>제1절 목적</w:t></w:r></w:p>
    `, { styles })

    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.markdown.includes("# 제1장 총칙"))
    assert.ok(result.markdown.includes("## 제1절 목적"))
    assert.ok(result.outline && result.outline.length >= 2)
  })

  it("테이블 파싱", async () => {
    const buffer = await createDocx(`
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>이름</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>나이</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>홍길동</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>30</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.markdown.includes("이름"))
    assert.ok(result.markdown.includes("홍길동"))
    assert.ok(result.markdown.includes("|"))
  })

  it("테이블 셀 병합 (gridSpan)", async () => {
    const buffer = await createDocx(`
      <w:tbl>
        <w:tr>
          <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>병합됨</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.markdown.includes("병합됨"))
  })

  it("테이블 gridBefore — 행 앞 스킵 그리드로 셀이 왼쪽으로 밀리지 않고 올바른 열 배치", async () => {
    // 자료손상 회귀: w:trPr/w:gridBefore 미처리 시 D가 A열로 무음 오배치되던 버그
    const buffer = await createDocx(`
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:trPr><w:gridBefore w:val="1"/></w:trPr>
          <w:tc><w:p><w:r><w:t>D</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>E</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    const dataRow = result.markdown.split("\n").find(l => l.includes("D") && l.includes("E"))
    assert.ok(dataRow, `D·E 행을 찾지 못함: ${result.markdown}`)
    const cells = dataRow.split("|").map(s => s.trim())
    // "|  | D | E |" → ["", "", "D", "E", ""]. gridBefore=1이라 첫 열은 빔.
    assert.equal(cells[1], "", `첫 열은 비어야 함(gridBefore=1): ${dataRow}`)
    assert.equal(cells[2], "D", `D는 둘째 열이어야 함: ${dataRow}`)
    assert.equal(cells[3], "E", `E는 셋째 열이어야 함: ${dataRow}`)
  })

  it("hwp5-5: 음수 gridBefore(기형 docx)는 클램프돼 첫 셀이 소실되지 않는다", async () => {
    // 2fffadd 가 연 신규 경로: gridBefore 음수 → colAddr=-1 → 첫 셀이 무음 탈락하던 회귀
    const buffer = await createDocx(`
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:trPr><w:gridBefore w:val="-1"/></w:trPr>
          <w:tc><w:p><w:r><w:t>D</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>E</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.match(result.markdown, /D/, "음수 gridBefore 여도 첫 셀 D 가 보존돼야 함(col 0 클램프)")
  })

  it("볼드/이탤릭 스타일 추출", async () => {
    const buffer = await createDocx(`
      <w:p>
        <w:r><w:rPr><w:b/></w:rPr><w:t>굵은 텍스트</w:t></w:r>
        <w:r><w:rPr><w:i/></w:rPr><w:t>기울인 텍스트</w:t></w:r>
      </w:p>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.markdown.includes("굵은 텍스트"))
    assert.ok(result.markdown.includes("기울인 텍스트"))
    // blocks에 스타일 정보 있는지 확인
    const styledBlock = result.blocks.find(b => b.style?.bold || b.style?.italic)
    assert.ok(styledBlock, "스타일 정보가 있어야 함")
  })

  it("포맷이 docx로 감지", async () => {
    const buffer = await createDocx(`<w:p><w:r><w:t>test</w:t></w:r></w:p>`)
    const format = await detectZipFormat(buffer)
    assert.equal(format, "docx")
  })

  it("메타데이터 추출", async () => {
    const buffer = await createDocx(`<w:p><w:r><w:t>test</w:t></w:r></w:p>`)
    const zip = await JSZip.loadAsync(buffer)
    zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>보고서</dc:title>
  <dc:creator>김철수</dc:creator>
</cp:coreProperties>`)
    const newBuffer = await zip.generateAsync({ type: "arraybuffer" })
    const result = await parse(newBuffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.equal(result.metadata?.title, "보고서")
    assert.equal(result.metadata?.author, "김철수")
  })

  it("빈 DOCX는 에러 없이 처리", async () => {
    const buffer = await createDocx("")
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.equal(result.markdown, "")
  })

  it("sdt(콘텐츠 컨트롤) 안의 인라인 run 텍스트 추출 — Google Docs 익스포트", async () => {
    // <w:p><w:sdt><w:sdtContent><w:r><w:t>...</w:t></w:r></w:sdtContent></w:sdt></w:p>
    const buffer = await createDocx(`
      <w:p><w:sdt><w:sdtPr><w:tag w:val="goog_rdk_6"/></w:sdtPr><w:sdtContent>
        <w:r><w:t>콘텐츠 컨트롤 안의 텍스트</w:t></w:r>
      </w:sdtContent></w:sdt></w:p>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.markdown.includes("콘텐츠 컨트롤 안의 텍스트"), `markdown: ${result.markdown}`)
  })

  it("블록 sdt로 감싼 문단/표 추출", async () => {
    const buffer = await createDocx(`
      <w:sdt><w:sdtContent>
        <w:p><w:r><w:t>블록 컨트롤 문단</w:t></w:r></w:p>
      </w:sdtContent></w:sdt>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.markdown.includes("블록 컨트롤 문단"), `markdown: ${result.markdown}`)
  })

  it("sdt 안의 표 셀 텍스트 추출", async () => {
    const buffer = await createDocx(`
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:sdt><w:sdtContent><w:r><w:t>성명</w:t></w:r></w:sdtContent></w:sdt></w:p></w:tc>
          <w:tc><w:p><w:sdt><w:sdtContent><w:r><w:t>홍길동</w:t></w:r></w:sdtContent></w:sdt></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.markdown.includes("성명"), `markdown: ${result.markdown}`)
    assert.ok(result.markdown.includes("홍길동"), `markdown: ${result.markdown}`)
  })

  it("깨진 styles.xml — 무시 대신 PARTIAL_PARSE 경고 + 본문 파싱 계속", async () => {
    const buffer = await createDocx(
      `<w:p><w:r><w:t>본문은 살아있다</w:t></w:r></w:p>`,
      { styles: `<w:styles xmlns:w="x"><w:style` },
    )
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.markdown.includes("본문은 살아있다"), "본문 파싱 계속")
    assert.ok(result.warnings?.some(w => w.code === "PARTIAL_PARSE" && w.message.includes("styles.xml")),
      `경고 목록: ${JSON.stringify(result.warnings)}`)
  })
})

describe("DOCX vMerge continue 셀 내용 보존 (리뷰 #18)", () => {
  it("위 셀이 있는 continue 셀 내용은 시작 셀로 합류한다", async () => {
    const buffer = await createDocx(`
      <w:tbl>
        <w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t>고아내용</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.markdown.includes("고아내용"), `continue 셀 내용 소실: ${result.markdown}`)
  })

  it("첫 행 고아 continue 셀은 일반 셀로 승격한다", async () => {
    const buffer = await createDocx(`
      <w:tbl>
        <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t>첫행고아</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.markdown.includes("첫행고아"), `고아 continue 셀 소실: ${result.markdown}`)
  })

  it("정상 병합(restart + 빈 continue)은 기존대로 rowSpan 흡수", async () => {
    const buffer = await createDocx(`
      <w:tbl>
        <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>병합시작</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    assert.ok(result.markdown.includes("병합시작"))
    assert.ok(result.markdown.includes('rowspan="2"'), `rowSpan 병합 깨짐: ${result.markdown}`)
  })
})

describe("DOCX 텍스트박스 수식 이중 방출 방지 (리뷰 #19)", () => {
  it("텍스트박스 안 수식은 텍스트박스 블록에서 1회만 나온다", async () => {
    const math = `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>E=mc</m:t></m:r></m:oMath>`
    const buffer = await createDocx(`
      <w:p>
        <w:r>
          <mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
            <mc:Choice Requires="wps">
              <w:drawing><wps:txbx xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                <w:txbxContent><w:p><w:r><w:t>박스텍스트</w:t></w:r>${math}</w:p></w:txbxContent>
              </wps:txbx></w:drawing>
            </mc:Choice>
            <mc:Fallback>
              <w:pict><v:textbox xmlns:v="urn:schemas-microsoft-com:vml">
                <w:txbxContent><w:p><w:r><w:t>박스텍스트</w:t></w:r>${math}</w:p></w:txbxContent>
              </v:textbox></w:pict>
            </mc:Fallback>
          </mc:AlternateContent>
        </w:r>
      </w:p>
    `)
    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (!result.success) return
    const count = (result.markdown.match(/E=mc/g) ?? []).length
    assert.equal(count, 1, `수식이 ${count}회 방출됨 (기대 1): ${result.markdown}`)
  })
})
