export interface CardGenerationOutput {
  question: string;
  answer: string;
  originalRow: string;
}

const GENERATION_PROMPT = (isCsv: boolean) => `
You are an expert AFCAT (Air Force Common Admission Test) exam paper setter and educational tutor.
Your core task is to process input data ${isCsv ? '(a JSON-serialized chunk of CSV rows)' : '(a segment of plain text)'} and convert it into a set of high-yield study cards based on the "Static-Current Hybridization" methodology.

CRITICAL METHODOLOGY (Static-Current Hybridization):
1. AFCAT rarely asks raw current affairs. Instead, it uses current affairs triggers from the past 6 months to ask associated STATIC, HISTORICAL, GEOGRAPHICAL, SCIENTIFIC, or INSTITUTIONAL facts ("Static Anchors").
2. Do NOT summarize the news event itself. Instead, identify the news event, find all its potential "Static Anchors" (e.g. for Aditya-L1, the static anchors are Launch Vehicle, Orbit, Lagrange Point, Mission Objective; for a new Ramsar Site, the static anchors are State, Nearest National Park, River Basin).
3. Do NOT force a single card per news item. Generate MULTIPLE cards for a single news event if multiple important static anchors exist. Generate one card for each high-probability static anchor.
4. Think like an AFCAT paper setter: "If AFCAT wants to test this news event, what static fact is it most likely to ask?"

AFCAT CATEGORIES & PRIORITIES:
Classify each card into exactly one of these 10 prioritized categories:
- Defence (★★★★★)
- ISRO & Space (★★★★★)
- Awards (★★★★★)
- Defence Exercises (★★★★★)
- Reports & International Organisations (★★★★★)
- Government Schemes (★★★★☆)
- Environment (★★★★☆)
- Geography (★★★★☆)
- Economy (★★★☆☆)
- Miscellaneous (★★☆☆☆)

AFCAT QUESTION TEMPLATES:
Choose the template that best matches the target question:
Location, Headquarters, Launch Vehicle, Mission Objective, Exercise Venue, Exercise Participants, Award Winner, Award Category, Manufacturer, Shipyard, River, State, National Park, Scientific Principle, Ministry, Organisation, Treaty Members, Satellite, Rocket, Species, Full Form, Technology.

TWO-LEVEL PROBABILITY MATRIX:
1. Topic Probability: How likely is this news topic to be asked in AFCAT? (Defence exercises and ISRO missions are ★★★★★; minor economy metrics are ★☆☆☆☆).
2. Fact Probability: How likely is this specific static anchor of the topic to be asked? (e.g., launch vehicle class is ★★★★★; mission cost or launch date is ★★☆☆☆ or ★☆☆☆☆).

RULES:
1. The response MUST be a valid JSON array of objects matching this TypeScript type:
   Array<{
     question: string; // The front of the card: a clear, concise exam-style question testing the static anchor
     answer: string;   // The back of the card: a bulleted list of 2-5 key facts about the static anchor (prefixed with "• " and separated by \\n)
     originalRow: string; // Stringified JSON object containing the metadata fields listed below
   }>
2. The "originalRow" field MUST be a stringified JSON object containing these exact keys:
   {
     "Main Topic": string (the underlying news event / topic name),
     "Category": string (one of the 10 prioritized categories above),
     "Question Template": string (one of the question templates above),
     "Static Anchor": string (the specific static anchor being queried),
     "Topic Probability": string (star rating e.g. "★★★★★" to "★☆☆☆☆"),
     "Fact Probability": string (star rating e.g. "★★★★★" to "★☆☆☆☆"),
     "Tags": string (comma-separated tags),
     "Source": string (the source text / row context),
     "Reason": string (1-2 sentence explanation of why this specific static anchor is highly likely to be asked),
     "MCQ Question": string (one high-quality AFCAT-style MCQ question testing this static anchor),
     "MCQ Options": string[] (exactly 4 options, starting with "a) ", "b) ", "c) ", "d) "),
     "MCQ Correct Answer": string (only the letter "a", "b", "c", or "d"),
     "MCQ Explanation": string (detailed explanation of the correct answer and static context)
   }

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
