import argparse
import csv
from pathlib import Path


MISSING_SENTINEL = -999.0
PANTHERIA_POP_COLUMN = "10-1_PopulationGrpSize"
DEFAULT_OUTPUT_SUFFIX = "_with_population_grp_size"


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


def format_number(value: float) -> str:
    if abs(value - round(value)) < 1e-9:
        return str(int(round(value)))
    text = f"{value:.2f}"
    return text.rstrip("0").rstrip(".")


def load_pantheria_index(path: Path):
    index = {}
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            key = normalize_name(row.get("MSW05_Binomial", ""))
            if key and key not in index:
                index[key] = row
    return index


def fill_population_group_size(
    mammals_path: Path, pantheria_index, output_path: Path, target_column: str
):
    stats = {
        "total": 0,
        "matched": 0,
        "filled": 0,
        "missing_trait": 0,
        "no_match": 0,
    }

    with mammals_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        if not fieldnames:
            raise ValueError(f"No header found in {mammals_path}")

        if target_column not in fieldnames:
            fieldnames = [*fieldnames, target_column]

        rows = []
        for row in reader:
            stats["total"] += 1
            sci_name = normalize_name(row.get("scientific_name", ""))
            pantheria_row = pantheria_index.get(sci_name)
            if pantheria_row is None:
                pantheria_row = pantheria_index.get(to_binomial(sci_name))

            if pantheria_row is None:
                stats["no_match"] += 1
                row[target_column] = row.get(target_column, "")
                rows.append(row)
                continue

            stats["matched"] += 1
            raw_value = parse_pantheria_number(pantheria_row.get(PANTHERIA_POP_COLUMN))
            if raw_value is None:
                stats["missing_trait"] += 1
                row[target_column] = row.get(target_column, "")
            else:
                row[target_column] = format_number(raw_value)
                stats["filled"] += 1
            rows.append(row)

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return stats


def default_paths():
    script_dir = Path(__file__).resolve().parent
    mammals = script_dir.parent / "mammals2026.csv"
    pantheria = script_dir / "PanTHERIA_1-0_WR05_Aug2008.txt"
    output = mammals.with_name(f"{mammals.stem}{DEFAULT_OUTPUT_SUFFIX}{mammals.suffix}")
    return mammals, pantheria, output


def main():
    default_mammals, default_pantheria, default_output = default_paths()

    parser = argparse.ArgumentParser(
        description=(
            "Add a population group size column to a mammals CSV using PanTHERIA "
            "matching by scientific name."
        )
    )
    parser.add_argument(
        "--mammals",
        default=str(default_mammals),
        help=f"Input mammals CSV path (default: {default_mammals})",
    )
    parser.add_argument(
        "--pantheria",
        default=str(default_pantheria),
        help=f"Input PanTHERIA TXT path (default: {default_pantheria})",
    )
    parser.add_argument(
        "--output",
        default=str(default_output),
        help=f"Output CSV path (default: {default_output})",
    )
    parser.add_argument(
        "--column-name",
        default="population_grp_size",
        help="Target output column name (default: population_grp_size)",
    )
    args = parser.parse_args()

    mammals_path = Path(args.mammals)
    pantheria_path = Path(args.pantheria)
    output_path = Path(args.output)
    target_column = args.column_name

    pantheria_index = load_pantheria_index(pantheria_path)
    stats = fill_population_group_size(
        mammals_path=mammals_path,
        pantheria_index=pantheria_index,
        output_path=output_path,
        target_column=target_column,
    )

    print(f"PanTHERIA species indexed: {len(pantheria_index)}")
    print(f"Rows read: {stats['total']}")
    print(f"Scientific name matches: {stats['matched']}")
    print(f"Filled '{target_column}': {stats['filled']}")
    print(f"Matched but missing PanTHERIA trait: {stats['missing_trait']}")
    print(f"No PanTHERIA match: {stats['no_match']}")
    print(f"Output file: {output_path}")


if __name__ == "__main__":
    main()
