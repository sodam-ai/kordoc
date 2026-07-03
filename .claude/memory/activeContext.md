# Active Context — kordoc 본체

**마지막 업데이트**: 2026-07-03 (연속 세션 9: pdf표GT 해부 → v3.11.0 개방형 표 복원 릴리스)
**상태**: 테스트 683/683. `npm run bench:gate` 5체인 전부 PASS. tsc 13(기존 — 신규 0)

## 이번 세션 완료 (2026-07-03 연속 9차)

- **① 분할병합 rowsSum 가설 실측 → 기각**: 6쌍 전수 해부 결과 코퍼스에 페이지
  분할 표가 아예 없음 (파서 `mergeCrossPageTables`가 상류 흡수). pair10 ref#15의
  +1행(18x11↔19x11)도 분할이 아니라 **중첩표 평탄화**였음. 채점기의 분할병합
  보정은 이 코퍼스에서 발동 대상 자체가 없음 — 미매칭 11건의 지배 패턴은
  ⓐ동의서류 평탄화(hwpx 외곽표+중첩표 vs pdf 단일 그리드) 6건 ⓑpdf 표 오검출
  ⓒ흐름띠(⇒)·빈 표 미감지
- **② pair05 해부 → 파서 근본 픽스 (v3.11.0)**: 진범 2개 실측 —
  ⓐ**좌우 개방형 표**(행정문서 관행: 수평 괘선 전폭, 수직선은 내부만. PDF에
  바깥 수직 stroke가 아예 없음) → 그리드가 가운데 열만 잡고 지역·비고 열 유출
  ⓑ**글상자 그라디언트 음영이 수평선 ~100개**(0.5pt 간격, w=2.5)로 출력 →
  mergeParallelLines(3pt 관용)가 연쇄 병합하며 실제 박스 테두리를 삼킴 →
  유출 텍스트+본문+제목을 클러스터 감지기가 13x2 쓰레기 표로 흡수.
  픽스 = `dropShadingStacks`(≥6줄·<2pt run 제거, 병합 전) +
  `closeOpenTableEdges`(끝점 정렬 괘선 ≥3줄 + 내부 수직선 교차≥2 실존 시 가상
  수직 테두리 합성, line-extract.ts, page-blocks 1.6단계)
- **③ 채점기 bagExtra**: 다중 셀 부모의 중첩표 텍스트를 **매칭 bag에만** 합산
  (pdf-table-gt.mjs topGrids + table-score.mjs cellTextBag) → 동의서류 박스 4건
  매칭 회복. 셀 좌표 채점 불관여. score.mjs(hwpx 트랙)는 bagExtra 없어 무영향
- **④ 릴리스 v3.11.0**: feat 95291ce → release b0eefe3 + 태그 + npm publish +
  gh release. README/CHANGELOG/CLAUDE.md 현행화

## 지표 대시보드 (2026-07-03 연속 9차 종료 — v3.11.0)

| 트랙 | 지표 | 값 | 게이트 | 비고 |
|---|---|---|---|---|
| hwpx(85) | recallMicro / phantom | **1.0** / 0.000054 | 0.999 / 0.005 | |
| hwpx | 표 exact / cellF1 | **611/611** / 1.0 | 0.99 / 0.999 | |
| pdf(48) | coverage(micro) | **0.99608** | 0.985 | 종전 0.99609, Δ−1e-5 = 표GT 트레이드 (파일별 최대하락 ice-geomjeong −0.0034 라벨탭 병리, 최대상승 pair05 +0.0018) |
| hwp쌍(10) | 유사도 / 커버 | **0.9946 / 0.9929** | 0.99 / 0.99 | |
| formats | docx/xlsxStr/hml | 0.998903/**1.0**/0.995974 | 0.998/0.999/0.995 | |
| roundtrip | fwd / bwd / 헤딩 / 수식 / 줄 | **0.999632 / 0.99915** / 0 / 0 / 0 | 0.999/0.998/0/0/0 | |
| pdf표GT(6쌍) | 매칭/exact/cellF1 | **0.9028/0.5833/0.6518** | **0.90/0.58/0.65** ↑재잠금 | cellExact 0.6732(0.67)·NED 0.4939(**0.49**↓ — 정직한 매칭 비용, 헤더 문서화) |
| fuzz(792런) | crash/hang/noCode/slow/genInvalid | **0/0/0/0/0** | 전부 0 | |
| 렌더 | 코퍼스 hwpx 스모크 | **85/85** 크래시·NaN 0 | 테스트 10/10 | |
| 테스트/tsc | **683/683** / 13(기존 — 신규 0) | — | — | |

### pdf표GT 쌍별 (v0 → v3.11.0)

| pair | 매칭 | exact | F1 | NED |
|---|---|---|---|---|
| 05 해외통계 | 8→**9/9** | 2→**5** | 0.458→**0.613** | 0.347→0.417 |
| 06 인구주택 | 11→12 | 10 | 0.715 | 0.447→0.423 |
| 07 경제총조사 | 4→5 | 3 | 0.516 | 0.630→0.570 |
| 08 가계금융 | 7→8 | 5 | 0.787 | 0.581→0.534 |
| 10 부여채용 | 16 | 9 | 0.590 | 0.483 |
| 11 중원채용 | 15 | 10 | 0.675 | 0.546 |

