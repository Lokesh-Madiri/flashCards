import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getOrCreateDefaultUser } from '@/lib/user'

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function getPriorityWeight(priorityStr: string): number {
  if (!priorityStr) return 0
  if (priorityStr.includes('★★★★★')) return 5
  if (priorityStr.includes('★★★★☆')) return 4
  if (priorityStr.includes('★★★☆☆')) return 3
  if (priorityStr.includes('★★☆☆☆')) return 2
  if (priorityStr.includes('★☆☆☆☆')) return 1
  return 0
}

function parseCardMeta(card: any): { category: string; priority: number } {
  let category = 'Miscellaneous'
  let priority = 0
  try {
    const parsed = JSON.parse(card.originalRow)
    if (parsed) {
      category = parsed['Category'] || parsed['category'] || 'Miscellaneous'
      const priStr = parsed['Topic Probability'] || parsed['AFCAT Priority'] || parsed['Priority'] || ''
      priority = getPriorityWeight(priStr)
    }
  } catch (e) {}
  return { category, priority }
}

/**
 * Build adaptive quiz questions from a card list.
 * Pulls AI-embedded MCQ if present, otherwise generates distractors from the deck.
 */
function buildQuizQuestion(card: any, allCards: any[]): any {
  let options: string[] = []
  let correctAnswer = card.answer
  let mcqQuestionText = card.question
  let useMcq = false

  let parsedRow: any = null
  try { parsedRow = JSON.parse(card.originalRow) } catch (e) {}

  if (
    parsedRow &&
    parsedRow['MCQ Question'] &&
    Array.isArray(parsedRow['MCQ Options']) &&
    parsedRow['MCQ Options'].length === 4
  ) {
    const mcqQ = parsedRow['MCQ Question']
    const mcqOpts = parsedRow['MCQ Options']
    const correctLetter = (parsedRow['MCQ Correct Answer'] || '').trim().toLowerCase()

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
    const allAnswers = Array.from(new Set(allCards.map((c: any) => c.answer)))
    let distractorCandidates = shuffleArray(
      allAnswers.filter((a: any) => a.toLowerCase() !== correctAnswer.toLowerCase())
    )
    const distractors = distractorCandidates.slice(0, 3)
    while (distractors.length < 3) {
      const fallbacks = ['Not Applicable', 'None of the above', 'False', 'Unknown']
      const next = fallbacks.find(f => !distractors.includes(f) && f.toLowerCase() !== correctAnswer.toLowerCase()) || 'N/A'
      distractors.push(next)
    }
    options = shuffleArray([correctAnswer, ...distractors])
  }

  return {
    id: card.id,
    question: mcqQuestionText,
    options,
    correctAnswer,
    originalRow: card.originalRow,
    isWeak: card.wrongInQuiz === true,
    needsRepeat: card.needsRepeat === true,
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const deckId = searchParams.get('deckId')

    if (!deckId) {
      return NextResponse.json({ error: 'deckId parameter is required.' }, { status: 400 })
    }

    // Fetch ALL cards in the deck with knowledge state fields
    const allCards = await prisma.card.findMany({
      where: { deckId },
      select: {
        id: true,
        question: true,
        answer: true,
        originalRow: true,
        state: true,
        needsRepeat: true,
        wrongInQuiz: true,
      }
    })

    if (allCards.length === 0) {
      return NextResponse.json([])
    }

    // --- ADAPTIVE KNOWLEDGE-STATE ENGINE ---
    // Bucket 1: Weak cards (answered wrong in previous quiz) — ALWAYS include all of them
    const weakCards = allCards.filter(c => c.wrongInQuiz === true)

    // Bucket 2: Unseen / needs-repeat cards (not yet mastered) — sorted by priority, take up to 15
    const repeatCards = allCards
      .filter(c => c.needsRepeat === true && c.wrongInQuiz !== true)
      .map(c => ({ card: c, ...parseCardMeta(c) }))
      .sort((a, b) => b.priority - a.priority)       // highest priority first
      .map(x => x.card)

    // Bucket 3: Mastered cards — take high-priority ones for retention (up to 10)
    const masteredCards = allCards
      .filter(c => c.needsRepeat === false && c.wrongInQuiz !== true)
      .map(c => ({ card: c, ...parseCardMeta(c) }))
      .sort((a, b) => b.priority - a.priority)
      .map(x => x.card)

    // Build dynamic quiz: all weak + up to 15 repeat + up to 10 mastered high-priority
    const quizPool: any[] = [
      ...weakCards,
      ...repeatCards.slice(0, 15),
      ...masteredCards.slice(0, 10),
    ]

    // Guarantee minimum 10 questions even if pool is small
    if (quizPool.length < 10 && allCards.length >= 10) {
      const existingIds = new Set(quizPool.map(c => c.id))
      const extras = shuffleArray(allCards.filter(c => !existingIds.has(c.id)))
      quizPool.push(...extras.slice(0, 10 - quizPool.length))
    } else if (quizPool.length < 10) {
      // Deck has fewer than 10 cards total — use all
      const existingIds = new Set(quizPool.map(c => c.id))
      allCards.filter(c => !existingIds.has(c.id)).forEach(c => quizPool.push(c))
    }

    // Cap at 40 to keep quiz manageable
    const selectedCards = quizPool.slice(0, 40)

    // Build MCQ quiz questions
    const quizQuestions = selectedCards.map(card => buildQuizQuestion(card, allCards))

    return NextResponse.json({
      questions: shuffleArray(quizQuestions),
      meta: {
        total: quizQuestions.length,
        weakCount: weakCards.length,
        repeatCount: Math.min(repeatCards.length, 15),
        masteredCount: Math.min(masteredCards.length, 10),
      }
    })
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

    const attempt = await prisma.quizAttempt.create({
      data: {
        deckId,
        userId: user.id,
        score,
        totalQ,
        correctQ,
      },
    })

    // Mark wrong cards for extra repetition
    if (Array.isArray(wrongCardIds) && wrongCardIds.length > 0) {
      await prisma.card.updateMany({
        where: { id: { in: wrongCardIds } },
        data: {
          needsRepeat: true,
          wrongInQuiz: true,
          state: 'learning',
        },
      })
    }

    // Clear wrongInQuiz flag for correctly answered cards
    const allCardsInDeck = await prisma.card.findMany({
      where: { deckId },
      select: { id: true },
    })
    const correctCardIds = allCardsInDeck
      .map(c => c.id)
      .filter(id => !(wrongCardIds || []).includes(id))

    if (correctCardIds.length > 0) {
      await prisma.card.updateMany({
        where: { id: { in: correctCardIds } },
        data: { wrongInQuiz: false },
      })
    }

    return NextResponse.json({ success: true, attemptId: attempt.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
