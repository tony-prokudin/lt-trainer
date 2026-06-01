# Lithuanian Words Trainer

A lightweight flashcard app that reads vocabulary from Google Sheets in the browser and stores review progress on the current device.

## What the current version does

- syncs directly from your public Google Sheet in the browser
- detects new rows automatically as the sheet grows
- supports `LT -> RU`, `RU -> LT`, and mixed practice
- reveals translation, pronunciation, and example together
- tracks simple statuses: `new`, `learned`, `forgotten`
- stores progress in browser storage on the current device
- works well as an iPhone home-screen web app

## Important behavior

- Progress is stored per device in `localStorage`
- Your iPhone and laptop will each keep their own progress unless you later add account sync
- The Google Sheet remains the source of truth for words

## Run locally

You can still run it with the simple Python server:

```bash
python3 lithuanian_flashcards/server.py
```

Then open:

```text
http://127.0.0.1:8123
```

## Best hosting option now

Because the app now stores progress in the browser, it can be hosted as a static site.

Good free options:

- GitHub Pages
- Netlify
- Cloudflare Pages

This repo already includes a GitHub Pages workflow that publishes `lithuanian_flashcards/static` whenever you push to `main`.

## iPhone use

After the site is hosted:

1. Open it in Safari on your iPhone
2. Tap Share
3. Tap `Add to Home Screen`
4. Launch it like a normal app icon
