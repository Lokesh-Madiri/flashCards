'use client'

import { useState, useEffect } from 'react'
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
  const [isCsv, setIsCsv] = useState(true)
  const [textInput, setTextInput] = useState('')
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [provider, setProvider] = useState<'gemini' | 'groq'>('gemini')
  
  // Inline rename state
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Upload progress state
  const [uploading, setUploading] = useState(false)
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

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
      setCsvFile(file)
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
    const paragraphs = text
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0)

    if (paragraphs.length === 0) {
      setErrorMsg('The text input is empty.')
      setUploading(false)
      return
    }

    const chunkSize = 4
    const chunks: string[][] = []
    for (let i = 0; i < paragraphs.length; i += chunkSize) {
      chunks.push(paragraphs.slice(i, i + chunkSize))
    }

    let activeDeckId: string | null = uploadMode === 'append' ? selectedDeckId : null
    const targetName = uploadMode === 'append' 
      ? (decks.find(d => d.id === selectedDeckId)?.name || deckName) 
      : deckName

    try {
      for (let index = 0; index < chunks.length; index++) {
        const chunkParagraphs = chunks[index]
        const progress = Math.round((index / chunks.length) * 100)
        setProgressPercent(progress)
        setProgressMsg(`Processing text chunk ${index + 1} of ${chunks.length}...`)

        const chunkStr = chunkParagraphs.join('\n\n')
        const textRes: Response = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckName: targetName,
            isCsv: false,
            chunk: chunkStr,
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
      setProgressMsg('Deck processing complete!')
      setTimeout(() => {
        setUploading(false)
        setDeckName('')
        setTextInput('')
        fetchDecks()
      }, 1000)
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'An error occurred during AI processing.')
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

    if (isCsv && !csvFile) {
      setErrorMsg('Please select a CSV file.')
      return
    }

    if (!isCsv && !textInput.trim()) {
      setErrorMsg('Please enter some text context.')
      return
    }

    setUploading(true)
    setProgressPercent(0)
    setProgressMsg('Starting file parsing...')

    try {
      if (isCsv && csvFile) {
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
      } else {
        await uploadTextInChunks(textInput)
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
                  className={`${styles.tab} ${isCsv ? styles.activeTab : ''}`}
                  onClick={() => setIsCsv(true)}
                  disabled={uploading}
                >
                  CSV File
                </button>
                <button
                  type="button"
                  className={`${styles.tab} ${!isCsv ? styles.activeTab : ''}`}
                  onClick={() => setIsCsv(false)}
                  disabled={uploading}
                >
                  Raw Text
                </button>
              </div>
            </div>

            {isCsv ? (
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
            ) : (
              <div className={styles.formGroup}>
                <label>Enter Raw Text / Paragraphs</label>
                <textarea
                  placeholder="Paste textbook sections, definitions, or study notes here. Double line breaks represent paragraph boundaries..."
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  disabled={uploading}
                  className={`${styles.inputField} ${styles.textareaField}`}
                />
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
                  Google Gemini (2.5 Flash)
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
