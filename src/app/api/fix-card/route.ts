import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const maxDuration = 30

const GRAMMAR_PROMPT = `You are a flashcard quality editor. You will be given a flashcard's Question and Answer.

Your task:
1. Fix any grammatical errors, awkward phrasing, or unclear wording.
2. Make the Question crisp and unambiguous (suitable for a competitive exam like AFCAT).
3. Make the Answer concise and factually accurate.
4. Do NOT change the core fact or meaning.
5. Return ONLY a JSON object: { "question": "...", "answer": "..." }
`

const REGENERATE_PROMPT = `You are an AFCAT exam flashcard expert. You will be given a flashcard that is theoretically wrong, unanswerable, or confusing.

Your task:
1. Identify the underlying TOPIC from the question.
2. Create a completely new, valid, answerable flashcard on the SAME topic.
3. The new question must be factually sound and answerable.
4. The new answer must be a concise, correct fact.
5. Return ONLY a JSON object: { "question": "...", "answer": "..." }
`

export async function POST(req: Request) {
  try {
    const { cardId, provider, mode } = await req.json()

    if (!cardId) {
      return NextResponse.json({ error: 'cardId is required.' }, { status: 400 })
    }

    // Fetch the card
    const card = await prisma.card.findUnique({ where: { id: cardId } })
    if (!card) {
      return NextResponse.json({ error: 'Card not found.' }, { status: 404 })
    }

    const isRegenerate = mode === 'regenerate'
    const systemPrompt = isRegenerate ? REGENERATE_PROMPT : GRAMMAR_PROMPT

    const prompt = isRegenerate
      ? `${systemPrompt}\n\nORIGINAL (BROKEN) QUESTION: ${card.question}\nORIGINAL (BROKEN) ANSWER: ${card.answer}\n\nCreate a new, correct flashcard on the same topic. Return only the JSON object.`
      : `${systemPrompt}\n\nCURRENT QUESTION: ${card.question}\nCURRENT ANSWER: ${card.answer}\n\nReturn only the JSON object.`

    let fixed: { question: string; answer: string } | null = null
    const selectedProvider = provider || 'gemini'

    try {
      if (selectedProvider === 'groq') {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'You are a flashcard quality editor. Output only valid JSON.' },
              { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          })
        })
        const data = await res.json()
        const raw = data.choices?.[0]?.message?.content || '{}'
        fixed = JSON.parse(raw)
      } else {
        // Gemini
        const apiKey = process.env.GEMINI_API_KEY
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        })
        const data = await res.json()
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
        const cleaned = raw.replace(/^```(json)?/, '').replace(/```$/, '').trim()
        fixed = JSON.parse(cleaned)
      }
    } catch (aiErr: any) {
      return NextResponse.json({ error: `AI fix failed: ${aiErr.message}` }, { status: 502 })
    }

    if (!fixed?.question || !fixed?.answer) {
      return NextResponse.json({ error: 'AI returned an invalid response. Try again.' }, { status: 500 })
    }

    // Update card in database
    const updated = await prisma.card.update({
      where: { id: cardId },
      data: {
        question: fixed.question.trim(),
        answer: fixed.answer.trim(),
      }
    })

    return NextResponse.json({
      success: true,
      card: {
        id: updated.id,
        question: updated.question,
        answer: updated.answer,
      }
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
