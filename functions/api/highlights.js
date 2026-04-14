import {
  anonCookie,
  enforceRateLimit,
  getClientIp,
  getFragment,
  getOrCreateAnonId,
  getPageCounts,
  hashValue,
  json,
  normalizeSlug,
  scoreToHeat,
} from "../../cloudflare/reader-data.js"

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null)
  const slug = normalizeSlug(body?.slug)
  const startOffset = Number(body?.startOffset)
  const endOffset = Number(body?.endOffset)

  if (
    !slug
    || !Number.isInteger(startOffset)
    || !Number.isInteger(endOffset)
    || startOffset < 0
    || endOffset <= startOffset
    || endOffset - startOffset > 5000
  ) {
    return json({ error: "Invalid highlight payload." }, { status: 400 })
  }

  const fragment = await getFragment(context.env.DB, slug)
  if (!fragment) {
    return json({ error: "Seed chapters into D1 before saving highlights." }, { status: 409 })
  }

  const anonId = getOrCreateAnonId(context.request)
  const ipHash = await hashValue(
    getClientIp(context.request),
    context.env.RATE_LIMIT_SALT,
  )
  const allowed = await enforceRateLimit(context.env.DB, `highlight:${ipHash}`, 24, 60)
  if (!allowed) {
    return json({ error: "Rate limit exceeded." }, { status: 429 })
  }

  const existing = await context.env.DB
    .prepare(
      `SELECT id, start_offset, end_offset
       FROM highlights
       WHERE slug = ?
         AND anon_id = ?
         AND start_offset < ?
         AND end_offset > ?`,
    )
    .bind(slug, anonId, endOffset, startOffset)
    .all()

  const matchingHighlights = existing.results || []
  const hasExactMatch = matchingHighlights.some((row) =>
    Number(row.start_offset) === startOffset && Number(row.end_offset) === endOffset
  )

  if (matchingHighlights.length > 0) {
    const deletePlaceholders = matchingHighlights.map(() => "?").join(", ")
    await context.env.DB
      .prepare(`DELETE FROM highlights WHERE id IN (${deletePlaceholders})`)
      .bind(...matchingHighlights.map((row) => row.id))
      .run()
  }

  if (!hasExactMatch) {
    await context.env.DB
      .prepare(
        `INSERT INTO highlights
          (id, slug, start_offset, end_offset, anon_id, ip_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        slug,
        startOffset,
        endOffset,
        anonId,
        ipHash,
        Date.now(),
      )
      .run()
  }

  const counts = await getPageCounts(context.env.DB, slug)
  const response = json({
    ok: true,
    ...counts,
    heat: scoreToHeat(counts.highlightCount, counts.commentCount),
  })
  response.headers.append("Set-Cookie", anonCookie(anonId))
  return response
}
