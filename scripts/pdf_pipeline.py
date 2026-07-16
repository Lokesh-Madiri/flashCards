import os
import sys
import argparse
import hashlib
import time
import json
import uuid
import re
import threading
from concurrent.futures import ThreadPoolExecutor
import fitz  # PyMuPDF
import psycopg2
import psycopg2.extras
import requests

# Set default encoding to UTF-8
sys.stdout.reconfigure(encoding='utf-8')

# Global locks and counters
db_conn_string = os.environ.get("DATABASE_URL", "")
groq_keys_counter = 0

# Keywords for topic detection to minimize API cost
TOPIC_KEYWORDS = [
    # Defence & Military / Exercises
    "defence", "military", "missile", "regiment", "army", "navy", "air force", "frigate", 
    "command", "maneuver", "bilateral", "tactical", "combat", "warship", "weapon", "ship", 
    "tank", "troop", "exercise", "dustlik", "samudra", "bridge", "konkan", "garud", "abhyas", "nomad",
    # ISRO & Space
    "isro", "space", "satellite", "launch", "rocket", "orbit", "mission", "moon", "mars", 
    "solar", "payload", "lagrange", "spaceflight", "lift", "gslv", "pslv", "lvm",
    # Awards & Honors
    "award", "prize", "medal", "honors", "recipient", "padma", "chakra", "dadasaheb", "laureus", "booker",
    # Reports & International Organisations
    "report", "index", "imf", "efta", "un", "g20", "g7", "saarc", "unesco", "treaty", "alliance", 
    "summit", "headquarters", "geneva", "organization", "council", "rankings",
    # Government Schemes
    "yojana", "portal", "scheme", "subsidy", "initiative", "diksha", "welfare",
    # Environment & Geography
    "ramsar", "wetland", "forest", "tiger", "reserve", "national park", "species", "carbon", 
    "gas", "environment", "wild", "lake", "river", "strait", "boundary", "border", "basin", "mountain"
]

def get_db_connection():
    return psycopg2.connect(db_conn_string)

def clean_text(text):
    # Strip headers/footers, duplicate spaces, and typical page numbers
    lines = text.split("\n")
    cleaned_lines = []
    for line in lines:
        stripped = line.strip()
        # Skip empty lines or trivial headers/footers
        if not stripped:
            continue
        # Skip pure page numbers
        if re.match(r"^\d+$", stripped):
            continue
        # Skip typical header indicators
        if len(stripped) < 3:
            continue
        cleaned_lines.append(stripped)
    
    return "\n".join(cleaned_lines)

def detect_afcat_topics(text):
    text_lower = text.lower()
    for keyword in TOPIC_KEYWORDS:
        if keyword in text_lower:
            return True
    return False

def get_groq_api_key():
    global groq_keys_counter
    keys_str = os.environ.get("GROQ_API_KEYS") or os.environ.get("GROQ_API_KEY") or ""
    keys = [k.strip() for k in keys_str.split(",") if k.strip()]
    if not keys:
        raise Exception("No Groq API keys found in environment variables.")
    key = keys[groq_keys_counter % len(keys)]
    groq_keys_counter += 1
    return key

def get_gemini_api_key():
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key or key == "placeholder_gemini_key":
        raise Exception("No Gemini API key found in environment variables.")
    return key

