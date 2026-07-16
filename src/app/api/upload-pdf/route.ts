import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getOrCreateDefaultUser } from '@/lib/user'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'

export async function POST(req: Request) {
  try {
    const user = await getOrCreateDefaultUser()
    const formData = await req.formData()
    
    const file = formData.get('file') as File | null
    const deckName = formData.get('deckName') as string | null
    const deckId = formData.get('deckId') as string | null
    const provider = (formData.get('provider') as string | null) || 'groq'

    if (!file) {
      return NextResponse.json({ error: 'No PDF file was provided.' }, { status: 400 })
    }

    if (!deckName || deckName.trim() === '') {
      return NextResponse.json({ error: 'Deck name is required.' }, { status: 400 })
    }

    // Get or create target deck
    let targetDeckId = deckId
    if (!targetDeckId) {
      const newDeck = await prisma.deck.create({
        data: {
          name: deckName.trim(),
          userId: user.id,
        },
      })
      targetDeckId = newDeck.id
    } else {
      const existingDeck = await prisma.deck.findUnique({
        where: { id: targetDeckId }
      })
      if (!existingDeck) {
        return NextResponse.json({ error: 'Target deck not found.' }, { status: 404 })
      }
    }

    // Read file and compute hash
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex')

    // Avoid duplicate ingestion
    const existingJob = await prisma.pdfIngestionJob.findUnique({
      where: { fileHash }
    })
    if (existingJob) {
      return NextResponse.json({
        success: true,
        jobId: existingJob.id,
        status: existingJob.status,
        deckId: targetDeckId,
        message: 'This PDF file has already been parsed. Ingestion avoided.',
      })
    }

    // Save PDF file to uploads directory
    const uploadsDir = path.join(process.cwd(), 'uploads')
    await fs.mkdir(uploadsDir, { recursive: true })
    const filename = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`
    const filePath = path.join(uploadsDir, filename)
    await fs.writeFile(filePath, buffer)

    // Create a new ingestion job
    const job = await prisma.pdfIngestionJob.create({
      data: {
        id: crypto.randomUUID(),
        deckId: targetDeckId,
        filename,
        fileHash,
        status: 'PENDING',
        totalPages: 0,
      }
    })

    // Spawn the python process in the background
    const pyProcess = spawn('python', [
      path.join(process.cwd(), 'scripts', 'pdf_pipeline.py'),
      '--job-id', job.id,
      '--pdf-path', filePath,
      '--deck-id', targetDeckId,
      '--provider', provider
    ], {
      detached: true,
      stdio: 'ignore'
    })
    pyProcess.unref()

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: 'PENDING',
      deckId: targetDeckId,
      message: 'PDF Uploaded successfully. Ingestion pipeline triggered in the background.',
    })
  } catch (err: any) {
    console.error('PDF upload and ingestion trigger failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
