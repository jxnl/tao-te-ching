# Tao Te Ching

`tao-te-ching` is a standalone Astro + Tailwind reader for the *Tao Te Ching*, using the James Legge translation as its canonical corpus.

## Corpus

- `tao.cleaned/` is the source of truth for the text.
- `scripts/import_gutenberg_tao.mjs` rebuilds `tao.cleaned/` from the MIT Internet Classics Archive's James Legge edition.
- Each chapter is normalized into its own Markdown file with stable slugs from `001-chapter-1.md` through `081-chapter-81.md`.

## App

- `src/lib/book.ts` loads `tao.cleaned/*.md`, renders Markdown to HTML, and builds normalized search text.
- `src/pages/` contains the home page, reader, stars page, JSON feeds, and OG assets.
- `functions/api/` and `cloudflare/reader-data.js` provide the D1-backed reader state, stars, highlights, comments, and search endpoints.

## Commands

```bash
pnpm install
pnpm build
pnpm d1:migrate:local
pnpm d1:seed:sql
pnpm exec wrangler d1 execute DB --local --file output/d1-seed.sql
pnpm cf:dev
```

## Cloudflare

- Pages project: `tao-te-ching`
- D1 database: `tao-te-ching`
- Live Pages URL: `https://tao-te-ching-2w5.pages.dev`
- Update `wrangler.toml` with the real D1 IDs after running:

```bash
pnpm exec wrangler d1 create tao-te-ching
```

- Then apply migrations and seed remotely:

```bash
pnpm d1:migrate:remote
pnpm d1:seed:sql
pnpm exec wrangler d1 execute DB --remote --file output/d1-seed.sql
pnpm deploy:cloudflare
```
