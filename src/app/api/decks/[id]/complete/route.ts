import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    const deck = await prisma.deck.findUnique({
      where: { id }
    })
    
    if (!deck) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 })
    }
    
    const now = new Date()
    const nextStep = deck.reviewIntervalStep + 1
    
    // Spaced repetition progression:
    // Step 1: 9 hours
    // Step 2: 24 hours (1 day)
    // Step 3: 72 hours (3 days)
    // Step 4+: 168 hours (7 days)
    let hoursToAdd = 9
    if (nextStep === 2) hoursToAdd = 24
    else if (nextStep === 3) hoursToAdd = 72
    else if (nextStep >= 4) hoursToAdd = 168
    
    const nextReviewAt = new Date(now.getTime() + hoursToAdd * 60 * 60 * 1000)
    
    await prisma.deck.update({
      where: { id },
      data: {
        lastCompletedAt: now,
        reviewIntervalStep: nextStep,
        nextReviewAt,
      }
    })
    
    console.log(`[SpacedRepetition] Deck "${deck.name}" (${id}) marked complete. Step: ${nextStep}. Next review at: ${nextReviewAt.toISOString()}`)
    
    return NextResponse.json({
      success: true,
      lastCompletedAt: now,
      reviewIntervalStep: nextStep,
      nextReviewAt,
    })
  } catch (err: any) {
    console.error('[API] POST /api/decks/[id]/complete error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
