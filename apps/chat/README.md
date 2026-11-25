# vid2grid chat

A chat app for talking to a vision model about a video. Each release is served
at <https://ianheinrich.github.io/vid2grid/chat/>, and it runs from a clone
too. Either way it runs entirely in your browser: the page calls the model's
API directly, and the video itself never leaves your computer. Plain
TypeScript and Vite, no framework.

## What it does

- Talks to any OpenAI-compatible API, local or hosted: a server such as
  Ollama, LM Studio or llama.cpp on your own computer, or a hosted API. Where
  a server reports privacy, prices or an account balance, the app shows them.
- Keeps many chats. Each has its own persona, model, temperature, reasoning
  effort, sheet resolution and round limit, and is saved in IndexedDB.
- Drag a video into a chat. It stays a playable video in a floating player.
  The app renders an overview of it with vid2grid and sends the sheets to the
  model. With Audio on, the transcript of the speech heard so far goes with it.
- Gives the model five tools for the video, and a sixth when audio is on:
  - `look(start, end, frames, perSheet)` renders a time range at the density the
    model picks, up to 64 frames and 20 per sheet. Fewer frames per sheet means
    larger frames.
  - `frames(times)` renders up to 9 chosen moments on one sheet, so a single
    call and a single image can check several details.
  - `note(t, text)` adds a line to the chat's scene log, which the model sees
    again on every later turn.
  - `zoom(image, t, left, top, right, bottom)` crops part of one video frame
    (`t`) or of an image (`image`, by name) and returns it enlarged as one
    image. The image can be a dropped picture, a grid, whose frame in the
    middle of the area is used, or an earlier zoom. The area is given in
    thousandths of the picture's width and height, from its top left corner.
    It is left out for a model that cannot see images.
  - `recall(names)` attaches earlier images again, by the names their stubs
    give, without rendering anything.
  - `listen(start, end)` reads what is heard in a range, up to 10 minutes per
    call: speech in quotes and sound events, one line each. It is offered only
    on a message with the Audio toggle on.
- Without a loaded video, `recall` and `zoom` are still offered when the chat
  holds images and the model can see them. Zooming into a video's frames needs
  that video loaded.
- Drop still images into a message too. They are scaled down to the chat's
  resolution. An image can be pinned so it is always sent.
- Zooming lets the model look closer at a detail. For a video moment the crop
  comes from the video itself, not from an earlier sheet. For a dropped image,
  the chat keeps a larger copy (up to 4096 px) in the browser, since the one
  sent to the model was scaled down, and the crop comes from that copy. Each
  zoom is one more image, so it counts towards the image limit like any other.

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

There is no default API. Open Settings from the sidebar and fill in:

- **Base URL.** Any API that speaks the OpenAI chat completions protocol, local
  or hosted. Quick fills set it for you:

  | Choice     | Base URL                       |
  | ---------- | ------------------------------ |
  | Venice     | `https://api.venice.ai/api/v1` |
  | OpenRouter | `https://openrouter.ai/api/v1` |
  | OpenAI     | `https://api.openai.com/v1`    |
  | Ollama     | `http://localhost:11434/v1`    |
  | LM Studio  | `http://localhost:1234/v1`     |

  A llama.cpp server or anything else compatible works by typing its URL.

- **API key.** Stored in your browser's localStorage and sent only to the base
  URL. Venice needs one; a local server usually does not, so leave it empty.
- **Default model** for new chats. Left unset, it is the first model the server
  lists. There is also an image limit to assume for models that do not report
  one, and a switch for showing the model's thinking.

Until a base URL is set the app calls no server, and the message box asks you
to choose an API.

A local server has to allow this page's origin, or the browser blocks the
requests (CORS). For Ollama, set `OLLAMA_ORIGINS` to the page's origin, or `*`;
in LM Studio, turn on CORS in the server settings.

On a server other than Venice, models whose ids mark them as embedding, speech,
rerank, moderation or image generation models are left out of the list.

A "Get started" checklist on the main screen walks through choosing an API, a
connection test, a default model and a first video or image. You can hide it.

**Test connection** checks what is typed in the dialog before you save it. It
shows the server, how many models it lists, how many can see images where the
server says so, and whether the key was checked, or why it could not connect and
what to try. On success the dialog's model lists show
that server's models at once. The rest of the app takes the list only when the
tested server and key are the saved ones, or once you save.

Venice only: the test also says which kind of key you have. An admin key can
read the account balance, which then shows in the sidebar. An inference key
chats fine but cannot read the balance.

## Models

The model picker is used in Settings, in each chat and in the study dialog.

- Models that cannot see images are hidden until a looking model is chosen, for
  the chat or, in Settings, for new chats. Then they show with a Text only badge.
