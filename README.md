# Radar AEO/GEO VendaMais

Plataforma interna para monitorar a presença da VendaMais em respostas de IA (answer engines), comparar concorrentes, analisar fontes citadas, calcular score de visibilidade, apoiar o foco mensal de *whale hunting* e gerar recomendações de conteúdo e site.

> **Protótipo navegável com dados simulados.** Pronto para subir no GitHub e publicar na Vercel.

## O que tem dentro

| Arquivo | Função |
|---|---|
| `index.html` | **Aplicação publicável** — arquivo único, auto-contido (não precisa de build nem de internet para carregar a interface). É isto que a Vercel serve. |
| `Radar AEO-GEO VendaMais.dc.html` | Código-fonte editável do protótipo (Design Component). |
| `support.js` | Runtime usado pelo arquivo-fonte durante a edição. |
| `vercel.json` | Configuração de deploy estático. |

## Telas

Dashboard executivo · Foco do mês (Central de Focos, cadastro manual, gerador de sugestões, ranking, comparação lado a lado, detalhe, decisão e foco oficial gerado) · Rodada mensal multi-IA · Recomendações de conteúdo e site · Evolução/Histórico (com exportação do relatório em PDF) · Configurações (chaves de API).

## Publicar na Vercel

1. Crie um repositório no GitHub e suba estes arquivos:
   ```bash
   git init
   git add .
   git commit -m "Radar AEO/GEO VendaMais"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/radar-aeo-geo-vendamais.git
   git push -u origin main
   ```
2. Em [vercel.com](https://vercel.com) → **Add New → Project** → importe o repositório.
3. Framework Preset: **Other**. Não há build step (site estático). Clique **Deploy**.
4. Pronto: a Vercel publica o `index.html` na sua URL.

## Chaves de API

As chaves digitadas na tela **Configurações** ficam **apenas no navegador** (localStorage), somente para o protótipo.

Em produção, **nunca** faça commit de chaves. Configure-as como *Environment Variables* na Vercel:

- **Vercel → Project → Settings → Environment Variables**
- Adicione conforme as IAs usadas:
  - `OPENAI_API_KEY`
  - `GEMINI_API_KEY`
  - `PERPLEXITY_API_KEY`
  - `COPILOT_API_KEY` *(opcional)*
  - `SERP_API_KEY` *(opcional, para Google AI Overview)*

As chamadas reais às IAs devem passar por um **backend** que lê essas variáveis — o navegador nunca recebe as chaves.

## Banco de dados (persistência na nuvem)

Para que os dados fiquem **permanentes** e **compartilhados** entre as duas pessoas (em vez de apenas no navegador), o app usa o **Supabase** — um documento JSON compartilhado na nuvem.

Setup único (~5 min, sem programar):

1. Crie uma conta grátis em [supabase.com](https://supabase.com) e um **novo projeto**.
2. No projeto, abra **SQL Editor → New query**, cole o conteúdo de [`supabase-schema.sql`](./supabase-schema.sql) e clique **Run**.
3. Vá em **Project Settings → API** e copie a **Project URL** e a chave **anon public**.
4. No app, abra **Configurações → Banco de dados compartilhado**, cole os dois valores e clique **Conectar banco**.

A partir daí, mover tarefas no Plano de ação, escolher o foco do mês, importar briefing e ajustar configurações fica salvo na nuvem e sincroniza entre os dispositivos (botão **Sincronizar agora**). Sem conexão, o app funciona em modo local.

> Como não há login (acesso aberto, conforme definido), as políticas do banco permitem leitura/escrita pela chave `anon`. Não guarde segredos sensíveis de produção nesse modo — as chaves das IAs devem migrar para Environment Variables + backend na Fase 3.

## Rodar localmente

```bash
npx serve .
# abra http://localhost:3000
```

## Roadmap

- **Fase 1 (atual):** protótipo estratégico com dados simulados.
- **Fase 2:** cadastro real e colagem manual de respostas; análise por IA.
- **Fase 3:** integrações via API (OpenAI Responses, Gemini Grounding, Perplexity Sonar), logs e custos.
- **Fase 4:** aprendizado histórico e priorização automática.
