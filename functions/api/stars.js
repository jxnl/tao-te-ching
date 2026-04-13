import {
  anonCookie,
  enforceRateLimit,
  getClientIp,
  getFragment,
  getOrCreateAnonId,
  getPageCounts,
  getVisitorHash,
  hashValue,
  json,
  normalizeSlug,
} from "../../cloudflare/reader-data.js"

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null)
  const slug = normalizeSlug(body?.slug)
  if (!slug) {
    return json({ error: "Invalid star payload." }, { status: 400 })
  }

  const fragment = await getFragment(context.env.DB, slug)
  if (!fragment) {
    return json({ error: "Chapter not found." }, { status: 404 })
  }

  const anonId = getOrCreateAnonId(context.request)
  const ipHash = await hashValue(getClientIp(context.request), context.env.RATE_LIMIT_SALT)
  const visitorHash = await getVisitorHash(context.request, context.env.RATE_LIMIT_SALT)
  const allowed = await enforceRateLimit(context.env.DB, `star:${ipHash}`, 40, 60)
  if (!allowed) {
    return json({ error: "Rate limit exceeded." }, { status: 429 })
  }

  await context.env.DB
    .prepare(
      `INSERT INTO stars (id, slug, visitor_hash, anon_id, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, visitor_hash) DO UPDATE
       SET anon_id = excluded.anon_id,
           ip_hash = excluded.ip_hash,
           created_at = excluded.created_at`,
    )
    .bind(crypto.randomUUID(), slug, visitorHash, anonId, ipHash, Date.now())
    .run()

  const counts = await getPageCounts(context.env.DB, slug)
  const response = json({
    ok: true,
    starCount: counts.starCount,
  })
  response.headers.append("Set-Cookie", anonCookie(anonId))
  return response
}

export async function onRequestDelete(context) {
  const url = new URL(context.request.url)
  const slug = normalizeSlug(url.searchParams.get("slug"))
  if (!slug) {
    return json({ error: "Missing slug." }, { status: 400 })
  }

  const ipHash = await hashValue(getClientIp(context.request), context.env.RATE_LIMIT_SALT)
  const allowed = await enforceRateLimit(context.env.DB, `star-delete:${ipHash}`, 40, 60)
  if (!allowed) {
    return json({ error: "Rate limit exceeded." }, { status: 429 })
  }

  const visitorHash = await getVisitorHash(context.request, context.env.RATE_LIMIT_SALT)
  await context.env.DB
    .prepare("DELETE FROM stars WHERE slug = ? AND visitor_hash = ?")
    .bind(slug, visitorHash)
    .run()

  const counts = await getPageCounts(context.env.DB, slug)
  const response = json({
    ok: true,
    starCount: counts.starCount,
  })
  response.headers.append("Set-Cookie", anonCookie(getOrCreateAnonId(context.request)))
  return response
}
