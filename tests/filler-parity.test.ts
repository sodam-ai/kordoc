/**
 * 채우기 두 경로 동등성 — fillFormFields(IR)와 fillHwpx(원본 보존)가
 * 같은 입력에서 같은 filled/unmatched를 내는지 검증 (v3.7 P2 정합).
 * 병합 라벨셀 값 유실(silent)과 중첩표 라벨 미재귀 교정을 명세로 고정한다.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { markdownToHwpx, parseHwpx, fillFormFields, fillHwpx, blocksToMarkdown } from "../src/index.js"

// 라벨이 colspan=2로 병합된 신청서형 표 — 값 열이 전부 비면 파서가 후행 열을
// 트리밍해 값 셀 자체가 사라지므로, 교체 대상 플레이스홀더 텍스트를 둔다
const MERGED_LABEL_MD = [
  "<table>",
  '<tr><th colspan="2">성 명</th><th>미기재</th></tr>',
  '<tr><td colspan="2">전화번호</td><td>미기재</td></tr>',
  "</table>",
].join("\n")

// 셀 안 중첩표에 라벨-값 쌍이 있는 서식 (바깥 라벨은 값 키와 접두 충돌 없는 이름)
const NESTED_LABEL_MD = [
  "<table>",
  "<tr><th>구분</th><th>상세</th></tr>",
  "<tr><td>세부내용</td><td><table>",
  "<tr><td>담당자</td><td>미정</td></tr>",
  "<tr><td>연락처</td><td>미정</td></tr>",
  "</table></td></tr>",
  "</table>",
].join("\n")

async function makeHwpx(md: string): Promise<ArrayBuffer> {
  const buf = await markdownToHwpx(md)
  return buf instanceof ArrayBuffer ? buf : (buf as Uint8Array).buffer as ArrayBuffer
}

/** 두 경로 실행 → {label, value} 시퀀스와 unmatched 비교용 요약 */
async function runBoth(md: string, values: Record<string, string>) {
  const buffer = await makeHwpx(md)

  const parsed = await parseHwpx(buffer)
  assert.ok(parsed.success)
  const ir = fillFormFields(parsed.blocks, values)
  const irMarkdown = blocksToMarkdown(ir.blocks)

  const hx = await fillHwpx(buffer, values)
  const hxParsed = await parseHwpx(hx.buffer)
  assert.ok(hxParsed.success)

  const pairs = (f: { label: string; value: string }[]) => f.map(x => `${x.label}=${x.value}`)
  return {
    ir, irMarkdown,
    hx, hxMarkdown: hxParsed.markdown,
    irPairs: pairs(ir.filled), hxPairs: pairs(hx.filled),
  }
}

describe("채우기 경로 동등성: 병합 라벨셀", () => {
  it("colspan 라벨의 값이 두 경로 모두 실제 다음 셀에 쓰인다", async () => {
    const r = await runBoth(MERGED_LABEL_MD, { "성명": "홍길동", "전화번호": "010-1234-5678" })

    assert.deepEqual(r.irPairs, r.hxPairs, "filled 동일")
    assert.deepEqual(r.ir.unmatched, r.hx.unmatched, "unmatched 동일")
    assert.deepEqual(r.ir.unmatched, [], "전부 매칭")

    // 핵심: 렌더에서 값이 보여야 함 (병합 플레이스홀더에 쓰면 사라짐)
    assert.ok(r.irMarkdown.includes("홍길동"), `IR 렌더에 값 존재: ${r.irMarkdown}`)
    assert.ok(r.irMarkdown.includes("010-1234-5678"), "IR 렌더에 전화번호 존재")
    assert.ok(r.hxMarkdown.includes("홍길동") && r.hxMarkdown.includes("010-1234-5678"), "hwpx 렌더에 값 존재")
  })
})

describe("채우기 경로 동등성: 중첩표 라벨", () => {
  it("중첩표 안 라벨-값 쌍을 두 경로 모두 채운다", async () => {
    const r = await runBoth(NESTED_LABEL_MD, { "담당자": "김주무", "연락처": "02-120" })

    assert.deepEqual(r.irPairs, r.hxPairs, `filled 동일 (ir=${r.irPairs} hx=${r.hxPairs})`)
    assert.deepEqual(r.ir.unmatched, r.hx.unmatched, "unmatched 동일")
    assert.deepEqual(r.ir.unmatched, [], "전부 매칭")

    assert.ok(r.irMarkdown.includes("김주무") && r.irMarkdown.includes("02-120"), `IR 중첩표 채움: ${r.irMarkdown}`)
    assert.ok(r.hxMarkdown.includes("김주무") && r.hxMarkdown.includes("02-120"), "hwpx 중첩표 채움")
  })
})

describe("IR filler: 병합 플레이스홀더 유실 차단", () => {
  it("전략2 데이터 칸이 세로 병합에 덮이면 값을 소진하지 않는다", async () => {
    // 부서 열의 두 번째 데이터 칸이 rowspan에 덮임 — 배열 값이 유실되면 안 됨
    const md = [
      "<table>",
      "<tr><th>성명</th><th>부서</th></tr>",
      '<tr><td></td><td rowspan="2"></td></tr>',
      "<tr><td></td></tr>",
      "</table>",
    ].join("\n")
    const buffer = await makeHwpx(md)
    const parsed = await parseHwpx(buffer)
    assert.ok(parsed.success)

    const r = fillFormFields(parsed.blocks, { "성명": ["갑", "을"], "부서": ["기획", "감사"] })
    const rendered = blocksToMarkdown(r.blocks)
    assert.ok(rendered.includes("갑") && rendered.includes("을"), `성명 배열 채움: ${rendered}`)
    assert.ok(rendered.includes("기획"), "부서 첫 값은 병합 셀(앵커)에 채움")
    // 병합에 덮인 칸으로 값이 사라지지 않아야 함 — "감사"는 미소진(렌더에 없어도 유실 아님)
    const filledValues = r.filled.map(f => f.value)
    assert.ok(!filledValues.includes("감사") || rendered.includes("감사"),
      `filled로 보고된 값은 렌더에 존재해야 함: ${JSON.stringify(r.filled)} / ${rendered}`)
  })

  it("filled로 보고된 값은 항상 렌더 결과에 나타난다 (silent 유실 금지)", async () => {
    const r = await runBoth(MERGED_LABEL_MD, { "성명": "검증자" })
    for (const f of r.ir.filled) {
      assert.ok(r.irMarkdown.includes(f.value), `filled 값 "${f.value}"이 렌더에 존재`)
    }
  })
})
