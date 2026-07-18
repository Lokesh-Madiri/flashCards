import { NextResponse } from 'next/server'

/**
 * Extracts YouTube video ID from any YouTube URL format.
 */
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

/**
 * Fetch YouTube auto-generated captions (supports mixed language).
 * Returns transcript text in whatever language(s) the video provides.
 */
async function fetchYouTubeCaptions(videoId: string): Promise<string> {
  // Step 1: Fetch the YouTube watch page to find the caption track URLs
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
  const watchRes = await fetch(watchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
    }
  })

  if (!watchRes.ok) {
    throw new Error(`Failed to fetch YouTube page: ${watchRes.status}`)
  }

  const html = await watchRes.text()

  // Step 2: Extract the captionTracks JSON from the page HTML
  const captionMatch = html.match(/"captionTracks":(\[.*?\])/)
  if (!captionMatch) {
    throw new Error('No captions found for this video. The video may not have auto-generated subtitles enabled.')
  }

  let captionTracks: any[] = []
  try {
    captionTracks = JSON.parse(captionMatch[1])
  } catch (e) {
    throw new Error('Failed to parse caption track metadata from YouTube.')
  }

  if (captionTracks.length === 0) {
    throw new Error('No caption tracks available for this video.')
  }

  // Step 3: Language priority — prefer Hindi (hi), then English (en), then auto-generated (asr), then any
  const preferredLangs = ['hi', 'en', 'en-IN']
  let selectedTrack = captionTracks.find(t =>
    preferredLangs.includes(t.languageCode) && t.kind !== 'asr'
  ) || captionTracks.find(t =>
    preferredLangs.includes(t.languageCode)
  ) || captionTracks.find(t =>
    t.kind === 'asr'  // Auto-generated fallback
  ) || captionTracks[0]

  const captionUrl = selectedTrack.baseUrl
  const lang = selectedTrack.languageCode || 'unknown'
  console.log(`[Transcribe] Using caption track: lang=${lang}, kind=${selectedTrack.kind || 'manual'}, url=${captionUrl?.substring(0, 80)}...`)

  // Step 4: Fetch the caption XML
  const captionRes = await fetch(captionUrl)
  if (!captionRes.ok) {
    throw new Error(`Failed to fetch caption file: ${captionRes.status}`)
  }

  const captionXml = await captionRes.text()

  // Step 5: Parse the XML <text> tags and strip HTML entities
  const textMatches = captionXml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)
  const lines: string[] = []

  for (const match of textMatches) {
    let text = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/<[^>]+>/g, '') // strip any inner tags
      .trim()

    if (text) lines.push(text)
  }

  if (lines.length === 0) {
    throw new Error('Caption file was empty or could not be parsed.')
  }

  // Merge into clean paragraph-style text
  return lines.join(' ')
}

export async function POST(req: Request) {
  try {
    const { youtubeUrl } = await req.json()

    if (!youtubeUrl || !youtubeUrl.trim()) {
      return NextResponse.json({ error: 'youtubeUrl is required.' }, { status: 400 })
    }

    const videoId = extractVideoId(youtubeUrl.trim())
    if (!videoId) {
      return NextResponse.json({ error: 'Invalid YouTube URL. Please provide a valid youtube.com or youtu.be link.' }, { status: 400 })
    }

    let transcript = ''
    try {
      transcript = await fetchYouTubeCaptions(videoId)
    } catch (captionErr: any) {
      return NextResponse.json({
        error: `Could not extract captions: ${captionErr.message}. Make sure the video has auto-generated subtitles turned on in YouTube Studio.`,
      }, { status: 422 })
    }

    return NextResponse.json({
      success: true,
      videoId,
      transcript,
      wordCount: transcript.split(/\s+/).length,
      message: `Extracted ${transcript.split(/\s+/).length.toLocaleString()} words from YouTube captions. Combined with your text for card generation.`
    })
  } catch (err: any) {
    console.error('[Transcribe] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
