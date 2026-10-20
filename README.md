# Superslow

A set timer and training log for super-slow strength training, as an iPhone home-screen web app.

You don't count reps. You note the weight and how long you can keep moving it:
under 60 s the weight is too heavy, over 90 s it is too light.

- Tap **Start**. A voice counts down from 10, and you start lifting on "zero".
- The time is called out every 10 s up to 60, then every 5 s (65, 70, 75 …).
- The screen stays on during the countdown and the set.
- Tap anywhere on the big **Done** slab when you finish. The set is saved with its weight, time and verdict.
- **History** shows each exercise's sets by day. You can export them as CSV, or back up and restore them as JSON.

## Install on the iPhone

1. Open `https://maxmcorp.github.io/superslow/` in Safari.
2. Tap Share, then **Add to Home Screen**.
3. Open Superslow from the home-screen icon. After the first launch it works offline.

Callouts play over your music, so the ring/silent switch must be on ring. Keeping the screen on needs iOS 18.4 or later. If the app can't keep it on, a yellow banner says so.

Your log lives on the phone, in the home-screen app's own storage. Use **Back up** now and then and keep the file in Files or iCloud Drive.

## Sounds

`sounds/<n>.wav` is the recording of the number `n`. A set uses:

- `0` to `10` for the countdown (`10` is also the first callout)
- `20`, `30`, `40`, `50`, `60`
- `65`, `70`, `75` … every 5 up to the highest number you record

Callouts stop after the highest recorded number above 60. A number without a recording plays a beep.

The files in the repository are placeholders spoken by a Windows voice (`tools/placeholder-sounds.ps1`). To use your own, replace the WAVs with files of the same names. They should be mono, short, and similar in loudness. Silence at the start is skipped automatically.

## Deploy a change

```sh
node tools/build.mjs   # lists the sounds, stamps the service worker version
git add -A && git commit -m "..." && git push
```

GitHub Pages serves the `main` branch. The phone picks up the new version the next time the app is opened while online, and reloads the version after that.

## Develop

```sh
npm test               # unit tests (node --test)
npm run serve          # http://localhost:8000; no service worker on http, so edits show on reload
```

| File | What it does |
|---|---|
| `schedule.js` | When things are said, and the verdict. Change the callout times here. |
| `audio.js` | Loads the sounds and plays them on time with Web Audio |
| `wakelock.js` | Keeps the screen on during a set |
| `store.js` | The training log in local storage, with CSV and JSON export |
| `app.js` | The screens |
| `sw.js` | Offline cache |
| `tools/build.mjs` | Run before each deploy |
| `tools/make-icons.py` | Draws the app icons |

Fonts: Barlow and Barlow Condensed by Jeremy Tribby, under the SIL Open Font License (`fonts/OFL.txt`).
