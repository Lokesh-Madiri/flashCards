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

function sortCardsByGroupAndPriority(cards: any[]): any[] {
  const getPriorityWeight = (priorityStr: string): number => {
    if (!priorityStr) return 0;
    if (priorityStr.includes('★★★★★')) return 5;
    if (priorityStr.includes('★★★★☆')) return 4;
    if (priorityStr.includes('★★★☆☆')) return 3;
    if (priorityStr.includes('★★☆☆☆')) return 2;
    if (priorityStr.includes('★☆☆☆☆')) return 1;
    return 0;
  };

  const mapped = cards.map(card => {
    let category = 'Miscellaneous';
    let priority = 0;
    try {
      const parsed = JSON.parse(card.originalRow);
      if (parsed) {
        category = parsed['Category'] || parsed['category'] || 'Miscellaneous';
        const priStr = parsed['AFCAT Priority'] || parsed['afcatPriority'] || parsed['Priority'] || '';
        priority = getPriorityWeight(priStr);
      }
    } catch (e) {}
    return { card, category, priority };
  });

  mapped.sort((a, b) => {
    const catCompare = a.category.localeCompare(b.category);
    if (catCompare !== 0) return catCompare;
    return b.priority - a.priority;
  });

  return mapped.map(item => item.card);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const deckId = searchParams.get('deckId')
    const progressStr = searchParams.get('progress')

    if (!deckId) {
      return NextResponse.json({ error: 'deckId parameter is required.' }, { status: 400 })
    }

    // Fetch all cards in the deck
    const cardsRaw = await prisma.card.findMany({
      where: { deckId }
    })

    if (cardsRaw.length === 0) {
      return NextResponse.json([])
    }

    // Sort cards exactly as we do in Study Mode
    const sortedCards = sortCardsByGroupAndPriority(cardsRaw)

    let selectedCards: any[] = []
    const N = progressStr ? parseInt(progressStr, 10) : NaN

    if (!isNaN(N) && N >= 20) {
      // 1. Current chunk: cards studied in the last 20 block (indices N - 20 to N - 1)
      const currentSlice = sortedCards.slice(Math.max(0, N - 20), Math.min(sortedCards.length, N))
      selectedCards.push(...currentSlice)

      // 2. Previous chunk: 10 random cards from the previous block (indices N - 40 to N - 21)
      if (N >= 40) {
        const prevSlice = sortedCards.slice(Math.max(0, N - 40), N - 20)
        const shuffledPrev = shuffleArray(prevSlice)
        selectedCards.push(...shuffledPrev.slice(0, 10))
      }

      // 3. Older chunks: 10 random cards from all older blocks combined (indices 0 to N - 41)
      if (N >= 60) {
        const olderSlice = sortedCards.slice(0, N - 40)
        const shuffledOlder = shuffleArray(olderSlice)
        selectedCards.push(...shuffledOlder.slice(0, 10))
      }
    } else {
      // Default fallback (e.g. deck finished or no progress milestone): load all sorted cards
      selectedCards = sortedCards
    }

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
        // Fallback distractor generation using the main deck list
        const allAnswers = Array.from(new Set(sortedCards.map(c => c.answer)))
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
