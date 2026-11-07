# Mini App UI audit

## Baseline findings

Baseline evidence was the supplied production screenshots plus a source review of the Mini App. The supplied screenshots showed page content extending behind translucent controls and student-form actions being obscured by the bottom navigation. A Playwright screenshot of the authenticated production baseline was not available before implementation; the screenshot suite below captures the updated local build and guards the reported layout failures.

| Area | Finding before changes | Change |
|---|---|---|
| Navigation | One 8-item grid was shared across roles; it was not a persistent bottom bar and exposed unrelated sections together. | Replaced with role-specific bars containing at most five tabs and a separate “Ko‘proq” menu. |
| App bar | The header showed the product and role, but not the current page title or notifications. | Added a sticky page-title app bar, unread badge, refresh, and role-aware More menu. |
| Overlap / contrast | Panels and navigation mixed the card color with transparency; supplied screenshots showed content visible through stacked controls. | Panels and menus now use opaque Telegram theme colors and explicit borders/shadows. |
| Small screens | Long screens shared the document scroll with a fixed tab bar, so form controls could continue behind it. | The page content now scrolls in its own viewport ending above the fixed five-tab bar, with safe-area spacing, horizontal clipping guards, and a 44px minimum for visible controls. |
| Keyboard | Focus did not scroll form fields into view and the tab bar remained visible while typing. | Focused fields scroll into view; the bottom bar hides while an input is focused; the viewport requests resize behavior. Physical Telegram keyboard behavior still needs device verification. |
| Back / primary actions | Telegram BackButton always returned to the dashboard. MainButton supported only selected forms and could show a submission label for other forms. | Back navigation now follows the in-app page history (detail falls back to tasks); MainButton is connected to homework, question, attendance, student, group, and teacher forms with context-specific labels and progress state. Destructive Telegram unlink, staff deactivation, teacher removal, and group removal now use the reusable confirmation dialog. |
| Missing role screens | Students had no weekly schedule view; teacher group information was only embedded on the home screen; owner staff had no dedicated summary; profile was absent. | Added student weekly schedule/next-lesson views, teacher and reception group screens, owner staff screen, and profile/settings screens. Student schedule data is returned by the existing authenticated overview endpoint. |
| Long lists | Student search existed but no paging; payment lists had neither search nor paging. | Added student/payment search and 20-row paging. |
| Loading / empty / errors | Several empty states were plain text and loading was a single status line. | Added loading skeletons, reusable empty/error/toast states, and a retry action. |
| Language / dates | Homework statuses and proof instructions mixed Uzbek with “Draft”, “Proof”, and “golos”; deadline dates used a long month format. | Replaced visible mixed-language homework copy with Uzbek Latin text and standardized dates to `dd.MM.yyyy` in `Asia/Tashkent`. |

## Screens covered

The Playwright visual matrix captures each role's tabs and “Ko‘proq” routes at 360×640, 390×844, and 430×932 in both light and dark Telegram theme parameters. It also captures student/teacher homework details and the student-login, reception-student, and teacher-homework form states.

| Role | Main tabs | Additional routes / states |
|---|---|---|
| Student | Bosh sahifa, Vazifalar, Jadval, Savol, Profil | Vazifa tafsilotlari, To‘lovlar, Sozlamalar, login |
| Teacher | Bosh sahifa, Guruhlar, Vazifalar, Davomat, Profil | Vazifa tafsilotlari, Vazifa yaratish, Savollar |
| Reception | Bosh sahifa, O‘quvchilar, Guruhlar, To‘lovlar, Savollar | O‘quvchi qo‘shish, Uy vazifalari, Davomat, Profil |
| Owner | Bosh sahifa, O‘quvchilar, Guruhlar, Xodimlar, Moliya | Savollar, To‘lovlar, Davomat, Hisobotlar, Sozlamalar, Uy vazifalari |

Generated screenshots and traces are local Playwright artifacts under `test-results/miniapp/` (ignored by Git). The tests check horizontal overflow and enforce 44px minimum dimensions on visible buttons and form controls for every captured screen.

The fixed navigation overlap found during screenshot review was corrected by constraining scrolling to the content viewport above the tab bar. A Playwright flow also verifies that unlinking a student's Telegram account requires confirmation and that cancellation makes no change.

## Remaining verification

- Playwright uses mocked Telegram WebApp and Worker responses; it verifies UI behavior, not production data or permissions.
- Test coverage includes reception student creation/login visibility, teacher homework creation, student credential sign-in/homework, and owner finance summary at all three viewports.
- A real Telegram Mini App must still be checked on iOS and Android for the native keyboard, safe-area insets, Telegram BackButton/MainButton rendering, haptics, and actual account data.
- The Mini App is served as a separate entry and currently builds to about 19.3 kB gzip. Its pages are conditional views in `MainApp.jsx`, not independently lazy-loaded route chunks; route-level code splitting remains a follow-up if the bundle grows.
- Loading/error states are component- and API-path dependent; network failure/recovery and every optional media permission flow are not exhaustively exercised by the visual matrix.
