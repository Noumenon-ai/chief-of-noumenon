# Design contract: Control Room

Mode: new identity. Approved by the owner on 2026-11-03, who chose direction C of three. References: `reference/direction-c-desktop.png`, `reference/direction-c-phone.png` (prototype captures, not the product) and `reference/direction-c-prototype.html`, which holds the exact measurements. Build this direction faithfully.

## Idea
A white room where you run a team. White as the default was the owner's request on 2026-11-04; the approved layout stays intact. Bot identity colours, working rings and waiting lights report real state. Owner change, 2026-11-04: bots stay on the left and chat gets the space when no live computer is needed. The current bot's running computer opens on the right; the person's saved choice for that bot wins. Anything waiting on the person uses one signal colour that is used for nothing else, so a glance answers "what needs me".

## Layout
- Owner change, 2026-11-04: desktop over 1100 px uses two columns when the computer is closed: a 164 px bot rail and chat filling the rest, with centred messages and composer at a comfortable reading width. When open, keep the existing third computer column (about 518 px at 1440).
- Owner change, 2026-11-04: at 721 to 1100 px keep the 112 px rail and 300 px open computer panel; overlay the panel when three columns would leave chat under 340 px. Closing the panel gives chat the remaining width without moving the rail.
- Up to 720 px: brand bar 49 px, horizontal bot row with status lights, chat fills, composer fixed at the bottom. The computer collapses to a thumbnail that opens full screen. Waiting cards stay inside the chat. No horizontal page scroll at any width. Honour safe-area insets.
- Every other page, such as Settings, Apps, Tasks, Onboarding and Login, uses the same brand bar, tokens and type. Those pages keep their structure.

## Tokens
Light is the default, as requested by the owner on 2026-11-04. Stored theme choices are respected; dark stays selectable with its original tokens. The light tokens are `--bg-app` and `--bg-surface` #ffffff, `--bg-raised` and `--bg-inset` #f6f4fb, `--bg-hover` #efebf8, `--line` #e2deea, `--ink` #1d1828, `--ink-muted` #575064, `--ink-faint` #655d72, `--accent` and `--focus` #5b3fd6, `--accent-fg` #ffffff, `--bubble-user` #ebe6ff, and `--code-bg` #f6f4fb. Signal tokens remain exclusive to waiting items. Vivid bot colours carry white initials at 4.5:1 or better. The following dark values are retained. Replace the values in `frontend/app/globals.css`, keeping token names, and copy them to the phone app where the drift test requires.
- `--bg-app` #17151c, `--bg-surface` #211e27, `--bg-raised` #302a38, `--bg-inset` #17151c, `--bg-hover` #3c3545, `--line` #49434f.
- `--ink` #f0edf5, `--ink-muted` #bfb7c8, `--ink-faint` must pass 4.5:1 on all surfaces; start from #aaa3b5.
- Signal: `--signal` #ffd45c, on-signal text #17151c, waiting ground `--signal-bg` #2f291c, signal border #ffd45c. Signal is only for waiting items and their lights.
- `--accent` is not signal. Use #d5cedc on dark with `--accent-fg` #17151c. `--bubble-user` #494053.
- Success, danger and focus must pass the contrast check and stay visually separate from signal. Focus is a 2 px visible ring on everything.
- Both themes pass `npm run check:contrast`; light uses a dark amber signal.
- Type: body and Hebrew IBM Plex Sans Hebrew 400 and 600. Receipts, status and small labels IBM Plex Mono 400 and 500. Self-host from `frontend/public/fonts`. No request to Google Fonts. Body 14 px, chat 15 px, phone chat 16 px, card title 24 px at weight 600.
- Radius: fields 8 px, cards 12 px, bubbles 16 px, avatars 10 px. No gradients, no glass.

