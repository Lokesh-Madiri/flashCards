import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getOrCreateDefaultUser } from '@/lib/user'
import { generateCardsWithGemini, generateCardsWithGroq } from '@/lib/ai'

export async function POST(req: Request) {
  try {
    const user = await getOrCreateDefaultUser()
    const { deckName, isCsv, chunk, provider, deckId } = await req.json()

    if (!deckName || deckName.trim() === '') {
      return NextResponse.json({ error: 'Deck name is required.' }, { status: 400 })
    }

    if (!chunk || chunk.trim() === '') {
      return NextResponse.json({ error: 'Chunk data is empty.' }, { status: 400 })
    }

    // Get or create the deck
    let targetDeckId = deckId
    if (!targetDeckId) {
      const newDeck = await prisma.deck.create({
        data: {
          name: deckName.trim(),
          userId: user.id,
        },
      })
      targetDeckId = newDeck.id
    } else {
      // Validate that the deck exists
      const existingDeck = await prisma.deck.findUnique({
        where: { id: targetDeckId }
      })
      if (!existingDeck) {
        return NextResponse.json({ error: 'Specified deck not found.' }, { status: 404 })
      }
    }

    // Call AI to generate Q&A cards
    let generatedCards = []
    const selectedProvider = provider || 'gemini'

    try {
      if (selectedProvider === 'groq') {
        generatedCards = await generateCardsWithGroq(chunk, isCsv)
      } else {
        generatedCards = await generateCardsWithGemini(chunk, isCsv)
      }
    } catch (aiErr: any) {
      console.error(`AI Generation error using ${selectedProvider}:`, aiErr)
      if (aiErr.message === 'GROQ_ALL_KEYS_RATE_LIMITED') {
        return NextResponse.json({ error: 'GROQ_ALL_KEYS_RATE_LIMITED' }, { status: 429 })
      }
      return NextResponse.json({ error: `AI Generation failed: ${aiErr.message}` }, { status: 502 })
    }

    // Save cards to database
    const cardData = generatedCards.map((card: any) => ({
      deckId: targetDeckId,
      question: card.question,
      answer: card.answer,
      originalRow: typeof card.originalRow === 'string' ? card.originalRow : JSON.stringify(card.originalRow),
      state: 'learning',
      needsRepeat: true,
      wrongInQuiz: false,
    }))

    if (cardData.length > 0) {
      await prisma.card.createMany({
        data: cardData,
      })
    }

    return NextResponse.json({
      success: true,
      deckId: targetDeckId,
      cardsGenerated: cardData.length,
    })
  } catch (err: any) {
    console.error('Upload processing failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
