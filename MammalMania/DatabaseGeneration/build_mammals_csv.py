#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import random
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, unquote, urlparse

import requests

WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
ENWIKI_API = "https://en.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
PAGEVIEWS_API = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article"

# IMPORTANT: set this to something real (Wikimedia APIs expect an identifying UA).
USER_AGENT = "AnimalWebGameMammalCSV/0.2 (carlosbarcelo.com)"

# --- Wikidata IDs / props ---
Q_MAMMAL = "Q7377"
Q_SPECIES = "Q7432"

P_INSTANCE_OF = "P31"
P_TAXON_RANK = "P105"
P_PARENT_TAXON = "P171"
P_TAXON_NAME = "P225"

P_MASS = "P2067"
P_LIFESPAN = "P2250"
P_GESTATION = "P3063"
P_LITTER = "P7725"
P_SPEED = "P2052"
P_CONSERVATION_STATUS = "P141"

# Unit QIDs
Q_KG = "Q11570"
Q_G = "Q41803"
Q_MG = "Q3241121"
Q_TONNE = "Q191118"
Q_LB = "Q100995"

Q_DAY = "Q573"
Q_WEEK = "Q23387"
Q_MONTH = "Q5151"
Q_YEAR = "Q577"

Q_MPH = "Q211256"
Q_KMH = "Q180154"
Q_MPS = "Q182429"
Q_KNOT = "Q128822"

LB_TO_KG = Decimal("0.45359237")
KMH_TO_MPH = Decimal("0.621371192237334")
MPS_TO_MPH = Decimal("2.2369362920544")
KNOT_TO_MPH = Decimal("1.15077944802354")

MAP_LIKE_IMAGE_KEYWORDS = {
    "area",
    "distribution",
    "locator",
    "location",
    "map",
    "range",
    "territory",
}

IMAGE_FILE_EXTENSIONS = {
    ".gif",
    ".jpeg",
    ".jpg",
    ".png",
    ".tif",
    ".tiff",
    ".webp",
}


@dataclass(frozen=True)
class Candidate:
    qid: str
    label: str
    enwiki_title: str
    sitelinks: int


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    return s


def _get_json(s: requests.Session, url: str, *, params: Optional[dict] = None, timeout: int = 30) -> dict:
    # Simple backoff for 429/503
    for attempt in range(6):
        r = s.get(url, params=params, timeout=timeout)
        if r.status_code in (429, 503):
            time.sleep(1.5 * (attempt + 1))
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()
    return {}


