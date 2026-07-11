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

// Geração do TEXTO completo de cada ativo de conteúdo, alinhado ao foco
async function generateContent(apiKey, empresa, ctx, ativos) {
  const partes = [];
  if (ctx.nome) partes.push('Foco do mês: ' + ctx.nome);
  if (ctx.nicho) partes.push('Nicho: ' + ctx.nicho);
  if (ctx.solucoes && ctx.solucoes.length) partes.push('Soluções: ' + ctx.solucoes.join(', '));
  if (ctx.dores) partes.push('Dores do cliente: ' + ctx.dores);
  if (ctx.objetivo) partes.push('Objetivo do mês: ' + ctx.objetivo);
  if (ctx.icp) partes.push('Cliente ideal (ICP): ' + ctx.icp);
  const ctxTxt = partes.join('\n') || '(sem contexto detalhado)';
  const schema = { type: 'object', additionalProperties: false, properties: { titulo: { type: 'string' }, conteudo: { type: 'string' } }, required: ['titulo', 'conteudo'] };

  async function one(tipo) {
    const sys = 'Você é redator de marketing B2B da empresa "' + empresa + '", especialista em AEO/GEO (otimização para respostas de IA). Escreva um ' + tipo + ' COMPLETO, bem escrito e pronto para revisão, em português do Brasil, alinhado ao foco do mês. Use formato answer-first, linguagem clara e específica ao nicho, com títulos/seções quando fizer sentido. Não invente números específicos — use [inserir dado] quando precisar. O texto deve posicionar a "' + empresa + '" como referência no tema.';
    const user = 'Tipo de conteúdo: ' + tipo + '\n\nContexto do foco do mês:\n' + ctxTxt + '\n\nEscreva o ' + tipo + ' completo (título + corpo).';
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: ANSWER_MODEL, temperature: 0.6, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], response_format: { type: 'json_schema', json_schema: { name: 'conteudo', strict: true, schema } } }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || 'Erro ao gerar conteúdo');
      const raw = d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : '{}';
      const p = JSON.parse(raw);
      return { tipo: tipo, titulo: p.titulo || tipo, conteudo: p.conteudo || '' };
    } catch (e) {
      return { tipo: tipo, titulo: tipo, conteudo: '', error: e.message || String(e) };
    }
  }
  return Promise.all((ativos || []).slice(0, 8).map(one));
}

// ============================================================================
// Gerador de focos — análise profunda de MERCADO + PORTFÓLIO da VendaMais
// Fase 1: pesquisa de mercado com busca na web (sinais reais, grounded).
// Fase 2: estrutura N focos ranqueados no formato completo do app.
// ============================================================================
async function researchMarket(apiKey, empresa, portfolio, objetivo, restricoes, dados, briefing) {
  const q =
    'Você é analista de estratégia de mercado B2B no Brasil. Faça uma análise objetiva de mercado para a empresa "' + empresa + '" ' +
    '(desenvolvimento e treinamento comercial). Portfólio de soluções: ' + (portfolio || []).join(', ') + '. ' +
    'Objetivo do mês: ' + (objetivo || '(não informado)') + '. Restrições/prioridades: ' + (restricoes || '(nenhuma)') + '. ' +
    'Fontes de dados disponíveis: ' + ((dados || []).join(', ') || '(nenhuma)') + '. ' +
    (briefing ? ('Briefing interno: ' + briefing.slice(0, 1500) + '. ') : '') +
    'Identifique de 8 a 12 NICHOS/SEGMENTOS de mercado no Brasil com maior potencial de "whale hunting" para esse portfólio, ' +
    'considerando: tamanho e aquecimento do setor, dor comercial, concorrência (consultorias/treinamentos que atuam nele), ' +
    'sazonalidade/eventos, e lacunas de presença em respostas de IA (AEO/GEO). Para cada nicho traga 1-2 frases de justificativa ' +
    'com sinais concretos e, quando citar tendência ou dado, indique a fonte. Seja específico ao mercado brasileiro atual.';
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ANSWER_MODEL, tools: [{ type: 'web_search_preview' }], input: q }),
    });
    const d = await r.json();
    if (!d.error) { const t = extractText(d); if (t) return t; }
  } catch (e) { /* fallback abaixo */ }
  // fallback sem busca
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ANSWER_MODEL, temperature: 0.5, messages: [{ role: 'user', content: q }] }),
    });
    const d = await r.json();
    if (!d.error && d.choices && d.choices[0]) return d.choices[0].message.content || '';
  } catch (e) { /* ignore */ }
  return '';
}

