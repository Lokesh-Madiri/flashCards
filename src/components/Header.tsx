'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, Settings, LayoutDashboard, Sparkles } from 'lucide-react'
import styles from './Header.module.css'

export default function Header() {
  const pathname = usePathname()

  return (
    <header className={styles.header}>
      <div className={`${styles.headerContainer} container`}>
        <Link href="/" className={styles.logo}>
          <div className={styles.logoIcon}>
            <BookOpen size={22} className={styles.iconPrimary} />
            <Sparkles size={12} className={styles.sparkle} />
          </div>
          <span className={styles.logoText}>Antigravity <span className={styles.logoAccent}>Recall</span></span>
        </Link>
        
        <nav className={styles.nav}>
          <Link 
            href="/" 
            className={`${styles.navLink} ${pathname === '/' ? styles.active : ''}`}
          >
            <LayoutDashboard size={18} />
            <span>Dashboard</span>
          </Link>
          <Link 
            href="/deck/settings" 
            className={`${styles.navLink} ${pathname === '/deck/settings' ? styles.active : ''}`}
          >
            <Settings size={18} />
            <span>Settings</span>
          </Link>
        </nav>
      </div>
    </header>
  )
}
