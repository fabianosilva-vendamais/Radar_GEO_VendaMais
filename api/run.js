// ============================================================================
// Radar AEO/GEO VendaMais — Motor real (OpenAI / ChatGPT)
// ----------------------------------------------------------------------------
// Função serverless da Vercel. Recebe as perguntas do foco do mês, consulta o
// ChatGPT (com busca na web quando possível), e analisa CADA resposta de forma
// COMPARATIVA À VENDAMAIS: se a marca apareceu, contra quais concorrentes, o
// sentimento, e o que ajustar no site e nas postagens.
//
// A chave da OpenAI vem de:
//   1) process.env.OPENAI_API_KEY  (recomendado — Vercel → Settings → Env Vars)
//   2) o campo "apiKey" do corpo da requisição (fallback: chave colada no app)
// ============================================================================

export const config = { maxDuration: 60 };

const ANSWER_MODEL = 'gpt-4o';
const ANALYSIS_MODEL = 'gpt-4o-mini';
const MAX_QUESTIONS = 8;

function extractText(d) {
  if (d && typeof d.output_text === 'string' && d.output_text) return d.output_text;
  let t = '';
  if (d && Array.isArray(d.output)) {
    d.output.forEach((o) => {
      if (o && o.type === 'message' && Array.isArray(o.content)) {
        o.content.forEach((c) => { if (c && c.type === 'output_text' && c.text) t += c.text; });
      }
    });
  }
  return t;
}

function extractSources(d) {
  const out = [];
  if (d && Array.isArray(d.output)) {
    d.output.forEach((o) => {
      if (o && o.type === 'message' && Array.isArray(o.content)) {
        o.content.forEach((c) => {
          if (c && Array.isArray(c.annotations)) {
            c.annotations.forEach((a) => {
              const url = a && (a.url || (a.url_citation && a.url_citation.url));
              if (url) {
                try { out.push(new URL(url).hostname.replace(/^www\./, '')); }
                catch (e) { out.push(String(url)); }
              }
            });
          }
        });
      }
    });
  }
  return Array.from(new Set(out)).slice(0, 6);
}

// Passo 1: pergunta natural ao ChatGPT (tenta com busca na web; cai para chat normal)
async function askChatGPT(apiKey, question) {
  // tentativa com web search (Responses API)
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ANSWER_MODEL, tools: [{ type: 'web_search_preview' }], input: question }),
    });
    const d = await r.json();
    if (!d.error) {
      const text = extractText(d);
      if (text) return { answer: text, sources: extractSources(d) };
    }
  } catch (e) { /* cai para o fallback */ }

  // fallback sem busca (Chat Completions)
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ANSWER_MODEL, messages: [{ role: 'user', content: question }], temperature: 0.4 }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'Erro na OpenAI');
    const answer = d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : '';
    return { answer: answer || '', sources: [] };
  } catch (e) {
    return { answer: '', sources: [], error: e.message || String(e) };
  }
}

// Passo 2: análise estruturada — SEMPRE comparativa à empresa
async function analyzeAnswer(apiKey, empresa, concorrentes, question, answer) {
  const sys =
    'Você é analista de AEO/GEO (otimização para respostas de IA). TODA a sua análise é SEMPRE comparativa à empresa "' + empresa + '". ' +
    'Dada uma pergunta feita a uma IA e a resposta que a IA deu, avalie objetivamente, em português do Brasil: ' +
    '(1) se "' + empresa + '" foi citada na resposta; ' +
    '(2) o destaque relativo aos concorrentes — status: "top" = entre os primeiros/destaque; "ok" = citada sem destaque; "fraca" = menção marginal; "ausente" = não citada; ' +
    '(3) o sentimento sobre "' + empresa + '" (Positivo, Neutro, Negativo ou "—" se ausente); ' +
    '(4) quais empresas/concorrentes apareceram na resposta (lista, sem incluir "' + empresa + '"); ' +
    '(5) o tipo de lacuna em uma frase curta; ' +
    '(6) UMA recomendação específica de ajuste no SITE de "' + empresa + '" e UMA de CONTEÚDO/postagem, para melhorar o posicionamento neste tema. ' +
    'Se "' + empresa + '" não apareceu: present=false, position=null, status="ausente", sentiment="—". A position é a posição aproximada em que a empresa é citada (1 = primeira), ou null.';

  const user =
    'Empresa analisada: ' + empresa + '\n' +
    'Concorrentes conhecidos: ' + (concorrentes && concorrentes.length ? concorrentes.join(', ') : '(não informados)') + '\n\n' +
    'Pergunta feita à IA:\n' + question + '\n\n' +
    'Resposta da IA:\n"""\n' + (answer || '(resposta vazia)') + '\n"""';

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      present: { type: 'boolean' },
      position: { type: ['integer', 'null'] },
      status: { type: 'string', enum: ['top', 'ok', 'fraca', 'ausente'] },
      sentiment: { type: 'string', enum: ['Positivo', 'Neutro', 'Negativo', '—'] },
      competitors: { type: 'array', items: { type: 'string' } },
      gapType: { type: 'string' },
      siteRecommendation: { type: 'string' },
      contentRecommendation: { type: 'string' },
      summary: { type: 'string' },
    },
    required: ['present', 'position', 'status', 'sentiment', 'competitors', 'gapType', 'siteRecommendation', 'contentRecommendation', 'summary'],
  };

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        temperature: 0.2,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name: 'analise_aeo_geo', strict: true, schema } },
      }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'Erro na análise');
    const raw = d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : '{}';
    return JSON.parse(raw);
  } catch (e) {
    // análise mínima de emergência (heurística simples)
    const present = (answer || '').toLowerCase().includes(empresa.toLowerCase());
    return {
      present, position: null, status: present ? 'ok' : 'ausente', sentiment: present ? 'Neutro' : '—',
      competitors: [], gapType: 'Análise automática indisponível', siteRecommendation: '', contentRecommendation: '',
      summary: 'Não foi possível analisar automaticamente esta resposta (' + (e.message || e) + ').',
    };
  }
}

