# next-session: 결재란(전자결재 스탬프) 텍스트 겹침 수정 — 조사 핸드오프

**상태**: ✅ **수정 완료** (2026-07-06 집/Windows) — 루트코즈는 §5 가설 A/B/C가 아니라 **reflow lineseg textpos 폴백 버그**였음(§10). Mac 잔여: `bench:visual` + `bench:gate`(corpus) 무회귀 확인만.
**작성**: 2026-07-06 · **분류**: reflow 다중 중첩표 geometry 버그 (저우선이었으나 사용자 요청으로 격상)

> ⚠️ 회귀 정석 검증(`bench:visual` 한컴 시각오라클)은 **macOS+한컴 GUI 전용**. Windows에선 완전보증 불가 →
> Windows에서 Edge/overlap-check/785테스트/스팟체크까지 완료. **Mac에선 오라클+corpus 게이트만 돌리면 됨.**

---

## 10. ✅ 실제 루트코즈와 수정 (2026-07-06, 집 PC)

**가설 A/B/C 전부 아님.** 한컴 정답은 세로 스택이 아니라 **한 줄 나란히 배치**다 —
표1 폭(15808) + 표2 폭(31416) < 표0 셀폭(49043)이라 treatAsChar 개체 둘이 같은 줄에 흐른다.
가로 전진 로직(`svg-render.ts advanceTo`)은 이미 있었고, 문제는 입력이었다:

- **버그**: `reflow.ts reflowPara` — 실텍스트 0인 문단(인라인 표만)의 합성 lineseg `textpos`가
  `m.chars.length`(=16)로 폴백 → `planLines`의 `plan.start=16` > 개체 index(0, 8) →
  `advanceTo`에서 개체가 전부 배제 → 가로 전진 0 → **두 표가 같은 x에 겹침** (수정 전 x1=x2=58.11 실측).
- **수정**: textpos 폴백을 `0`으로 (reflow.ts 1줄 + 주석). A안(objBottom 누적 스택)을 택했다면
  나란히 배치가 세로로 찢어져 **오답**이었을 것.
- **회귀 테스트**: `tests/render.test.ts` "reflow 인라인 표 나란히 배치 (결재란 겹침)" —
  한 문단 인라인 표 2개 합성 → x 전진 단언. 레드(수정 전 실패) → 그린 확인.

**검증 완료(Windows)**:
- 재현 fixture(원본 지역아동센터계획.hwpx는 회사 PC에만 있어, 동일 시그니처의
  `(서울시)2026년 자치구 축제 지원 및 육성사업 추진계획.hwpx`로 재현): overlap-check **2쌍 → 0쌍**
- Edge headless 육안: 라벨표 좌 + 스탬프표 우(주무관→축제진흥팀장→과장→본부장) 정상 배치
- `npm test` 785/785 통과
- 스팟체크 4건(reflow 경로 실문서) 전면 겹침쌍 **감소**(39→38, 319→307, 10434→10066, 11496→11355), 악화 0
- 실텍스트만 있는 문서 2건은 SVG **byte-identical** (수정 영향 범위가 빈 문단에 국한됨을 확인)

**Mac 잔여**: `npm run bench:visual` + `npm run bench:gate`(corpus 필요 — 집 PC엔 없음),
원본 fixture(지역아동센터계획.hwpx)로 overlap-check 0쌍 재확인.

---

## 1. 증상 / 재현

공문 표지 좌상단 **결재란**(전자결재 스탬프 박스)에서 텍스트가 세로로 겹침.

- **Fixture**: `tests/fixtures/real/지역아동센터계획.hwpx` (1페이지 표지). 결재란에 "아동지원팀장","결재","시행","접수" 존재.
- **재현**: `node dist/cli.js render tests/fixtures/real/지역아동센터계획.hwpx -o out.svg --reflow --silent`
- **겹침 관측**(SVG 좌표, page0 로컬):
  - `"2026. 1. 26."`(날짜, y=130.7 x=135.5) ↔ `"아동지원팀장"`(직위, y=134.4 x=129.2) — Δy≈3.7pt, 사실상 같은 줄
  - `"결재일자"`(라벨, y=131.1 x=56.2) ↔ `"주무관"`(y=134.4 x=70.8)
  - 정상 비교: 라벨행(문서번호 y106 / 결재일자 y131 / 공개여부 y155)은 ~24pt 정상 간격. 실장 열은 정상 스택(여성가족실장 y130→직무대리 y141.7→01/26 y150.7).
- **검증 엔진**: **Edge headless**(`msedge --headless=new --screenshot`) = WebView2/Chromium = 실앱 동일. **librsvg/sharp 금지**(textLength 무시해 겹침 과장).

## 2. 객관 지표 (수정 전/후)

`bench/reflow-overlap-check.mjs` — 결재 박스 텍스트 bbox 겹침 자동감지.
```
node bench/reflow-overlap-check.mjs out.svg 0 220
```
- **현재(수정 전)**: `2 overlapping pairs` — `"2026. 1. 26."∩"아동지원팀장"`(area 229), `"결재일자"∩"주무관"`(area 133)
- **목표(수정 후)**: `0 pairs`

## 3. 구조 (ground truth — section0.xml 실측)