def qid_from_uri(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def as_decimal(amount_str: str) -> Decimal:
    s = amount_str.strip()
    if s.startswith("+"):
        s = s[1:]
    return Decimal(s)


def unit_qid_from_uri(unit_uri: str) -> Optional[str]:
    if not unit_uri or unit_uri == "1":
        return None
    return unit_uri.rsplit("/", 1)[-1]


def pick_best_statements(statements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    preferred = [s for s in statements if s.get("rank") == "preferred"]
    if preferred:
        return preferred
    normal = [s for s in statements if s.get("rank") == "normal"]
    if normal:
        return normal
    return [s for s in statements if s.get("rank") != "deprecated"]


def extract_quantity_claims(entity: Dict[str, Any], prop: str) -> List[Tuple[Decimal, Optional[str]]]:
    claims = entity.get("claims", {})
    statements = pick_best_statements(claims.get(prop, []))
    out: List[Tuple[Decimal, Optional[str]]] = []
    for st in statements:
        dv = st.get("mainsnak", {}).get("datavalue", {}).get("value")
        if not isinstance(dv, dict) or "amount" not in dv:
            continue
        try:
            val = as_decimal(dv["amount"])
        except Exception:
            continue
        out.append((val, unit_qid_from_uri(dv.get("unit", ""))))
    return out


def extract_item_claim_qids(entity: Dict[str, Any], prop: str) -> List[str]:
    claims = entity.get("claims", {})
    statements = pick_best_statements(claims.get(prop, []))
    out: List[str] = []
    for st in statements:
        dv = st.get("mainsnak", {}).get("datavalue", {}).get("value")
        if not isinstance(dv, dict):
            continue
        qid = dv.get("id")
        if isinstance(qid, str) and qid:
            out.append(qid)
    return out


def extract_string_claims(entity: Dict[str, Any], prop: str) -> List[str]:
    claims = entity.get("claims", {})
    statements = pick_best_statements(claims.get(prop, []))
    out: List[str] = []
    for st in statements:
        dv = st.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(dv, str):
            clean = dv.strip()
            if clean:
                out.append(clean)
    return out


def wikidata_label(s: requests.Session, qid: str, label_cache: Dict[str, Optional[str]]) -> Optional[str]:
    if qid in label_cache:
        return label_cache[qid]
    try:
        j = _get_json(
            s,
            WIKIDATA_API,
            params={
                "action": "wbgetentities",
                "ids": qid,
                "props": "labels",
                "languages": "en",
                "format": "json",
            },
        )
        label = j.get("entities", {}).get(qid, {}).get("labels", {}).get("en", {}).get("value")
        label_cache[qid] = label
        return label
    except Exception:
        label_cache[qid] = None
        return None


def convert_mass_to_kg(value: Decimal, unit_qid: Optional[str]) -> Optional[Decimal]:
    if unit_qid == Q_KG:
        return value
    if unit_qid == Q_G:
        return value / Decimal("1000")
    if unit_qid == Q_MG:
        return value / Decimal("1000000")
    if unit_qid == Q_TONNE:
        return value * Decimal("1000")
    if unit_qid == Q_LB:
        return value * LB_TO_KG
    return None


def convert_time_to_days(value: Decimal, unit_qid: Optional[str]) -> Optional[Decimal]:
    if unit_qid == Q_DAY:
        return value
    if unit_qid == Q_WEEK:
        return value * Decimal("7")
    if unit_qid == Q_MONTH:
        return value * Decimal("30.4375")
    if unit_qid == Q_YEAR:
        return value * Decimal("365.25")
    return None


def convert_time_to_years(value: Decimal, unit_qid: Optional[str]) -> Optional[Decimal]:
    if unit_qid == Q_YEAR:
        return value
    days = convert_time_to_days(value, unit_qid)
    if days is None:
        return None
    return days / Decimal("365.25")


def convert_speed_to_mph(value: Decimal, unit_qid: Optional[str]) -> Optional[Decimal]:
    if unit_qid == Q_MPH:
        return value
    if unit_qid == Q_KMH:
        return value * KMH_TO_MPH
    if unit_qid == Q_MPS:
        return value * MPS_TO_MPH
    if unit_qid == Q_KNOT:
        return value * KNOT_TO_MPH
    return None


def best_mass_kg(entity: Dict[str, Any]) -> Optional[float]:
    conv = []
    for v, u in extract_quantity_claims(entity, P_MASS):
        c = convert_mass_to_kg(v, u)
        if c is not None:
            conv.append(c)
    return float(max(conv)) if conv else None


def best_lifespan_yr(entity: Dict[str, Any]) -> Optional[float]:
    conv = []
    for v, u in extract_quantity_claims(entity, P_LIFESPAN):
        c = convert_time_to_years(v, u)
        if c is not None:
            conv.append(c)
    return float(max(conv)) if conv else None


def best_gestation_days(entity: Dict[str, Any]) -> Optional[float]:
    conv = []
    for v, u in extract_quantity_claims(entity, P_GESTATION):
        c = convert_time_to_days(v, u)
        if c is not None:
            conv.append(c)
    return float(max(conv)) if conv else None


def best_litter_size(entity: Dict[str, Any]) -> Optional[float]:
    best: Optional[Decimal] = None
    for v, u in extract_quantity_claims(entity, P_LITTER):
        # litter size often unitless ("1")
        if u is None:
            best = v if best is None else max(best, v)
    return float(best) if best is not None else None


def best_speed_mph(entity: Dict[str, Any]) -> Optional[float]:
    conv = []
    for v, u in extract_quantity_claims(entity, P_SPEED):
        c = convert_speed_to_mph(v, u)
        if c is not None:
            conv.append(c)
    return float(max(conv)) if conv else None


def normalize_conservation_status(label: str) -> str:
    clean = label.strip()
    if clean.lower().endswith(" status"):
        clean = clean[:-7].strip()
    return clean


def is_usable_conservation_status(status: Optional[str]) -> bool:
    if not status:
        return False
    return not status.strip().casefold().startswith("data deficient")


def best_conservation_status(entity: Dict[str, Any], s: requests.Session, label_cache: Dict[str, Optional[str]]) -> Optional[str]:
    for qid in extract_item_claim_qids(entity, P_CONSERVATION_STATUS):
        label = wikidata_label(s, qid, label_cache)
        if label:
            return normalize_conservation_status(label)
    return None


def best_scientific_name(entity: Dict[str, Any]) -> Optional[str]:
    names = extract_string_claims(entity, P_TAXON_NAME)
    return names[0] if names else None


def wikipedia_url(title: str) -> str:
    return "https://en.wikipedia.org/wiki/" + quote(title.replace(" ", "_"), safe=":/()'%")


def filename_from_image_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    path = urlparse(url).path
    if not path:
        return None
    parts = [p for p in path.split("/") if p]
    if not parts:
        return None

    # Commons thumbnail URLs include ".../thumb/.../<filename>/<size>-<filename>".
    # We want the original filename segment, not the sized thumbnail name.
    if "thumb" in parts:
        i = parts.index("thumb")
        if len(parts) > i + 3:
            raw_name = parts[i + 3]
        else:
            raw_name = parts[-1]
    else:
        raw_name = parts[-1]

    name = unquote(raw_name)
    if not name:
        return None
    if name.lower().startswith("file:"):
        name = name[5:]
    return name


def has_supported_image_extension(filename: str) -> bool:
    lower = filename.lower()
    return any(lower.endswith(ext) for ext in IMAGE_FILE_EXTENSIONS)


def is_map_like_image_name_or_url(value: Optional[str]) -> bool:
    if not value:
        return False
    text = unquote(value).lower()
    tokens = re.split(r"[^a-z0-9]+", text)
    return any(token in MAP_LIKE_IMAGE_KEYWORDS for token in tokens if token)


def page_image_filenames_from_enwiki(s: requests.Session, title: str) -> List[str]:
    """
    Returns image filenames used by the page (without "File:" prefix), filtered to common
    raster image formats so we can seek non-map photos when the lead image is map-like.
    """
    j = _get_json(
        s,
        ENWIKI_API,
        params={
            "action": "query",
            "titles": title,
            "prop": "images",
            "imlimit": "max",
            "format": "json",
            "redirects": "1",
        },
    )
    pages = j.get("query", {}).get("pages", {})
    for _, page in pages.items():
        out: List[str] = []
        for img in page.get("images", []):
            raw = img.get("title")
            if not isinstance(raw, str):
                continue
            name = raw[5:] if raw.lower().startswith("file:") else raw
            name = name.strip().replace(" ", "_")
            if not name or not has_supported_image_extension(name):
                continue
            out.append(name)
        return out
    return []


def sparql_candidates(s: requests.Session, *, limit: int, order: str, min_sitelinks: int, max_sitelinks: Optional[int] = None) -> List[Candidate]:
    max_filter = f"FILTER(?sitelinks <= {max_sitelinks})" if max_sitelinks is not None else ""
    query = f"""
    SELECT ?item ?itemLabel ?title ?sitelinks WHERE {{
      ?item wdt:{P_INSTANCE_OF} wd:Q16521 ;
            wdt:{P_TAXON_RANK} wd:{Q_SPECIES} ;
            wdt:{P_PARENT_TAXON}* wd:{Q_MAMMAL} .
      ?article schema:about ?item ;
               schema:isPartOf <https://en.wikipedia.org/> ;
               schema:name ?title .
      ?item wikibase:sitelinks ?sitelinks .
      FILTER(?sitelinks >= {min_sitelinks})
      {max_filter}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    ORDER BY {order}(?sitelinks)
    LIMIT {limit}
    """
    j = _get_json(s, WIKIDATA_SPARQL, params={"format": "json", "query": query}, timeout=60)
    out: List[Candidate] = []
    for b in j.get("results", {}).get("bindings", []):
        out.append(
            Candidate(
                qid=qid_from_uri(b["item"]["value"]),
                label=b.get("itemLabel", {}).get("value", ""),
                enwiki_title=b["title"]["value"],
                sitelinks=int(b["sitelinks"]["value"]),
            )
        )
    return out


def wikidata_entity(s: requests.Session, qid: str) -> Dict[str, Any]:
    j = _get_json(
        s,
        WIKIDATA_API,
        params={
            "action": "wbgetentities",
            "ids": qid,
            "props": "labels|claims",
            "languages": "en",
            "format": "json",
        },
    )
    return j["entities"][qid]


def lead_image_from_enwiki(s: requests.Session, title: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (image_url, filename) using PageImages: prop=pageimages piprop=original|name.
    filename is like "Lion_waiting_in_Namibia.jpg" (no "File:" prefix).
    """
    j = _get_json(
        s,
        ENWIKI_API,
        params={
            "action": "query",
            "titles": title,
            "prop": "pageimages",
            "piprop": "original|name",
            "format": "json",
            "redirects": "1",
        },
    )
    pages = j.get("query", {}).get("pages", {})
    for _, page in pages.items():
        orig = page.get("original", {})
        url = orig.get("source")
        filename = page.get("pageimage") or filename_from_image_url(url)
        return url, filename
    return None, None


def commons_metadata_for_filename(s: requests.Session, filename: str) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """
    Given "Foo bar.jpg", query Commons file page metadata.
    Returns: (commons_file_page_url, direct_image_url, license_short, attribution)
    If file isn't on Commons, returns (None, None, None, None).
    """
    normalized = unquote(filename.strip())
    if normalized.lower().startswith("file:"):
        normalized = normalized[5:]
    title = "File:" + normalized.replace("_", " ")
    j = _get_json(
        s,
        COMMONS_API,
        params={
            "action": "query",
            "titles": title,
            "prop": "imageinfo",
            "iiprop": "url|extmetadata",
            "format": "json",
        },
    )
    pages = j.get("query", {}).get("pages", {})
    for _, page in pages.items():
        if "missing" in page:
            return None, None, None, None
        ii = (page.get("imageinfo") or [])
        if not ii:
            return None, None, None, None
        info = ii[0]
        ext = info.get("extmetadata", {}) or {}
        license_short = (ext.get("LicenseShortName") or {}).get("value")
        artist = (ext.get("Artist") or {}).get("value")
        credit = (ext.get("Credit") or {}).get("value")

        # crude but useful: a short attribution string
        attribution = None
        if artist and license_short:
            attribution = f"{artist} / {license_short}"
        elif credit and license_short:
            attribution = f"{credit} / {license_short}"
        elif license_short:
            attribution = license_short

        commons_file_page = "https://commons.wikimedia.org/wiki/" + quote(title.replace(" ", "_"))
        return commons_file_page, info.get("url"), license_short, attribution

    return None, None, None, None


def pageviews_last_30d(s: requests.Session, title: str) -> Optional[int]:
    """
    Approx “per month” popularity: total views over last 30 completed days (ending yesterday UTC).
    Uses Pageviews API per-article endpoint.
    """
    # API expects underscores and URL-encoding
    article = quote(title.replace(" ", "_"), safe="")
    end_date = datetime.now(timezone.utc).date() - timedelta(days=1)
    start_date = end_date - timedelta(days=29)

    # Format: YYYYMMDD00
    start = start_date.strftime("%Y%m%d") + "00"
    end = end_date.strftime("%Y%m%d") + "00"

    url = f"{PAGEVIEWS_API}/en.wikipedia/all-access/user/{article}/daily/{start}/{end}"
    j = _get_json(s, url, timeout=30)
    items = j.get("items", [])
    if not items:
        return 0
    return int(sum(i.get("views", 0) for i in items))


def build_csv(count: int, seed: int, out_path: str) -> None:
    rnd = random.Random(seed)
    s = session()
    label_cache: Dict[str, Optional[str]] = {}

    print(f"Starting mammal CSV build: count={count}, seed={seed}, out='{out_path}'")

    # Variety: popular + obscure
    print("Fetching popular mammal candidates from Wikidata...")
    popular = sparql_candidates(s, limit=1200, order="DESC", min_sitelinks=25)
    print(f"Fetched {len(popular)} popular candidates.")

    print("Fetching obscure mammal candidates from Wikidata...")
    obscure = sparql_candidates(s, limit=3500, order="ASC", min_sitelinks=2, max_sitelinks=20)
    print(f"Fetched {len(obscure)} obscure candidates.")

    pool = rnd.sample(popular, k=min(len(popular), count * 3)) + rnd.sample(obscure, k=min(len(obscure), count * 3))
    rnd.shuffle(pool)
    print(f"Candidate pool ready: {len(pool)} entries.")

    seen = set()
    rows: List[Dict[str, Any]] = []
    skipped_no_image = 0
    skipped_status = 0
    skipped_map_only = 0

    for idx, cand in enumerate(pool, start=1):
        if len(rows) >= count:
            break
        if cand.qid in seen:
            continue
        seen.add(cand.qid)

        # throttle lightly
        if idx % 25 == 0:
            time.sleep(0.5)

        try:
            ent = wikidata_entity(s, cand.qid)
        except Exception:
            continue

        mass_kg = best_mass_kg(ent)
        lifespan_yr = best_lifespan_yr(ent)
        gestation_days = best_gestation_days(ent)
        litter_size = best_litter_size(ent)
        max_speed_mph = best_speed_mph(ent)
        conservation_status = best_conservation_status(ent, s, label_cache)
        scientific_name = best_scientific_name(ent)

        # popularity
        try:
            views_30d = pageviews_last_30d(s, cand.enwiki_title)
        except Exception:
            views_30d = None

        # lead image from enwiki, but keep it ONLY if it resolves to a Commons file (reusable)
        image_url = None
        image_file_page = None
        image_license = None
        image_attribution = None

        try:
            _lead_url, filename = lead_image_from_enwiki(s, cand.enwiki_title)
            if filename:
                file_page, direct_url, lic, attrib = commons_metadata_for_filename(s, filename)
                # If not on Commons, we leave blank to avoid accidentally using non-free enwiki-only files.
                if direct_url and file_page:
                    image_url = direct_url
                    image_file_page = file_page
                    image_license = lic
                    image_attribution = attrib

                    # If the lead image appears to be a map/territory image, try to replace it
                    # with another non-map image used on the same page.
                    if is_map_like_image_name_or_url(filename) or is_map_like_image_name_or_url(direct_url):
                        page_images = page_image_filenames_from_enwiki(s, cand.enwiki_title)
                        fallback_found = False
                        for alt_filename in page_images:
                            if alt_filename == filename:
                                continue
                            if is_map_like_image_name_or_url(alt_filename):
                                continue
                            alt_file_page, alt_direct_url, alt_lic, alt_attrib = commons_metadata_for_filename(s, alt_filename)
                            if alt_direct_url and alt_file_page and not is_map_like_image_name_or_url(alt_direct_url):
                                image_url = alt_direct_url
                                image_file_page = alt_file_page
                                image_license = alt_lic
                                image_attribution = alt_attrib
                                fallback_found = True
                                break

                        if not fallback_found:
                            image_url = None
                            image_file_page = None
                            image_license = None
                            image_attribution = None
                            skipped_map_only += 1
        except Exception:
            pass

        if not image_url:
            skipped_no_image += 1
            continue
        if not is_usable_conservation_status(conservation_status):
            skipped_status += 1
            continue

        rows.append(
            {
                "wikidata_id": cand.qid,
                "common_name": cand.label,
                "scientific_name": scientific_name,
                "wikipedia_title": cand.enwiki_title,
                "source_url": wikipedia_url(cand.enwiki_title),

                "mass_kg": mass_kg,
                "lifespan_yr": lifespan_yr,
                "gestation_days": gestation_days,
                "litter_size": litter_size,
                "max_speed_mph": max_speed_mph,
                "conservation_status": conservation_status,

                "pageviews_30d": views_30d,

                "image_url": image_url,
                "image_file_page": image_file_page,
                "image_license": image_license,
                "image_attribution": image_attribution,
            }
        )

        if len(rows) % 25 == 0:
            print(f"Collected {len(rows)}/{count} rows so far (latest: {cand.label}).")
        if idx % 100 == 0:
            print(f"Scanned {idx}/{len(pool)} candidates; valid rows={len(rows)}.")

    fieldnames = [
        "wikidata_id",
        "common_name",
        "scientific_name",
        "wikipedia_title",
        "source_url",
        "mass_kg",
        "lifespan_yr",
        "gestation_days",
        "litter_size",
        "max_speed_mph",
        "conservation_status",
        "pageviews_30d",
        "image_url",
        "image_file_page",
        "image_license",
        "image_attribution",
    ]

    print(f"Skipped {skipped_no_image} candidates with no reusable image.")
    print(f"Skipped {skipped_map_only} candidates with only map-like images on page.")
    print("Skipped "
          f"{skipped_status} candidates with missing/Data Deficient conservation status.")
    print(f"Writing {len(rows)} rows to CSV: {out_path}")
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)

    print(f"Wrote {len(rows)} rows to {out_path}")
    if len(rows) < count:
        print("Tip: rerun with a different --seed or increase the SPARQL limits in the script.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=200)
    ap.add_argument("--seed", type=int, default=20260207)
    ap.add_argument("--out", type=str, default="mammals_mvp.csv")
    args = ap.parse_args()
    build_csv(args.count, args.seed, args.out)


if __name__ == "__main__":
    main()
