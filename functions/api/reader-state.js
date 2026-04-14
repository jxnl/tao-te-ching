import {
  enforceRateLimit,
  getClientIp,
  getReaderState,
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
  const allowed = await enforceRateLimit(context.env.DB, `reader-state:${ipHash}`, 180, 60)
  if (!allowed) {
    return json({ error: "Rate limit exceeded." }, { status: 429 })
  }

  const visitorHash = await getVisitorHash(context.request, context.env.RATE_LIMIT_SALT)
  const state = await getReaderState(context.env.DB, slug, visitorHash)
  if (!state) {
    return json({ error: "Chapter not found in D1." }, { status: 404 })
  }

  return json(state)
}
