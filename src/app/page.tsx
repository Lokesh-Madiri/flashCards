'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Papa from 'papaparse'
import { 
  Plus, 
  UploadCloud, 
  FileText, 
  Trash2, 
  Edit3, 
  Check, 
  X, 
  Play, 
  BookOpen, 
  HelpCircle,
  FileSpreadsheet,
  AlertCircle
} from 'lucide-react'
import styles from './page.module.css'

interface Deck {
  id: string
  name: string
  createdAt: string
  totalCards: number
  activeCards: number
}

export default function Dashboard() {
  const router = useRouter()
  const [decks, setDecks] = useState<Deck[]>([])
  const [loadingDecks, setLoadingDecks] = useState(true)
  
  // Form State
  const [deckName, setDeckName] = useState('')
  const [uploadMode, setUploadMode] = useState<'create' | 'append'>('create')
  const [selectedDeckId, setSelectedDeckId] = useState<string>('')
  const [uploadFormat, setUploadFormat] = useState<'csv' | 'text' | 'pdf'>('csv')
  const [textInput, setTextInput] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [provider, setProvider] = useState<'gemini' | 'groq'>('gemini')

  // Uncontrolled ref for the raw text textarea — avoids React re-render lag with huge pastes
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [wordCount, setWordCount] = useState(0)
  
  // Inline rename state
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Upload progress state
  const [uploading, setUploading] = useState(false)
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  // Coverage report state (Feature 2)
  const [coverageReport, setCoverageReport] = useState<{
    coverageScore: number
    wellCovered: string[]
    partiallyCovered: string[]
    missing: string[]
    summary: string
  } | null>(null)
  const [showCoverageModal, setShowCoverageModal] = useState(false)

  useEffect(() => {
    fetchDecks()
  }, [])

  const fetchDecks = async () => {
    try {
      setLoadingDecks(true)
      const res = await fetch('/api/decks')
      if (res.ok) {
        const data = await res.json()
        setDecks(data)
        if (data.length > 0) {
          setSelectedDeckId(prev => prev || data[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to fetch decks:', err)
    } finally {
      setLoadingDecks(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0]
      if (uploadFormat === 'pdf') {
        setPdfFile(file)
      } else {
        setCsvFile(file)
      }
      // Autofill deck name if empty
      if (!deckName) {
        const baseName = file.name.replace(/\.[^/.]+$/, "") // strip extension
        setDeckName(baseName)
      }
    }
  }

  const handleDeleteDeck = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This will delete all associated flashcards and quiz scores.`)) {
      return
    }

    try {
      const res = await fetch(`/api/decks/${id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setDecks(decks.filter(d => d.id !== id))
      }
    } catch (err) {
      console.error('Failed to delete deck:', err)
    }
  }

  const startRenameDeck = (deck: Deck) => {
    setEditingDeckId(deck.id)
    setRenameValue(deck.name)
  }

  const handleRenameDeck = async (id: string) => {
    if (!renameValue.trim()) return

    try {
      const res = await fetch(`/api/decks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue }),
      })
      
      if (res.ok) {
        setDecks(decks.map(d => d.id === id ? { ...d, name: renameValue.trim() } : d))
        setEditingDeckId(null)
      }
    } catch (err) {
      console.error('Failed to rename deck:', err)
    }
  }

  // Handle uploading and chunked processing
  const uploadCsvInChunks = async (rows: any[]) => {
    if (rows.length === 0) {
      setErrorMsg('The CSV file is empty.')
      setUploading(false)
      return
    }

    const chunkSize = 40
    const chunks: any[][] = []
    for (let i = 0; i < rows.length; i += chunkSize) {
      chunks.push(rows.slice(i, i + chunkSize))
    }

    let activeDeckId: string | null = uploadMode === 'append' ? selectedDeckId : null
    const targetName = uploadMode === 'append' 
      ? (decks.find(d => d.id === selectedDeckId)?.name || deckName) 
      : deckName

    try {
      for (let index = 0; index < chunks.length; index++) {
        const chunkRows = chunks[index]
        const progress = Math.round((index / chunks.length) * 100)
        setProgressPercent(progress)
        setProgressMsg(`Processing chunk ${index + 1} of ${chunks.length} (${chunkRows.length} rows)...`)

        const chunkStr = JSON.stringify(chunkRows)
        const uploadRes: Response = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckName: targetName,
            isCsv: true,
            chunk: chunkStr,
            provider,
            deckId: activeDeckId,
          }),
        })

        if (!uploadRes.ok) {
          const errData: any = await uploadRes.json()
          throw new Error(errData.error || 'Server error uploading chunk')
        }

        const uploadData: any = await uploadRes.json()
        activeDeckId = uploadData.deckId
      }

      setProgressPercent(100)
      setProgressMsg('Deck processing complete!')
      setTimeout(() => {
        setUploading(false)
        setDeckName('')
        setCsvFile(null)
        fetchDecks()
      }, 1000)
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'An error occurred during AI processing.')
      setUploading(false)
    }
  }

  const uploadTextInChunks = async (text: string) => {
    // --- SLIDING WINDOW MAP-REDUCE CHUNKING ---
    const words = text.trim().split(/\s+/).filter(w => w.length > 0)

    if (words.length === 0) {
      setErrorMsg('The text input is empty.')
      setUploading(false)
      return
    }

    const CHUNK_SIZE = 800
    const OVERLAP    = 150

    const chunks: string[] = []
    let start = 0
    while (start < words.length) {
      const end = Math.min(start + CHUNK_SIZE, words.length)
      chunks.push(words.slice(start, end).join(' '))
      if (end === words.length) break
      start += CHUNK_SIZE - OVERLAP
    }

    let activeDeckId: string | null = uploadMode === 'append' ? selectedDeckId : null
    const targetName = uploadMode === 'append'
      ? (decks.find(d => d.id === selectedDeckId)?.name || deckName)
      : deckName

    const generatedQuestions: string[] = []

    try {
      for (let index = 0; index < chunks.length; index++) {
        const progress = Math.round((index / chunks.length) * 100)
        setProgressPercent(progress)
        setProgressMsg(
          `Sliding window chunk ${index + 1} of ${chunks.length} (~${Math.round(chunks[index].split(' ').length)} words, ${OVERLAP}-word overlap)...`
        )

        const textRes: Response = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckName: targetName,
            isCsv: false,
            chunk: chunks[index],
            provider,
            deckId: activeDeckId,
          }),
        })

        if (!textRes.ok) {
          const errData: any = await textRes.json()
          throw new Error(errData.error || 'Server error uploading text chunk')
        }

        const textData: any = await textRes.json()
        activeDeckId = textData.deckId
      }

      setProgressPercent(100)
      setProgressMsg(`Done! Running coverage audit on ${words.length.toLocaleString()} words...`)

      // --- COVERAGE OVERVIEW (Feature 2) ---
      // Only send the first 2000 words to avoid hitting Vercel's 4.5MB body limit
      try {
        const truncatedForCoverage = words.slice(0, 2000).join(' ')
        const coverageRes = await fetch('/api/coverage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalText: truncatedForCoverage,
            cardQuestions: generatedQuestions,
            provider,
          }),
        })
        if (coverageRes.ok) {
          const report = await coverageRes.json()
          setCoverageReport(report)
          setShowCoverageModal(true)
        }
      } catch (covErr) {
        console.warn('Coverage audit failed (non-blocking):', covErr)
      }

      setProgressMsg(`Done! Processed ${chunks.length} chunk${chunks.length > 1 ? 's' : ''} from ${words.length.toLocaleString()} words.`)
      setTimeout(() => {
        setUploading(false)
        setDeckName('')
        setTextInput('')
        setYoutubeUrl('')
        setWordCount(0)
        if (textareaRef.current) textareaRef.current.value = ''
        fetchDecks()
      }, 1500)
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'An error occurred during AI processing.')
      setUploading(false)
    }
  }

  const uploadPdf = async (file: File) => {
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('deckName', uploadMode === 'create' ? deckName : decks.find(d => d.id === selectedDeckId)?.name || 'AFCAT Deck')
      if (uploadMode === 'append') {
        formData.append('deckId', selectedDeckId)
      }
      formData.append('provider', provider)

      const res = await fetch('/api/upload-pdf', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to upload PDF file.')
      }

      setProgressPercent(100)
      setProgressMsg(data.message || 'PDF ingestion started in background.')
      
      setTimeout(() => {
        setUploading(false)
        setPdfFile(null)
        setDeckName('')
        fetchDecks()
      }, 2500)
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'An error occurred during PDF uploading.')
      setUploading(false)
    }
  }

  // Handle uploading and chunked processing
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    if (uploadMode === 'create' && !deckName.trim()) {
      setErrorMsg('Please enter a stack name.')
      return
    }

    if (uploadMode === 'append' && !selectedDeckId) {
      setErrorMsg('Please select a target stack to append to.')
      return
    }

    if (uploadFormat === 'csv' && !csvFile) {
      setErrorMsg('Please select a CSV file.')
      return
    }

    if (uploadFormat === 'pdf' && !pdfFile) {
      setErrorMsg('Please select a PDF document.')
      return
    }

    if (uploadFormat === 'text' && !(textareaRef.current?.value || '').trim()) {
      setErrorMsg('Please enter some text context.')
      return
    }

    setUploading(true)
    setProgressPercent(0)
    setProgressMsg('Starting file processing...')

    try {
      if (uploadFormat === 'csv' && csvFile) {
        Papa.parse(csvFile, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            uploadCsvInChunks(results.data)
          },
          error: (err) => {
            setErrorMsg(`CSV Parsing failed: ${err.message}`)
            setUploading(false)
          }
        })
      } else if (uploadFormat === 'pdf' && pdfFile) {
        await uploadPdf(pdfFile)
      } else {
        // Feature 3: If YouTube URL provided, fetch transcript and merge with pasted text
        // Read directly from the uncontrolled ref to get the full text without state lag
        const rawText = textareaRef.current?.value || ''
        let combinedText = rawText
        if (youtubeUrl.trim()) {
          setProgressMsg('Fetching YouTube captions...')
          try {
            const transcribeRes = await fetch('/api/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ youtubeUrl: youtubeUrl.trim() }),
            })
            const transcribeData = await transcribeRes.json()
            if (transcribeRes.ok && transcribeData.transcript) {
              combinedText = rawText + '\n\n--- YouTube Transcript ---\n\n' + transcribeData.transcript
              setProgressMsg(`YouTube captions extracted (${transcribeData.wordCount?.toLocaleString()} words). Processing combined sources...`)
            } else {
              setProgressMsg(`YouTube captions unavailable: ${transcribeData.error}. Processing text only...`)
            }
          } catch (ytErr) {
            setProgressMsg('YouTube fetch failed. Processing text only...')
          }
        }
        await uploadTextInChunks(combinedText)
      }
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'An error occurred during parsing.')
      setUploading(false)
    }
  }

  return (
    <div className={`${styles.dashboard} container animate-fade-in`}>
      <div className={styles.titleArea}>
        <h1>Antigravity Recall Study Dashboard</h1>
        <p>Upload text or large CSV files to create micro-learning flashcard decks using Gemini and Groq.</p>
      </div>

      {/* Coverage Report Modal (Feature 2) */}
      {showCoverageModal && coverageReport && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #0f172a, #1e293b)',
            border: '1px solid rgba(99,102,241,0.4)',
            borderRadius: '16px', padding: '32px',
            maxWidth: '620px', width: '100%',
            maxHeight: '85vh', overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.3rem' }}>📊 Coverage Overview</h2>
                <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  How well do the generated cards cover your source text?
                </p>
              </div>
              <button onClick={() => setShowCoverageModal(false)} style={{
                background: 'none', border: 'none', color: '#94a3b8',
                cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1, padding: '4px'
              }}>×</button>
            </div>

            {/* Score Ring */}
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{
                display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
                background: coverageReport.coverageScore >= 70
                  ? 'rgba(34,197,94,0.1)' : coverageReport.coverageScore >= 40
                  ? 'rgba(251,191,36,0.1)' : 'rgba(239,68,68,0.1)',
                border: `2px solid ${coverageReport.coverageScore >= 70 ? '#22c55e' : coverageReport.coverageScore >= 40 ? '#fbbf24' : '#ef4444'}`,
                borderRadius: '50%', width: '100px', height: '100px',
                justifyContent: 'center'
              }}>
                <span style={{ fontSize: '1.8rem', fontWeight: 800 }}>{coverageReport.coverageScore}%</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Coverage</span>
              </div>
              <p style={{ marginTop: '12px', fontSize: '0.9rem', color: '#e2e8f0' }}>{coverageReport.summary}</p>
            </div>

            {/* Topic breakdown */}
            {coverageReport.wellCovered.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ color: '#4ade80', margin: '0 0 8px', fontSize: '0.85rem' }}>✅ Well Covered ({coverageReport.wellCovered.length})</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {coverageReport.wellCovered.map((t, i) => (
                    <span key={i} style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '12px', padding: '3px 10px', fontSize: '0.75rem' }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            {coverageReport.partiallyCovered.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ color: '#fbbf24', margin: '0 0 8px', fontSize: '0.85rem' }}>⚠️ Partially Covered ({coverageReport.partiallyCovered.length})</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {coverageReport.partiallyCovered.map((t, i) => (
                    <span key={i} style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '12px', padding: '3px 10px', fontSize: '0.75rem' }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            {coverageReport.missing.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ color: '#f87171', margin: '0 0 8px', fontSize: '0.85rem' }}>❌ Potentially Missing ({coverageReport.missing.length})</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {coverageReport.missing.map((t, i) => (
                    <span key={i} style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '3px 10px', fontSize: '0.75rem' }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => setShowCoverageModal(false)} className="btn-primary" style={{ width: '100%' }}>
              Got it — View My Flashcards
            </button>
          </div>
        </div>
      )}

      <div className={styles.sectionGrid}>
        
        {/* Left Side: Upload Panel */}
        <section className={`${styles.uploadPanel} glass-panel`}>
          <h2>
            <Plus size={20} className={styles.iconPrimary} />
            <span>Create New Study Stack</span>
          </h2>

          <form onSubmit={handleUploadSubmit} className="flex flex-col gap-6">
            <div className={styles.formGroup}>
              <label>Stack Mode</label>
              <div className={styles.tabs}>
                <button
                  type="button"
                  className={`${styles.tab} ${uploadMode === 'create' ? styles.activeTab : ''}`}
                  onClick={() => setUploadMode('create')}
                  disabled={uploading}
                >
                  New Stack
                </button>
                <button
                  type="button"
                  className={`${styles.tab} ${uploadMode === 'append' ? styles.activeTab : ''}`}
                  onClick={() => {
                    setUploadMode('append')
                    if (decks.length > 0 && !selectedDeckId) {
                      setSelectedDeckId(decks[0].id)
                    }
                  }}
                  disabled={uploading || decks.length === 0}
                  title={decks.length === 0 ? "You must have at least one deck to append to!" : ""}
                >
                  Add to Existing
                </button>
              </div>
            </div>

            {uploadMode === 'create' ? (
              <div className={styles.formGroup}>
                <label>Stack Name (Unique identifier)</label>
                <input 
                  type="text" 
                  placeholder="e.g., Biology Part 2, AWS Core Concepts"
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  disabled={uploading}
                  className={styles.inputField}
                />
              </div>
            ) : (
              <div className={styles.formGroup}>
                <label>Select Target Stack</label>
                <select
                  value={selectedDeckId}
                  onChange={(e) => setSelectedDeckId(e.target.value)}
                  disabled={uploading}
                  className={styles.inputField}
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#fff',
                    border: '1px solid var(--accent-glow)',
                    padding: '12px',
                    borderRadius: '8px',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {decks.map((d) => (
                    <option key={d.id} value={d.id} style={{ background: '#1e293b', color: '#fff' }}>
                      {d.name} ({d.totalCards} cards)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={styles.formGroup}>
              <label>Input Format</label>
              <div className={styles.tabs}>
                <button
                  type="button"
                  className={`${styles.tab} ${uploadFormat === 'csv' ? styles.activeTab : ''}`}
                  onClick={() => setUploadFormat('csv')}
                  disabled={uploading}
                >
                  CSV File
                </button>
                <button
                  type="button"
                  className={`${styles.tab} ${uploadFormat === 'text' ? styles.activeTab : ''}`}
                  onClick={() => setUploadFormat('text')}
                  disabled={uploading}
                >
                  Raw Text
                </button>
                <button
                  type="button"
                  className={`${styles.tab} ${uploadFormat === 'pdf' ? styles.activeTab : ''}`}
                  onClick={() => setUploadFormat('pdf')}
                  disabled={uploading}
                >
                  PDF Document
                </button>
              </div>
            </div>

            {uploadFormat === 'csv' && (
              <div className={styles.formGroup}>
                <label>Select CSV File</label>
                <label className={styles.fileDropzone}>
                  <UploadCloud size={32} className={styles.iconPrimary} />
                  <span>Click to browse and upload CSV</span>
                  <input 
                    type="file" 
                    accept=".csv"
                    onChange={handleFileChange}
                    disabled={uploading}
                    className={styles.fileInput}
                  />
                </label>
                {csvFile && (
                  <div className={styles.selectedFileInfo}>
                    <FileSpreadsheet size={16} />
                    <span>{csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)</span>
                  </div>
                )}
              </div>
            )}

            {uploadFormat === 'text' && (
              <div className={styles.formGroup}>
                <label>
                  Enter Raw Text / Paragraphs
                  {wordCount > 0 && (
                    <span style={{ marginLeft: '10px', fontSize: '0.75rem', color: wordCount > 5000 ? '#4ade80' : 'var(--text-muted)', fontWeight: 400 }}>
                      {wordCount.toLocaleString()} words{wordCount > 800 ? ` → ~${Math.ceil((wordCount - 150) / (800 - 150))} AI chunks` : ''}
                    </span>
                  )}
                </label>
                <textarea
                  ref={textareaRef}
                  placeholder="Paste any amount of text — thousands of words, entire chapters, lecture notes. The sliding window chunker handles it all automatically..."
                  defaultValue=""
                  onInput={(e) => {
                    const val = (e.target as HTMLTextAreaElement).value
                    // Debounce word count update so large pastes don't block the UI
                    const wc = val.trim() ? val.trim().split(/\s+/).length : 0
                    setWordCount(wc)
                  }}
                  disabled={uploading}
                  className={`${styles.inputField} ${styles.textareaField}`}
                  style={{ minHeight: '180px' }}
                />
                <div style={{ marginTop: '10px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                    🎬 YouTube Video URL <span style={{ opacity: 0.6 }}>(Optional — captions will be merged with text above)</span>
                  </label>
                  <input
                    type="url"
                    placeholder="https://youtube.com/watch?v=..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    disabled={uploading}
                    className={styles.inputField}
                    style={{ fontSize: '0.85rem' }}
                  />
                  {youtubeUrl.trim() && (
                    <p style={{ fontSize: '0.72rem', color: '#a78bfa', marginTop: '4px' }}>
                      ✅ Captions (Hindi+English auto) will be extracted and combined with your text.
                    </p>
                  )}
                </div>
              </div>
            )}

            {uploadFormat === 'pdf' && (
              <div className={styles.formGroup}>
                <label>Select PDF Document</label>
                <label className={styles.fileDropzone}>
                  <UploadCloud size={32} className={styles.iconPrimary} />
                  <span>Click to browse and upload PDF</span>
                  <input 
                    type="file" 
                    accept=".pdf"
                    onChange={handleFileChange}
                    disabled={uploading}
                    className={styles.fileInput}
                  />
                </label>
                {pdfFile && (
                  <div className={styles.selectedFileInfo}>
                    <FileText size={16} />
                    <span>{pdfFile.name} ({(pdfFile.size / (1024 * 1024)).toFixed(2)} MB)</span>
                  </div>
                )}
              </div>
            )}

            <div className={styles.formGroup}>
              <label>AI LLM Provider</label>
              <div className={styles.providerToggle}>
                <button
                  type="button"
                  className={`${styles.providerOption} ${provider === 'gemini' ? styles.selected : ''}`}
                  onClick={() => setProvider('gemini')}
                  disabled={uploading}
                >
                  Google Gemini (2.0 Flash)
                </button>
                <button
                  type="button"
                  className={`${styles.providerOption} ${provider === 'groq' ? styles.selected : ''}`}
                  onClick={() => setProvider('groq')}
                  disabled={uploading}
                >
                  Groq (Llama-3.3-70b)
                </button>
              </div>
            </div>

            {errorMsg && (
              <div style={{ color: 'var(--danger)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertCircle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            <button 
              type="submit" 
              className="btn-primary"
              disabled={uploading}
              style={{ width: '100%', marginTop: '12px' }}
            >
              {uploading ? 'Processing Chunks...' : 'Generate Flashcards'}
            </button>

            {uploading && (
              <div className={styles.progressContainer}>
                <div className={styles.progressHeader}>
                  <span className={styles.progressMessage}>{progressMsg}</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className={styles.progressBar}>
                  <div 
                    className={styles.progressFill} 
                    style={{ width: `${progressPercent}%` }}
                  ></div>
                </div>
              </div>
            )}
          </form>
        </section>

        {/* Right Side: Decks Panel */}
        <section className={`${styles.decksPanel} glass-panel`}>
          <h2>
            <BookOpen size={20} className={styles.iconPrimary} />
            <span>Your Study Stacks</span>
          </h2>

          {loadingDecks ? (
            <div className={styles.emptyState}>Loading your decks...</div>
          ) : decks.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No study decks found. Upload your study notes or a CSV file on the left to generate your first deck!</p>
            </div>
          ) : (
            <div className={styles.decksList}>
              {decks.map((deck) => {
                const masteredCount = deck.totalCards - deck.activeCards
                const progressPct = deck.totalCards > 0 
                  ? Math.round((masteredCount / deck.totalCards) * 100) 
                  : 0

                return (
                  <div key={deck.id} className={`${styles.deckItem} glass-panel glass-panel-hover`}>
                    
                    <div className={styles.deckHeader}>
                      <div className={styles.deckTitleContainer}>
                        {editingDeckId === deck.id ? (
                          <div className="flex items-center gap-2" style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              className={styles.deckNameInput}
                              autoFocus
                            />
                            <button 
                              onClick={() => handleRenameDeck(deck.id)} 
                              className={styles.actionBtn}
                              title="Save"
                            >
                              <Check size={16} style={{ color: 'var(--success)' }} />
                            </button>
                            <button 
                              onClick={() => setEditingDeckId(null)} 
                              className={styles.actionBtn}
                              title="Cancel"
                            >
                              <X size={16} style={{ color: 'var(--danger)' }} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <h3 
                              className={styles.deckTitle}
                              onClick={() => startRenameDeck(deck)}
                              title="Click to rename"
                            >
                              {deck.name}
                            </h3>
                            <button 
                              onClick={() => startRenameDeck(deck)} 
                              className={styles.actionBtn}
                              title="Rename Stack"
                            >
                              <Edit3 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                      
                      <div className={styles.deckActions}>
                        <button 
                          onClick={() => handleDeleteDeck(deck.id, deck.name)}
                          className={`${styles.actionBtn} ${styles.delete}`}
                          title="Delete Stack"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <div className={styles.deckProgressSection}>
                      <div className={styles.progressLabel}>
                        <span>{masteredCount} of {deck.totalCards} cards mastered</span>
                        <span>{progressPct}%</span>
                      </div>
                      <div className={styles.progressDeckBar}>
                        <div 
                          className={styles.progressDeckFill}
                          style={{ width: `${progressPct}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className={styles.deckControls}>
                      <Link 
                        href={`/deck/${deck.id}/study`}
                        className={styles.studyBtn}
                      >
                        <Play size={14} />
                        <span>Study Flashcards</span>
                      </Link>
                      
                      <button
                        onClick={() => router.push(`/deck/${deck.id}/quiz`)}
                        className={styles.quizBtn}
                        disabled={deck.activeCards > 0}
                        title={deck.activeCards > 0 ? "Study all active cards before unlocking the MCQ test!" : "Unlock MCQ Quiz"}
                      >
                        <HelpCircle size={14} />
                        <span>Take MCQ Test</span>
                      </button>
                    </div>

                  </div>
                )
              })}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
