'use client'

import { useState, useEffect } from 'react'
import { Settings, Save, Mail, AlertCircle, CheckCircle2 } from 'lucide-react'
import styles from './page.module.css'

export default function SettingsPage() {
  const [enabled, setEnabled] = useState(false)
  const [time, setTime] = useState('09:00')
  const [timezone, setTimezone] = useState('UTC')
  const [email, setEmail] = useState('')
  
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  
  // Simulated email logger on UI
  const [simulationLog, setSimulationLog] = useState('')

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const user = await res.json()
        setEmail(user.email)
        setTimezone(user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
        if (user.notificationTime) {
          setEnabled(true)
          setTime(user.notificationTime)
        } else {
          setEnabled(false)
          setTime('09:00')
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notificationTime: enabled ? time : null,
          timezone,
        }),
      })

      if (res.ok) {
        setMessage({ type: 'success', text: 'Reminder settings updated successfully!' })
      } else {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save settings')
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  const handleTestTrigger = async () => {
    setTesting(true)
    setMessage(null)
    setSimulationLog('')

    try {
      const res = await fetch('/api/cron/notifications?test=true')
      const data = await res.json()
      
      if (res.ok) {
        setMessage({ type: 'success', text: `Test triggered! ${data.message}` })
        if (data.logContents) {
          setSimulationLog(data.logContents)
        }
      } else {
        throw new Error(data.error || 'Failed to trigger test')
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={`${styles.settingsPage} container animate-fade-in`}>
      <div className={`${styles.panel} glass-panel`}>
        <h1>
          <Settings size={26} className={styles.icon} />
          <span>Notification Settings</span>
        </h1>
        <p className={styles.subtitle}>Configure daily study reminders to help you review flashcards consistently.</p>

        <form onSubmit={handleSave} className="flex flex-col gap-6" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div className={styles.formGroup}>
            <label>Registered Email Address</label>
            <input
              type="text"
              value={email}
              disabled
              className={styles.inputField}
              style={{ opacity: 0.6 }}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className={styles.checkboxInput}
              />
              <span>Enable Daily Study Reminder Email</span>
            </label>
          </div>

          <div className={styles.formGroup}>
            <label>Preferred Study Time</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={!enabled}
              className={styles.inputField}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Your Local Timezone</label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={styles.inputField}
              placeholder="e.g. America/New_York or Asia/Kolkata"
            />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Must match standard IANA timezone database names (e.g. UTC, Asia/Kolkata, Europe/London).
            </span>
          </div>

          {message && (
            <div className={`${styles.alert} ${message.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
              {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <span>{message.text}</span>
            </div>
          )}

          <div className={styles.actionRow}>
            <button 
              type="submit" 
              className="btn-primary"
              disabled={saving || testing}
            >
              <Save size={16} />
              <span>{saving ? 'Saving...' : 'Save Settings'}</span>
            </button>

            <button
              type="button"
              onClick={handleTestTrigger}
              className="btn-secondary"
              disabled={saving || testing}
            >
              <Mail size={16} />
              <span>{testing ? 'Sending...' : 'Send Test Reminder'}</span>
            </button>
          </div>
        </form>

        {simulationLog && (
          <div className={styles.simulatorLog}>
            <div className={styles.simulatorTitle}>
              <span>Simulated Email Log Output (prisma/sent_emails.log)</span>
              <span style={{ color: 'var(--success)' }}>Active</span>
            </div>
            {simulationLog}
          </div>
        )}
      </div>
    </div>
  )
}
