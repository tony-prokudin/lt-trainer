from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = Path(os.environ.get("LITHUANIAN_FLASHCARDS_DATA_DIR", ROOT / "data"))
PROGRESS_PATH = DATA_DIR / "progress.json"
DEFAULT_PORT = 8123
DEFAULT_HOST = "127.0.0.1"

SHEET_ID = os.environ.get(
    "LITHUANIAN_FLASHCARDS_SHEET_ID",
    "1Tx5wN5IWSMOLtg_60ihrkf-T6G1_darxaoIstj6on5M",
)
SHEET_URL = os.environ.get(
    "LITHUANIAN_FLASHCARDS_SHEET_URL",
    (
        "https://docs.google.com/spreadsheets/d/"
        f"{SHEET_ID}/gviz/tq?tqx=out:json"
    ),
)

EXPECTED_HEADERS = ["lithuanian", "russian", "pronunciation", "examples"]
STATUS_NEW = "new"
STATUS_LEARNED = "learned"
STATUS_FORGOTTEN = "forgotten"
ALLOWED_STATUSES = {STATUS_NEW, STATUS_LEARNED, STATUS_FORGOTTEN}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_progress() -> dict:
    if not PROGRESS_PATH.exists():
        return {"cards": {}, "meta": {"created_at": utc_now_iso()}}

    with PROGRESS_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def save_progress(progress: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with PROGRESS_PATH.open("w", encoding="utf-8") as fh:
        json.dump(progress, fh, ensure_ascii=False, indent=2)


def build_card_id(lithuanian: str, russian: str) -> str:
    key = f"{lithuanian.strip().lower()}::{russian.strip().lower()}"
    return re.sub(r"\s+", " ", key)


def parse_gviz_payload(raw_payload: str) -> dict:
    start = raw_payload.find("{")
    end = raw_payload.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("Unexpected Google Sheets response format.")
    return json.loads(raw_payload[start : end + 1])


def extract_cell_value(cell: dict | None) -> str:
    if not cell:
        return ""
    value = cell.get("v", "")
    return str(value).strip()


def fetch_sheet_rows() -> list[dict]:
    request = urllib.request.Request(
        SHEET_URL,
        headers={"User-Agent": "LithuanianFlashcards/1.0"},
    )

    with urllib.request.urlopen(request, timeout=20) as response:
        payload = response.read().decode("utf-8")

    table = parse_gviz_payload(payload)["table"]
    rows = table.get("rows", [])

    parsed_rows = []
    for row in rows:
        cells = row.get("c", [])
        values = [extract_cell_value(cell) for cell in cells[:4]]
        while len(values) < 4:
            values.append("")
        if not any(values):
            continue
        parsed_rows.append(
            {
                "lithuanian": values[0],
                "russian": values[1],
                "pronunciation": values[2],
                "examples": values[3],
            }
        )

    if parsed_rows:
        first_row_headers = [parsed_rows[0][key].strip().lower() for key in EXPECTED_HEADERS]
        if first_row_headers == EXPECTED_HEADERS:
            parsed_rows = parsed_rows[1:]

    normalized_rows = []
    for row in parsed_rows:
        if not row["lithuanian"] or not row["russian"]:
            continue
        row["id"] = build_card_id(row["lithuanian"], row["russian"])
        normalized_rows.append(row)

    return normalized_rows


def merge_cards_with_progress(cards: list[dict], progress: dict) -> dict:
    progress_cards = progress.setdefault("cards", {})
    seen_ids = set()
    now = utc_now_iso()

    merged_cards = []
    new_cards_count = 0

    for card in cards:
        card_id = card["id"]
        seen_ids.add(card_id)
        record = progress_cards.get(card_id)

        if record is None:
            record = {
                "status": STATUS_NEW,
                "created_at": now,
                "last_reviewed_at": None,
                "times_seen": 0,
                "success_count": 0,
                "failure_count": 0,
            }
            progress_cards[card_id] = record
            new_cards_count += 1

        merged_cards.append(
            {
                **card,
                "status": record["status"],
                "times_seen": record["times_seen"],
                "success_count": record["success_count"],
                "failure_count": record["failure_count"],
                "last_reviewed_at": record["last_reviewed_at"],
                "created_at": record["created_at"],
            }
        )

    for card_id, record in progress_cards.items():
        if card_id not in seen_ids:
            record["missing_from_sheet"] = True
        else:
            record.pop("missing_from_sheet", None)

    status_counts = {
        STATUS_NEW: 0,
        STATUS_LEARNED: 0,
        STATUS_FORGOTTEN: 0,
    }
    for card in merged_cards:
        status_counts[card["status"]] += 1

    return {
        "cards": merged_cards,
        "new_cards_added": new_cards_count,
        "status_counts": status_counts,
        "synced_at": now,
    }


def get_deck_payload() -> dict:
    progress = load_progress()
    cards = fetch_sheet_rows()
    payload = merge_cards_with_progress(cards, progress)
    progress.setdefault("meta", {})
    progress["meta"]["last_sync_at"] = payload["synced_at"]
    save_progress(progress)
    return payload


def update_progress(card_id: str, status: str) -> dict:
    if status not in ALLOWED_STATUSES:
        raise ValueError(f"Unsupported status: {status}")

    progress = load_progress()
    record = progress.setdefault("cards", {}).get(card_id)
    if record is None:
        raise KeyError(f"Unknown card id: {card_id}")

    record["status"] = status
    record["last_reviewed_at"] = utc_now_iso()
    record["times_seen"] = int(record.get("times_seen", 0)) + 1

    if status == STATUS_LEARNED:
        record["success_count"] = int(record.get("success_count", 0)) + 1
    elif status == STATUS_FORGOTTEN:
        record["failure_count"] = int(record.get("failure_count", 0)) + 1

    save_progress(progress)
    return record


class FlashcardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/deck":
            self.handle_api_deck()
            return

        if parsed.path == "/api/health":
            self.send_json({"ok": True, "time": utc_now_iso()})
            return

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/review":
            self.handle_api_review()
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def handle_api_deck(self) -> None:
        try:
            payload = get_deck_payload()
            self.send_json(payload)
        except urllib.error.URLError as exc:
            self.send_json(
                {
                    "error": "sheet_unreachable",
                    "message": f"Could not reach Google Sheets: {exc.reason}",
                },
                status=HTTPStatus.BAD_GATEWAY,
            )
        except Exception as exc:  # pragma: no cover - safety net
            self.send_json(
                {"error": "deck_load_failed", "message": str(exc)},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def handle_api_review(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length).decode("utf-8")
            payload = json.loads(raw_body or "{}")
            card_id = str(payload.get("cardId", "")).strip()
            status = str(payload.get("status", "")).strip().lower()

            if not card_id:
                raise ValueError("cardId is required")

            updated = update_progress(card_id, status)
            self.send_json({"ok": True, "record": updated})
        except KeyError as exc:
            self.send_json(
                {"error": "card_not_found", "message": str(exc)},
                status=HTTPStatus.NOT_FOUND,
            )
        except ValueError as exc:
            self.send_json(
                {"error": "invalid_request", "message": str(exc)},
                status=HTTPStatus.BAD_REQUEST,
            )
        except Exception as exc:  # pragma: no cover - safety net
            self.send_json(
                {"error": "review_update_failed", "message": str(exc)},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def log_message(self, format: str, *args) -> None:
        return

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def run_server(
    port: int = int(os.environ.get("PORT", DEFAULT_PORT)),
    host: str = os.environ.get("HOST", DEFAULT_HOST),
) -> None:
    server = ThreadingHTTPServer((host, port), FlashcardHandler)
    print(f"Lithuanian flashcards running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
