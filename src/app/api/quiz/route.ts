import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getOrCreateDefaultUser } from '@/lib/user'

// Helper to shuffle an array in place
function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const deckId = searchParams.get('deckId')

    if (!deckId) {
      return NextResponse.json({ error: 'deckId parameter is required.' }, { status: 400 })
    }

    const cards = await prisma.card.findMany({
      where: { deckId },
    })

    if (cards.length === 0) {
      return NextResponse.json([])
    }

    // Get list of all unique answers in this deck to use as distractors
    const allAnswers = Array.from(new Set(cards.map(c => c.answer)))

    const quizQuestions = cards.map((card) => {
      const correctAnswer = card.answer
      
      // Filter out the correct answer to get candidates for distractors
      let distractorCandidates = allAnswers.filter(a => a.toLowerCase() !== correctAnswer.toLowerCase())

      // Shuffle candidates and pick 3
      distractorCandidates = shuffleArray(distractorCandidates)
      const distractors = distractorCandidates.slice(0, 3)

      // Fallback distractors if there are not enough cards in the deck
      while (distractors.length < 3) {
        const fallbacks = ['Not Applicable', 'None of the above', 'False', 'True', 'Unknown']
        const nextFallback = fallbacks.find(f => !distractors.includes(f) && f.toLowerCase() !== correctAnswer.toLowerCase()) || 'N/A'
        distractors.push(nextFallback)
      }

      const options = shuffleArray([correctAnswer, ...distractors])

      return {
        id: card.id,
        question: card.question,
        options,
        correctAnswer,
        originalRow: card.originalRow,
      }
    })

    // Shuffle the quiz questions list
    return NextResponse.json(shuffleArray(quizQuestions))
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await getOrCreateDefaultUser()
    const { deckId, score, totalQ, correctQ, wrongCardIds } = await req.json()

    if (!deckId) {
      return NextResponse.json({ error: 'deckId is required.' }, { status: 400 })
    }

    // Create the Quiz Attempt
    const attempt = await prisma.quizAttempt.create({
      data: {
        deckId,
        userId: user.id,
        score,
        totalQ,
        correctQ,
      },
    })

    // Reset wrong cards so they appear in the flashcard repeat stack again
    if (Array.isArray(wrongCardIds) && wrongCardIds.length > 0) {
      await prisma.card.updateMany({
        where: {
          id: { in: wrongCardIds },
        },
        data: {
          needsRepeat: true,
          wrongInQuiz: true,
          state: 'learning',
        },
      })
    }

    // Mark correctly answered cards as cleared from being wrong in quiz
    const cardsInDeck = await prisma.card.findMany({
      where: { deckId },
      select: { id: true },
    })
    
    const correctCardIds = cardsInDeck
      .map(c => c.id)
      .filter(id => !wrongCardIds.includes(id))

    if (correctCardIds.length > 0) {
      await prisma.card.updateMany({
        where: {
          id: { in: correctCardIds },
        },
        data: {
          wrongInQuiz: false,
        },
      })
    }

    return NextResponse.json({ success: true, attemptId: attempt.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
