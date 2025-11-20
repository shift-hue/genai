from __future__ import annotations

import csv
import random
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple

from .config_loader import project_paths, load_settings
from .preprocessing import normalize_text


@dataclass
class CategorySpec:
    id: str
    merchants: List[str]
    patterns: List[str]


CATEGORIES: List[CategorySpec] = [
    CategorySpec(
        id="GROCERIES",
        merchants=["Walmart", "Aldi", "Tesco", "Safeway", "Kroger"],
        patterns=["grocery", "supermarket", "food market"],
    ),
    CategorySpec(
        id="RESTAURANTS",
        merchants=["McDonalds", "Starbucks", "KFC", "Burger King"],
        patterns=["restaurant", "cafe", "dining", "fast food"],
    ),
    CategorySpec(
        id="TRANSPORT",
        merchants=["Uber", "Lyft", "City Metro", "Shell"],
        patterns=["taxi", "ride", "bus", "train", "fuel"],
    ),
    CategorySpec(
        id="UTILITIES",
        merchants=["City Power", "Water Corp", "Gas Co"],
        patterns=["electric bill", "water bill", "gas bill", "utilities"],
    ),
    CategorySpec(
        id="RENT",
        merchants=["Main St Rentals", "Home Mortgage"],
        patterns=["rent", "mortgage"],
    ),
    CategorySpec(
        id="INCOME",
        merchants=["ACME Payroll", "Initech Ltd"],
        patterns=["salary", "payroll", "bonus"],
    ),
    CategorySpec(
        id="ENTERTAINMENT",
        merchants=["Netflix", "Spotify", "Cinema World"],
        patterns=["subscription", "movie", "music"],
    ),
    CategorySpec(
        id="HEALTHCARE",
        merchants=["City Pharmacy", "General Hospital"],
        patterns=["pharmacy", "hospital", "clinic"],
    ),
    CategorySpec(
        id="SHOPPING",
        merchants=["Amazon", "eBay", "Mall Plaza"],
        patterns=["online store", "retail", "shopping"],
    ),
    CategorySpec(
        id="SUBSCRIPTIONS",
        merchants=["Cloud Storage Co", "News Daily"],
        patterns=["monthly plan", "subscription", "membership"],
    ),
]


def add_noise(description: str) -> str:
    """Inject simple noise: misspellings, abbreviations, digits."""

    text = description

    # Random abbreviation
    replacements = {
        "street": "st",
        "road": "rd",
        "avenue": "ave",
        "department": "dept",
    }
    for k, v in replacements.items():
        if random.random() < 0.2 and k in text.lower():
            text = re_sub_case_insensitive(k, v, text)

    # Random misspelling
    typos = {
        "payment": "paymnt",
        "grocery": "grocry",
        "restaurant": "restarant",
        "subscription": "subscrption",
    }
    for k, v in typos.items():
        if random.random() < 0.15 and k in text.lower():
            text = re_sub_case_insensitive(k, v, text)

    # Optional trailing digits
    if random.random() < 0.4:
        text = f"{text} {random.randint(10, 9999)}"

    return text


def re_sub_case_insensitive(pattern: str, repl: str, text: str) -> str:
    import re

    return re.sub(pattern, repl, text, flags=re.IGNORECASE)


def generate_examples_per_category(n_per_category: int) -> List[Tuple[str, float, str, str]]:
    rows: List[Tuple[str, float, str, str]] = []
    for spec in CATEGORIES:
        for _ in range(n_per_category):
            merchant = random.choice(spec.merchants)
            pattern = random.choice(spec.patterns)
            amount = round(random.uniform(3.0, 300.0), 2)
            base_desc = f"{merchant} {pattern}"
            noisy_desc = add_noise(base_desc)
            normalized = normalize_text(noisy_desc)
            rows.append((noisy_desc, amount, merchant, spec.id))
    return rows


def split_dataset(rows: List[Tuple[str, float, str, str]]):
    random.shuffle(rows)
    n = len(rows)
    n_train = int(0.7 * n)
    n_val = int(0.15 * n)
    train = rows[:n_train]
    val = rows[n_train : n_train + n_val]
    test = rows[n_train + n_val :]
    return train, val, test


def write_split(path: Path, rows: List[Tuple[str, float, str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["description", "amount", "merchant", "category_id"])
        writer.writerows(rows)


def main() -> None:
    settings = load_settings()
    random.seed(settings.random_seed)

    paths = project_paths()
    data_dir: Path = paths["data"] / "generated"
    data_dir.mkdir(parents=True, exist_ok=True)

    # 10 categories, at least 500 samples overall
    n_per_category = 60  # 10 * 60 = 600
    rows = generate_examples_per_category(n_per_category)
    train, val, test = split_dataset(rows)

    write_split(data_dir / "train.csv", train)
    write_split(data_dir / "val.csv", val)
    write_split(data_dir / "test.csv", test)


if __name__ == "__main__":  # pragma: no cover
    main()
