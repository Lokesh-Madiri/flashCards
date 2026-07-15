import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const deckId = searchParams.get('deckId')
    const all = searchParams.get('all') === 'true'

    if (!deckId) {
      return NextResponse.json({ error: 'deckId parameter is required.' }, { status: 400 })
    }

    const whereClause: any = { deckId }
    if (!all) {
      whereClause.needsRepeat = true
    }

    const cards = await prisma.card.findMany({
      where: whereClause,
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(cards)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { cardId, needsRepeat, state } = await req.json()

    if (!cardId) {
      return NextResponse.json({ error: 'cardId is required.' }, { status: 400 })
    }

    const updatedCard = await prisma.card.update({
      where: { id: cardId },
      data: {
        needsRepeat: needsRepeat !== undefined ? needsRepeat : true,
        state: state || undefined,
      },
    })

    return NextResponse.json(updatedCard)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