## Components
- Bot channel: square rounded avatar, name, engine or model, last-message preview, and a status light: signal when waiting, muted when idle, plain pulse when working. Selected channel uses a 10 percent bot-colour tint and a 3 px start-edge bar; hover uses a 5 percent tint. Desktop rail avatars are 40 px. Add bot is always visible; selected bots expose Edit bot and Delete bot beside their chats, with both actions also in the chat header menu. A bot may show several chats, opened from the rail.
- Bubbles: person on the end side, bot on the start side. Text direction per message follows its content, so Hebrew is right to left within an English layout, and the whole layout mirrors for a Hebrew interface.
- Receipt: one compact mono line with a check, for tool work. Expanding shows detail. Failed receipts say so in danger colour.
- Approval card: the visual centre. Signal ground and border, eyebrow "Waiting for you", plain title such as "Chief wants to create a GitHub issue", labelled details, equal Deny and Allow buttons at least 44 px high, with Allow solid signal. After an answer it collapses to a receipt line stating the outcome.
- Hand-off card: reason, thumbnail, Take over, Continue, Cancel.
- Computer zone (owner change, 2026-11-04): above 720 px, running computers open automatically; stopped or absent computers close automatically. A person's open or closed choice wins for that bot and is remembered in guarded browser storage. A labelled, translated Computer button with a monitor icon in the chat header opens the existing panel and reports its expanded state; its close control stays visible. With no computer, show the existing setup offer only when opened. Keep the live view, Take control, hand-off and approval thumbnails, and Take over opening the panel. Keep existing Docker/image setup messages and actions. Phones retain the thumbnail and full-screen panel. Other chats' actual waiting items appear as compact signal-coloured links above the conversation, naming bot and chat, independent of the panel; no empty or checking copy, only a quiet line if a check fails. The strip scrolls horizontally within its own bounds so it cannot displace the composer or approval actions.
- Composer: text field, attach, `@app`, microphone. The microphone records in the browser and sends through the shared local transcription service. Where the browser cannot record, such as a page not served securely, it explains that instead of failing silently.
- A `Telegram` label on Telegram-origin chats.

## States
Every view has designed empty, loading, error and success states in the product's own plain words: no bots yet, nothing waiting, engine not ready, connector down, computer stopped, turn failed. A loading placeholder is removed once content arrives. Include a real 404 and real page metadata and a social image.

## Accessibility and motion
Contrast 4.5:1 for text, real buttons, keyboard reachable everything, visible focus, touch targets at least 44 px on a phone, `prefers-reduced-motion` respected. Working bots have a gently pulsing identity-colour ring; waiting lights are larger and pulse in signal colour. Idle dots are quiet. Existing turn state drives the chat working indicator. Messages and approval cards rise and fade over 200 ms; channel hover and small button press feedback take 120 ms. Animations use opacity and transforms without layout shift, and all animation, transition and press motion stops under `prefers-reduced-motion`. Empty chats greet by local time and bot name, with three translated starters that fill the composer without sending. The no-computer offer has a small inline screen drawing in the bot colour and a solid accent setup action.

## Owner audit corrections, 2026-11-04

Maintain the white room, bot colours and existing layout. The desktop brand bar
is 48 px and contains the linked product name. Idle bots have no status dot.
The selected bot's chat count and quiet Edit/Delete actions share one row;
Delete uses danger colour on hover or keyboard focus. The phone Add button
keeps a compact, stable width. Dialogs initially focus their container.

Settings navigation wraps on phones. Your day and Advanced are separate pages.
App choices sit above the composer without covering the microphone. Usage tables
scroll within their own container on narrow screens. Known approval fields use
plain labels and file paths are shortened, with the full path available on hover.

## Owner extension: plain setup and conversation cards (2026-11-04)

Keep the approved identity, spacing, type and palette. Question cards have two
to five plain-text rows labelled A through E, “or answer below”, and collapse to
one answer line. They use ordinary surface/border tokens; approval cards retain
their own signal treatment and authority. Connect cards show a catalog app name,
one truthful sentence, Connect, and “Bots read freely and ask before changing
anything.” Credentials belong in the existing separate form. Connected cards
present Read only by default and an explicit Save access and continue action.
Errors use plain text and Retry. Controls work by keyboard and touch.

The first greeting is application copy from the lead bot (or the first helper
when the person has not chosen a lead) with three real examples
(plan a day, summarize a PDF, draft a reply), followed by Connect Gmail, Set up a
daily brief, and Just chat, plus Dismiss. It is claimed once per owner and excluded
for installs with existing chats. A brief card offers Every morning at 8 and Not
now. Offering does not enable a routine. Missing app connections get their own
cards after activation.

Apps uses letter tiles in the identity palette, a connected-count filter,
category chips, section headings and concise rows. Phone search stays at the
bottom with content clearance. No borrowed logos. Google setup uses six steps,
fixed external destinations, exact copyable callbacks, two labelled fields,
format checks, and plain error guidance. English and Hebrew layouts at 1440 and
390 px must have no horizontal page scroll. Phone Settings is a single list
reached from the chat header, preserving existing routes and real destinations.
Small links and Back to chat have 44 px touch targets. Toasts stay above the
composer. Import describes bot setup imports; it is not labelled memory import.
