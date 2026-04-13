import { getFragmentEntries } from "@/lib/book"

export function GET() {
  return new Response(
    JSON.stringify(
      getFragmentEntries().map((fragment) => ({
        slug: fragment.slug,
        path: fragment.path,
        title: fragment.title,
        chapterLabel: fragment.chapterLabel,
        previewText: fragment.previewText,
        bodyHtml: fragment.bodyHtml,
        canonicalOrder: fragment.canonicalOrder,
      })),
    ),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    },
  )
}
