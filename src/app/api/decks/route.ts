import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getOrCreateDefaultUser } from '@/lib/user'

export async function GET() {
  try {
    console.log('[API] GET /api/decks: starting request')
    const user = await getOrCreateDefaultUser()
    console.log('[API] GET /api/decks: default user retrieved:', user.id)
    
    const decks = await prisma.deck.findMany({
      where: { userId: user.id },
      include: {
        cards: {
          select: {
            needsRepeat: true,
          }
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    console.log(`[API] GET /api/decks: successfully retrieved ${decks.length} decks`)

    const responseData = decks.map((deck) => {
      const totalCards = deck.cards.length
      const activeCards = deck.cards.filter((c: { needsRepeat: boolean }) => c.needsRepeat).length
      return {
        id: deck.id,
        name: deck.name,
        createdAt: deck.createdAt,
        totalCards,
        activeCards,
      }
    })

    return NextResponse.json(responseData)
  } catch (err: any) {
    console.error('[API] GET /api/decks error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
