from __future__ import annotations

from .ml_model import train_from_reports


def main() -> int:
    model = train_from_reports()
    print(f"trained {len(model['counts'])} buckets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
