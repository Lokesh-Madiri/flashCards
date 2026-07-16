export interface CardGenerationOutput {
  question: string;
  answer: string;
  originalRow: string;
}

const GENERATION_PROMPT = (isCsv: boolean) => `
You are an expert educational tutor.
Convert the provided input data ${isCsv ? '(which represents a JSON-serialized chunk of CSV rows)' : '(which represents a segment of plain text)'} into a set of high-quality study flashcards.

Rules:
1. Each flashcard must consist of a "question", a "answer", and "originalRow".
2. The "answer" MUST be a single word or a very short phrase (maximum 2 words, single word is highly preferred). It must be easy to type and verify.
3. The "question" must be a meaningful, clear question that tests a specific fact from the input.
4. "originalRow" MUST contain:
   - If CSV: the exact JSON string of the source row.
   - If plain text: the exact sentence or paragraph that contains the answer.
5. All columns and information from the input data must be covered; do not leave out any rows or key facts.
6. The response MUST be a valid JSON array of objects matching this TypeScript type:
   Array<{ question: string; answer: string; originalRow: string; }>

Do not include markdown code block formatting (like \`\`\`json ... \`\`\`) in the response if possible, just return raw JSON text. If you must use markdown, make sure it is valid JSON.

Input Data:
`;

export async function generateCardsWithGemini(dataString: string, isCsv: boolean): Promise<CardGenerationOutput[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'placeholder_gemini_key') {
    throw new Error('Gemini API key is not configured. Please set GEMINI_API_KEY in your .env file.');
  }

  const prompt = GENERATION_PROMPT(isCsv) + '\n' + dataString;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errText}`);
  }

  const result = await response.json();
  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returned an empty response.');
  }

  return parseJsonResponse(rawText);
}

export async function generateCardsWithGroq(dataString: string, isCsv: boolean): Promise<CardGenerationOutput[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'placeholder_groq_key') {
    throw new Error('Groq API key is not configured. Please set GROQ_API_KEY in your .env file.');
  }

  const prompt = GENERATION_PROMPT(isCsv) + '\n' + dataString;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a structured assistant that outputs only valid JSON arrays. Do not include introductory text.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${errText}`);
  }

  const result = await response.json();
  const rawText = result.choices?.[0]?.message?.content;
  if (!rawText) {
    throw new Error('Groq returned an empty response.');
  }

  return parseJsonResponse(rawText);
}

function parseJsonResponse(rawText: string): CardGenerationOutput[] {
  let cleaned = rawText.trim();
  
  // Strip markdown code block wrapper if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?/, '').replace(/```$/, '').trim();
  }

  // Some LLMs wrap the array inside an object (e.g. { "cards": [...] } or similar) when forced to json_object
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    // If it's an object, check if there is an array property inside
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key])) {
        return parsed[key];
      }
    }
    throw new Error('JSON response is not an array and does not contain an array property.');
  } catch (err: any) {
    console.error('Failed to parse AI output:', cleaned);
    throw new Error(`Invalid JSON format returned by AI: ${err.message}`);
  }
}
