# Tao Workspace Notes

- This workspace is an Astro + Tailwind reader for the *Tao Te Ching*.
- `tao.cleaned/` is the canonical cleaned Markdown corpus rendered by the site.
- `scripts/import_gutenberg_tao.mjs` rebuilds `tao.cleaned/` from the MIT Internet Classics Archive's James Legge translation.

## Key Files

- `src/lib/book.ts` loads `tao.cleaned/*.md`, parses front matter, renders Markdown to HTML, and builds normalized search text.
- `src/scripts/book-ui.ts` handles client-side search, reader navigation, stars, highlights, and marginalia updates.
- `functions/api/*.js` plus `cloudflare/reader-data.js` implement the D1-backed API layer.
- `scripts/build-d1-seed.mjs` generates `output/d1-seed.sql` from `tao.cleaned/`.
- `scripts/render_og_images.mjs` renders the social preview images into `public/og/`.

## Editing Guidance

- Treat `tao.cleaned/` as the source of truth for site content.
- Preserve the chapter front matter fields and stable `001`-through-`081` ordering unless the task explicitly changes the corpus pipeline.
- Prefer minimal changes to the reader shell and marginalia behavior unless the user asks for a redesign.