def call_ai_api(prompt, provider):
    max_retries = 3
    delay = 3.5
    for attempt in range(max_retries):
        try:
            if provider == "gemini":
                api_key = get_gemini_api_key()
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
                res = requests.post(url, json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "responseMimeType": "application/json"
                    }
                }, timeout=60)
                if res.status_code == 429:
                    print(f"[RateLimit] 429 received from Gemini, retrying in {delay}s...")
                    time.sleep(delay)
                    delay *= 2
                    continue
                if res.status_code != 200:
                    raise Exception(f"Gemini returned error status {res.status_code}: {res.text}")
                
                res_json = res.json()
                raw_text = res_json["candidates"][0]["content"]["parts"][0]["text"]
                return raw_text
            else:
                # Groq
                api_key = get_groq_api_key()
                # Spacing delay to avoid rate limit spikes
                time.sleep(2.5)
                res = requests.post("https://api.groq.com/openai/v1/chat/completions", headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }, json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": "You are a structured assistant that outputs only valid JSON arrays. Do not include introductory text."},
                        {"role": "user", "content": prompt}
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1
                }, timeout=60)
                if res.status_code == 429:
                    print(f"[RateLimit] 429 received from Groq, retrying in {delay}s...")
                    time.sleep(delay)
                    delay *= 2
                    continue
                if res.status_code != 200:
                    raise Exception(f"Groq returned error status {res.status_code}: {res.text}")
                
                res_json = res.json()
                raw_text = res_json["choices"][0]["message"]["content"]
                return raw_text
        except Exception as e:
            if attempt == max_retries - 1:
                raise e
            print(f"[API Error] Attempt {attempt + 1} failed: {e}. Retrying in {delay}s...")
            time.sleep(delay)
            delay *= 2

def parse_and_save_cards(raw_text, deck_id, chunk_index):
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(json)?", "", cleaned)
        cleaned = re.sub(r"```$", "", cleaned)
        cleaned = cleaned.strip()
    
    try:
        cards_list = json.loads(cleaned)
    except Exception as e:
        # Check if the JSON is wrapped inside an object
        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, list):
                cards_list = parsed
            else:
                cards_list = None
                for key in parsed:
                    if isinstance(parsed[key], list):
                        cards_list = parsed[key]
                        break
                if cards_list is None:
                    raise Exception("No list found inside JSON response.")
        except Exception as inner_e:
            raise Exception(f"Failed to parse JSON response: {inner_e}. Raw Content: {cleaned[:300]}")
            
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        inserted_count = 0
        for card in cards_list:
            card_id = str(uuid.uuid4())
            question = card.get("question", "")
            answer = card.get("answer", "")
            original_row = card.get("originalRow", "")
            
            if not question or not answer:
                continue
                
            if isinstance(original_row, dict):
                original_row = json.dumps(original_row)
            elif not isinstance(original_row, str):
                original_row = str(original_row)
                
            cursor.execute(
                'INSERT INTO "Card" (id, "deckId", question, answer, "originalRow", state, "needsRepeat", "wrongInQuiz", "createdAt") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())',
                (card_id, deck_id, question, answer, original_row, 'learning', True, False)
            )
            inserted_count += 1
        conn.commit()
        print(f"[Chunk {chunk_index}] Successfully saved {inserted_count} cards to database.")
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cursor.close()
        conn.close()

GENERATION_PROMPT = """You are an expert AFCAT (Air Force Common Admission Test) exam paper setter and educational tutor.
Your core task is to process the provided input news events segment and convert it into a set of high-yield study cards based on the "Static-Current Hybridization" methodology.

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

Input Data segment to process:
"""