- Search by name, mark favourites with a star, filter by Uncensored,
  Recommended, Reasoning, Audio and Beta, and sort by recommendation, price,
  context or name.
- Venice only: each model has a privacy badge, private or anonymized, and a
  Private filter. Only private models show by default. Other servers report no
  privacy, so the filter is hidden there and every model shows.
- Hover or arrow to a model to see its details pane: description, tags, price
  per million tokens, context size, image limit, the Auto sheet resolution,
  reasoning effort, privacy and whether it takes audio. Arrow keys, Home, End
  and Enter work in the list.

## Looking model

A looking model is a second model that looks at pictures for a chat's own
model, the writer. With one set, every picture goes to the looking model and
never to the writer, so the writer can be a model that only reads text.

- Overview sheets, dropped images and pictures from the tools are described
  once, before the writer's next round, with your message or the tool call's
  question as what to pay attention to. The writer reads the words in place of
  the pictures, in that turn and later ones. You can read them too: under your
  message, and in the reply's activity row.
- The writer gets an `ask(question, pictures)` tool in place of `recall`. It
  sends the stored pictures to the looking model again, from any turn, so each
  question costs a looking call. `look`, `frames` and `zoom` take an optional
  `question`.
- Replay, swipes and Compare reuse a description. **Look again** drops one, and
  the next reply has those pictures described afresh.
- A writer without tools, or whose server refuses them, cannot ask. A later
  message with no new pictures is then put to the looking model itself, with as
  many pictures as it takes: the turn's own first, then pinned ones, the
  overview and the newest. The writer reads the answer as a note.
- If a look fails, the reply fails with the looking model and its server named,
  and Retry looks again. If an `ask` fails, the writer is told and goes on.
- Study, Check timestamps and Suggest from video send pictures, so they use the
  looking model as well. Suggest sends it the overview alone, without the scene
  log. Receipts and totals count its tokens, at its own price where that is known.

To set it up with KoboldCpp as the writer:

1. Start KoboldCpp with a text model. In Settings, use
   `http://localhost:5001/v1` as the base URL and leave the key empty.
2. Under **Looking model**, turn on "Use a different server for looking". Pick
   Venice and add its key, or type the URL of a second local server that runs a
   vision model, for example KoboldCpp on another port.
3. Press **Test looking model**, then choose the model. New chats get it, and so
   does an empty chat you never chose one for. For a chat you already use, choose
   it in Chat settings, on the Model tab.

Some servers list their models to anyone, so a list alone does not check the
key. The looking model's test then sends the chosen model a few words, with no
picture, and says whether it answered. Test connection sends nothing more and
says that the key was not checked.

Without a different server, the looking model runs on the chat's own.

What goes where: the writer's server gets your messages, the replies, the words
about the pictures and, with Audio on, the transcript. The looking server gets
the pictures, the questions about them, your message where it says what to look
for, and earlier questions and answers about the same pictures. It gets nothing
else of the conversation and no transcript, and the writer is told to leave what
was heard out of its questions. Check timestamps sends the sentences it checks,
so on any reply that comes after a message with Audio on it first asks, naming
the host, when that is another server than the chat's. The looking server's key
is kept like the other and sent only to its own URL. Settings and the Model tab
both name the host that pictures are sent to.

A chat remembers which server its looking model was picked on, the chat's own
server included. If that server is no longer in Settings, the chat does not send
until you choose again, so pictures never move to another server on their own.

A chat whose model only reads text cannot send pictures without a looking model.
The Model tab says so, and the chat only sends while it holds none.

## Chat settings

The Chat settings drawer in a chat's header has two tabs.

- **Instructions.** A system prompt where `{{char}}` and `{{user}}` stand for the
  character and user names set below it, with a preview of the filled-in
  prompt. The voice is Analyst (cites moments as timestamps), In character
  (never mentions tools or frames, few timestamps) or Narrator (third-person
  prose). Save a setup as a named persona, then reuse, update or delete it.
  Personas are kept in localStorage and shared by all chats.
