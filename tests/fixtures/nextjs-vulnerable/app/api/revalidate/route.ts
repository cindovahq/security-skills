import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const tag = request.nextUrl.searchParams.get('tag')
  const path = request.nextUrl.searchParams.get('path')

  if (tag) revalidateTag(tag)
  if (path) revalidatePath(path)

  return NextResponse.json({ revalidated: true, now: Date.now() })
}