// Pesquisa focada nas subdivisões de um macro-segmento
async function researchSubsegments(apiKey, empresa, portfolio, parent) {
  const q =
    'Você é analista de mercado B2B no Brasil. O macro-segmento em análise é "' + parent.nome + '"' + (parent.tese ? (' — contexto: ' + parent.tese) : '') + '. ' +
    'Liste as 10 a 12 principais SUBDIVISÕES/subsegmentos desse setor no Brasil (elos da cadeia, categorias de empresas). ' +
    'Para cada subdivisão, indique brevemente: volume/tamanho de mercado no Brasil, potencial de margem/ticket para serviços de consultoria e treinamento comercial, maturidade comercial típica das empresas e sinais de dor comercial. ' +
    'Empresa interessada: "' + empresa + '" (portfólio: ' + (portfolio || []).join(', ') + '). Cite fontes quando usar dados.';
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ANSWER_MODEL, tools: [{ type: 'web_search_preview' }], input: q }),
    });
    const d = await r.json();
    if (!d.error) { const t = extractText(d); if (t) return t; }
  } catch (e) { /* fallback abaixo */ }
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ANSWER_MODEL, temperature: 0.5, messages: [{ role: 'user', content: q }] }),
    });
    const d = await r.json();
    if (!d.error && d.choices && d.choices[0]) return d.choices[0].message.content || '';
  } catch (e) { /* ignore */ }
  return '';
}

// Associações e entidades de classe do segmento (com busca na web)
async function findAssociations(apiKey, empresa, nicho, contexto) {
  const q =
    'Liste as principais associações setoriais, federações, confederações, sindicatos patronais e entidades de classe do setor "' + nicho + '" no Brasil — as nacionais e as estaduais/regionais mais fortes. ' +
    'Para cada uma: nome completo, sigla, tipo de entidade, abrangência, e por que é relevante para uma empresa de consultoria e treinamento comercial ("' + empresa + '") que quer se posicionar nesse setor (eventos, feiras, publicações, comissões, acesso a associados).' +
    (contexto ? (' Contexto adicional: ' + contexto) : '');
  let research = '';
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ANSWER_MODEL, tools: [{ type: 'web_search_preview' }], input: q }),
    });
    const d = await r.json();
    if (!d.error) research = extractText(d) || '';
  } catch (e) { /* segue sem pesquisa */ }

  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            nome: { type: 'string' }, sigla: { type: 'string' }, tipo: { type: 'string' },
            abrangencia: { type: 'string' }, relevancia: { type: 'string', enum: ['Alta', 'Média', 'Baixa'] },
            motivo: { type: 'string' }, comoUsar: { type: 'string' },
          },
          required: ['nome', 'sigla', 'tipo', 'abrangencia', 'relevancia', 'motivo', 'comoUsar'],
        },
      },
    },
    required: ['items'],
  };
  const sys =
    'Você estrutura pesquisas de mercado. Dado o setor "' + nicho + '", produza a lista das associações e entidades de classe mais relevantes do setor no Brasil (10 a 14), em português do Brasil, ordenadas da mais relevante para a menos. ' +
    'Campos: nome (oficial), sigla, tipo (Associação setorial, Federação, Confederação, Sindicato patronal, Entidade técnica...), abrangencia (Nacional, Estadual — UF, Regional), relevancia (Alta/Média/Baixa para a estratégia comercial da "' + empresa + '"), motivo (1 frase: por que importa) e comoUsar (1 frase acionável: como a "' + empresa + '" pode usar essa entidade — evento, conteúdo, parceria, comissão). ' +
    'Use APENAS entidades reais e conhecidas; se não tiver certeza de uma, não a inclua.';
  const user = 'Setor: ' + nicho + '\n\nPESQUISA (base factual):\n"""\n' + (research || '(indisponível — use apenas entidades brasileiras amplamente conhecidas)') + '\n"""';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ANSWER_MODEL, temperature: 0.3, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], response_format: { type: 'json_schema', json_schema: { name: 'associacoes', strict: true, schema } } }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'Erro ao estruturar associações');
  const raw = d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : '{}';
  const parsed = JSON.parse(raw);
  return { items: (parsed.items || []).slice(0, 14), grounded: !!research };
}

