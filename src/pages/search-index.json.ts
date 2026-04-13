import { getSearchEntries } from "@/lib/book"

export function GET() {
  return new Response(JSON.stringify(getSearchEntries()), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  })
}
