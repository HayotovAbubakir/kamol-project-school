import {
  Banknote,
  Bell,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  GraduationCap,
  HardHat,
  Home,
  KeyRound,
  Lock,
  LogOut,
  Menu,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  UserCog,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { useNotifications } from '../context/NotificationContext'
import LiveBackground from './atmosphere/LiveBackground'
import GlassPane from './GlassPane'
import NotificationToasts from './NotificationToasts'

const SIDEBAR_KEY = 'kamol-sidebar-collapsed'

function buildNav(base, { ownerAccount = false } = {}) {
  return [
    {
      items: [{ to: base, labelKey: 'nav.home', end: true, icon: Home }],
    },
    {
      labelKey: 'nav.education',
      items: [
        { to: `${base}/groups`, labelKey: 'nav.groups', icon: Users },
        { to: `${base}/teachers`, labelKey: 'nav.teachers', icon: HardHat },
        { to: `${base}/students`, labelKey: 'nav.students', icon: GraduationCap },
        { to: `${base}/schedule`, labelKey: 'nav.schedule', icon: CalendarDays },
      ],
    },
    {
      labelKey: 'nav.finance',
      items: [
        { to: `${base}/finance`, labelKey: 'nav.financeSummary', icon: ChartColumn, end: true },
        { to: `${base}/finance/paid`, labelKey: 'nav.paid', icon: Banknote },
        { to: `${base}/finance/debtors`, labelKey: 'nav.debtors', icon: UserRound },
      ],
    },
    {
      labelKey: 'nav.system',
      items: [
        { to: `${base}/notifications`, labelKey: 'nav.notifications', icon: Bell },
        { to: `${base}/settings/fon`, labelKey: 'nav.appearance', icon: Palette },
        ...(ownerAccount
          ? [{ to: `${base}/settings/account`, labelKey: 'nav.account', icon: Lock }]
          : []),
        { to: `${base}/settings/staff`, labelKey: 'nav.staff', icon: UserCog },
        { to: `${base}/settings/roles`, labelKey: 'nav.roles', icon: KeyRound },
      ],
    },
  ]
}

const NAV = {
  owner: buildNav('/owner', { ownerAccount: true }),
  admin: buildNav('/admin'),
  teacher: [
    {
      items: [
        { to: '/teacher', labelKey: 'nav.home', end: true, icon: Home },
        { to: '/teacher/groups', labelKey: 'nav.myGroups', icon: Users },
        { to: '/teacher/attendance', labelKey: 'nav.attendance', icon: ClipboardCheck },
        { to: '/teacher/schedule', labelKey: 'nav.schedule', icon: CalendarDays },
        { to: '/teacher/settings/fon', labelKey: 'nav.appearance', icon: Palette },
      ],
    },
  ],
}

/** Mobil pastki tablar (YouTube uslubi) — asosiy sahifalar */
const BOTTOM_NAV = {
  teacher: [
    { to: '/teacher', labelKey: 'nav.home', end: true, icon: Home },
    { to: '/teacher/groups', labelKey: 'nav.myGroups', icon: Users },
    { to: '/teacher/attendance', labelKey: 'nav.attendance', icon: ClipboardCheck },
    { to: '/teacher/schedule', labelKey: 'nav.schedule', icon: CalendarDays },
  ],
  owner: [
    { to: '/owner', labelKey: 'nav.home', end: true, icon: Home },
    { to: '/owner/groups', labelKey: 'nav.groups', icon: Users },
    { to: '/owner/students', labelKey: 'nav.students', icon: GraduationCap },
    { to: '/owner/finance', labelKey: 'nav.financeSummary', icon: ChartColumn },
    { to: '/owner/notifications', labelKey: 'nav.notifications', icon: Bell },
  ],
  admin: [
    { to: '/admin', labelKey: 'nav.home', end: true, icon: Home },
    { to: '/admin/groups', labelKey: 'nav.groups', icon: Users },
    { to: '/admin/students', labelKey: 'nav.students', icon: GraduationCap },
    { to: '/admin/finance', labelKey: 'nav.financeSummary', icon: ChartColumn },
    { to: '/admin/notifications', labelKey: 'nav.notifications', icon: Bell },
  ],
}

const PAGE_TITLES = [
  { match: /\/settings\/account/, titleKey: 'nav.account' },
  { match: /\/settings\/fon/, titleKey: 'nav.appearance' },
  { match: /\/settings\/staff/, titleKey: 'nav.staff' },
  { match: /\/settings\/roles/, titleKey: 'nav.roles' },
  { match: /\/attendance\/absent-today/, titleKey: 'owner.absentToday.title' },
  { match: /\/teacher\/attendance/, titleKey: 'nav.attendance' },
  { match: /\/teacher\/groups/, titleKey: 'nav.myGroups' },
  { match: /\/finance\/debtors/, titleKey: 'nav.debtors' },
  { match: /\/finance\/paid/, titleKey: 'nav.paid' },
  { match: /\/finance$/, titleKey: 'nav.financeSummary' },
  { match: /\/groups/, titleKey: 'nav.groups' },
  { match: /\/teachers/, titleKey: 'nav.teachers' },
  { match: /\/students/, titleKey: 'nav.students' },
  { match: /\/schedule/, titleKey: 'nav.schedule' },
  { match: /\/notifications/, titleKey: 'nav.notifications' },
]

function resolvePageTitle(pathname) {
  return PAGE_TITLES.find((p) => p.match.test(pathname))?.titleKey || 'nav.home'
}

function NavIcon({ icon: Icon, size = 18 }) {
  if (!Icon) return null
  return <Icon className="nav-icon" size={size} strokeWidth={2} aria-hidden />
}

function isBottomNavActive(pathname, item) {
  if (item.end) {
    return pathname === item.to || pathname === `${item.to}/`
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

export default function AppShell({ role }) {
  const { user, logout } = useAuth()
  const { t } = useLanguage()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const links = NAV[role] || []
  const bottomLinks = BOTTOM_NAV[role] || []
  const pageTitle = t(resolvePageTitle(pathname))
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed)
  const [topbarHidden, setTopbarHidden] = useState(false)
  const contentRef = useRef(null)
  const lastScrollY = useRef(0)
  const scrollDirection = useRef(null)
  const scrollDistance = useRef(0)
  const topbarHiddenRef = useRef(false)
  const lockUntil = useRef(0)
  const scrollFrame = useRef(0)

  const setHidden = (hidden) => {
    if (topbarHiddenRef.current === hidden) return
    topbarHiddenRef.current = hidden
    setTopbarHidden(hidden)
    lockUntil.current = performance.now() + 340
  }

  const isDesktop = () => window.matchMedia('(min-width: 1025px)').matches

  const toggleNav = () => {
    if (isDesktop()) {
      setSidebarCollapsed((prev) => {
        const next = !prev
        try {
          localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0')
        } catch {
          /* ignore */
        }
        return next
      })
      return
    }
    setMobileNavOpen((v) => !v)
  }

  const closeMobileNav = () => setMobileNavOpen(false)

  useEffect(() => {
    const root = document.documentElement
    if (mobileNavOpen) {
      root.classList.add('nav-drawer-open')
    } else {
      root.classList.remove('nav-drawer-open')
    }
    return () => {
      root.classList.remove('nav-drawer-open')
    }
  }, [mobileNavOpen])

  useEffect(() => {
    const isTypingTarget = (el) => {
      if (!el || !(el instanceof HTMLElement)) return false
      if (el.isContentEditable) return true
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      return Boolean(el.closest('input, textarea, select, [contenteditable="true"]'))
    }

    const homePath = `/${role}`

    const onKeyDown = (e) => {
      if (e.repeat) return

      if (e.key === 'Escape') {
        // Modal o‘zi Esc ni ushlaydi
        if (document.querySelector('.modal-backdrop')) return
        e.preventDefault()
        setMobileNavOpen(false)
        const atHome = pathname === homePath || pathname === `${homePath}/`
        if (!atHome) navigate(homePath)
        return
      }

      if (e.key !== 'Tab' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
      if (isTypingTarget(document.activeElement)) return
      e.preventDefault()
      if (window.matchMedia('(min-width: 1025px)').matches) {
        setSidebarCollapsed((prev) => {
          const next = !prev
          try {
            localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0')
          } catch {
            /* ignore */
          }
          return next
        })
      } else {
        setMobileNavOpen((v) => !v)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, pathname, role])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setMobileNavOpen(false)
      topbarHiddenRef.current = false
      setTopbarHidden(false)
      lastScrollY.current = 0
      scrollDirection.current = null
      scrollDistance.current = 0
      lockUntil.current = 0
      if (contentRef.current) contentRef.current.scrollTop = 0
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1025px)')
    const handler = (e) => {
      if (e.matches) setMobileNavOpen(false)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return undefined

    // Topbar yig‘ilganda ~100px joy ochiladi; shu qadar scroll qolmasa — yashirish trap
    const TOPBAR_SPACE = 120
    const remainingScroll = () => Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop)
    const canHideWithoutTrap = () => el.scrollHeight - el.clientHeight > TOPBAR_SPACE
    const isTrapped = () => topbarHiddenRef.current && el.scrollHeight <= el.clientHeight + 4

    const restoreIfTrapped = () => {
      if (!topbarHiddenRef.current) return
      if (isTrapped() || el.scrollTop <= 12) setHidden(false)
    }

    const onScroll = () => {
      if (scrollFrame.current) return
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = 0
        const y = el.scrollTop
        const now = performance.now()

        if (now < lockUntil.current) {
          lastScrollY.current = y
          restoreIfTrapped()
          return
        }

        const delta = y - lastScrollY.current
        lastScrollY.current = y

        if (y <= 12) {
          scrollDirection.current = null
          scrollDistance.current = 0
          setHidden(false)
          return
        }

        if (Math.abs(delta) < 1.5) {
          restoreIfTrapped()
          return
        }

        const direction = delta > 0 ? 'down' : 'up'
        if (scrollDirection.current === direction) {
          scrollDistance.current += Math.abs(delta)
        } else {
          scrollDirection.current = direction
          scrollDistance.current = Math.abs(delta)
        }

        if (direction === 'down' && y > 40 && scrollDistance.current >= 20) {
          scrollDistance.current = 0
          // Pastga scroll qoldig‘i kam bo‘lsa yoki yig‘ilgach scroll yo‘qolsa — yashirma
          if (canHideWithoutTrap() && remainingScroll() > 24) {
            setHidden(true)
            requestAnimationFrame(() => requestAnimationFrame(restoreIfTrapped))
          }
        } else if (direction === 'up' && scrollDistance.current >= 16) {
          scrollDistance.current = 0
          setHidden(false)
        }

        restoreIfTrapped()
      })
    }

    // Content sig‘ib qolganda scroll event chiqmaydi — wheel/touch bilan qaytarish
    const revealOnUpIntent = (deltaY) => {
      if (!topbarHiddenRef.current) return
      if (deltaY < -4) setHidden(false)
    }

    const onWheel = (e) => revealOnUpIntent(e.deltaY)

    let touchY = null
    const onTouchStart = (e) => {
      touchY = e.touches[0]?.clientY ?? null
    }
    const onTouchMove = (e) => {
      if (touchY == null) return
      const y = e.touches[0]?.clientY
      if (y == null) return
      revealOnUpIntent(touchY - y)
      touchY = y
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current)
    }
  }, [])

  const MenuToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose

  return (
    <div className={`app-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}${mobileNavOpen ? ' nav-drawer-open' : ''}`}>
      <LiveBackground />
      <div className="app-bg" aria-hidden>
        <div className="app-bg-noise" />
      </div>

      <div
        className={`sidebar-scrim${mobileNavOpen ? ' sidebar-scrim-visible' : ''}`}
        onClick={closeMobileNav}
        aria-hidden
      />

      <GlassPane
        className={`sidebar${mobileNavOpen ? ' sidebar-open' : ''}`}
        radius={24}
      >
        <div className="sidebar-mobile-head">
          <strong>{t('nav.menu')}</strong>
          <button type="button" className="sidebar-close-btn" onClick={closeMobileNav} aria-label={t('nav.close')}>
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar-nav">
          {links.map((group, index) => (
            <div key={group.labelKey || `nav-${index}`} className="nav-group">
              {group.labelKey ? <p className="nav-group-label">{t(group.labelKey)}</p> : null}
              {group.items.map((item) => {
                const showBadge = item.icon === Bell && unreadCount > 0
                return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={closeMobileNav}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  <span className="nav-link-icon-wrap">
                    <NavIcon icon={item.icon} />
                    {showBadge ? (
                      <span className="nav-notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                    ) : null}
                  </span>
                  <span>{t(item.labelKey)}</span>
                </NavLink>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="btn btn-sidebar-logout"
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
          >
            <LogOut size={16} />
            {t('nav.logout')}
          </button>
        </div>
      </GlassPane>

      <div className="main-area">
        <GlassPane className={`topbar${topbarHidden ? ' topbar-hidden' : ''}`} radius={20}>
          <div className="topbar-left">
            <button
              type="button"
              className="topbar-hamburger"
              onClick={toggleNav}
              aria-label={sidebarCollapsed ? t('nav.openMenu') : t('nav.closeMenu')}
              title={sidebarCollapsed ? t('nav.openMenu') : t('nav.closeMenu')}
            >
              <span className="topbar-hamburger-mobile">
                <Menu size={20} />
              </span>
              <span className="topbar-hamburger-desktop">
                <MenuToggleIcon size={20} />
              </span>
            </button>
            <div className="topbar-title">{pageTitle}</div>
          </div>
          <div className="topbar-actions">
            <div className="topbar-meta">
              <Users size={15} />
              <span>{user?.username || user?.name || ''}</span>
            </div>
          </div>
        </GlassPane>
        <main ref={contentRef} className="content-area page-shell">
          <Outlet />
        </main>
      </div>

      {bottomLinks.length > 0 && typeof document !== 'undefined'
        ? createPortal(
          <nav className="mobile-bottom-nav" aria-label={t('nav.menu')}>
            {bottomLinks.map((item) => {
              const active = isBottomNavActive(pathname, item)
              const showBadge = item.icon === Bell && unreadCount > 0
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={`mobile-bottom-nav-item${active ? ' active' : ''}`}
                  onClick={closeMobileNav}
                >
                  <span className="mobile-bottom-nav-icon">
                    <NavIcon icon={item.icon} size={28} />
                    {showBadge ? (
                      <span className="nav-notif-badge mobile-bottom-nav-badge">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    ) : null}
                  </span>
                  <span className="mobile-bottom-nav-label">{t(item.labelKey)}</span>
                </NavLink>
              )
            })}
          </nav>,
          document.body,
        )
        : null}

      <NotificationToasts />
    </div>
  )
}
