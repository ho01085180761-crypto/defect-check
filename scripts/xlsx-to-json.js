// 원천데이터/불량유형표.xlsx 의 '불량유형표' 시트를 data/defect-types.json 으로 바꾼다.
// 엑셀 파일은 읽기만 한다. 추가 패키지 없이 Node.js 기본 기능만 사용.
// 실행: node scripts/xlsx-to-json.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const XLSX_PATH = path.join(ROOT, '원천데이터', '불량유형표.xlsx');
const OUT_PATH = path.join(ROOT, 'data', 'defect-types.json');
const SHEET_NAME = '불량유형표';

// .xlsx 는 zip 파일이다. 중앙 디렉터리를 읽어 파일 이름 → 내용 맵을 만든다.
function readZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip 형식이 아닙니다');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescapeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

// <t> 조각들을 이어 붙여 글자를 얻는다 (서식이 섞인 글자 포함).
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');

// "C12" → 열 번호 2 (A=0)
const colIndex = (ref) => ref.replace(/\d+/g, '').split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

const files = readZip(fs.readFileSync(XLSX_PATH));
const str = (name) => files[name]?.toString('utf8');

// 시트 이름 → 시트 파일 경로 찾기
const workbook = str('xl/workbook.xml');
const sheetTag = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0])
  .find((tag) => unescapeXml(tag.match(/name="([^"]*)"/)[1]) === SHEET_NAME);
if (!sheetTag) throw new Error(`'${SHEET_NAME}' 시트가 없습니다`);
const relId = sheetTag.match(/r:id="([^"]*)"/)[1];
const rels = str('xl/_rels/workbook.xml.rels');
const relTag = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${relId}"`));
let target = relTag.match(/Target="([^"]*)"/)[1];
target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;

const sharedXml = str('xl/sharedStrings.xml') ?? '';
const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

// 행/칸 읽기
const rows = [];
for (const rowMatch of str(target).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
  const row = [];
  for (const c of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = c[1];
    const inner = c[2] ?? '';
    const ref = attrs.match(/r="([A-Z]+\d+)"/)[1];
    const type = attrs.match(/t="([^"]*)"/)?.[1];
    const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    let value;
    if (type === 's') value = shared[+v];
    else if (type === 'inlineStr') value = textOf(inner);
    else if (type === 'b') value = v === '1';
    else if (type === 'str' || type === 'e') value = v != null ? unescapeXml(v) : '';
    else value = v != null ? Number(v) : '';
    row[colIndex(ref)] = typeof value === 'string' ? value.trim() : value;
  }
  rows.push(row);
}

// 첫 번째로 내용이 있는 행을 제목 줄로 본다.
const nonEmpty = rows.filter((r) => r.some((v) => v !== undefined && v !== ''));
const [header, ...body] = nonEmpty;
const keys = header.map((h) => (h == null ? '' : String(h)));
const types = body.map((r) => {
  const obj = {};
  keys.forEach((k, i) => { if (k) obj[k] = r[i] ?? ''; });
  return obj;
});

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(types, null, 2) + '\n');
console.log(`columns: ${keys.filter(Boolean).join(' | ')}`);
console.log(`types: ${types.length}`);
