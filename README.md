# Rota do Dia — App de Entregas (Anjun/iMile)

App de organização de entregas com importação de PDF, agrupamento por bairro,
rota no Google Maps e histórico salvo no Supabase.

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha:

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — do seu projeto Supabase (schema `entregas`).
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
4. Em **Environment Variables**, adicione `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `ANTHROPIC_API_KEY`.
5. Clique em **Deploy**.

A partir daí, todo push no GitHub republica automaticamente.

## Arquitetura

- `src/App.jsx` — SPA em React (importar PDF, cadastro manual, pendentes agrupados por bairro, histórico).
- `src/main.jsx` — bootstrap do React.
- `api/extract-pdf.js` — função serverless (Vercel) que faz a chamada à API da Anthropic no servidor, usando `ANTHROPIC_API_KEY`, para extrair os dados de entrega de um PDF sem expor a chave no navegador.
- Dados salvos via Supabase REST (PostgREST), schema `entregas`, tabelas `pacotes`, `historico`, `settings`.
