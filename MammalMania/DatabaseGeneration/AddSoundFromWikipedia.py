#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
import time
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import unquote, urlparse

import requests


ENWIKI_API = "https://en.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "AnimalGameSoundURLFiller/0.1 (carlosbarcelo.com)"

AUDIO_EXTENSIONS = (
    ".ogg",
    ".oga",
    ".opus",
    ".wav",
    ".flac",
    ".mp3",
    ".m4a",
    ".aac",
)
PREFERRED_AUDIO_KEYWORDS = {
    "call",
    "song",
    "sound",
    "voice",
    "vocal",
    "roar",
    "bark",
    "howl",
    "trumpet",
    "echolocation",
}
DEPRIORITIZE_AUDIO_KEYWORDS = {
    "pronunciation",
    "spoken",
    "wiki",
    "wikipedia",
    "ll-q",
}
DEFAULT_OUTPUT_SUFFIX = "_with_sound"


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    return s


def _get_json(
    s: requests.Session,
    url: str,
    *,
    params: Optional[dict] = None,
    timeout: int = 30,
) -> dict:
    last_exc: Optional[Exception] = None
    for attempt in range(6):
        try:
            response = s.get(url, params=params, timeout=timeout)
            if response.status_code in (429, 503):
                time.sleep(1.5 * (attempt + 1))
                continue
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            last_exc = exc
            time.sleep(1.5 * (attempt + 1))
    if last_exc is not None:
        raise last_exc
    return {}


def normalize_title(value: str) -> str:
    clean = unquote((value or "").strip())
    if not clean:
        return ""
    clean = clean.replace("_", " ")
    if clean.lower().startswith("file:"):
        clean = clean[5:]
    return clean.strip()


def normalize_file_title(file_title: str) -> str:
    clean = normalize_title(file_title)
    if not clean:
        return ""
    return f"File:{clean}"


def wikipedia_title_from_row(row: Dict[str, str]) -> str:
    title = normalize_title(row.get("wikipedia_title", ""))
    if title:
        return title

    source_url = (row.get("source_url") or "").strip()
    if not source_url:
        return ""
    parsed = urlparse(source_url)
    path = parsed.path or ""
    if "/wiki/" not in path:
        return ""
    wiki_part = path.split("/wiki/", 1)[1]
    return normalize_title(wiki_part)


def is_audio_filename(file_title: str) -> bool:
    clean = normalize_title(file_title).lower()
    return any(clean.endswith(ext) for ext in AUDIO_EXTENSIONS)