def process_single_chunk(chunk_id, jobId, chunk_index, start_page, end_page, pdf_path, deck_id, provider, worker_id):
    print(f"[Worker {worker_id}] Starting processing for Chunk {chunk_index} (Pages {start_page}-{end_page})...")
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Extract text page-by-page
        doc = fitz.open(pdf_path)
        chunk_text_parts = []
        for p_idx in range(start_page - 1, min(end_page, doc.page_count)):
            page = doc.load_page(p_idx)
            page_text = page.get_text("text")
            cleaned_page = clean_text(page_text)
            if cleaned_page:
                chunk_text_parts.append(cleaned_page)
        
        doc.close()
        
        chunk_text = "\n\n".join(chunk_text_parts)
        
        # Check topic detection to avoid cost
        if not chunk_text or not detect_afcat_topics(chunk_text):
            print(f"[Chunk {chunk_index}] Ignored - No AFCAT-relevant static current anchors detected in text. Skipping API call to minimize costs.")
            cursor.execute(
                'UPDATE "PdfChunk" SET status = %s, "error" = %s, "updatedAt" = NOW() WHERE id = %s',
                ("COMPLETED", "Skipped: No relevant AFCAT topics detected.", chunk_id)
            )
            conn.commit()
            return

        # Call AI API
        prompt = GENERATION_PROMPT + "\n" + chunk_text
        ai_response = call_ai_api(prompt, provider)
        
        # Parse and save cards
        parse_and_save_cards(ai_response, deck_id, chunk_index)
        
        # Update status to completed
        cursor.execute(
            'UPDATE "PdfChunk" SET status = %s, "error" = NULL, "updatedAt" = NOW() WHERE id = %s',
            ("COMPLETED", chunk_id)
        )
        conn.commit()
        print(f"[Chunk {chunk_index}] Processing COMPLETED successfully.")
        
    except Exception as e:
        conn.rollback()
        err_msg = str(e)
        print(f"[Chunk {chunk_index}] FAILED: {err_msg}")
        cursor.execute(
            'UPDATE "PdfChunk" SET status = %s, "error" = %s, "updatedAt" = NOW() WHERE id = %s',
            ("FAILED", err_msg[:500], chunk_id)
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()

def main():
    parser = argparse.ArgumentParser(description="AFCAT Scalable PDF Ingestion Pipeline")
    parser.add_argument("--job-id", type=str, help="Ingestion job ID to initialize")
    parser.add_argument("--pdf-path", type=str, help="Path to PDF file")
    parser.add_argument("--deck-id", type=str, help="Target deck ID")
    parser.add_argument("--provider", type=str, default="groq", choices=["groq", "gemini"], help="AI Provider")
    parser.add_argument("--workers", type=int, default=4, help="Number of parallel worker threads")
    
    args = parser.parse_args()
    
    worker_uuid = str(uuid.uuid4())
    print(f"[Pipeline] Worker ID initialized: {worker_uuid}")
    
    if args.job_id:
        # Initialize a new ingestion job
        if not args.pdf_path or not args.deck_id:
            print("Error: --pdf-path and --deck-id are required when initializing a --job-id.")
            sys.exit(1)
            
        print(f"[Pipeline] Initializing Job {args.job_id} for PDF {args.pdf_path}...")
        
        # Hash check to prevent duplicates
        sha256 = hashlib.sha256()
        with open(args.pdf_path, "rb") as f:
            while chunk := f.read(8192):
                sha256.update(chunk)
        file_hash = sha256.hexdigest()
        
        # Open PDF to get pages
        doc = fitz.open(args.pdf_path)
        total_pages = doc.page_count
        doc.close()
        
        print(f"[Pipeline] PDF total pages: {total_pages}, hash: {file_hash}")
        
        # Register chunks
        chunk_size = 10  # 10 pages per chunk
        chunks_to_create = []
        chunk_index = 0
        for start in range(1, total_pages + 1, chunk_size):
            end = min(total_pages, start + chunk_size - 1)
            chunks_to_create.append((
                str(uuid.uuid4()), args.job_id, chunk_index, start, end, "PENDING"
            ))
            chunk_index += 1
            
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # Check if this PDF hash already exists (avoid duplicate ingestion)
            cursor.execute('SELECT id, status FROM "PdfIngestionJob" WHERE "fileHash" = %s', (file_hash,))
            existing = cursor.fetchone()
            if existing:
                job_id_existing, status_existing = existing
                print(f"[Pipeline] Warning: This PDF hash already exists in database (Job {job_id_existing}, status: {status_existing}). Duplicate ingestion avoided.")
                # Link this deck ID to the already completed cards or notify user
                cursor.execute('UPDATE "PdfIngestionJob" SET status = %s WHERE id = %s', ("COMPLETED", args.job_id))
                conn.commit()
                sys.exit(0)
            
            # Save file hash and status
            cursor.execute(
                'UPDATE "PdfIngestionJob" SET "fileHash" = %s, "totalPages" = %s, status = %s, "updatedAt" = NOW() WHERE id = %s',
                (file_hash, total_pages, "PROCESSING", args.job_id)
            )
            
            # Bulk insert chunks
            psycopg2.extras.execute_values(
                cursor,
                'INSERT INTO "PdfChunk" (id, "jobId", "chunkIndex", "startPage", "endPage", status, "createdAt", "updatedAt") VALUES %s',
                [(c[0], c[1], c[2], c[3], c[4], c[5], psycopg2.Timestamp(time.time()), psycopg2.Timestamp(time.time())) for c in chunks_to_create]
            )
            conn.commit()
            print(f"[Pipeline] Job {args.job_id} successfully initialized with {len(chunks_to_create)} chunks.")
        except Exception as e:
            conn.rollback()
            print(f"[Pipeline] Initialization failed: {e}")
            sys.exit(1)
        finally:
            cursor.close()
            conn.close()
            
    # Worker processing loop (Horizontally scalable mode!)
    print("[Pipeline] Running workers loop to process chunks...")
    
    # We will process chunks using a ThreadPoolExecutor to run tasks in parallel
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        while True:
            # Fetch a chunk using atomic SELECT FOR UPDATE SKIP LOCKED
            conn = get_db_connection()
            cursor = conn.cursor()
            
            chunk = None
            try:
                # Lock and claim one chunk that is PENDING or FAILED (resume interrupted jobs)
                cursor.execute(
                    'SELECT c.id, c."jobId", c."chunkIndex", c."startPage", c."endPage", j."deckId", j."filename" '
                    'FROM "PdfChunk" c '
                    'JOIN "PdfIngestionJob" j ON c."jobId" = j.id '
                    'WHERE c.status IN (\'PENDING\', \'FAILED\') '
                    'AND (c."lockedAt" IS NULL OR c."lockedAt" < NOW() - INTERVAL \'15 minutes\') '
                    'LIMIT 1 FOR UPDATE SKIP LOCKED'
                )
                chunk = cursor.fetchone()
                
                if chunk:
                    chunk_id, jobId, chunk_index, start_page, end_page, deck_id, filename = chunk
                    # Lock the chunk
                    cursor.execute(
                        'UPDATE "PdfChunk" SET status = %s, "lockedBy" = %s, "lockedAt" = NOW(), "updatedAt" = NOW() WHERE id = %s',
                        ("PROCESSING", worker_uuid, chunk_id)
                    )
                    conn.commit()
            except Exception as e:
                conn.rollback()
                print(f"[Pipeline] Database lock query failed: {e}")
                time.sleep(3)
                continue
            finally:
                cursor.close()
                conn.close()
                
            if not chunk:
                # No pending chunks in database. Check if active jobs are fully completed.
                conn = get_db_connection()
                cursor = conn.cursor()
                try:
                    # Find any jobs in PROCESSING status
                    cursor.execute('SELECT id FROM "PdfIngestionJob" WHERE status = \'PROCESSING\'')
                    active_jobs = cursor.fetchall()
                    for (j_id,) in active_jobs:
                        # Check if all chunks for this job are COMPLETED
                        cursor.execute('SELECT COUNT(*) FROM "PdfChunk" WHERE "jobId" = %s AND status != \'COMPLETED\'', (j_id,))
                        remaining = cursor.fetchone()[0]
                        if remaining == 0:
                            # Mark job as completed
                            cursor.execute('UPDATE "PdfIngestionJob" SET status = %s, "updatedAt" = NOW() WHERE id = %s', ("COMPLETED", j_id))
                            conn.commit()
                            print(f"[Pipeline] Ingestion Job {j_id} marked as fully COMPLETED.")
                except Exception as e:
                    conn.rollback()
                    print(f"[Pipeline] Job completion check failed: {e}")
                finally:
                    cursor.close()
                    conn.close()
                
                # Sleep a little before checking again
                time.sleep(5)
                continue
                
            # Submit task to worker thread
            chunk_id, jobId, chunk_index, start_page, end_page, deck_id, filename = chunk
            # The PDF file is expected to be uploaded in the Next.js standard uploads directory
            pdf_path_on_disk = os.path.join("uploads", filename)
            
            # Safety fallback for manual local testing path
            if not os.path.exists(pdf_path_on_disk) and args.pdf_path:
                pdf_path_on_disk = args.pdf_path
                
            executor.submit(
                process_single_chunk,
                chunk_id, jobId, chunk_index, start_page, end_page, pdf_path_on_disk, deck_id, args.provider, worker_uuid
            )

if __name__ == "__main__":
    main()
