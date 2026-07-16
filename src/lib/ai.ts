export interface CardGenerationOutput {
  question: string;
  answer: string;
  originalRow: string;
}

const GENERATION_PROMPT = (isCsv: boolean) => `
You are an expert AFCAT exam educational tutor.
Convert the provided input data ${isCsv ? '(which represents a JSON-serialized chunk of CSV rows)' : '(which represents a segment of plain text)'} into a set of high-quality study cards tailored for the AFCAT (Air Force Common Admission Test).

For each news item or row extracted:
1. Identify the main topic.
2. Extract only exam-relevant facts.
3. Classify into exactly one of these categories:
   - Defence & Military
   - Government Schemes
   - Reports & Indices
   - International Organisations
   - Science & Technology
   - Environment
   - Geography
   - Economy & Banking
   - Awards & Appointments
   - Miscellaneous
4. Assign AFCAT priority:
   ★★★★★ Extremely Important
   ★★★★☆ Important
   ★★★☆☆ Moderate
   ★★☆☆☆ Low
   ★☆☆☆☆ Very Low
5. Extract any hidden Static GK that AFCAT could ask.
6. Generate one Q&A card where:
   - "question" (Front): Exam-style question.
   - "answer" (Back): Answer in 2–5 bullets (using the bullet character "• " and separated by newlines \\n).
7. Add tags (e.g., Defence, ISRO, Economy, Environment).
8. Do not include speeches, opinions, political rhetoric, or details that have no exam value. Keep each card self-contained and answerable in under 30 seconds.

Rules:
1. The response MUST be a valid JSON array of objects matching this TypeScript type:
   Array<{
     question: string;
     answer: string;
     originalRow: string;
   }>
2. To preserve the metadata, the "originalRow" field MUST be a stringified JSON object containing these exact keys:
   {
     "Main Topic": string,
     "Category": string,
     "AFCAT Priority": string,
     "Static GK": string,
     "Tags": string,
     "Source": string (either the original JSON row or the text paragraph)
   }
3. The "answer" field MUST be a bulleted list of 2-5 facts, with each bullet prefixed with "• " and separated by newlines \\n (e.g., "• Fact one\\n• Fact two"). Do not output markdown code blocks.

Input Data:
`;

async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 3500): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      console.log(`[RateLimit] Status 429 detected. Retrying in ${delay / 1000}s... (Attempt ${i + 1}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // exponential backoff
      continue;
    }
    return res;
  }
  return fetch(url, options);
}

export async function generateCardsWithGemini(dataString: string, isCsv: boolean): Promise<CardGenerationOutput[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'placeholder_gemini_key') {
    throw new Error('Gemini API key is not configured. Please set GEMINI_API_KEY in your .env file.');
  }

  const prompt = GENERATION_PROMPT(isCsv) + '\n' + dataString;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const response = await fetchWithRetry(url, {
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

let groqKeyCounter = 0

export async function generateCardsWithGroq(dataString: string, isCsv: boolean): Promise<CardGenerationOutput[]> {
  const keysStr = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || ''
  const keys = keysStr.split(',').map(k => k.trim()).filter(k => k.length > 0)
  
  if (keys.length === 0 || keys[0] === 'placeholder_groq_key') {
    throw new Error('Groq API key(s) not configured. Please set GROQ_API_KEYS or GROQ_API_KEY in your .env file.')
  }

  // Round-robin selection
  const apiKey = keys[groqKeyCounter % keys.length]
  console.log(`[GroqRoundRobin] Using API key index ${groqKeyCounter % keys.length} of ${keys.length}`)
  groqKeyCounter++

  // Spacing delay to avoid rate limit spikes
  const spacingTimeout = 2500
  console.log(`[GroqRoundRobin] Sleeping for ${spacingTimeout}ms before request...`)
  await new Promise(resolve => setTimeout(resolve, spacingTimeout))

  const prompt = GENERATION_PROMPT(isCsv) + '\n' + dataString

  const response = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
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
