# vid2grid chat

A chat app for talking to a vision model about a video. Each release is served
at <https://ianheinrich.github.io/vid2grid/chat/>, and it runs from a clone
too. Either way it runs entirely in your browser: the page calls the model's
API directly, and the video itself never leaves your computer. Plain
TypeScript and Vite, no framework.

## What it does

- Talks to [Venice.ai](https://venice.ai) or to any OpenAI-compatible server.
  The base URL is a setting, so a local Ollama or LM Studio works too.
- Keeps many chats. Each has its own persona, model, temperature, reasoning
  effort, sheet resolution and round limit, and is saved in IndexedDB.
- Drag a video into a chat. It stays a playable video in a floating player.
  The app renders an overview of it with vid2grid and sends the sheets to the
  model.
- Gives the model three tools for the video, and a fourth when audio is on:
  - `look(start, end, frames, perSheet)` renders a time range at the density the
    model picks, up to 64 frames and 20 per sheet. Fewer frames per sheet means
    larger frames.
  - `frames(times)` renders up to 9 chosen moments on one sheet, so a single
    call and a single image can check several details.
  - `note(t, text)` adds a line to the chat's scene log, which the model sees
    again on every later turn.
  - `listen(start, end)` reads what is heard in a range, up to 10 minutes per
    call: speech in quotes and sound events, one line each. It is offered only
    on a message with the Audio toggle on.
- Drop still images into a message too. They are scaled down to the chat's
  resolution. An image can be pinned so it is always sent.

## Run, build, test

From the repo root:

```bash
npm ci
npm run dev:chat
npm run build
npm test --workspace apps/chat
```

`npm run dev:chat` serves the app on port 5174, because 5173 is the website's
dev server. `npm run build` type-checks every package and builds this app
along with the website. CI's `test` job builds both apps on every push and PR,
so a break shows up before a release.

## Releasing

The chat app has its own release key, the `version` in
[package.json](package.json). When a bump lands on `main`, CI tags the commit
`chat-vX.Y.Z`, creates a GitHub release and deploys the app to `/chat/` on the
same Pages site as the website. Version `0.0.0` never releases. Only the
maintainer bumps it.

A deploy replaces the whole site, so it builds each app from its own release:
the app releasing now from this commit, the other from its latest tag (`v*` for
the website, `chat-v*` for this app). Build the same site locally from the repo
root with:

```bash
bash scripts/buildPagesSite.sh <web-ref> <chat-ref> <out-dir>
```

A ref is a tag or commit, or `.` for the checkout as it stands, uncommitted
work included. An empty chat ref leaves `/chat/` out. For example,
`bash scripts/buildPagesSite.sh v1.2.0 . /tmp/vid2grid-site` puts the released
website at the root of `/tmp/vid2grid-site` and this checkout's chat app in its
`chat/` folder.

## Setup

Open Settings from the sidebar and fill in:

- **API key.** Stored in your browser's localStorage and sent only to the base
  URL. A local server that needs no key can leave it empty.
- **Base URL.** Venice.ai by default. Point it at any server that speaks the
  OpenAI chat completions API.
- **Default model** for new chats, plus an image limit to assume for models
  that do not report one, and a switch for showing the model's thinking.

A "Get started" checklist on the main screen walks through the key, a
connection test, a default model and a first video or image. You can hide it.

**Test connection** checks what is typed in the dialog before you save it. It
reports whether the server answered, how many models it lists and how many can
see images. On Venice it also says which kind of key you have. An admin key can
read the account balance, which then shows in the sidebar. An inference key
chats fine but cannot read the balance.

## Models

The model picker is used in Settings, in each chat and in the study dialog.

- Search by name, mark favourites with a star, filter by Private, Uncensored,
  Recommended, Reasoning, Audio and Beta, and sort by recommendation, price,
  context or name. Only private models show by default.
- Each model has a privacy badge: private, or anonymized.
- Hover or arrow to a model to see its details pane: description, tags, price
  per million tokens, context size, image limit, the Auto sheet resolution,
  reasoning effort, privacy and whether it takes audio. Arrow keys, Home, End
  and Enter work in the list.

## Chat settings

The Chat settings drawer in a chat's header has two tabs.

- **Instructions.** A system prompt where `{{char}}` and `{{user}}` stand for the
  character and user names set below it, with a preview of the filled-in
  prompt. The voice is Analyst (cites moments as timestamps), In character
  (never mentions tools or frames, few timestamps) or Narrator (third-person
  prose). Save a setup as a named persona, then reuse, update or delete it.
  Personas are kept in localStorage and shared by all chats.
- **Model.** The chat's model, temperature, reasoning effort, what happens to
  earlier images, sheet resolution and maximum rounds per reply.

## Knowledge

The Knowledge drawer, next to Chat settings in the header, shows what the model
knows. Only one of the two drawers is open at a time.

Under **This chat**:

- **Chat summary.** It stands in for older messages. The app writes it
  automatically when a request would use more than 60% of the model's context,
  keeping the newest four turns word for word. You can edit it, summarize now,
  or clear it. If a summary fails, the turn just goes out longer.
- **Scene log.** The model's notes about the current video. The log starts over
  when a new video is attached. Edit or delete any note, add your own (it
  starts at the player's current time), or Condense to have the model merge
  duplicates. The condensed log is shown as a preview first, and you accept or
  discard it. The tab shows an approximate token cost.

Under **Videos**, a picker lists every video the chat has had, newest first,
with the attached one marked current. It starts on the current video, and each
heading names the video shown.

- **Timeline.** The entries made by a study (see Deep analysis). Edit or delete
  entries. It also lists the audio analysed so far, with how much of the video
  that covers, and a button to zoom into unclear moments.
- **People.** Who appears in the video, kept per video. Add people by hand or
  Suggest from video, which asks the model for names, short descriptions and
  first-seen times from the overview and scene log. A suggestion never
  overwrites someone you already have.

For an older video, the timeline, audio and people saved for it are shown read
only, since that video is not attached. Studying, zooming, suggesting people
and seeking the player work on the current video.

## Messages

- Replies render a small Markdown subset: headings, quotes, lists, bold,
  italics, inline code, and quoted speech.
- A timestamp such as [1:42] in any message, note or receipt is a link. It
  opens the player at that moment.
- Each reply has an activity row above it. It reads like "Thought · 2 looks ·
  3 frames · 1 note" and expands to the thinking and each tool call with
  thumbnails and linked times. While the model works it shows what was sent
  and how long it has waited, and warns after 90 seconds.
- Text the model writes before calling tools stays in the reply, muted and
  labelled "Before looking", above the answer. Copy, the receipt and Check
  timestamps use the answer alone.
- Under each reply is a receipt: rounds, images sent, tokens in and out with the
  cached share, an estimated cost where the model has a price, and the time
  taken. If the reply cites a moment that no sheet in the chat shows, it adds
  "Cited 2:10 without looking" with a Check button.
- **Check timestamps** renders the cited moments on one sheet and has the chat's
  model mark each claim confirmed, contradicted or unclear, with a reason. It
  needs the video attached.
- **Replay** gets a new reply. The old one is kept, and arrows on the latest
  reply swipe between them. **Compare with another model** does the same with a
  model you pick, and the reply names the model that wrote it.
- **Edit** changes any message. Editing your latest message reruns the reply.
  **Branch** copies the chat up to that message into a new chat. **Delete**
  removes a reply or message with an Undo. **Copy** copies the text. A reply
  that stopped at its round limit offers **Keep going**.
- Stop a running reply with Esc or the Stop button.

## Video

- The video chip in the header opens the player. If the file is not loaded, for
  example after a restart, it offers to reattach it, from a stored copy or the
  remembered file where the browser allows it.
- The player floats over the chat. Drag its title bar to move it, drag the
  corner handle or use the arrow keys to resize it, and Dock it above the
  conversation. Controls: frame step back and forward, speed from 0.25 to 2
  times, and a loop set with In and Out. Clicking a timestamp while the player
  is open offers a loop of two seconds either side. Its position is
  remembered. Frame step moves between the video's real frames, using each
  frame's own presentation time.
- The **coverage strip** under the video shows which parts the model has seen.
  Darker means more frames per second, and the strip shows a playhead. Click
  to jump.
- Click any image to open the **lightbox**. Arrows move between images, the
  wheel, +, - and double click zoom, and a pin button keeps an image always
  sent. On a sheet, click a frame to jump the video to that cell. **Ask about
  this** puts that moment into the message box as "About [1:42]:".

## Deep analysis

- **Thoroughness** is a menu in the message box: Normal, Thorough or
  Exhaustive. Normal uses the chat's Max rounds (8 by default). Thorough allows
  up to 15 rounds and stops once the model is confident. Exhaustive allows up
  to 30 and is told to investigate thoroughly and keep notes, so it is the most
  costly. The choice sticks to the chat: it stays after you send, each chat
  keeps its own, and a new chat starts at Normal. **Keep going** picks up from
  the notes when a reply runs out of rounds.
- **Reasoning**, next to it, shows for models that support a reasoning effort.
  A level picked here is the chat's reasoning effort, the same setting as the
  Model tab, so the two always agree, and it sticks to the chat and shows on
  each message sent with it. Default clears it, so the model's own default
  applies, or the level the Thorough or Exhaustive choice maps to, and the
  entry names the level it stands for.
- **Answer now** appears beside Stop while the model is thinking. It cuts the
  thinking short and has the model answer from what it has seen so far; the
  reply then says that its thinking was cut short.
- **Study video** has the model watch the whole video, or a range, in windows
  and write a timestamped timeline. The dialog sets the window length (20 to
  120 s), density, range and model, and shows an estimate of requests, tokens,
  cost and time before you start. A progress card shows the window being
  studied, the spend so far and Pause or Stop. A stopped study can resume, and
  a finished one can be redone or cleared from the menu next to the button.
  The timeline is kept per video and is sent to the model with every reply.
- A study flags the moments it found unclear. **Zoom into unclear moments**,
  from the study menu or the Timeline tab, then has the model re-examine just
  those moments at a higher density and update their entries. It runs only when
  you ask.
- **Audio** is a toggle in the message box and an "Include audio" checkbox in
  the study dialog. The audio is analysed on your computer, in pieces of five
  minutes, and the result is stored per video, so a stretch is analysed once.
  Speech is transcribed and a sound classifier labels other sounds, so only
  the resulting text goes to the API. The sounds to listen for are an editable
  list under Audio labels in Settings, one label per line. A line is either a
  name, such as `applause`, or a name followed by several wordings for the same
  sound, such as `crowd: applause; people clapping; cheering`. The sound model
  compares the audio with every wording, and a match is reported under the
  name, so near-synonyms add up instead of splitting the vote. A short wording
  of one or two words is put in a sentence for the model; a longer one is used
  as you typed it, so a descriptive phrase works too. Speech is transcribed in
  five second pieces, and a piece that is only a tag such as `(laughter)` is
  listed as a sound.

## Storage and export

- With "Keep a copy of attached videos in this browser" on, the video is saved
  in the browser's private file storage so it opens again after a restart. It
  asks first above a size you set (4 GB by default). Settings lists the
  stored copies with usage and quota, and each can be removed.
- Download a chat as Markdown from the sidebar: the title, model, video,
  prompt, every turn and the scene log.
- Backup in Settings saves all chats, messages and timelines to one JSON file,
  with or without images, and Restore reads it back.
- The sidebar groups chats by recent activity, and the search box matches chat
  titles and video names. Rename or delete a chat from its row. A deleted chat
  can be undone for a short time.

## Keyboard shortcuts

Press the `?` button in the sidebar for the list.

| Keys             | Does                                                    |
| ---------------- | ------------------------------------------------------- |
| `Enter`          | Send. `Shift` `Enter` adds a new line.                  |
| `Esc`            | Stop the running reply.                                 |
| `Up`             | Edit your last message, from an empty message box.      |
| `Ctrl` `Alt` `N` | New chat.                                               |
| `Ctrl` `,`       | Open Chat settings.                                     |
| `Ctrl` `Alt` `K` | Open Knowledge.                                         |
| `,` and `.`      | Step the player a frame back or forward, over or in it. |

In the lightbox, the arrow keys change image, `+` and `-` zoom and `Esc`
closes.

## How it works

### The agent loop

A reply is a loop of rounds. Each round sends the request and streams the
answer. If the model called tools, the app runs them, which renders sheets or
saves a note, adds the results and images to the conversation, and starts the
next round. The loop ends when the model answers without a tool call. The limit
is 8 rounds, or the chat's Max rounds setting, or 15 for a Thorough reply and 30
for an Exhaustive one. On the
last round tools are switched off and the model is told to answer from what it
has. Models that cannot use tools, or chats with no video, get no tools.

### The image budget

Venice keeps every image in the conversation, caps the number of images per
request (`maxImages`, usually 10) and bills them again on every turn. So the app
does not resend everything:

- Pinned images are always sent.
- The latest overview comes next. It may take up to half of the slots left after
  the pins, so the whole video stays in view as looks pile up.
- The newest other images fill the rest, up to the model's cap.
- Older images are replaced by a short text stub saying what they were.

That is the default for **Earlier images** in the Model tab: describe them, and
the model re-opens one when it needs it. The other choice keeps sending them, up
to the image limit.

If the model needs an older part of the video, it can call `look` again.
Rendered sheets are cached, so asking again costs no new rendering. If pinned
images alone exceed the cap, the turn does not start until you unpin some.

### The context block

The system prompt holds only things that do not change during a chat: the
persona, how to use the tools, the voice's answer style and the video's name,
length and size. That keeps it identical from request to request, so the server's
prompt cache can reuse it.

What changes goes in a context block, a message placed just before your newest
message. It holds the chat summary, the people, the study timeline, the scene log
and, for a Thorough or Exhaustive reply, the extra guidance. A new note then only breaks the cache
from that point on, and the receipt shows how much was cached.

### Sheet resolution

A chat's sheet resolution defaults to Auto, which picks a size for the chosen
model. Vision models shrink or split images very differently: some scale every
image down to under 1000 px, others read 3000 px or more. Sending more pixels
than a model uses wastes bytes, and every image is billed again on each turn.
The sizes and token estimates come from each model family's own documentation,
since Venice publishes no image limits. When the model's context is known, Auto
also steps the size down until a full set of images fits in half of it, and
keeps the overview under about 20,000 tokens. The fixed sizes are still in the
list.

## Privacy

- The video is never uploaded. Only the sheets and images that the model is
  sent go to the API. Summaries, cast suggestions, studies and timestamp checks
  are model calls too, and send sheets or text to the same API.
- On Venice, a private model runs on Venice's own servers without retention. An
  anonymized model is passed on to the original provider with your identity
  removed.
- The API key and the chats stay in your browser, in localStorage and
  IndexedDB. Stored video copies stay in the browser's file storage.

## Where the code lives

- [index.html](index.html) holds all the markup.
- [src/main.ts](src/main.ts) wires that markup to the modules in [src/](src/).
  [src/types.ts](src/types.ts) holds the shared types and
  [src/time.ts](src/time.ts) formats and parses timestamps.
- [src/api/](src/api/) is the OpenAI-compatible client and the SSE parser.
- [src/video/](src/video/) sizes the overview, renders it through vid2grid, runs
  the tools, plans studies, stores video copies and keeps the sheet cache.
- [src/audio/](src/audio/) runs the audio analysis in pieces, stores the result
  per video and prepares it for the `listen` tool.
- [src/attachments/](src/attachments/) downscales images and sorts dropped
  files.
- [src/chat/](src/chat/) holds the IndexedDB store, the request building with
  the image budget and context block, the agent loop, and the logic behind
  summaries, cast, timestamp checks, alternate replies, personas and export.
- [src/ui/](src/ui/) has the sidebar, conversation, composer, player, lightbox,
  chat drawer panels, study panel and settings.
- [packages/core](../../packages/core/) and
  [packages/browser](../../packages/browser/) do all the planning and
  rendering: `requestFromOptions` and `generateCollages` from core,
  `createBrowserPorts` and `probeVideo` from the browser executor. Audio goes
  through `analyseAudio` from core and `createBrowserAudioPorts` from the
  browser executor. The app has no planning logic of its own.
- Tests are in [tests/](tests/).