결재란 = **다중 중첩표**(모두 `treatAsChar="1"` 인라인):
- **표0**(outer) ⊃ **표1**(라벨 4×2: 문서번호/결재일자/공개여부/방침번호 + 값) + **표2**(스탬프 7×5: 시민·주무관·아동지원팀장·아동담당관·여성가족실장직무대리·01/26)
- section0.xml에 표 5개(표0~2가 결재란, 표3~4는 제목). 표1은 중첩깊이2, 표2는 깊이1 — 서로 다른 셀/문단.
- **lineseg 캐시 없음**(`grep linesegarray` = 0) → **reflow 경로** 확정(한컴 저장본 아님).
- 표2(스탬프) 셀 높이 실측: Row0 h=2029, **Row1 h=380(얇음)**, Row2 h=2029. rowSpan>1 셀 다수(r3 span1x2 등).

## 4. 코드 경로 (핵심 좌표 — 수정 후보 지점)

| 위치 | 역할 |
|------|------|
| `src/render/svg-render.ts:555-580` `cellContentExtent` | 셀높이 = max over 문단(seg.vertpos+textheight) + 인라인개체(baseV+h). **합산 아닌 max**. |
| `src/render/layout.ts:75-104` `solveRowHeights` | 행높이 = max(선언 cellSz.height, cellContentExtent). **콘텐츠성장은 rowSpan===1 셀만**(:97-99). |
| `src/render/reflow.ts:76-155` `reflowPara` | **objBottom = max over objs(startV + h)** (:149-153). ← 핵심 의심 |
| `src/render/reflow.ts:186-218` `reflowBlockFlow` | cursorV 문단간 누적 세로흐름 |
| `src/render/reflow.ts:158-179` `reflowTablesIn` | 셀 subList 재귀 reflow(중첩표 처리) |
| `src/render/svg-render.ts:~404` `drawPara` | 인라인개체 실draw는 `seg.vertpos` 기준(측정은 baseV 기준 — 불일치) |

## 5. 루트코즈 가설 (미확정 — 오라클로 확정 필요)

가장 유력(A) → 순위:

- **(A) reflowPara objBottom=max** (reflow.ts:149-153): 한 문단에 인라인 중첩표가 여러 개(표1+표2)면 전부 같은 `startV`에 겹쳐 배치됨(max라 스택 안 됨). 표1(라벨)·표2(스탬프)가 같은 호스트 문단의 두 인라인 개체면 이게 직접 원인.
- **(B) cellContentExtent 인라인개체 baseV 기준** (svg-render.ts:568): 개체 높이를 `baseV`(문단 첫 seg)로 더함. draw는 실제 얹힌 줄 seg.vertpos(:404). 다줄 문단 2번째줄+ 개체는 과소측정.
- **(C) rowSpan>1 콘텐츠 미성장** (layout.ts:97-99, svg-render.ts:648 `contentH: c.rs===1?…:undefined`): 세로병합 셀에 쌓인 텍스트가 행을 못 키움. 표2의 rowSpan 셀들.

## 6. 후보 수정 + 리스크

- **(A) 수정**: 인라인 개체 여러 개를 세로로 스택. 단 `objBottom = max→누적`으로 단순 변경하면 **인라인 이미지/수식이 텍스트와 같은 줄에 흐르는 정상 케이스까지 깨짐**. → **block-level 개체(표)만** 스택하고 진짜 인라인(이미지/수식)은 기존 유지하도록 좁혀야. 개체가 "줄에 흐르는지 vs 자기 블록인지" 구분 필요.
- **(C) 수정**: `contentH`를 rowSpan>1 셀도 전달 + solveRowHeights의 rowSpan 분배에 콘텐츠 반영. 상대적으로 국소적이나 표 전반 높이에 영향.
- 어느 쪽이든 **표 조판 전반에 영향** → 반드시 오라클 + 코퍼스 게이트로 무회귀 확인.

## 7. 검증 절차 (수정 후 필수 순서)

1. `npm run build`
2. `node dist/cli.js render tests/fixtures/real/지역아동센터계획.hwpx -o /tmp/out.svg --reflow --silent`
3. `node bench/reflow-overlap-check.mjs /tmp/out.svg 0 220` → **0 pairs** 확인
4. Edge headless 스크린샷 육안 — 결재란 겹침 해소 + 표 안 깨짐
5. **`npm run bench:visual`** (⬅ **macOS + 한컴 필수, 회사에서**) — 한컴 실렌더 시각오라클 무회귀
6. `npm run bench:gate` (reflow 게이트 포함 코퍼스 회귀)
7. 회귀 스팟체크: `재활용센터현황.hwpx`, `특별구급대실적.hwpx`, `제물포터널협약서.hwpx` 등 표 많은 fixture Edge 전후비교

## 8. 재현 자산

- `bench/reflow-overlap-check.mjs` — 겹침 지표 도구 (이 브랜치에 커밋됨)
- `tests/fixtures/real/지역아동센터계획.hwpx` — 재현 fixture (기존)
- 관련: `.claude/plans/render-poc/findings.md`(세로모델 역설계), 직전 렌더수정 커밋 `2423a0a`(폰트·중첩표셀높이·다구역)

## 9. 맥락 (왜 지금)

Docufinder(로컬 문서검색 앱)에서 `.hwp` 원본레이아웃 미리보기를 rhwp 네이티브 크레이트로 신설(별건, main 병합 완료). 그 김에 HWPX 결재란 겹침도 잡으려 했으나 다중 중첩표 엔진 버그로 판명 → 회사/Mac에서 오라클과 함께 진행하기로.
