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

    // Count previous quiz attempts for this deck to increase questions dynamically
    const attemptCount = await prisma.quizAttempt.count({
      where: { deckId }
    })
    
    // limit starts at 20, then 30 (20 current + 10 previous), then 40, etc.
    const limit = 20 + attemptCount * 10

    // Fetch cards ordered by creation date DESC
    const cards = await prisma.card.findMany({
      where: { deckId },
      orderBy: { createdAt: 'desc' }
    })

    if (cards.length === 0) {
      return NextResponse.json([])
    }

    // Slice to the computed limit
    const selectedCards = cards.slice(0, Math.min(cards.length, limit))

    const quizQuestions = selectedCards.map((card) => {
      let options: string[] = []
      let correctAnswer = card.answer
      let useMcq = false
      let mcqQuestionText = card.question

      // Try parsing originalRow metadata for pre-generated MCQ
      let parsedRow: any = null
      try {
        parsedRow = JSON.parse(card.originalRow)
      } catch (e) {}

      if (
        parsedRow &&
        parsedRow['MCQ Question'] &&
        Array.isArray(parsedRow['MCQ Options']) &&
        parsedRow['MCQ Options'].length === 4
      ) {
        const mcqQ = parsedRow['MCQ Question']
        const mcqOpts = parsedRow['MCQ Options']
        const correctLetter = (parsedRow['MCQ Correct Answer'] || '').trim().toLowerCase()

        // Find which option matches the correct letter (e.g. "b) PSLV-C57" corresponds to "b")
        let mcqCorrect = ''
        for (const opt of mcqOpts) {
          const cleanedOpt = opt.trim().toLowerCase()
          if (
            cleanedOpt.startsWith(`${correctLetter})`) ||
            cleanedOpt.startsWith(`${correctLetter}.`) ||
            cleanedOpt.startsWith(`${correctLetter} `)
          ) {
            mcqCorrect = opt
            break
          }
        }

        if (!mcqCorrect) {
          mcqCorrect = mcqOpts.find((o: string) => o.trim().toLowerCase().startsWith(correctLetter)) || mcqOpts[0]
        }

        mcqQuestionText = mcqQ
        options = mcqOpts
        correctAnswer = mcqCorrect
        useMcq = true
      } else {
        // Fallback distractor generation
        const allAnswers = Array.from(new Set(cards.map(c => c.answer)))
        let distractorCandidates = allAnswers.filter(a => a.toLowerCase() !== correctAnswer.toLowerCase())

        distractorCandidates = shuffleArray(distractorCandidates)
        const distractors = distractorCandidates.slice(0, 3)

        while (distractors.length < 3) {
          const fallbacks = ['Not Applicable', 'None of the above', 'False', 'True', 'Unknown']
          const nextFallback = fallbacks.find(f => !distractors.includes(f) && f.toLowerCase() !== correctAnswer.toLowerCase()) || 'N/A'
          distractors.push(nextFallback)
        }

        options = shuffleArray([correctAnswer, ...distractors])
      }

      return {
        id: card.id,
        question: mcqQuestionText,
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
