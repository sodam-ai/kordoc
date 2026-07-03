import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { detectClusterTables, findTwoColumnProseCutX, type ClusterItem } from "../src/pdf/cluster-detector.js"

/** 헬퍼: 간단한 텍스트 아이템 생성 */
function item(text: string, x: number, y: number, w = 40, fontSize = 12): ClusterItem {
  return { text, x, y, w, h: fontSize, fontSize, fontName: "Test" }
}

describe("detectClusterTables", () => {
  it("2열 × 4행 정렬된 텍스트 → 테이블 감지", () => {
    // 2열 key-value 테이블 시뮬레이션
    const items: ClusterItem[] = [
      // col1(x=50), col2(x=200) — 갭이 fontSize*1.5 이상
      item("구분", 50, 400),    item("내용", 200, 400),
      item("이름", 50, 380),    item("홍길동", 200, 380),
      item("나이", 50, 360),    item("30세", 200, 360),
      item("주소", 50, 340),    item("서울시", 200, 340),
    ]

    const results = detectClusterTables(items, 1)
    assert.ok(results.length > 0, "테이블이 감지되어야 함")
    assert.equal(results[0].table.cols, 2)
    assert.ok(results[0].table.rows >= 3)
  })

  it("3열 × 3행 테���블 감지", () => {
    const items: ClusterItem[] = [
      item("번호", 50, 400), item("이름", 200, 400), item("금액", 350, 400),
      item("1", 50, 380),    item("사과", 200, 380), item("1000", 350, 380),
      item("2", 50, 360),    item("배", 200, 360),   item("2000", 350, 360),
    ]

    const results = detectClusterTables(items, 1)
    assert.ok(results.length > 0, "3열 테이블 감지")
    assert.equal(results[0].table.cols, 3)
  })

  it("단일 열 텍스트(문단) → 테이블 아님", () => {
    const items: ClusterItem[] = [
      item("첫째 줄 내용입니다", 50, 400, 200),
      item("둘째 줄 내용입니다", 50, 380, 200),
      item("셋째 줄 내용입니다", 50, 360, 200),
    ]

    const results = detectClusterTables(items, 1)
    assert.equal(results.length, 0, "단일 열은 테이블이 아님")
  })

  it("아이템이 너무 적으면 테이블 아님", () => {
    const items: ClusterItem[] = [
      item("A", 50, 400), item("B", 200, 400),
    ]
    const results = detectClusterTables(items, 1)
    assert.equal(results.length, 0)
  })

  it("빈 배열 → 빈 결과", () => {
    assert.deepEqual(detectClusterTables([], 1), [])
  })
})

/** 헬퍼: 2단 조판 본문 페이지 시뮬레이션 (국회 속기록류) */
function twoColumnProsePage(): ClusterItem[] {
  const items: ClusterItem[] = []
  // 좌단 x=50~280 / 우단 x=310~540, 각 12줄 — 마지막 줄 빼고 justify
  for (let r = 0; r < 12; r++) {
    const y = 700 - r * 20
    const lastL = r === 11
    const lastR = r === 5 // 우단 문단 끝 (짧은 줄)
    items.push({ text: "왼쪽단의본문문장조각입니다" + r, x: 50, y, w: lastL ? 120 : 230, h: 12, fontSize: 12, fontName: "T" })
    items.push({ text: "오른쪽단의본문문장조각입니다" + r, x: 310, y, w: lastR ? 110 : 230, h: 12, fontSize: 12, fontName: "T" })
  }
  return items
}

describe("findTwoColumnProseCutX (2단 조판 본문 판별)", () => {
  it("좌우 대칭 justify 본문 → 단 사이 컷 반환", () => {
    const cutX = findTwoColumnProseCutX(twoColumnProsePage())
    assert.ok(cutX !== null, "2단 본문으로 판별되어야 함")
    assert.ok(cutX > 280 && cutX < 310, `컷이 단 사이(280~310)여야 함: ${cutX}`)
  })

  it("짧은 라벨 열을 가진 진짜 표 → null", () => {
    const items: ClusterItem[] = []
    for (let r = 0; r < 12; r++) {
      const y = 700 - r * 20
      items.push({ text: "구분" + r, x: 50, y, w: 40, h: 12, fontSize: 12, fontName: "T" })
      items.push({ text: "내용값" + r, x: 310, y, w: 60, h: 12, fontSize: 12, fontName: "T" })
    }
    assert.equal(findTwoColumnProseCutX(items), null, "짧은 셀 표는 본문이 아님")
  })

  it("숫자 위주 2열(예산표) → null", () => {
    const items: ClusterItem[] = []
    for (let r = 0; r < 12; r++) {
      const y = 700 - r * 20
      items.push({ text: "1,234,567,890,123", x: 50, y, w: 230, h: 12, fontSize: 12, fontName: "T" })
      items.push({ text: "9,876,543,210,987", x: 310, y, w: 230, h: 12, fontSize: 12, fontName: "T" })
    }
    assert.equal(findTwoColumnProseCutX(items), null, "숫자 표는 본문이 아님")
  })

  it("detectClusterTables: 2단 조판 본문은 표로 감지하지 않음", () => {
    const results = detectClusterTables(twoColumnProsePage(), 1)
    assert.equal(results.length, 0, "2단 본문이 표로 흡수되면 안 됨")
  })

  it("오염 좌표(Infinity·과대 span)에서 폭주 없이 즉시 종료", () => {
    // 손상 PDF의 오염 CTM이 만드는 극단 좌표 — 스캔 루프 폭주 회귀 방지 (fuzz: bflip)
    const inf = twoColumnProsePage()
    inf.push({ text: "오염", x: Infinity, y: 700, w: 10, h: 12, fontSize: 12, fontName: "T" })
    const t0 = performance.now()
    findTwoColumnProseCutX(inf)
    const huge = twoColumnProsePage()
    huge.push({ text: "오염", x: 1e9, y: 700, w: 10, h: 12, fontSize: 12, fontName: "T" })
    findTwoColumnProseCutX(huge)
    assert.ok(performance.now() - t0 < 1000, "오염 좌표에서 1초 내 반환해야 함")
  })
})
