import argparse
import csv
from pathlib import Path


MISSING_SENTINEL = -999.0

PANTHERIA_TO_TARGET = {
    "5-1_AdultBodyMass_g": "mass_kg",
    "9-1_GestationLen_d": "gestation_days",
    "15-1_LitterSize": "litter_size",
    "17-1_MaxLongevity_m": "lifespan_yr",
}


def normalize_name(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def to_binomial(normalized_name: str) -> str:
    parts = normalized_name.split()
    if len(parts) >= 2:
        return f"{parts[0]} {parts[1]}"
    return normalized_name


def parse_pantheria_number(raw: str):
    if raw is None:
        return None
    raw = raw.strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    if value <= MISSING_SENTINEL:
        return None
    return value


def format_number(value: float, decimals: int) -> str:
    text = f"{value:.{decimals}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def convert_trait(source_column: str, value: float):
    if value is None:
        return None
    if source_column == "5-1_AdultBodyMass_g":
        mass_kg = value / 1000.0
        if mass_kg < 1:
            return format_number(mass_kg, 3)
        return format_number(mass_kg, 1)
    if source_column == "9-1_GestationLen_d":
        return format_number(value, 1)
    if source_column == "15-1_LitterSize":
        if abs(value - round(value)) < 1e-9:
            return str(int(round(value)))
        return format_number(value, 2)
    if source_column == "17-1_MaxLongevity_m":
        return format_number(value / 12.0, 1)
    return None


def load_pantheria_index(path: Path):
    index = {}
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            key = normalize_name(row.get("MSW05_Binomial", ""))
            if key and key not in index:
                index[key] = row
    return index


def fill_and_filter_mammals(mammals_path: Path, pantheria_index):
    kept_rows = []
    stats = {
        "total": 0,
        "dropped_no_match": 0,
        "dropped_too_sparse": 0,
        "kept": 0,
    }

    with mammals_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        if not fieldnames:
            raise ValueError(f"No header found in {mammals_path}")

        for mammal_row in reader:
            stats["total"] += 1
            sci_name = normalize_name(mammal_row.get("scientific_name", ""))
            pantheria_row = pantheria_index.get(sci_name)
            if pantheria_row is None:
                pantheria_row = pantheria_index.get(to_binomial(sci_name))

            if pantheria_row is None:
                stats["dropped_no_match"] += 1
                continue

            mapped_count = 0
            for source_col, target_col in PANTHERIA_TO_TARGET.items():
                source_value = parse_pantheria_number(pantheria_row.get(source_col))
                converted = convert_trait(source_col, source_value)
                if converted is not None:
                    mapped_count += 1
                    mammal_row[target_col] = converted
                else:
                    mammal_row[target_col] = mammal_row.get(target_col, "")

            if mapped_count < 2:
                stats["dropped_too_sparse"] += 1
                continue

            kept_rows.append(mammal_row)

        stats["kept"] = len(kept_rows)
    return fieldnames, kept_rows, stats


def write_csv(path: Path, fieldnames, rows):
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Fill mammal traits from PanTHERIA by scientific name and drop rows "
            "that do not meet minimum data completeness."
        )
    )
    parser.add_argument(
        "--mammals",
        default="mammals.csv",
        help="Input mammals CSV path (default: mammals.csv)",
    )
    parser.add_argument(
        "--pantheria",
        default="PanTHERIA_1-0_WR05_Aug2008.txt",
        help="Input PanTHERIA TXT path (default: PanTHERIA_1-0_WR05_Aug2008.txt)",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output CSV path (default: overwrite --mammals file)",
    )
    args = parser.parse_args()

    mammals_path = Path(args.mammals)
    pantheria_path = Path(args.pantheria)
    output_path = Path(args.output) if args.output else mammals_path

    pantheria_index = load_pantheria_index(pantheria_path)
    fieldnames, rows, stats = fill_and_filter_mammals(mammals_path, pantheria_index)
    write_csv(output_path, fieldnames, rows)

    print(f"PanTHERIA species indexed: {len(pantheria_index)}")
    print(f"Total mammals read: {stats['total']}")
    print(f"Dropped (no PanTHERIA match): {stats['dropped_no_match']}")
    print(f"Dropped (fewer than 2 mapped traits): {stats['dropped_too_sparse']}")
    print(f"Rows written: {stats['kept']}")
    print(f"Output file: {output_path}")


if __name__ == "__main__":
    main()
