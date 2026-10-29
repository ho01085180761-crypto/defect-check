// 불량 사진 판독 서버 함수 (Vercel /api/judge, 미리보기 서버에서도 사용)
// 요청: POST { image: "data:image/jpeg;base64,..." }
// 응답: { 유형코드, 유형명, 확신도, 판단근거, 추정원인, 현장확인할것: [], 사람판정필요 }
// 키와 모델은 환경 변수 GEMINI_API_KEY, GEMINI_MODEL 에서 읽는다. 추가 패키지 없음.
const defectTypes = require('../data/defect-types.json');

const UNKNOWN = '판단 불가';
const HUMAN_CHECK_BELOW = 70;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function buildPrompt() {
  const table = defectTypes
    .map((t) => `- ${t['유형코드']} ${t['유형명']}: 판단 기준=${t['판단 기준']} / 추정 원인=${t['추정 원인']} / 현장 확인할 것=${t['현장 확인할 것']}`)
    .join('\n');
  return [
    '너는 금속 부품 표면 불량을 판독하는 품질 검사원이다. 사진 한 장을 보고 아래 불량유형표 중 하나를 고른다.',
    '',
    '[불량유형표]',
    table,
    '',
    '규칙:',
    '- code는 위 표의 유형코드 중 하나만 고른다. 사진이 흐리거나, 부품이 아니거나, 표의 어느 유형에도 맞지 않으면 "판단 불가"로 한다.',
    '- confidence는 0~100 정수. 확실하지 않으면 낮게 준다.',
    '- evidence는 사진에서 실제로 본 것(위치, 모양, 색)을 한국어 한두 문장으로 쓴다. 보이지 않는 것은 지어내지 않는다.',
    '- cause는 표의 추정 원인을 참고해 이 사진에 맞게 한 문장으로 쓴다.',
    '- checks는 현장에서 확인할 것을 짧은 항목 2~4개로 쓴다. 표의 "현장 확인할 것"을 참고한다.',
    '- 정상(D00)이거나 판단 불가면 cause는 "-", checks는 빈 목록이어도 된다.',
  ].join('\n');
}

const responseSchema = {
  type: 'OBJECT',
  properties: {
    code: { type: 'STRING', enum: [...defectTypes.map((t) => t['유형코드']), UNKNOWN] },
    confidence: { type: 'INTEGER' },
    evidence: { type: 'STRING' },
    cause: { type: 'STRING' },
    checks: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['code', 'confidence', 'evidence', 'cause', 'checks'],
};

async function askGemini(base64, mimeType) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!key || !model) throw new Error('GEMINI_API_KEY 또는 GEMINI_MODEL 환경 변수가 비어 있습니다');

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt() }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Gemini 오류 ${r.status}: ${String(j.error?.message ?? '').split(key).join('***')}`);
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return JSON.parse(text);
}

// AI 답을 정리한다. 유형명과 '사람 판정 필요'는 AI가 아니라 여기서 정한다.
function toResult(ai) {
  const type = defectTypes.find((t) => t['유형코드'] === ai.code);
  const confidence = Math.max(0, Math.min(100, Math.round(Number(ai.confidence) || 0)));
  const code = type ? type['유형코드'] : UNKNOWN;
  return {
    유형코드: code,
    유형명: type ? type['유형명'] : UNKNOWN,
    확신도: confidence,
    판단근거: String(ai.evidence ?? ''),
    추정원인: String(ai.cause ?? ''),
    현장확인할것: Array.isArray(ai.checks) ? ai.checks.map(String).filter(Boolean) : [],
    사람판정필요: code === UNKNOWN || confidence < HUMAN_CHECK_BELOW,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST로 보내 주세요' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
    const m = String(body.image ?? '').match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    if (!m) return send(res, 400, { error: '사진(data URL)이 없습니다' });
    const ai = await askGemini(m[2], m[1]);
    send(res, 200, toResult(ai));
  } catch (e) {
    send(res, 500, { error: e.message });
  }
};

module.exports.toResult = toResult;
