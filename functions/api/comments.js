import {
  anonCookie,
  enforceRateLimit,
  getClientIp,
  getComments,
  getFragment,
  getOrCreateAnonId,
  getVisitorHash,
  hashValue,
  json,
  normalizeSlug,
} from "../../cloudflare/reader-data.js"

export async function onRequestGet(context) {
  const slug = normalizeSlug(new URL(context.request.url).searchParams.get("slug"))
  if (!slug) {
    return json({ error: "Missing or invalid slug." }, { status: 400 })
  }

  const ipHash = await hashValue(
    getClientIp(context.request),
    context.env.RATE_LIMIT_SALT,
  )
  const allowed = await enforceRateLimit(context.env.DB, `comment-read:${ipHash}`, 90, 60)
  if (!allowed) {
    return json({ error: "Rate limit exceeded." }, { status: 429 })
  }

  const visitorHash = await getVisitorHash(context.request, context.env.RATE_LIMIT_SALT)
  return json({
    slug,
    comments: await getComments(context.env.DB, slug, 24, visitorHash),
  })
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null)
  const slug = normalizeSlug(body?.slug)
  const content = String(body?.body || "").replace(/\s+/g, " ").trim()
  const startOffset = body?.startOffset == null ? null : Number(body.startOffset)
  const endOffset = body?.endOffset == null ? null : Number(body.endOffset)

  if (!slug || !content || content.length > 1200) {
    return json({ error: "Invalid comment payload." }, { status: 400 })
  }

  if (
    (startOffset != null || endOffset != null)
    && (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset <= startOffset)
  ) {
    return json({ error: "Invalid comment range." }, { status: 400 })
  }

  const fragment = await getFragment(context.env.DB, slug)
  if (!fragment) {
    return json({ error: "Seed chapters into D1 before posting comments." }, { status: 409 })
  }

  const anonId = getOrCreateAnonId(context.request)
  const ipHash = await hashValue(
    getClientIp(context.request),
    context.env.RATE_LIMIT_SALT,
  )
  const visitorHash = await getVisitorHash(context.request, context.env.RATE_LIMIT_SALT)
  const allowed = await enforceRateLimit(context.env.DB, `comment:${ipHash}`, 4, 600)
  if (!allowed) {
    return json({ error: "Rate limit exceeded." }, { status: 429 })
  }

  const createdAt = Date.now()
  const id = crypto.randomUUID()
  await context.env.DB
    .prepare(
      `INSERT INTO comments
        (id, slug, start_offset, end_offset, body, anon_id, ip_hash, visitor_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, slug, startOffset, endOffset, content, anonId, ipHash, visitorHash, createdAt)
    .run()

  const response = json({
    ok: true,
    comment: {
      id,
      body: content,
      start_offset: startOffset,
      end_offset: endOffset,
      can_delete: true,
      created_at: createdAt,
    },
  })
  response.headers.append("Set-Cookie", anonCookie(anonId))
  return response
}

export async function onRequestDelete(context) {
  const url = new URL(context.request.url)
  const id = String(url.searchParams.get("id") || "").trim()
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return json({ error: "Missing or invalid comment id." }, { status: 400 })
  }

  const ipHash = await hashValue(
    getClientIp(context.request),
    context.env.RATE_LIMIT_SALT,
  )
  const allowed = await enforceRateLimit(context.env.DB, `comment-delete:${ipHash}`, 20, 60)
  if (!allowed) {
    return json({ error: "Rate limit exceeded." }, { status: 429 })
  }

  const visitorHash = await getVisitorHash(context.request, context.env.RATE_LIMIT_SALT)
  const deleted = await context.env.DB
    .prepare(
      `UPDATE comments
       SET status = 'hidden'
       WHERE id = ?
         AND visitor_hash = ?
         AND status = 'visible'
       RETURNING id`,
    )
    .bind(id, visitorHash)
    .first()

  if (!deleted) {
    return json({ error: "Comment not found." }, { status: 404 })
  }

  return json({ ok: true, id })
}
