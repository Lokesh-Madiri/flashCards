export interface CardGenerationOutput {
  question: string;
  answer: string;
  originalRow: string;
}

const GENERATION_PROMPT = (isCsv: boolean) => `
You are an expert AFCAT (Air Force Common Admission Test) exam paper setter, defence analyst, educational content designer, and information extraction engine.

Your task is to process the provided input (${isCsv ? "JSON-serialized CSV rows" : "plain text copied from PDFs, websites, OCR, notes or books"}) and convert it into a complete set of high-quality AFCAT flashcards using the Static-Current Hybridization methodology.

===============================================================================
PRIMARY OBJECTIVE
===============================================================================

Your objective is NOT to summarize the input.

Your objective is to identify every important AFCAT-relevant fact, recover any lost document structure, infer relationships between facts, identify all possible static anchors, and generate exam-quality flashcards and MCQs.

Every important factual statement should appear somewhere in the final output.

Think exactly like an AFCAT paper setter.

===============================================================================
STEP 0 — DOCUMENT RECONSTRUCTION (MANDATORY)
===============================================================================

The input may come from
• PDF copy-paste
• OCR
• Newspapers
• Websites
• Books
• Notes
• Tables
• CSV

Formatting may be lost.
Before reasoning: Recover the logical structure.
Specifically:
• Detect headings.
• Detect subheadings.
• Detect bullet lists.
• Detect numbered lists.
• Merge wrapped sentences.
• Merge broken table rows.
• Associate dates with the correct entity.
• Associate locations with the correct topic.
• Associate people with organizations.
• Associate organizations with reports.
• Associate schemes with ministries.
• Associate missions with launch vehicles.
• Associate exercises with participating countries.

Do NOT process one line at a time.
Treat consecutive lines as belonging together unless strong evidence suggests otherwise.
Never lose information because formatting disappeared.

===============================================================================
STEP 1 — FACT EXTRACTION
===============================================================================

Extract EVERY factual statement.
Do NOT summarize.
Preserve:
• Names, Dates, Locations, Rivers, States, Capitals, Ministries, Headquarters, Reports, Organizations, Treaties, Species, Awards, Missions, Satellites, Rockets, Defence exercises, Military equipment, Scientific concepts, Technologies, National Parks, Biosphere Reserves, Ramsar Sites, Tiger Reserves, Economic terms.

Ignore only:
• Editorial comments, Opinions, Motivational text, Introductions, Filler sentences.

===============================================================================
STEP 2 — STATIC-CURRENT HYBRIDIZATION
===============================================================================

AFCAT rarely asks direct current affairs.
Instead:
Current Affair → Identify Static Anchors

Example:
News: Aditya-L1 reached Halo Orbit.
Static Anchors: Launch Vehicle, Orbit, Lagrange Point, Mission Objective, Payloads, ISRO Centre, Solar Observation.

Generate separate flashcards for every important anchor.
Never create only one flashcard for a news item if multiple static anchors exist.

===============================================================================
STEP 3 — STATIC ANCHOR DISCOVERY
===============================================================================

For every topic, discover every possible AFCAT static anchor.
Possible anchors include: Location, State, Capital, River, Mountain Range, National Park, Tiger Reserve, Biosphere Reserve, Ramsar Site, UNESCO Site, Headquarters, Formation Year, Founder, Ministry, Organization, Report Publisher, Index, Award, Award Category, Award Winner, Launch Vehicle, Mission Objective, Orbit, Satellite, Rocket, Missile, Aircraft, Warship, Shipyard, Manufacturer, Exercise Venue, Exercise Participants, Exercise Objective, Scientific Principle, Technology, Full Form, Species, Habitat, Treaty, Member Countries, Constitutional Article, Institution, Government Scheme, Department, Committee, Historical Event, Operation, Command, Military Base, Weapon System.

If multiple anchors exist, generate multiple flashcards.

===============================================================================
STEP 4 — AFCAT PRIORITY
===============================================================================

Assign every card exactly one category.
Priority:
★★★★★ Defence
★★★★★ ISRO & Space
★★★★★ Awards
★★★★★ Defence Exercises
★★★★★ Reports & International Organisations
★★★★☆ Government Schemes
★★★★☆ Environment
★★★★☆ Geography
★★★☆☆ Economy
★★☆☆☆ Miscellaneous

===============================================================================
STEP 5 — QUESTION SELECTION
===============================================================================

Think like an AFCAT examiner.
For each topic ask:
If AFCAT asks ONE question, what is the highest probability fact?
If AFCAT asks TWO questions, what is second?
Continue until all HIGH VALUE static anchors are exhausted.
Discard only low-value trivia.

===============================================================================
STEP 6 — QUESTION TEMPLATES
===============================================================================

Prefer these templates:
Location, Headquarters, Launch Vehicle, Mission Objective, Exercise Venue, Exercise Participants, Award Winner, Award Category, Manufacturer, Shipyard, River, State, National Park, Scientific Principle, Ministry, Organisation, Treaty Members, Satellite, Rocket, Species, Full Form, Technology.

===============================================================================
STEP 7 — PROBABILITY MATRIX
===============================================================================

Assign Topic Probability (★★★★★ to ★☆☆☆☆) and Fact Probability (★★★★★ to ★☆☆☆☆).
Topic Probability = How likely AFCAT asks from this topic.
Fact Probability = How likely AFCAT asks this exact static anchor.

===============================================================================
STEP 8 — FLASHCARD QUALITY
===============================================================================

Question: One concept only, clear, exam style, no ambiguity.
Answer: 2–5 concise bullet points. Every bullet begins with "• ".

===============================================================================
STEP 9 — MCQ GENERATION
===============================================================================

Generate ONE high-quality AFCAT MCQ.
Requirements: Exactly four options: a), b), c), d). Only one correct answer. Wrong options should be plausible. Explanation must explain why correct, why topic matters, and relevant static context.

===============================================================================
STEP 10 — COVERAGE VERIFICATION
===============================================================================

Before producing output, internally verify:
Every factual statement has been used in a flashcard OR used in an MCQ OR removed because purely editorial. Do NOT omit information.

===============================================================================
STEP 11 — FACT ACCURACY
===============================================================================

Never hallucinate. Use only well-established factual knowledge. If uncertain, prefer omission over fabrication.

===============================================================================
OUTPUT FORMAT
===============================================================================

Return ONLY valid JSON.
No markdown. No explanations. No code fences.

Return:
Array<{
  question: string,
  answer: string,
  originalRow: string
}>

originalRow MUST be a STRINGIFIED JSON OBJECT containing EXACTLY these fields:
{
  "Main Topic": string,
  "Category": string,
  "Question Template": string,
  "Static Anchor": string,
  "Topic Probability": string,
  "Fact Probability": string,
  "Tags": string,
  "Source": string,
  "Reason": string,
  "MCQ Question": string,
  "MCQ Options": string[],
  "MCQ Correct Answer": string,
  "MCQ Explanation": string
}

The answer field must contain bullet points separated using '\\n'.
Return nothing except the JSON array.
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

  const prompt = GENERATION_PROMPT(isCsv) + '\n' + dataString

  let failedKeysCount = 0
  const startIdx = groqKeyCounter

  // Attempt to make the request cycling through all available keys
  for (let i = 0; i < keys.length; i++) {
    const currentKeyIdx = (startIdx + i) % keys.length
    const apiKey = keys[currentKeyIdx]
    groqKeyCounter = currentKeyIdx // Align global counter to current key

    console.log(`[GroqRoundRobin] Trying API key index ${currentKeyIdx} of ${keys.length}`)

    // Spacing delay to avoid immediate rate limit spikes
    const spacingTimeout = 2500
    await new Promise(resolve => setTimeout(resolve, spacingTimeout))

    try {
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
      })

      if (response.status === 429) {
        console.warn(`[RateLimit] Key index ${currentKeyIdx} returned 429. Rotating to next key...`)
        failedKeysCount++
        continue
      }

      if (!response.ok) {
        const errText = await response.text()
        console.warn(`[GroqError] Key index ${currentKeyIdx} error: ${response.status} - ${errText}`)
        failedKeysCount++
        continue
      }

      const result = await response.json()
      const rawText = result.choices?.[0]?.message?.content
      if (!rawText) {
        console.warn(`[GroqError] Key index ${currentKeyIdx} returned empty content`)
        failedKeysCount++
        continue
      }

      // Successfully processed! Advance key counter for next request
      groqKeyCounter = (currentKeyIdx + 1) % keys.length
      return parseJsonResponse(rawText)

    } catch (err: any) {
      console.warn(`[GroqError] Exception with key index ${currentKeyIdx}: ${err.message}`)
      failedKeysCount++
      continue
    }
  }

  // If we cycled through all keys and all failed
  if (failedKeysCount >= keys.length) {
    throw new Error('GROQ_ALL_KEYS_RATE_LIMITED')
  }

  throw new Error('Failed to generate cards with Groq after trying all keys.')
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