- **Model.** The chat's model, its looking model, temperature, reasoning effort, what happens to
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
  when a new video is attached or the video is removed. Edit or delete any
  note, add your own (it starts at the player's current time), or Condense to
  have the model merge duplicates. The condensed log is shown as a preview
  first, and you accept or discard it. The tab shows an approximate token cost.

Under **Videos**, a picker lists every video the chat has had and that was not
removed, newest first, with the attached one marked current. It starts on the
current video, and each heading names the video shown.

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
- **Remove from chat**, in the menu next to Study video and under each video in
  the conversation, takes a video out of the chat after it was sent. The player
  closes, the model no longer gets the video's tools or facts, and the scene
  log is cleared. The messages stay, with the sheets the model saw and what a
  looking model said of them, which `ask` can still ask about, and the video
  shows as "video.mp4, removed from this chat". In a chat that has had
  several videos only the chosen one goes, and removing the current one leaves
  the chat without a current video. The toast's Undo puts everything back. The
  timeline, people and audio saved for the video are kept, so attaching the
  same file again brings them back. It has to wait while a reply or a study
  runs in the chat.
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
- **Transcript.** A message sent with Audio on carries the speech heard so far as
  text, next to the overview, and shows what it covered, such as "Transcript to
  42:10 sent". See The transcript below.

## Storage and export

- With "Keep a copy of attached videos in this browser" on, the video is saved
  in the browser's private file storage so it opens again after a restart. It
  asks first above a size you set (4 GB by default). Settings lists the
  stored copies with usage and quota, and each can be removed. Removing a video
  from a chat, or deleting the chat, deletes the copy once Undo has gone, unless
  another chat or message still has the video.
- Images are kept while anything uses them: a message, a reply you can swipe back
  to, a picture waiting to be sent or a cached sheet of a video some chat still
  has. Once a deletion can no longer be undone, the images only it used are
  deleted, unless a reply is running or the app is open in another tab. Settings
  shows how many stored images nothing uses and how much space they take, and
  deletes them on request once the other tabs are closed. A browser without Web
  Locks cannot tell whether other tabs are open, so there images are never deleted.
- Download a chat as Markdown from the sidebar: the title, model, video,
  prompt, every turn and the scene log.
- Backup in Settings saves all chats, messages and timelines to one JSON file,
  with or without images, and Restore reads it back. A backup made without images
  shows the pictures this browser still has, so it cannot get them back once the
  chat they came from is deleted.
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

Every image in the conversation is sent again on every turn, servers cap the
number of images per request (Venice reports `maxImages`, usually 10; for other
servers the image limit in Settings stands in) and hosted APIs bill them again
each time. So the app does not resend everything:

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

A video of 20 minutes or more gets an overview of 20 frames a sheet, so four
sheets of 20 on a model that takes ten images. Measured on videos of 30 to 60
minutes, that shape with the transcript did best. A shorter video gets the
highest count up to 20 that leaves no blank cells.

### The transcript

The first message with Audio on, once some speech has been heard, carries the
transcript: timed lines such as `[12:40] text`, after a line saying which ranges
have been heard, so that silence is not mistaken for audio not heard yet. Sending
never waits for the audio: what has not been heard by then is left out and said
to be. A later message carries it again when the text has grown by at least a
quarter since the last one that got a reply, when speech from before that one's
start has been heard and the text is cut at its cap, or when the chat summary has
replaced the message that carried it. Keep going never carries another one into a
reply that already has it. On a message with Audio off, no transcript is sent.

- It is capped at about 16,000 tokens or a quarter of the model's context,
  whichever is smaller. Over the cap it runs from the start of the video to the
  cap, and a last line says which range is left out.
- For the rest of that turn, Keep going included, the text stays in the request.
  On later turns it is a one line stub saying what it covered and that `listen`
  can read any range again. Where `listen` is not offered, because the model
  cannot use tools or the video's file is not loaded, the newest transcript stays
  in full in its place, as long as Audio is on.
- The message stores the ranges that had been heard and where the text was cut,
  not the text, which is rebuilt from the speech stored for the video. Speech
  heard later does not change it, so the server's prompt cache holds. A backup
  holds no speech, so a transcript cannot be rebuilt in another browser.
- Times on the transcript's lines count as seen for the receipt's "Cited without
  looking" note, though only those exact times.
- Replay decides again with what has been heard by then, and drops the transcript
  of a video that has since been replaced. Compare with another model sends what
  the first model was sent, cut to the other model's cap.

### The context block

The system prompt holds only things that do not change during a chat: the
persona, how to use the tools, the voice's answer style and the video's name,
length and size. That keeps it identical from request to request, so the server's
prompt cache can reuse it.

What changes goes in a context block, a message placed just before your newest
message. It holds the chat summary, the people, the study timeline, the scene log
and, for a Thorough or Exhaustive reply, the extra guidance. With Audio on it
also says what has been analysed, leaving out the speech the transcript already
covers. A new note then only breaks the cache from that point on, and the
receipt shows how much was cached.

### Sheet resolution

A chat's sheet resolution defaults to Auto, which picks a size for the chosen
model. Vision models shrink or split images very differently: some scale every
image down to under 1000 px, others read 3000 px or more. Sending more pixels
than a model uses wastes bytes, and every image is billed again on each turn.
The sizes and token estimates come from each model family's own documentation,
since most APIs publish no image limits. When the model's context is known, Auto
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
