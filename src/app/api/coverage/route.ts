import { NextResponse } from 'next/server'
import { generateCardsWithGemini, generateCardsWithGroq } from '@/lib/ai'

const COVERAGE_PROMPT = `You are an expert knowledge auditor. You will be given:
1. An original source text
2. A list of flashcard questions already generated from that text

Your task is to audit whether all significant topics from the original text are captured in the flashcard questions.

Return a JSON object with exactly this shape:
{
  "coverageScore": number (0-100, percentage of topics covered),
  "wellCovered": string[] (topics or concepts that are well-represented in the cards),
  "partiallyCovered": string[] (topics mentioned in source but only superficially covered in cards),
  "missing": string[] (important topics in the source that have NO corresponding flashcard),
  "summary": string (1-2 sentence overall assessment)
}

Be specific. Use topic names, not vague descriptions.`

export async function POST(req: Request) {
  try {
    const { originalText, cardQuestions, provider } = await req.json()

    if (!originalText || !cardQuestions) {
      return NextResponse.json({ error: 'originalText and cardQuestions are required.' }, { status: 400 })
    }

    // Truncate original text to avoid token limits — use first 3000 words
    const truncatedText = originalText.split(/\s+/).slice(0, 3000).join(' ')
    const questionsText = Array.isArray(cardQuestions)
      ? cardQuestions.slice(0, 100).join('\n')
      : String(cardQuestions)

    const prompt = `${COVERAGE_PROMPT}

--- ORIGINAL SOURCE TEXT (first 3000 words) ---
${truncatedText}

--- GENERATED FLASHCARD QUESTIONS (${cardQuestions.length} total) ---
${questionsText}

Return only the JSON object, no extra text.`

    let rawResponse = ''
    try {
      if ((provider || 'gemini') === 'groq') {
        // Use Groq but request JSON directly
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'You are a knowledge auditor. Output only valid JSON.' },
              { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
          })
        })
        const data = await res.json()
        rawResponse = data.choices?.[0]?.message?.content || '{}'
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
        rawResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
      }
    } catch (aiErr: any) {
      return NextResponse.json({ error: `AI call failed: ${aiErr.message}` }, { status: 502 })
    }

    // Parse and validate JSON
    let report: any = {}
    try {
      const cleaned = rawResponse.replace(/^```(json)?/, '').replace(/```$/, '').trim()
      report = JSON.parse(cleaned)
    } catch (e) {
      return NextResponse.json({ error: 'Failed to parse coverage report from AI.' }, { status: 500 })
    }

    return NextResponse.json({
      coverageScore: report.coverageScore ?? 0,
      wellCovered: report.wellCovered ?? [],
      partiallyCovered: report.partiallyCovered ?? [],
      missing: report.missing ?? [],
      summary: report.summary ?? '',
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