// Geração de perguntas AEO/GEO alinhadas ao foco do mês
async function generateQuestions(apiKey, empresa, ctx) {
  const partes = [];
  if (ctx.nome) partes.push('Foco do mês: ' + ctx.nome);
  if (ctx.nicho) partes.push('Nicho/segmento: ' + ctx.nicho);
  if (ctx.solucoes && ctx.solucoes.length) partes.push('Soluções: ' + ctx.solucoes.join(', '));
  if (ctx.dores) partes.push('Dores do cliente: ' + ctx.dores);
  if (ctx.objetivo) partes.push('Objetivo do mês: ' + ctx.objetivo);
  if (ctx.icp) partes.push('Cliente ideal (ICP): ' + ctx.icp);
  if (ctx.concorrentes) partes.push('Concorrentes: ' + (Array.isArray(ctx.concorrentes) ? ctx.concorrentes.join(', ') : ctx.concorrentes));

  const sys =
    'Você cria perguntas de teste AEO/GEO em português do Brasil. As perguntas simulam o que um potencial cliente digitaria a uma IA (ChatGPT) ao buscar soluções — portanto NÃO devem citar "' + empresa + '" diretamente, EXCETO 1 ou 2 perguntas comparativas/de marca no final. ' +
    'Gere de 6 a 8 perguntas curtas, naturais e específicas ao foco informado, cobrindo: descoberta do nicho, soluções, dor do cliente e 1 comparativa de marca. Devolva apenas as perguntas.';
  const user = 'Contexto do foco do mês:\n' + (partes.join('\n') || '(sem contexto detalhado)');
  const schema = { type: 'object', additionalProperties: false, properties: { questions: { type: 'array', items: { type: 'string' } } }, required: ['questions'] };

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ANALYSIS_MODEL, temperature: 0.5, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], response_format: { type: 'json_schema', json_schema: { name: 'perguntas_aeo_geo', strict: true, schema } } }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'Erro ao gerar perguntas');
    const raw = d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : '{}';
    const parsed = JSON.parse(raw);
    return (parsed.questions || []).filter(Boolean).slice(0, 8);
  } catch (e) {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed', message: 'Use POST.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const apiKey = (process.env.OPENAI_API_KEY || body.apiKey || '').trim();
  if (!apiKey) { res.status(400).json({ error: 'no_key', message: 'Nenhuma chave da OpenAI encontrada. Configure OPENAI_API_KEY na Vercel ou cole a chave em Configurações.' }); return; }

  // Ação: apenas gerar perguntas alinhadas ao foco (sem rodar a análise)
  if (body.action === 'questions') {
    const empresaQ = (body.empresa || 'VendaMais').trim();
    const qs = await generateQuestions(apiKey, empresaQ, body.focusContext || {});
    res.status(200).json({ ok: true, questions: qs });
    return;
  }

  const empresa = (body.empresa || 'VendaMais').trim();
  const concorrentes = Array.isArray(body.concorrentes) ? body.concorrentes : [];
  const rawQuestions = Array.isArray(body.questions) ? body.questions : [];
  const questions = rawQuestions.slice(0, MAX_QUESTIONS).map((q) => (typeof q === 'string' ? { texto: q, categoria: '' } : { texto: q.texto || '', categoria: q.categoria || '' })).filter((q) => q.texto);
  if (!questions.length) { res.status(400).json({ error: 'no_questions', message: 'Nenhuma pergunta enviada.' }); return; }

  try {
    const items = await Promise.all(questions.map(async (q) => {
      const ask = await askChatGPT(apiKey, q.texto);
      const analysis = await analyzeAnswer(apiKey, empresa, concorrentes, q.texto, ask.answer);
      return {
        question: q.texto,
        categoria: q.categoria,
        answerExcerpt: (ask.answer || '').slice(0, 700),
        sources: ask.sources || [],
        present: !!analysis.present,
        position: analysis.position == null ? null : analysis.position,
        status: analysis.status || 'ausente',
        sentiment: analysis.sentiment || '—',
        competitors: Array.isArray(analysis.competitors) ? analysis.competitors : [],
        gapType: analysis.gapType || '',
        siteRecommendation: analysis.siteRecommendation || '',
        contentRecommendation: analysis.contentRecommendation || '',
        summary: analysis.summary || '',
      };
    }));

    res.status(200).json({ ok: true, empresa, model: ANSWER_MODEL, data: new Date().toISOString(), focoNome: body.focoNome || '', items });
  } catch (e) {
    res.status(500).json({ error: 'run_failed', message: 'Falha ao rodar o radar: ' + (e.message || String(e)) });
  }
}
