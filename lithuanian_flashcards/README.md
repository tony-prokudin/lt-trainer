# Lithuanian Words Trainer

A small local flashcard app that reads your vocabulary from Google Sheets and stores review progress separately on your machine.

## What the MVP does

- syncs directly from your Google Sheet on refresh
- detects new rows automatically as the sheet grows
- supports `LT -> RU`, `RU -> LT`, and mixed practice
- reveals translation, pronunciation, and example together
- tracks simple statuses: `new`, `learned`, `forgotten`
- stores progress in `lithuanian_flashcards/data/progress.json`

## Run locally

```bash
python3 lithuanian_flashcards/server.py
```

Then open:

```text
http://127.0.0.1:8123
```

## Notes

- The app pulls from the public Google Sheet URL embedded in `server.py`.
- New words get status `new` automatically the first time they appear.
- For hosting, the server also supports `HOST`, `PORT`, `LITHUANIAN_FLASHCARDS_SHEET_ID`, `LITHUANIAN_FLASHCARDS_SHEET_URL`, and `LITHUANIAN_FLASHCARDS_DATA_DIR` environment variables.
- A Dockerfile is included so you can deploy the same app to a hosted service without changing the code.

## Hosting notes

- This MVP stores progress on the filesystem, so hosted deployments need persistent storage.
- For Docker-style hosting, a good mount path is `/data` with `LITHUANIAN_FLASHCARDS_DATA_DIR=/data`.
- For the included Render Blueprint, the mount path is `/opt/render/project/src/data`.
- If you deploy without persistent storage, your card statuses will reset after redeploys or restarts.

## Render deploy

This repo now includes a root-level `render.yaml` for a hosted Render deployment.

How to deploy:

1. Push this project to GitHub.
2. In Render, create a new Blueprint and connect that repo.
3. Render will pick up `render.yaml` from the repo root.
4. Confirm the web service settings and create the service.
5. Wait for the first deploy, then open the generated `onrender.com` URL.

What the Blueprint config does:

- creates a Python web service
- starts the app with `python server.py`
- mounts a persistent disk at `/opt/render/project/src/data`
- stores review progress on that disk
- points the app at your public Google Sheet

Important:

- The Blueprint uses the `starter` plan because Render persistent disks are attached to paid web services, not ephemeral free ones according to Render's docs.