(06~08 NED 하락 = 동의서류가 미매칭(빈셀 공짜 exact)→매칭(평탄화 그리드와
좌표 대조)으로 바뀐 정직한 반영. 표 발견율과 구조 충실도의 분해가 정확해짐)

## 기각·보류 실험 기록 (9차 — 재시도 시 이 함정 확인)

- **세그먼트 괘선 체이닝**(같은 y, gap≤3pt 연결): pair06 문의처(셀 단위 분절
  괘선) 복구되지만 **pair07 지원서(25x8) 셀 배치 변질**(miss 15→34, NED −0.08)
  + coverage −7e-5. 폐기 코드는 이 세션 히스토리 참조
- **컴포넌트 단위 합성**(groupConnectedLines별 + y-스팬 70% 가드): ice-geomjeong
  문제형식 열 이탈은 고치지만 **pair10 반환청구서(p18)에서 합성→3x3 그리드→
  shouldDemoteTable이 문단 강등→표 소멸→매칭 −1**. 1행 다열 스킵과 demote의
  연쇄를 풀어야 재시도 가능
- **전역 합성(채택안)의 보수성은 의도된 특성**: 폭이 비슷한 표가 쌓인 페이지에선
  그룹이 뭉쳐 발동 안 함 — 그래서 pair05 외 5쌍이 비트 동일(수술적)이었음
- **ice-geomjeong 잔여 병리**(백로그): 검정고시 응시자격 박스 — 라벨 탭 글상자
  (제목 박스가 큰 박스 상단에 겹침)의 짧은 수직선(66.8/301.8)이 열 경계가 되어
  프로즈가 찢김. 음영 필터가 라벨 테두리를 살리며 노출됨(v0에도 유사 병리,
  형태만 다름). 파일 coverage 0.99953→0.99611 (게이트 여유)

## 다음 세션 후보

- pair06 문의처(세그먼트 괘선) — 체이닝을 **콜리니어 이웃이 같은 컴포넌트일 때만**
  거는 정밀화 / pair07 지원서 셀 이동 원인(콜XS 미세 이동 vs bbox 흡수) 해부부터
- ice-geomjeong 라벨 탭 병리 — 짧은 수직선의 열 지지도(support) 필터 검토
- 동의서류 셀 표현 차는 수용 종결 (매칭은 회복됨, 좌표 채점은 구조 차이 반영이 정직)
- 소액 백로그: hml bizinfo 0.973(글상자) / eval-perf-2024.pdf 0.9785(벡터 아웃라인
  OCR) / A-5 폼 정오 / hwp3 합성 픽스처
- 렌더 차기(다단·2페이지+·도형)는 요청 시만

## 재론 금지 (기존 유지 + 신규)

- LINE_SEG 원본 유지 / 공문서 장평 95%·한컴 빈 문단 생략형 / PDF 머리글 y-클러스터 재도입 금지
- PDF coverage perLine trigram / hidden text 회전 예외 / extractLines CTM 추적 / pdfjs cMap 자산
- findTwoColumnProseCutX fullPage만 + finite 가드·상한 400 / align Pass 1 본문문자 우선
- 셀 장식 관용은 heading paraPr 마킹 줄에만 / changwon 성능 재론 금지
- formats 추출기 = 파서 경계 미러 / xlsx 시트 순서 = workbook 순서 / UNIT_CAP 5만
- pdf-table-gt 모수 = 최상위 2×2+ / docx vMerge val 없음=계속 셀
- **pdf 헤어라인 tolerance 완화 금지** (6차 실험 — GT 양방향 회귀)
- **수식 왕복 정합 유지** (고정점 테스트 잠금, 예약어 따옴표는 변환 전 원문에만)
- **렌더**: SVG width/height pt 단위(px=25% 축소) / horzsize=줄 영역 폭 / 한컴 저장본 전용
- **신규(9차)**: 분할병합 rowsSum 관용 재론 금지(발동 대상 없음 실측) /
  개방변 합성을 컴포넌트 단위로 옮길 땐 demote 연쇄(p18)와 체이닝 부작용(pair07)
  전 쌍 대조 필수 / bagExtra는 매칭 전용 — 셀 채점에 섞지 말 것
- ⚠ hash-sweep EXTS에 .hml 미포함 — hml 파서 검증은 md 해시 별도 대조

## 코퍼스/도구 메모

- 실파일 코퍼스(gitignore): review/ 45 · hwp5/ 13+30 · pdf/ 42 · pairs/ 26 · formats/ 27
- 게이트 일괄: `npm run bench:gate`(5체인) / PDF표: `node bench/pdf-table-gt.mjs`
- **9차 진단 도구**(bench/out/, gitignore): `diag-lines.mts`(선 추출→전처리→그리드
  단계 계측), `diag-raw.mts`(raw 선+curveTo 통계), `diag-ops.mts`(영역 교차 경로
  원본 덤프+CTM). 스크래치: diag-pair.mjs(쌍 매칭 해부)·diag-deep.mjs(표 전체
  구조+중첩)·diag-rows.mjs(행 시그니처 대조) — 세션 스크래치라 휘발, 필요 시 재작성
- npm publish: `~/.npmrc` bypass 2FA granular 토큰 유효. 릴리스 관례 = feat 커밋 →
  release 커밋(CHANGELOG+README `## vX.Y.Z 변경사항`+package.json) + 경량 태그 +
  npm publish + gh release
- 렌더 재현: `node dist/cli.js render <hwpx> -o out.svg` → headless Chrome
  `--window-size=794,1123` 스크린샷
