# Active Context — kordoc 본체

**마지막 업데이트**: 2026-07-03 (연속 세션 6: v3.8.4 릴리스 + roundtrip 왕복 수술 3종 + pdf표GT 순서구제·게이트 편입)
**상태**: 테스트 641/641. `npm run bench:gate` **5체인**(score·roundtrip·pdf-table-gt·formats·fuzz) 전부 PASS. tsc 13(동수)

## 이번 세션 완료 (2026-07-03 연속 6차)

- **⓪ v3.8.4 릴리스** — docx 병합표·텍스트박스(전 세션 적립 1255e49) + 이번 수술 묶음.
  npm publish + git tag + GitHub 릴리스. CHANGELOG/README 현행화 동반
- **① roundtrip 헤딩 왕복 소실 수술** — 파서 헤딩 감지 경로 = OUTLINE 권위 + 폰트비율
  휴리스틱인데, ⑴ generator가 outline 정보를 안 심었고 ⑵ 폰트 경로는 `case "r"`이
  실제 한컴 `<hp:run>`을 못 잡는 죽은 코드(실파일도 동일)라 이중 불발. **generator에
  OUTLINE paraPr(1~4, level 0~3) + 빈 서식 numbering(id 1, paraHead 7레벨 빈 텍스트)
  + secPr outlineShapeIDRef="1"** 심어 해결 — 한컴 화면 번호 무변화·문서 찾아가기
  개요 표시. h5/h6→h4 축약(paraPr 매핑). 파서 쪽은 **빈 서식 paraHead에 "^N." 접두
  발명하던 버그**만 수정(실코퍼스 영향 0 실증). corpus 75건 md엔 헤딩 0개(공문서
  관행)라 fwd/bwd 무영향 — fixture 헤딩 무결성 게이트(h1~h6 레벨 시퀀스) 신설로 잠금
- **② 마스킹 별표 런 + 리스트 마커 수술** (fwd 0.947→**0.9996**·bwd 0.9468→**0.9991**의
  주역) — worst 문서 해부로 발견: ⑴ `******` 마스킹이 md HR로 소비돼 `────` 40자로
  변신(그램 597/문서) ⑵ 순서 리스트 "2. 3."이 "1. 2."로 재부여. **파서 escapeGfm에
  `*` 추가**(본문+셀, markdown-units 미러 동기화), **MdBlock.marker 원본 보존**,
  **generator 센티널 언이스케이프**(강조 정규식이 `\*`의 별표를 델리미터로 소비해
  백슬래시만 남던 함정 — 인덱스 내장 `\x00N\x00` 마스킹→복원). 전 코퍼스 md 전/후
  전수 대조: hwpx 29/88·hml 9/9·pdf 27/42 변경 전부 `*` 이스케이프 성격만
- **③ pdf-table-gt 순서구제** (매칭 81.94→**84.72%**·exact 51.39→**54.17%**·cellF1
  0.6046→**0.6324**) — pair06 해부: 2단 페이지에서 pdf가 표를 y순 방출해 문서 흐름과
  역전 → 순서보존 DP가 그리드 동일 표를 버림. matchTables에 잔여 전역 그리디
  (sim≥0.55) 구제 추가. 다른 쌍 변화 0(문턱 보수성)·roundtrip 무영향. **무후퇴 플로어
  게이트 + bench:gate 체인 편입** (3회 연속 동일)
- **④ 파서 tolerance 실험 → 철회** (기록 자산): 응시원서 표 12열→9열 붕괴 원인 =
  1.6~2.7pt 헤어라인 경계를 coordMergeTol(플로어 8, 4×radius)이 병합. 1.25×/1.5로
  낮추면 pair06 22x12 GT 일치하지만 **pair08은 GT가 9열 통합이라 22x13 유령 열로
  F1 0.373→0 붕괴** — GT 표현이 문서마다 갈려 pdf 쪽 증거로 구분 불가. 전면 철회,
  pdf-table-gt.mjs 헤더에 실험 기록. **재론 금지**

## 지표 대시보드 (2026-07-03 연속 6차 종료)

