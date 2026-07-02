/**
 * 다중값(배열) 채우기 — 2~30장 반복 양식·명부형 표 지원 회귀 테스트
 * + 채우기 후 linesegarray 제거(한컴 변조 경고 방지) 검증
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import JSZip from "jszip"
import { fillHwpx } from "../src/form/filler-hwpx.js"
import { fillFormFields } from "../src/form/filler.js"
import type { IRBlock } from "../src/types.js"

const SEC_NS = `xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"`

function tc(row: number, col: number, text: string): string {
  const run = text ? `<hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run>` : `<hp:run charPrIDRef="0"/>`
  return `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="0">
    <hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">
      <hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${run}</hp:p>
    </hp:subList>
    <hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/>
    <hp:cellSz width="2000" height="500"/><hp:cellMargin left="0" right="0" top="0" bottom="0"/>
  </hp:tc>`
}

function table(rows: string[][]): string {
  const trs = rows.map((cells, r) => `<hp:tr>${cells.map((t, c) => tc(r, c, t)).join("")}</hp:tr>`).join("")
  return `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:tbl>${trs}</hp:tbl></hp:run></hp:p>`
}

async function makeHwpx(sectionBody: string): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file("mimetype", "application/hwp+zip")
  zip.file("Contents/section0.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<hs:sec ${SEC_NS}>${sectionBody}</hs:sec>`)
  return await zip.generateAsync({ type: "arraybuffer" })
}

async function sectionOf(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  return await zip.file("Contents/section0.xml")!.async("text")
}

describe("fillHwpx — 배열 값(반복 라벨) 채우기", () => {
  it("전략 1: 같은 라벨 3회 등장 + 배열 → 등장 순서대로 각기 다른 값", async () => {
    const buffer = await makeHwpx(
      table([["성명", ""]]) + table([["성명", ""]]) + table([["성명", ""]]),
    )
    const result = await fillHwpx(buffer, { 성명: ["김일번", "이이번", "박삼번"] })
    assert.equal(result.filled.length, 3)
    assert.deepEqual(result.filled.map(f => f.value), ["김일번", "이이번", "박삼번"])
    const section = await sectionOf(result.buffer)
    for (const v of ["김일번", "이이번", "박삼번"]) assert.ok(section.includes(v), `${v} 삽입`)
    assert.deepEqual(result.unmatched, [])
  })

  it("전략 1: 배열 소진 후 등장은 채우지 않음 (마지막 값 반복 금지)", async () => {
    const buffer = await makeHwpx(
      table([["성명", ""]]) + table([["성명", ""]]) + table([["성명", ""]]),
    )
    const result = await fillHwpx(buffer, { 성명: ["김일번", "이이번"] })
    assert.equal(result.filled.length, 2)
    const section = await sectionOf(result.buffer)
    assert.equal((section.match(/김일번/g) ?? []).length, 1)
    assert.equal((section.match(/이이번/g) ?? []).length, 1)
  })

  it("전략 1: 문자열(스칼라)은 기존처럼 모든 등장에 동일값", async () => {
    const buffer = await makeHwpx(table([["성명", ""]]) + table([["성명", ""]]))
    const result = await fillHwpx(buffer, { 성명: "홍길동" })
    assert.equal(result.filled.length, 2)
    const section = await sectionOf(result.buffer)
    assert.equal((section.match(/홍길동/g) ?? []).length, 2)
  })

  it("전략 2: 명부형 표(헤더+3행) + 배열 → 행마다 다음 값", async () => {
    const buffer = await makeHwpx(
      table([
        ["성명", "직급"],
        ["", ""],
        ["", ""],
        ["", ""],
      ]),
    )
    const result = await fillHwpx(buffer, {
      성명: ["김일번", "이이번", "박삼번"],
      직급: ["주무관", "팀장", "과장"],
    })
    assert.equal(result.filled.length, 6)
    const section = await sectionOf(result.buffer)
    for (const v of ["김일번", "이이번", "박삼번", "주무관", "팀장", "과장"]) {
      assert.ok(section.includes(v), `${v} 삽입`)
    }
  })

  it("전략 2: 스칼라는 기존처럼 첫 데이터 행만", async () => {
    const buffer = await makeHwpx(table([["성명", "직급"], ["", ""], ["", ""]]))
    const result = await fillHwpx(buffer, { 성명: "홍길동" })
    assert.equal(result.filled.length, 1)
  })
})

describe("fillFormFields(IR) — 배열 값 채우기", () => {
  const makeListTable = (): IRBlock[] => [{
    type: "table",
    table: {
      rows: 4,
      cols: 2,
      cells: [
        [{ text: "성명", colSpan: 1, rowSpan: 1 }, { text: "직급", colSpan: 1, rowSpan: 1 }],
        [{ text: "", colSpan: 1, rowSpan: 1 }, { text: "", colSpan: 1, rowSpan: 1 }],
        [{ text: "", colSpan: 1, rowSpan: 1 }, { text: "", colSpan: 1, rowSpan: 1 }],
        [{ text: "", colSpan: 1, rowSpan: 1 }, { text: "", colSpan: 1, rowSpan: 1 }],
      ],
    },
  }]

  it("명부형 표: 배열 → 행마다 다음 값", () => {
    const result = fillFormFields(makeListTable(), { 성명: ["김일번", "이이번", "박삼번"] })
    assert.equal(result.filled.length, 3)
    const t = result.blocks[0].table!
    assert.equal(t.cells[1][0].text, "김일번")
    assert.equal(t.cells[2][0].text, "이이번")
    assert.equal(t.cells[3][0].text, "박삼번")
  })

  it("명부형 표: 배열이 행보다 짧으면 남는 행은 비워둠", () => {
    const result = fillFormFields(makeListTable(), { 성명: ["김일번"] })
    assert.equal(result.filled.length, 1)
    const t = result.blocks[0].table!
    assert.equal(t.cells[1][0].text, "김일번")
    assert.equal(t.cells[2][0].text, "")
  })
})

describe("fillHwpx — linesegarray 제거 (한컴 변조 경고 방지)", () => {
  const LINESEG = `<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="600" horzpos="0" horzsize="42520" flags="393216"/></hp:linesegarray>`

  it("텍스트를 채운 섹션은 linesegarray가 전부 비워진다", async () => {
    const para = `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t>성명:   </hp:t></hp:run>${LINESEG}</hp:p>`
    const buffer = await makeHwpx(para)
    const result = await fillHwpx(buffer, { 성명: "홍길동" })
    assert.equal(result.filled.length, 1)
    const section = await sectionOf(result.buffer)
    assert.ok(section.includes("홍길동"))
    assert.ok(!section.includes("linesegarray"), "채운 섹션의 linesegarray는 제거되어야 한다")
  })

  it("아무것도 채우지 못한 문서는 바이트 동일 (linesegarray 유지)", async () => {
    const para = `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t>본문 문단</hp:t></hp:run>${LINESEG}</hp:p>`
    const buffer = await makeHwpx(para)
    const result = await fillHwpx(buffer, { 존재하지않는라벨: "값" })
    assert.equal(result.filled.length, 0)
    assert.deepEqual(new Uint8Array(result.buffer), new Uint8Array(buffer), "무변경이면 바이트 동일")
    const section = await sectionOf(result.buffer)
    assert.ok(section.includes("linesegarray"), "무변경 문서의 linesegarray는 유지")
  })
})
