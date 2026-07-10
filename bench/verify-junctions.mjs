// PDF 실렌더 줄바꿈 지점이 원문 어절(공백) 경계인지 전수 검증.
// 사용: node verify-junctions.mjs <lines.txt> <source.md>
import { readFile } from "node:fs/promises";

const [linesFile, mdFile] = process.argv.slice(2);
const linesRaw = (await readFile(linesFile, "utf-8")).split("\n");
const md = (await readFile(mdFile, "utf-8")).replace(/[*`#]/g, "");

// md nospace + 역인덱스 맵
const map = []; // nospace index -> md index
let mdNo = "";
for (let i = 0; i < md.length; i++) {
  if (/\s/.test(md[i])) continue;
  map.push(i);
  mdNo += md[i];
}

const norm = (s) => s.replace(/\s+/g, "");
const CTX = 5;

let pages = 0, verified = 0, clean = 0;
const dirty = [], unmatched = [];
let prev = null;
for (const raw of linesRaw) {
  if (raw.startsWith("===== PAGE")) { pages++; prev = null; continue; }
  const cur = norm(raw);
  if (!cur) { prev = null; continue; }
  if (prev && prev.length >= CTX && cur.length >= CTX) {
    const ctx = prev.slice(-CTX) + cur.slice(0, CTX);
    const pos = mdNo.indexOf(ctx);
    if (pos >= 0 && mdNo.indexOf(ctx, pos + 1) < 0) {
      // 유일 매치만 판정 (표·목차 등 비선형 재배열은 unmatched로)
      const jA = map[pos + CTX - 1]; // 줄 A 마지막 글자의 md 위치
      const jB = map[pos + CTX];     // 줄 B 첫 글자의 md 위치
      verified++;
      if (jB - jA > 1) clean++;      // 사이에 공백/개행 존재 = 어절 경계
      else dirty.push(`…${prev.slice(-12)} ‖ ${cur.slice(0, 12)}…`);
    } else {
      unmatched.push(`…${prev.slice(-10)} ‖ ${cur.slice(0, 10)}…`);
    }
  }
  prev = cur;
}

console.log(`pages=${pages} junctions verified=${verified} clean=${clean} DIRTY=${dirty.length} unmatched(표·목차 등)=${unmatched.length}`);
if (dirty.length) { console.log("--- 어절 중간 분리 지점:"); for (const d of dirty) console.log(" ", d); }
