import type { Metadata } from 'next'
import './globals.css'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: 'Antigravity Recall | Personal Flashcards & MCQ Quiz',
  description: 'Convert CSV/text inputs into smart study flashcards and MCQ tests, re-queuing incorrect quiz items automatically.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main style={{ flex: 1, padding: '40px 0' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
