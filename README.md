# Rota do Dia — App de Entregas (Anjun/iMile)

App de organização de entregas com importação de PDF, agrupamento por bairro,
mapa com marcadores, rota otimizada no Google Maps e histórico salvo no Supabase.

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha:

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — do projeto Supabase dedicado deste app (schema `public`, tabelas `pacotes`, `historico`, `settings`).
- `VITE_GOOGLE_MAPS_API_KEY` — chave do Google Maps Platform (Geocoding API, Maps JavaScript API, Directions API), restrita por HTTP referrer ao domínio do site. Sem ela o app funciona normalmente, só sem mapa/geocodificação/otimização de rota.
- `ANTHROPIC_API_KEY` — usada apenas pela função serverless `api/extract-pdf.js` (nunca exposta ao navegador).

## Rodar localmente

```
npm install
npm run dev
```

## Publicar na Vercel

1. Faça push deste repositório para o GitHub (já feito).
2. Em vercel.com, **Add New → Project** e selecione o repositório `rota-entregas`.
3. O Vercel detecta automaticamente que é um projeto Vite.
4. Em **Environment Variables**, adicione `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_MAPS_API_KEY` e `ANTHROPIC_API_KEY`.
5. Clique em **Deploy**.

A partir daí, todo push no GitHub republica automaticamente.

## Arquitetura

- `src/App.jsx` — SPA em React (importar PDF, cadastro manual, pendentes agrupados por bairro, histórico, mapa com marcadores).
- `src/main.jsx` — bootstrap do React.
- `api/extract-pdf.js` — função serverless (Vercel) que faz a chamada à API da Anthropic no servidor, usando `ANTHROPIC_API_KEY`, para extrair os dados de entrega de um PDF sem expor a chave no navegador.
- Dados salvos via Supabase REST (PostgREST), schema `public`, tabelas `pacotes`, `historico`, `settings`.

### Mapa e rota (Google Maps)

Ao cadastrar uma entrega (manual ou por PDF), o endereço é geocodificado (Geocoding API) e a
coordenada é salva junto do registro em `pacotes`/`historico`. Isso alimenta três coisas:

- Um mapa com marcadores das entregas pendentes (aba **Pendentes**) e do histórico acumulado (aba **Histórico**) — esse histórico vai se preenchendo a cada entrega concluída.
- Detecção de cliente recorrente por proximidade de coordenada (até 60m), além da comparação por texto do endereço.
- Otimização da ordem das paradas (Directions API, `optimizeWaypoints`) antes de abrir o link de rota no Google Maps.

A cidade de referência usada para desambiguar endereços curtos está na constante `CIDADE_REFERENCIA` em `src/App.jsx` (hoje `"Macapá, AP, Brasil"`) — ajuste se a operação for em outra cidade.
