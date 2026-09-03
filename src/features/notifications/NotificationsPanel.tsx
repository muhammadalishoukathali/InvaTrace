/** The bell button and panel in the header. Clicking a notification marks it
 *  read and, if the server sent a linkTo, navigates there too. Desktop shows
 *  a dropdown, mobile gets a bottom sheet over the page instead - didn't want
 *  a dropdown getting cut off or feeling cramped on a small screen. */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useNotifications, useMarkNotificationRead } from './useNotifications'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import type { AppNotification, NotificationKind } from '@/types'
import './notifications.css'

const KIND_ICON: Record<NotificationKind, string> = {
  report_screened: 'CircleCheck',
  report_rejected: 'AlertTriangle',
  report_needs_rescan: 'ScanLine',
  report_merged: 'GitMerge',
  validation_unavailable: 'WifiOff',
  sync_ok: 'CircleCheck',
  system: 'Bell',
}
const KIND_TINT: Record<NotificationKind, string> = {
  report_screened: 'var(--green)',
  report_rejected: 'var(--red)',
  report_needs_rescan: 'var(--amber-text)',
  report_merged: 'var(--green)',
  validation_unavailable: 'var(--muted)',
  sync_ok: 'var(--body)',
  system: 'var(--muted)',
}

/**
 * Bell icon plus its dropdown/sheet, shows up in the header on every screen.
 * Pulls the actual notification data from useNotifications.ts. Clicking an
 * item marks it read and, if the server gave it a linkTo, jumps there - could
 * be straight to a screened report or the relevant sighting on the map.
 */
export function NotificationsPanel() {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const location = useLocation()
  const { data } = useNotifications()
  const { markOne, markAll } = useMarkNotificationRead()

  const unread = data?.unread ?? 0
  const items = data?.items ?? []

  useEffect(() => {
    // this listener is only for desktop - clicking outside closes the dropdown.
    // mobile doesn't need it since the sheet backdrop already handles that
    if (!open || !isDesktop) return
    const onDown = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, isDesktop])

  const openItem = (n: AppNotification) => {
    if (!n.read) void markOne(n.id)
    if (n.linkTo) {
      // had to special-case absolute URLs here - if I just passed them to
      // navigate(), React Router treats them as a relative path and you end
      // up with something broken like "/foo/https:/…"
      if (/^https?:\/\//i.test(n.linkTo)) {
        window.open(n.linkTo, '_blank', 'noopener,noreferrer')
      } else {
        const alreadyHere = location.pathname + location.search === n.linkTo
          || location.pathname === n.linkTo
        navigate(n.linkTo, alreadyHere ? { replace: true } : undefined)
      }
    }
    setOpen(false)
  }

  return (
    <div ref={wrapper} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="notifications-panel"
        onClick={() => setOpen((v) => !v)}
        className="app-header__action"
        style={{
          position: 'relative',
        }}
      >
        <Icon name="Bell" size={18} color="var(--body)" />
        {unread > 0 && (
          <span aria-hidden style={{
            position: 'absolute', top: 6, right: 6,
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--red)', border: '1.5px solid var(--surface)',
          }} />
        )}
      </button>

      {open && isDesktop && (
        <PanelBody
          items={items} unread={unread}
          onItem={openItem} onMarkAll={() => void markAll()}
          onClose={() => setOpen(false)}
          layout="dropdown"
        />
      )}
      {open && !isDesktop && createPortal(
        <>
          <div onClick={() => setOpen(false)} aria-hidden className="app-sheet-backdrop" />
          <PanelBody
            items={items} unread={unread}
            onItem={openItem} onMarkAll={() => void markAll()}
            onClose={() => setOpen(false)}
            layout="sheet"
          />
        </>,
        document.body,
      )}
    </div>
  )
}

/** Pulled the list itself out into its own component so the desktop dropdown
 *  and mobile sheet can share it - only had to write the list styling once. */
function PanelBody({
  items, unread, onItem, onMarkAll, onClose, layout,
}: {
  items: AppNotification[]
  unread: number
  onItem: (n: AppNotification) => void
  onMarkAll: () => void
  onClose: () => void
  layout: 'dropdown' | 'sheet'
}) {
  const isSheet = layout === 'sheet'
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogA11y(panelRef, onClose)

  return (
    <div ref={panelRef} id="notifications-panel" tabIndex={-1}
      role="dialog" aria-label="Notifications" aria-modal={isSheet ? 'true' : undefined}
      className={`notifications-panel notifications-panel--${layout}${isSheet ? ' app-sheet' : ''}`}>
      {isSheet && (
        <div className="app-sheet__handle" aria-hidden />
      )}
      <header className={isSheet ? 'app-sheet__header' : 'notifications-panel__header'}>
        <div className={isSheet ? 'app-sheet__heading' : undefined}>
          <h2 tabIndex={-1} data-dialog-initial
            className={isSheet ? 'app-sheet__title' : 'notifications-panel__title'}>
            Notifications
          </h2>
          <p className={isSheet ? 'app-sheet__subtitle' : 'notifications-panel__subtitle'}>
            {unread === 0 ? 'Everything has been read' : `${unread} unread update${unread === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className={isSheet ? 'app-sheet__header-actions' : 'notifications-panel__actions'}>
          {unread > 0 && (
            <button type="button" onClick={onMarkAll} className="notifications-panel__mark-all">
              Mark all read
            </button>
          )}
          {isSheet && (
            <button type="button" onClick={onClose} aria-label="Close notifications" className="app-sheet__close">
              <Icon name="X" size={18} color="var(--body)" />
            </button>
          )}
        </div>
      </header>

      <ul className="notification-list">
        {items.length === 0 && (
          <li className="notification-list__empty">
            <span className="notification-list__empty-icon" aria-hidden>
              <Icon name="Bell" size={24} color="currentColor" />
            </span>
            <strong>No updates yet</strong>
            <p>Report screening and sync updates will appear here.</p>
          </li>
        )}
        {items.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => onItem(n)}
              className={`notification-item${n.read ? '' : ' notification-item--unread'}`}>
              <span className="notification-item__icon" aria-hidden>
                <Icon name={KIND_ICON[n.kind]} size={18} color={KIND_TINT[n.kind]} />
              </span>
              <div className="notification-item__content">
                <div className="notification-item__title">{n.title}</div>
                <div className="notification-item__body">{n.body}</div>
                <time className="notification-item__time" dateTime={n.createdAt}>
                  {formatAgo(n.createdAt)}
                </time>
              </div>
              {!n.read && (
                <span aria-hidden className="notification-item__unread" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}