| 트랙 | 지표 | 값 | 게이트 | 비고 |
|---|---|---|---|---|
| hwpx(85) | recallMicro / phantom | **1.0** / 0.000054 | 0.999 / 0.005 | |
| hwpx | 표 exact / cellF1 | **611/611** / 1.0 | 0.99 / 0.999 | |
| hwpx | cellExact / contentNED / order | **1.0/1.0/1.0** | | |
| pdf(48) | coverage(micro) | **0.99609** | 0.985 | 미달 1건 = eval-perf-2024 0.9785(벡터 아웃라인) |
| hwp쌍(10) | 유사도 / 커버 | **0.9946 / 0.9929** | 0.99 / 0.99 | |
| docx(7) | recall | **0.998903** | 0.998 | |
| xlsx(11) | strRecall / numRecall | **1.0** / 0.9844 | 0.999(str) | num은 표기차 정상 |
| hml(9) | recall | 0.9960 | 0.995 | bizinfo 0.973(글상자 추정) |
| roundtrip | fwd / bwd / tblExact / 헤딩 | **0.9996 / 0.9991** / 0.7278 / 0에러 ⬆ | 0.999/0.998/0.72/0 ⬆ | 수술 3종 완료, tblExact은 헤딩과 무관 실증 |
| pdf표GT(6쌍) | 매칭/exact/cellF1/NED | **0.8472/0.5417/0.6324**/0.5008 ⬆ | 0.845/0.54/0.63/0.5 ✨편입 | 순서구제 도입 |
| fuzz(732런) | crash/hang/noCode/slow | **0/0/0/0** | 전부 0 | |
| 테스트/tsc | **641/641** / 13(동수) | — | — | +generator 회귀 4건 |

## 릴리스

- **v3.8.4 발행됨** (2026-07-03): docx 병합표+텍스트박스 / 마스킹 별표 보호 /
  왕복 충실도 3종 / 개요 번호 발명 수정. npm+tag+gh release
- 커밋: 2a439b7(수술) → a0bc6f4(bench) → e39f3a9(release)

## 다음 세션 (플랜: .claude/plans/next-session-pdf-gt-leftovers.md — 구 roundtrip 대체)

- **① pdf-table-gt 잔여**: 분할병합 보정 불발(전 쌍 splitMerged=0 — 머리글 반복
  rowsSum 불일치 의심, 관용 rowsSum-1 시도) / pair05 F1 0.458 해부
- ② 소액: hml bizinfo 글상자 / eval-perf-2024 OCR / A-5 폼 정오 / hwp3 합성 픽스처
- roundtrip 잔여는 수용 상태 (셀 img·hr 비대칭·인라인 강조 — IR 한계)

## 재론 금지 (기존 유지 + 신규)

- LINE_SEG 원본 유지 / 공문서 장평 95%·한컴 빈 문단 생략형 / PDF 머리글 y-클러스터 재도입 금지
- PDF coverage perLine trigram / hidden text 회전 예외 / extractLines CTM 추적 / pdfjs cMap 자산
- findTwoColumnProseCutX fullPage만 + finite 가드·상한 400 유지 / align Pass 1 본문문자 우선
- 셀 장식 관용은 heading paraPr 마킹 줄에만 / changwon 성능 재론 금지
- formats 추출기 = 파서 경계 미러 / xlsx 시트 순서 = workbook 순서 / UNIT_CAP 5만
- pdf-table-gt 모수 = 최상위 2×2+ / docx vMerge val 없음=계속 셀
- **pdf 헤어라인 tolerance 완화 금지** (④ 실험 기록 참조 — GT 양방향 회귀)
- **파서 md `*` 이스케이프 유지** (escapeGfm — 벤치는 unescapeMd 대칭) / **generator
  센티널 언이스케이프 유지** / **생성 헤딩 = OUTLINE + 빈 서식 numbering** (서식 채우면
  화면에 번호 붙음) / 파서 빈 서식 paraHead 접두 발명 금지
- ⚠ hash-sweep EXTS에 .hml 미포함 — hml 파서 검증은 md 해시 별도 대조

## 코퍼스/도구 메모

- 실파일 코퍼스(gitignore): review/ 45 · hwp5/ 13+30 · pdf/ 42 · pairs/ 26 · formats/ 27
- pairs 재수집: bench/pairs-manifest.json (mods.go.kr Referer 필수)
- PDF 수집법: 검색엔진 `filetype:pdf site:go.kr` 직링크 / score pdf 트랙 pdftotext(poppler) 필수
- 게이트 일괄: `npm run bench:gate`(5체인) / perf: `node bench/perf.mjs` / PDF표: `node bench/pdf-table-gt.mjs`
- npm publish: `~/.npmrc` bypass 2FA granular 토큰 유효. 릴리스 관례 = release 커밋
  (CHANGELOG+README `## vX.Y.Z 변경사항`+package.json) + 경량 태그 + npm publish + gh release
- 디버깅 자산(scratchpad 휘발): rt-diag.mjs(왕복 그램 소실 해부)·pair-diag.mjs(pdf표GT 쌍
  해부)·grid-diag.mjs(그리드 행별 앵커 지도)·md-compare.mjs(⚠ 이중 dist 임포트 시 pdfjs
  전역 충돌로 PDF 파싱 실패 — PDF는 프로세스 분리 필수)