async function generateFocos(apiKey, empresa, portfolio, inputs, qtd, mode) {
  const research = (mode && mode.parent)
    ? await researchSubsegments(apiKey, empresa, portfolio, mode.parent)
    : await researchMarket(apiKey, empresa, portfolio, inputs.objetivo, inputs.restricoes, inputs.dados, inputs.briefing);
  const n = Math.max(3, Math.min(12, qtd || 5));
  const foco = {
    type: 'object', additionalProperties: false,
    properties: {
      id: { type: 'string' },
      nome: { type: 'string' },
      subnicho: { type: 'string' },
      tese: { type: 'string' },
      confianca: { type: 'string', enum: ['alta', 'media-alta', 'media', 'baixa'] },
      acao: { type: 'string' },
      refinar: { type: 'boolean' },
      tipoEntrada: { type: 'string' },
      notas: {
        type: 'object', additionalProperties: false,
        properties: {
          comercial: { type: 'integer' }, fit: { type: 'integer' }, autoridade: { type: 'integer' },
          lacuna: { type: 'integer' }, concorrentes: { type: 'integer' }, urgencia: { type: 'integer' },
          execucao: { type: 'integer' }, alinhamento: { type: 'integer' },
        },
        required: ['comercial', 'fit', 'autoridade', 'lacuna', 'concorrentes', 'urgencia', 'execucao', 'alinhamento'],
      },
      solucoes: { type: 'array', items: { type: 'string' } },
      evidencias: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { fonte: { type: 'string' }, texto: { type: 'string' }, forca: { type: 'string', enum: ['Forte', 'Média', 'Fraca'] }, origem: { type: 'string' } }, required: ['fonte', 'texto', 'forca', 'origem'] } },
      perguntas: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { texto: { type: 'string' }, categoria: { type: 'string' }, prioridade: { type: 'string', enum: ['Crítica', 'Alta', 'Média'] } }, required: ['texto', 'categoria', 'prioridade'] } },
      concorrentes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { nome: { type: 'string' }, tipo: { type: 'string' }, frequencia: { type: 'string' }, risco: { type: 'string', enum: ['Alto', 'Médio', 'Baixo'] } }, required: ['nome', 'tipo', 'frequencia', 'risco'] } },
      ativos: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { tipo: { type: 'string' }, titulo: { type: 'string' }, objetivo: { type: 'string' }, prioridade: { type: 'string', enum: ['Crítica', 'Alta', 'Média'] } }, required: ['tipo', 'titulo', 'objetivo', 'prioridade'] } },
      contas: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { empresa: { type: 'string' }, segmento: { type: 'string' }, motivo: { type: 'string' }, prioridade: { type: 'string', enum: ['Alta', 'Média', 'Baixa'] } }, required: ['empresa', 'segmento', 'motivo', 'prioridade'] } },
      riscos: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { texto: { type: 'string' }, nivel: { type: 'string', enum: ['Alto', 'Médio', 'Baixo'] } }, required: ['texto', 'nivel'] } },
      scoreInicial: { type: 'integer' }, presencaInicial: { type: 'integer' },
      metaScore: { type: 'integer' }, metaPresenca: { type: 'integer' },
      metaLeads: { type: 'integer' }, metaReunioes: { type: 'integer' }, metaOportunidades: { type: 'integer' },
    },
    required: ['id', 'nome', 'subnicho', 'tese', 'confianca', 'acao', 'refinar', 'tipoEntrada', 'notas', 'solucoes', 'evidencias', 'perguntas', 'concorrentes', 'ativos', 'contas', 'riscos', 'scoreInicial', 'presencaInicial', 'metaScore', 'metaPresenca', 'metaLeads', 'metaReunioes', 'metaOportunidades'],
  };
  if (mode && mode.parent) {
    foco.properties.volume = { type: 'integer' };
    foco.properties.margem = { type: 'integer' };
    foco.properties.chanceVM = { type: 'integer' };
    foco.required = foco.required.concat(['volume', 'margem', 'chanceVM']);
  }
  const schema = { type: 'object', additionalProperties: false, properties: { focos: { type: 'array', items: foco } }, required: ['focos'] };

  let sys =
    'Você é o motor de recomendação estratégica do Radar AEO/GEO da "' + empresa + '". ' +
    'Recomende EXATAMENTE ' + n + ' focos mensais de whale hunting, ranqueados do mais forte ao mais fraco, ' +
    'com base em: análise de mercado, portfólio da empresa, concorrência, lacunas de presença em respostas de IA (AEO/GEO), ' +
    'tendências, capacidade de execução e prioridades comerciais. Cada foco é um nicho/segmento distinto — NÃO repita nichos. ' +
    'Português do Brasil, específico e realista para o mercado brasileiro atual. ' +
    'Regras de preenchimento: notas de 0 a 10 (inteiros) coerentes com a tese; confianca ∈ {alta, media-alta, media, baixa}; ' +
    'acao curta ("Selecionar como foco principal", "Avaliar como próximo ciclo", "Descartar por ora"); ' +
    'refinar=true quando o nicho ainda é amplo; tipoEntrada normalmente "Assistida"; ' +
    'solucoes SOMENTE do portfólio fornecido; evidencias com origem plausível ("Análise de mercado", "Portfólio", "Rodadas AEO/GEO", "CRM e pipeline", "Tendências"); ' +
    'perguntas = o que um decisor desse nicho perguntaria a uma IA (formato whale hunting/comparativo/dor); ' +
    'contas = empresas-alvo reais ou plausíveis do nicho no Brasil; ' +
    'scoreInicial 20-55, metaScore 65-80, presencaInicial 5-25, metaPresenca 35-55, e metas de leads/reuniões/oportunidades realistas. ' +
    'id = slug curto único (ex.: "coop", "agro", "saude").';
  let user =
    'PORTFÓLIO da ' + empresa + ' (use só estes em "solucoes"): ' + (portfolio || []).join(', ') + '\n' +
    'OBJETIVO do mês: ' + (inputs.objetivo || '(não informado)') + '\n' +
    'RESTRIÇÕES/PRIORIDADES: ' + (inputs.restricoes || '(nenhuma)') + '\n' +
    'SOLUÇÕES a enfatizar: ' + ((inputs.solucoes || []).join(', ') || '(livre)') + '\n' +
    'FONTES DE DADOS consideradas: ' + ((inputs.dados || []).join(', ') || '(nenhuma)') + '\n' +
    (inputs.briefing ? ('BRIEFING interno: ' + inputs.briefing.slice(0, 1800) + '\n') : '') +
    '\nANÁLISE DE MERCADO (pesquisa, use como base factual):\n"""\n' + (research || '(indisponível — use seu conhecimento do mercado brasileiro)') + '\n"""\n\n' +
    'Gere os ' + n + ' focos ranqueados agora.';

  if (mode && mode.parent) {
    const p = mode.parent;
    sys =
      'Você é o motor de recomendação estratégica do Radar AEO/GEO da "' + empresa + '". ' +
      'O usuário escolheu o macro-segmento "' + p.nome + '" e quer EXPANDI-LO. Gere EXATAMENTE ' + n + ' SUBSEGMENTOS específicos desse macro-segmento ' +
      '(ex.: para Agronegócio: máquinas agrícolas, fertilizantes, sementes, nutrição animal, pecuária, armazenagem...), ranqueados do mais forte ao mais fraco. ' +
      'Cada subsegmento segue o MESMO formato completo de foco (tese, notas, evidências, perguntas, concorrentes, ativos, contas, riscos, metas), específico e realista para o mercado brasileiro. ' +
      'Preencha também, para cada subsegmento, três notas inteiras de 0 a 10: volume (tamanho/volume de mercado no Brasil), margem (potencial de margem/ticket para consultoria e treinamento comercial) e chanceVM (probabilidade de precisar da "' + empresa + '" — intensidade da dor comercial + fit com o portfólio). ' +
      'Regras: notas 0-10 inteiros coerentes; confianca ∈ {alta, media-alta, media, baixa}; acao curta; refinar=false em subsegmentos já específicos; tipoEntrada="Assistida"; solucoes SOMENTE do portfólio; ' +
      'evidencias com origem plausível ("Análise de mercado", "Portfólio", "Tendências"); perguntas = o que um decisor desse subsegmento perguntaria a uma IA; contas = empresas reais ou plausíveis do subsegmento no Brasil; ' +
      'scoreInicial 20-55, metaScore 65-80, presencaInicial 5-25, metaPresenca 35-55; id = slug curto único.';
    user =
      'MACRO-SEGMENTO a expandir: ' + p.nome + (p.subnicho ? (' (' + p.subnicho + ')') : '') + '\n' +
      'TESE do macro-segmento: ' + (p.tese || '(não informada)') + '\n' +
      'PORTFÓLIO da ' + empresa + ' (use só estes em "solucoes"): ' + (portfolio || []).join(', ') + '\n\n' +
      'PESQUISA sobre o segmento (base factual):\n"""\n' + (research || '(indisponível — use seu conhecimento do mercado brasileiro)') + '\n"""\n\n' +
      'Gere os ' + n + ' subsegmentos ranqueados agora.';
  }

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ANSWER_MODEL, temperature: 0.55, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], response_format: { type: 'json_schema', json_schema: { name: 'focos_ranqueados', strict: true, schema } } }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'Erro ao gerar focos');
  const raw = d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : '{}';
  const parsed = JSON.parse(raw);
  const focos = (parsed.focos || []).slice(0, n);
  // dedup de ids
  const seen = {};
  focos.forEach((f, i) => { let id = (f.id || ('foco' + i)).toString().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || ('foco' + i); while (seen[id]) id = id + i; seen[id] = 1; f.id = id; });
  return { focos, grounded: !!research };
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

  // Ação: escrever o TEXTO completo de cada ativo de conteúdo
  if (body.action === 'content') {
    const empresaC = (body.empresa || 'VendaMais').trim();
    const ativos = Array.isArray(body.ativos) ? body.ativos : [];
    const items = await generateContent(apiKey, empresaC, body.focusContext || {}, ativos);
    res.status(200).json({ ok: true, items: items });
    return;
  }

  // Ação: gerar focos ranqueados (análise profunda de mercado + portfólio)
  if (body.action === 'focos') {
    const empresaF = (body.empresa || 'VendaMais').trim();
    const portfolio = Array.isArray(body.portfolio) ? body.portfolio : [];
    const inputs = {
      objetivo: body.objetivo || '', restricoes: body.restricoes || '',
      solucoes: Array.isArray(body.solucoes) ? body.solucoes : [],
      dados: Array.isArray(body.dados) ? body.dados : [], briefing: body.briefing || '',
    };
    try {
      const out = await generateFocos(apiKey, empresaF, portfolio, inputs, body.qtd || 5);
      res.status(200).json({ ok: true, focos: out.focos, grounded: out.grounded });
    } catch (e) {
      res.status(500).json({ error: 'focos_failed', message: 'Falha ao gerar focos: ' + (e.message || String(e)) });
    }
    return;
  }

  // Ação: expandir macro-segmento em subsegmentos (volume, margem, chance VendaMais)
  if (body.action === 'expandir') {
    const empresaE = (body.empresa || 'VendaMais').trim();
    const parent = body.parent || {};
    if (!parent.nome) { res.status(400).json({ error: 'no_parent', message: 'Segmento a expandir não informado.' }); return; }
    const portfolioE = Array.isArray(body.portfolio) ? body.portfolio : [];
    try {
      const out = await generateFocos(apiKey, empresaE, portfolioE, {}, body.qtd || 10, { parent });
      res.status(200).json({ ok: true, focos: out.focos, grounded: out.grounded });
    } catch (e) {
      res.status(500).json({ error: 'expandir_failed', message: 'Falha ao expandir o segmento: ' + (e.message || String(e)) });
    }
    return;
  }

  // Ação: associações e entidades de classe do segmento foco
  if (body.action === 'associacoes') {
    const empresaA = (body.empresa || 'VendaMais').trim();
    const nicho = (body.nicho || '').trim();
    if (!nicho) { res.status(400).json({ error: 'no_nicho', message: 'Defina o foco do mês (nicho) antes de buscar associações.' }); return; }
    try {
      const out = await findAssociations(apiKey, empresaA, nicho, body.contexto || '');
      res.status(200).json({ ok: true, nicho: nicho, items: out.items, grounded: out.grounded });
    } catch (e) {
      res.status(500).json({ error: 'assoc_failed', message: 'Falha ao buscar associações: ' + (e.message || String(e)) });
    }
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
