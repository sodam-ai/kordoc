# Active Context — kordoc 본체

**마지막 업데이트**: 2026-07-03 (PDF coverage 게이트 PASS + line-detector·hwpx/parser 분리 — 계획 ①② 전부 완료)
**상태**: 테스트 625/625. score 전 게이트 PASS. origin/main 동기화 예정 커밋 4개

## 이번 세션 완료 (2026-07-03)

- **①-a. 회전 텍스트 hidden 오분류 수정** (`fix:`) — fontSize를 대각 성분이 아닌 **열벡터 노름**(hypot)으로.
  90° 회전 [0,s,-s,0]에서 fontSize=0 → 사이드탭·회전 표가 prompt-injection 필터에 폐기되던 실버그.
  goe-school 3,000개·khs-budget 637개(회전 계속비 표) 복구. 회귀 테스트 4건 추가(625/625)
- **①-b. bench 채점 대칭화 3건** (`bench:`) — coverage 0.95964 → **0.99471 (게이트 0.985 PASS)**
  1. normPdf 리더 점선 런 붕괴(`[.．·‧‥…⋯]{3,}`+`[·‧‥…⋯]{2,}`→'·') — archives 혼자 15%p 왜곡(···×1896)
  2. consensus 가장자리(첫/끝 2줄) 반복라인 제거(≥3페이지) — 파서의 존12%+3페이지 규칙과 대칭.
     본문 중간 동일 문구는 유지해 파서 본문 오삭제 감지력 보존
  3. **참조 trigram 줄 단위 계산**(perLine) — 줄 경계 gram은 추출기 순회 순서의 인코딩("순서 비교 금지" 원칙
     잔존 누수). kordoc 측은 전체 텍스트 유지(초과 gram 무벌점·문단 리플로우 흡수)
- **②-a. pdf/line-detector.ts 1,247줄 → 7모듈** (`refactor:`) — 허브 40줄.
  line-types(41)/line-extract(307)/image-regions(71)/table-grid(328)/cell-extract(138)/cell-text(235)/undersegmented(174).
  순환 1건은 mergeCellTextLines를 cell-text에 배치(유일 호출자 동거)로 해소. 해시 42건 동일
- **②-b. hwpx/parser.ts 1,619줄 → 8모듈** (`refactor:`) — 엔트리 126줄.
  parser-shared(110)/styles(266)/para-heading(95)/images(145)/metadata(82)/zip-sections(131)/table-build(114)/section-walker(659).
  section-walker는 상호재귀 클러스터라 유지. 해시 45건 동일 + no-op 88/88 + tsc 에러 13건=분리 전 동수

## 기준선 (2026-07-03)

- 테스트 **625/625** (`npm run build` 후 실행 — dist 스테일 함정. **tsup은 타입체크 안 함** — 분리/이동 후 `npx tsc --noEmit`으로 import 누락 검출, 기존 에러 13건 존재)
- score.mjs 전체 PASS: hwpx recallMicro 0.999949(전체)·phantom 0.000069·표 316/316 / **pdf 42건 coverage 0.99471**
- pdf per-doc 미달 2건(게이트는 micro): eval-perf-2024 0.972(다행 셀 행 분할 실약점), assembly-minutes-1179 0.984
- perf.mjs: hwpx median ~7.9ms / no-op 88/88 (75 hwpx + 13 hwp)
- 순수 이동 게이트: `node bench/hash-sweep.mjs <corpus하위경로> <출력.json>` 2회(결정성)→분리→diff

## 다음 후보 (우선순위순)

1. **PDF 다행 셀 행 분할** — "측정산식/또는 측정방법", "'18년/이전" 같은 2줄 셀이 시각적 줄 단위로
   별도 행으로 쪼개짐(eval-perf-2024 0.972의 주인). 선 없는 행 경계에서 셀 내용 병합 필요 — 표 재구성 영역이라 회귀 주의
2. **남은 대형 파일**: hwpx/generator.ts 1,068줄(분리 후보), pdf/cluster-detector.ts 727줄(관찰)
3. 저순위 백로그 (아래)

## 남은 백로그 (전부 저순위)

- PDF: 텍스트순서 mid로 밀리는 바닥글(cbe/ice-arc 잔여, edge룰 한계) / mdToPlain ASCII '|' 소거 비대칭(perLine이 대부분 흡수, 기록만) / 회전 표 읽기 순서(현재 아이템 단위 포함만 — khs p770 계속비 표)
- 표 열/병합 변경, 1x1·1열 표 행 연산, HWP5 행 추가/삭제 (P1 스코프 제외분)
- HWP5 중첩표 셀 수정 — ScanCell5에 tables 없음 (최후순위)
- IR filler 전략2: 병합 행 열 어긋남 (기록만)
- GFM 경로 다문단 빈 셀 skip (정직 보고), 본문 빈 문단(설계상 불가)
- score.mjs recall 결손 1건: review/36434527 "가." 2자 누락 — 원인 조사 후보

## 재론 금지 (기존 결정 유지)

- LINE_SEG 원본 유지, lineseg 제거는 수정 섹션만
- 공문서 전역 장평 95%, 굴림체=1.0em, 함초롬 한글=0.97em, 공백=0.5em
- 한컴 빈 문단 = PARA_TEXT 생략형(nChars=1) 지배적
- 정보소통광장 hwpx 변환 제공 — .hwp 수집 불가, hwplib 픽스처 사용
- **PDF 머리글/바닥글 y-클러스터 규칙 재도입 금지** (본문 오삭제 사고 — block-detect.ts 주석)
- **PDF coverage 참조 trigram은 줄 단위(perLine)** — 줄 경계 gram 재도입 금지(순서 비교 금지 원칙). kordoc 측만 전체 텍스트
- hidden text 필터의 회전 예외([0,s,-s,0]=가시 텍스트) 되돌리기 금지 — 진짜 0 스케일만 hidden

## 코퍼스/도구 메모

- 실파일 코퍼스(gitignore): `bench/corpus/review/` 45건 · `bench/corpus/hwp5/` 13+30건 · `bench/corpus/pdf/` 42건
- PDF 수집법: 검색엔진 `filetype:pdf site:go.kr` 직링크 (korea.kr RSS 폐지)
- score.mjs pdf 트랙 **pdftotext(poppler) 필수** (/opt/homebrew/bin/pdftotext 설치됨)
- npm publish: `~/.npmrc` bypass 2FA granular 토큰 유효
