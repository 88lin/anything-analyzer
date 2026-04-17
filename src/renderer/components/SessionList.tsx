import React, { useState } from 'react'
import { Button, Input, Modal, Empty } from '../ui'
import { IconPlus, IconDelete } from '../ui/Icons'
import { useLocale } from '../i18n'
import type { Session } from '../../shared/types'
import styles from './SessionList.module.css'

interface SessionListProps {
  sessions: Session[]
  currentSessionId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string, url: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onOpenSettings: () => void
  activeRequestCount?: number
}

/**
 * Session status dot color
 */
function getDotColor(session: Session): string {
  if (session.status === 'running') return 'var(--color-success)'
  if (session.status === 'paused') return 'var(--color-warning)'
  return 'var(--text-disabled)'
}

function getStatusInfo(session: Session): { symbol: string; color: string; labelKey: string } {
  if (session.status === 'running') return { symbol: '●', color: 'var(--color-success)', labelKey: 'capture.running' }
  if (session.status === 'paused') return { symbol: '⏸', color: 'var(--color-warning)', labelKey: 'capture.paused' }
  return { symbol: '■', color: 'var(--text-muted)', labelKey: 'capture.stopped' }
}

function extractDomain(url: string): string {
  if (!url) return ''
  try { return new URL(url).hostname } catch { return url }
}

const SessionList: React.FC<SessionListProps> = ({
  sessions,
  currentSessionId,
  onSelect,
  onCreate,
  onDelete,
  onOpenSettings,
  activeRequestCount = 0,
}) => {
  const { t } = useLocale()
  const [modalOpen, setModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [nameError, setNameError] = useState('')
  const [urlError, setUrlError] = useState('')

  const openModal = () => {
    setModalOpen(true)
    window.electronAPI.setTargetViewVisible(false)
  }

  const closeModal = () => {
    setModalOpen(false)
    setFormName('')
    setFormUrl('')
    setNameError('')
    setUrlError('')
    window.electronAPI.setTargetViewVisible(true)
  }

  const validate = (): boolean => {
    let valid = true
    if (!formName.trim()) {
      setNameError('Please enter a session name')
      valid = false
    } else {
      setNameError('')
    }
    if (formUrl.trim()) {
      try {
        new URL(formUrl)
        setUrlError('')
      } catch {
        setUrlError('Please enter a valid URL')
        valid = false
      }
    } else {
      setUrlError('')
    }
    return valid
  }

  const handleCreate = async () => {
    if (!validate()) return
    setCreating(true)
    try {
      await onCreate(formName.trim(), formUrl.trim())
      closeModal()
    } catch {
      // create failed
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setDeletingId(id)
    try {
      await onDelete(id)
    } catch {
      // delete failed
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className={styles.container}>
      {/* Section header with count */}
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}>SESSIONS</span>
        {sessions.length > 0 && (
          <span className={styles.sectionCount}>{sessions.length}</span>
        )}
      </div>

      {/* Session list */}
      <div className={styles.list}>
        {sessions.length === 0 ? (
          <Empty description="No sessions" style={{ marginTop: 40 }} />
        ) : (
          sessions.map((session) => {
            const isActive = session.id === currentSessionId
            const isHovered = session.id === hoveredId
            const dotColor = getDotColor(session)
            const status = getStatusInfo(session)
            const domain = extractDomain(session.target_url)
            return (
              <div
                key={session.id}
                className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                onClick={() => onSelect(session.id)}
                onMouseEnter={() => setHoveredId(session.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div
                  className={`${styles.statusDot} ${session.status === 'running' ? styles.statusDotRunning : ''}`}
                  style={{ background: dotColor, color: dotColor }}
                />
                <div className={styles.sessionInfo}>
                  <div className={styles.sessionName}>{session.name}</div>
                  <div className={styles.sessionMeta}>
                    <span style={{ color: status.color }}>{status.symbol} {t(status.labelKey as any)}</span>
                    {isActive && activeRequestCount > 0 && (
                      <span className={styles.sessionCount}> · {activeRequestCount} reqs</span>
                    )}
                  </div>
                  {domain && <div className={styles.sessionUrl}>{domain}</div>}
                </div>

                {isHovered && (
                  <span
                    className={`${styles.deleteBtn} ${deletingId === session.id ? styles.deleteBtnDisabled : ''}`}
                    onClick={(e) => handleDelete(e, session.id)}
                  >
                    <IconDelete size={13} />
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* New session button */}
      <div className={styles.footer}>
        <div className={styles.newBtn} onClick={openModal}>
          + {t('session.newSession').replace('+ ', '')}
        </div>
      </div>

      {/* Bottom: Settings + Version */}
      <div className={styles.sidebarBottom}>
        <div className={styles.bottomBtn} onClick={onOpenSettings}>⚙ {t('settings.title')}</div>
        <div className={styles.versionText}>v3.2.0</div>
      </div>

      {/* Create session modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={t('session.createTitle')}
        footer={
          <>
            <Button onClick={closeModal}>{t('session.cancel')}</Button>
            <Button variant="primary" onClick={handleCreate} loading={creating}>
              {t('session.create')}
            </Button>
          </>
        }
      >
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>{t('session.name')}</label>
          <Input
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder={t('session.namePlaceholder')}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          {nameError && <div className={styles.formError}>{nameError}</div>}
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>{t('session.targetUrl')}</label>
          <Input
            value={formUrl}
            onChange={(e) => setFormUrl(e.target.value)}
            placeholder={t('session.targetUrlPlaceholder')}
          />
          <div className={styles.formHint}>Leave empty to capture traffic via proxy only</div>
          {urlError && <div className={styles.formError}>{urlError}</div>}
        </div>
      </Modal>
    </div>
  )
}

export default SessionList
