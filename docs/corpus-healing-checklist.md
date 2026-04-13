# Tao Corpus Checklist

Use this after regenerating `tao.cleaned/`.

- Confirm there are exactly `81` chapter files plus `proofread-manifest.json`.
- Verify the slugs run from `001-chapter-1.md` through `081-chapter-81.md`.
- Spot-check a few chapters against the MIT James Legge source URLs in `tao.cleaned/proofread-manifest.json`.
- Run `pnpm build` and `pnpm d1:seed:sql` to confirm the app and D1 seed still compile cleanly.
