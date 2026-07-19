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
    const progressStr = searchParams.get('progress')   // cards studied so far (multiple of 20)

    if (!deckId) {
      return NextResponse.json({ error: 'deckId parameter is required.' }, { status: 400 })
    }

    // Fetch ALL cards sorted the same way the study page sorts them
    // (so index positions map correctly to what the user actually studied)
    const allCardsRaw = await prisma.card.findMany({
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

    if (allCardsRaw.length === 0) {
      return NextResponse.json({ questions: [], meta: { total: 0, bucketA: 0, bucketB: 0, bucketC: 0 } })
    }

    // Sort cards exactly as the study page does (category asc, priority desc)
    const sortedCards = [...allCardsRaw].sort((a, b) => {
      const ma = parseCardMeta(a)
      const mb = parseCardMeta(b)
      const catCmp = ma.category.localeCompare(mb.category)
      if (catCmp !== 0) return catCmp
      return mb.priority - ma.priority
    })

    const N = progressStr ? parseInt(progressStr, 10) : NaN
    const isMilestoneQuiz = !isNaN(N) && N >= 20

    let selectedCards: any[]
    let bucketMeta = { bucketA: 0, bucketB: 0, bucketC: 0 }

    if (isMilestoneQuiz) {
      // ================================================================
      // 3-BUCKET MILESTONE FRAMEWORK
      // Triggered every 20 cards (quiz 1 at N=20, quiz 2 at N=40, ...)
      // ================================================================

      // Slice out the three regions
      const currentBatch  = sortedCards.slice(Math.max(0, N - 20), Math.min(sortedCards.length, N))
      const previousBatch = sortedCards.slice(0, Math.max(0, N - 20))

      // --- BUCKET A: Current 20-card batch, 5★ first ---
      const bucketA = [...currentBatch].sort((a, b) => {
        const pa = parseCardMeta(a).priority
        const pb = parseCardMeta(b).priority
        return pb - pa   // highest priority first
      })

      // --- BUCKET B: Previous batches — ONLY ★★★★★ cards (priority 5), up to 10 ---
      const bucketB = previousBatch
        .map(c => ({ c, ...parseCardMeta(c) }))
        .filter(x => x.priority === 5)          // strictly 5 stars only
        .sort((a, b) => b.priority - a.priority)
        .map(x => x.c)
        .slice(0, 10)

      // --- BUCKET C: Previously missed (wrongInQuiz=true) from all previous batches ---
      const bucketC = previousBatch.filter(c => c.wrongInQuiz === true)

      // Combine, deduplicate by id, preserve order (A → B → C)
      const seen = new Set<string>()
      const pool: any[] = []
      for (const card of [...bucketA, ...bucketB, ...bucketC]) {
        if (!seen.has(card.id)) {
          seen.add(card.id)
          pool.push(card)
        }
      }

      bucketMeta = { bucketA: bucketA.length, bucketB: bucketB.length, bucketC: bucketC.length }
      selectedCards = pool

    } else {
      // ================================================================
      // FREE-FORM / END-OF-DECK ADAPTIVE ENGINE
      // Used when navigating to /quiz directly (no progress milestone)
      // ================================================================

      const weakCards = sortedCards.filter(c => c.wrongInQuiz === true)
      const repeatCards = sortedCards
        .filter(c => c.needsRepeat === true && c.wrongInQuiz !== true)
        .map(c => ({ card: c, ...parseCardMeta(c) }))
        .sort((a, b) => b.priority - a.priority)
        .map(x => x.card)
      const masteredCards = sortedCards
        .filter(c => c.needsRepeat === false && c.wrongInQuiz !== true)
        .map(c => ({ card: c, ...parseCardMeta(c) }))
        .sort((a, b) => b.priority - a.priority)
        .map(x => x.card)

      const pool: any[] = [
        ...weakCards,
        ...repeatCards.slice(0, 15),
        ...masteredCards.slice(0, 10),
      ]

      // Ensure minimum 10
      if (pool.length < 10) {
        const existingIds = new Set(pool.map(c => c.id))
        const extras = shuffleArray(sortedCards.filter(c => !existingIds.has(c.id)))
        pool.push(...extras.slice(0, 10 - pool.length))
      }

      bucketMeta = { bucketA: weakCards.length, bucketB: repeatCards.slice(0,15).length, bucketC: masteredCards.slice(0,10).length }
      selectedCards = pool.slice(0, 40)
    }

    const quizQuestions = selectedCards.map(card => buildQuizQuestion(card, allCardsRaw))

    return NextResponse.json({
      questions: isMilestoneQuiz ? quizQuestions : shuffleArray(quizQuestions),
      meta: {
        total: quizQuestions.length,
        isMilestone: isMilestoneQuiz,
        milestoneN: isMilestoneQuiz ? N : null,
        ...bucketMeta,
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
