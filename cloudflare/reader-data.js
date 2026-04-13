const STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "being",
  "been",
  "from",
  "into",
  "over",
  "that",
  "their",
  "there",
  "these",
  "those",
  "this",
  "upon",
  "were",
  "with",
])

export function json(data, init = {}) {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json; charset=utf-8")
  headers.set("cache-control", headers.get("cache-control") || "no-store")
  headers.set("x-content-type-options", "nosniff")
  headers.set("referrer-policy", "same-origin")
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  })
}

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizeSlug(value) {
  const slug = String(value || "").trim()
  return /^[a-z0-9-]+$/.test(slug) ? slug : ""
}

export function tokenize(value, limit = 8) {
  const seen = new Set()
  const next = []

  for (const token of normalizeText(value).split(" ")) {
    if (token.length < 3 || STOP_WORDS.has(token) || seen.has(token)) continue
    seen.add(token)
    next.push(token)
    if (next.length >= limit) break
  }

  return next
}

export function scoreToHeat(highlightCount, commentCount) {
  const raw = highlightCount + commentCount * 3
  if (raw <= 0) return 0
  return Math.min(0.92, Math.log(raw + 1) / 6)
}

export function buildSearchQuery(tokens) {
  if (!tokens.length) {
    return {
      scoreExpr: "0",
      scoreBindings: [],
      whereExpr: "0",
      whereBindings: [],
    }
  }

  const scoreParts = []
  const scoreBindings = []
  const whereParts = []
  const whereBindings = []

  for (const token of tokens) {
    const pattern = `%${token}%`
    scoreParts.push("(CASE WHEN title_normalized LIKE ? THEN 8 ELSE 0 END)")
    scoreBindings.push(pattern)
    scoreParts.push("(CASE WHEN preview_normalized LIKE ? THEN 4 ELSE 0 END)")
    scoreBindings.push(pattern)
    scoreParts.push("(CASE WHEN search_text LIKE ? THEN 1 ELSE 0 END)")
    scoreBindings.push(pattern)

    whereParts.push("(title_normalized LIKE ? OR preview_normalized LIKE ? OR search_text LIKE ?)")
    whereBindings.push(pattern, pattern, pattern)
  }

  return {
    scoreExpr: scoreParts.join(" + "),
    scoreBindings,
    whereExpr: whereParts.join(" OR "),
    whereBindings,
  }
}

export async function hashValue(value, salt = "tao-te-ching") {
  const payload = new TextEncoder().encode(`${salt}:${value}`)
  const digest = await crypto.subtle.digest("SHA-256", payload)
  return Array.from(new Uint8Array(digest), (part) =>
    part.toString(16).padStart(2, "0"),
  ).join("")
}

export async function getVisitorHash(request, salt = "tao-te-ching") {
  const ip = getClientIp(request)
  const userAgent = request.headers.get("user-agent") || ""
  const language = request.headers.get("accept-language") || ""
  return hashValue(`${ip}|${userAgent}|${language}`, salt)
}

export function getClientIp(request) {
  const forwarded = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")
    || ""
  return forwarded.split(",")[0]?.trim() || "0.0.0.0"
}

export function getCookieValue(request, name) {
  const cookieHeader = request.headers.get("cookie") || ""
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=")
    if (key === name) return valueParts.join("=")
  }
  return ""
}

export function getOrCreateAnonId(request) {
  return getCookieValue(request, "tao_te_ching_anon") || crypto.randomUUID()
}

export function anonCookie(anonId) {
  return [
    `tao_te_ching_anon=${anonId}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=31536000",
    "Secure",
  ].join("; ")
}

export async function enforceRateLimit(db, key, limit, windowSeconds, now = Date.now()) {
  const bucket = Math.floor(now / (windowSeconds * 1000))
  const expiresAt = now + windowSeconds * 1000

  await db
    .prepare("DELETE FROM request_limits WHERE expires_at < ?")
    .bind(now)
    .run()

  const result = await db
    .prepare(
      `INSERT INTO request_limits (rate_key, bucket, count, expires_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(rate_key, bucket) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, bucket, expiresAt)
    .first()

  return Number(result?.count || 0) <= limit
}

export async function getFragment(db, slug) {
  return db
    .prepare(
      `SELECT slug, path, chapter_label, title, preview_text, canonical_order
       FROM fragments
       WHERE slug = ?
       LIMIT 1`,
    )
    .bind(slug)
    .first()
}

export async function getPageCounts(db, slug) {
  const [highlightRow, commentRow, starRow] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS count FROM highlights WHERE slug = ?")
      .bind(slug)
      .first(),
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM comments WHERE slug = ? AND status = 'visible'",
      )
      .bind(slug)
      .first(),
    db
      .prepare("SELECT COUNT(*) AS count FROM stars WHERE slug = ?")
      .bind(slug)
      .first(),
  ])

  return {
    highlightCount: Number(highlightRow?.count || 0),
    commentCount: Number(commentRow?.count || 0),
    starCount: Number(starRow?.count || 0),
  }
}

export async function getComments(db, slug, limit = 24) {
  const result = await db
    .prepare(
      `SELECT id, body, start_offset, end_offset, created_at
       FROM comments
       WHERE slug = ? AND status = 'visible'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(slug, limit)
    .all()

  return result.results || []
}

export async function getRelatedFragments(db, slug, limit = 3) {
  const fragment = await db
    .prepare(
      "SELECT title, preview_text FROM fragments WHERE slug = ? LIMIT 1",
    )
    .bind(slug)
    .first()

  if (!fragment) return []

  const tokens = tokenize(`${fragment.title} ${fragment.preview_text}`, 10)
  if (!tokens.length) return []

  const { scoreExpr, scoreBindings, whereExpr, whereBindings } = buildSearchQuery(tokens)
  const result = await db
    .prepare(
      `SELECT slug, title, chapter_label, preview_text, canonical_order, ${scoreExpr} AS score
       FROM fragments
       WHERE slug != ? AND (${whereExpr})
       ORDER BY score DESC, canonical_order ASC
       LIMIT ?`,
    )
    .bind(...scoreBindings, slug, ...whereBindings, limit)
    .all()

  return (result.results || []).filter((entry) => Number(entry.score || 0) > 0)
}

export async function getReaderState(db, slug) {
  const fragment = await getFragment(db, slug)
  if (!fragment) return null

  const [{ highlightCount, commentCount, starCount }, comments, related] = await Promise.all([
    getPageCounts(db, slug),
    getComments(db, slug),
    getRelatedFragments(db, slug),
  ])

  return {
    slug,
    fragment,
    highlightCount,
    commentCount,
    starCount,
    heat: scoreToHeat(highlightCount, commentCount),
    comments,
    related,
  }
}

export async function searchFragments(db, query, limit = 10) {
  const tokens = tokenize(query, 10)
  if (!tokens.length) return []

  const { scoreExpr, scoreBindings, whereExpr, whereBindings } = buildSearchQuery(tokens)
  const result = await db
    .prepare(
      `SELECT slug, title, chapter_label, preview_text, canonical_order, ${scoreExpr} AS score
       FROM fragments
       WHERE ${whereExpr}
       ORDER BY score DESC, canonical_order ASC
       LIMIT ?`,
    )
    .bind(...scoreBindings, ...whereBindings, limit)
    .all()

  return (result.results || []).filter((entry) => Number(entry.score || 0) > 0)
}
