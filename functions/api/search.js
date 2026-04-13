import {
  enforceRateLimit,
  getClientIp,
  hashValue,
  json,
  searchFragments,
} from "../../cloudflare/reader-data.js"

export async function onRequestGet(context) {
  const query = (new URL(context.request.url).searchParams.get("q") || "").slice(0, 120)
  const ipHash = await hashValue(
    getClientIp(context.request),
    context.env.RATE_LIMIT_SALT,
  )
  const allowed = await enforceRateLimit(context.env.DB, `search:${ipHash}`, 60, 60)
  if (!allowed) {
    return json({ error: "Rate limit exceeded." }, { status: 429 })
  }

  const results = await searchFragments(context.env.DB, query)
  return json({
    query,
    results,
  })
}