def tokenize(value: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", value.lower())


def score_audio_candidate(file_title: str, wiki_title: str, scientific_name: str) -> int:
    name = normalize_title(file_title).lower()
    score = 0
    if any(keyword in name for keyword in PREFERRED_AUDIO_KEYWORDS):
        score += 5
    if any(keyword in name for keyword in DEPRIORITIZE_AUDIO_KEYWORDS):
        score -= 5

    title_tokens = set(tokenize(wiki_title))
    scientific_tokens = set(tokenize(scientific_name))
    name_tokens = set(tokenize(name))
    score += len(title_tokens & name_tokens)
    score += len(scientific_tokens & name_tokens)

    if name.endswith(".ogg") or name.endswith(".oga") or name.endswith(".opus"):
        score += 1
    return score


def list_page_file_titles(s: requests.Session, wiki_title: str) -> List[str]:
    out: List[str] = []
    imcontinue: Optional[str] = None

    while True:
        params = {
            "action": "query",
            "titles": wiki_title,
            "prop": "images",
            "imlimit": "max",
            "format": "json",
        }
        if imcontinue:
            params["imcontinue"] = imcontinue
        payload = _get_json(s, ENWIKI_API, params=params)

        pages = payload.get("query", {}).get("pages", {})
        for page in pages.values():
            for image in page.get("images", []):
                title = image.get("title")
                if isinstance(title, str) and title:
                    out.append(title)

        cont = payload.get("continue", {})
        imcontinue = cont.get("imcontinue")
        if not imcontinue:
            break

    return out


def best_audio_file_title(
    file_titles: List[str],
    wiki_title: str,
    scientific_name: str,
) -> str:
    audio_files = [title for title in file_titles if is_audio_filename(title)]
    if not audio_files:
        return ""
    audio_files.sort(
        key=lambda candidate: score_audio_candidate(candidate, wiki_title, scientific_name),
        reverse=True,
    )
    return audio_files[0]


def resolve_audio_file_url(
    s: requests.Session,
    file_title: str,
    file_url_cache: Dict[str, str],
) -> str:
    normalized_file_title = normalize_file_title(file_title)
    if not normalized_file_title:
        return ""

    if normalized_file_title in file_url_cache:
        return file_url_cache[normalized_file_title]

    params = {
        "action": "query",
        "titles": normalized_file_title,
        "prop": "imageinfo",
        "iiprop": "url|mime",
        "format": "json",
    }

    for api in (COMMONS_API, ENWIKI_API):
        payload = _get_json(s, api, params=params)
        pages = payload.get("query", {}).get("pages", {})
        for page in pages.values():
            if "missing" in page:
                continue
            image_info = page.get("imageinfo") or []
            if not image_info:
                continue
            info = image_info[0]
            url = info.get("url") or ""
            mime = (info.get("mime") or "").lower()
            if url and (mime.startswith("audio/") or is_audio_filename(normalized_file_title)):
                file_url_cache[normalized_file_title] = url
                return url

    file_url_cache[normalized_file_title] = ""
    return ""


def find_sound_url_for_page(
    s: requests.Session,
    wiki_title: str,
    scientific_name: str,
    page_cache: Dict[str, str],
    file_url_cache: Dict[str, str],
) -> str:
    if wiki_title in page_cache:
        return page_cache[wiki_title]

    file_titles = list_page_file_titles(s, wiki_title)
    audio_title = best_audio_file_title(file_titles, wiki_title, scientific_name)
    if not audio_title:
        page_cache[wiki_title] = ""
        return ""

    sound_url = resolve_audio_file_url(s, audio_title, file_url_cache)
    page_cache[wiki_title] = sound_url
    return sound_url


def default_paths():
    script_dir = Path(__file__).resolve().parent
    mammals_path = script_dir.parent / "mammals2026.csv"
    output_path = mammals_path.with_name(f"{mammals_path.stem}{DEFAULT_OUTPUT_SUFFIX}{mammals_path.suffix}")
    return mammals_path, output_path


def add_sound_column(
    mammals_path: Path,
    output_path: Path,
    column_name: str,
    force_refresh: bool,
    progress_every: int,
) -> dict:
    s = session()

    page_cache: Dict[str, str] = {}
    file_url_cache: Dict[str, str] = {}
    rows = []
    stats = {
        "total": 0,
        "filled": 0,
        "left_blank": 0,
        "missing_title": 0,
        "already_had_value": 0,
        "errors": 0,
    }

    with mammals_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        if not fieldnames:
            raise ValueError(f"No header found in {mammals_path}")
        if column_name not in fieldnames:
            fieldnames = [*fieldnames, column_name]

        for idx, row in enumerate(reader, start=1):
            stats["total"] += 1
            existing = (row.get(column_name) or "").strip()
            if existing and not force_refresh:
                stats["already_had_value"] += 1
                rows.append(row)
                continue

            wiki_title = wikipedia_title_from_row(row)
            if not wiki_title:
                row[column_name] = ""
                stats["missing_title"] += 1
                stats["left_blank"] += 1
                rows.append(row)
                continue

            try:
                sound_url = find_sound_url_for_page(
                    s=s,
                    wiki_title=wiki_title,
                    scientific_name=row.get("scientific_name", ""),
                    page_cache=page_cache,
                    file_url_cache=file_url_cache,
                )
            except Exception:
                sound_url = ""
                stats["errors"] += 1

            row[column_name] = sound_url
            if sound_url:
                stats["filled"] += 1
            else:
                stats["left_blank"] += 1
            rows.append(row)

            if progress_every > 0 and idx % progress_every == 0:
                print(
                    f"Processed {idx} rows. "
                    f"Filled={stats['filled']}, blanks={stats['left_blank']}, "
                    f"errors={stats['errors']}."
                )

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return stats


def main() -> None:
    default_mammals_path, default_output_path = default_paths()

    parser = argparse.ArgumentParser(
        description=(
            "Add a sound file URL column to mammals CSV by checking audio files "
            "used on each Wikipedia page."
        )
    )
    parser.add_argument(
        "--mammals",
        default=str(default_mammals_path),
        help=f"Input mammals CSV path (default: {default_mammals_path})",
    )
    parser.add_argument(
        "--output",
        default=str(default_output_path),
        help=f"Output CSV path (default: {default_output_path})",
    )
    parser.add_argument(
        "--column-name",
        default="sound_url",
        help="Name of output sound URL column (default: sound_url)",
    )
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Recompute sound URL even when column already has a value.",
    )
    parser.add_argument(
        "--progress-every",
        type=int,
        default=25,
        help="Print progress every N rows (default: 25, 0 to disable).",
    )
    args = parser.parse_args()

    mammals_path = Path(args.mammals)
    output_path = Path(args.output)

    stats = add_sound_column(
        mammals_path=mammals_path,
        output_path=output_path,
        column_name=args.column_name,
        force_refresh=args.force_refresh,
        progress_every=max(0, args.progress_every),
    )

    print(f"Rows read: {stats['total']}")
    print(f"Filled '{args.column_name}': {stats['filled']}")
    print(f"Left blank: {stats['left_blank']}")
    print(f"Missing wikipedia title/source URL: {stats['missing_title']}")
    print(f"Rows skipped (already had value): {stats['already_had_value']}")
    print(f"Request/parse errors: {stats['errors']}")
    print(f"Output file: {output_path}")


if __name__ == "__main__":
    main()
