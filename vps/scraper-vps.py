from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path

from vps.scraper_vps import scrape_onpe_vps


def main() -> int:
    project_root = Path(__file__).resolve().parent.parent
    data_dir = project_root / "data"
    output_dir = project_root / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)
    profile_dir = Path("/var/lib/election-counter/browser-profile")
    browser_path = "/opt/election-counter/.venv/lib/python3.11/site-packages/playwright/driver/package/.local-browsers/chromium-1208/chrome-linux64/chrome"
    while True:
        started = datetime.now(timezone.utc).isoformat()
        raw = scrape_onpe_vps(
            data_dir=data_dir,
            headed=True,
            browser_channel="chromium",
            user_data_dir=profile_dir,
            executable_path=browser_path,
        )
        (output_dir / "vps_last_run.json").write_text(
            raw.get("metadata", {}).get("mode", ""),
            encoding="utf-8",
        )
        print(raw.get("metadata", {}).get("mode", ""))
        print(f"[vps] cycle started: {started}")
        print(f"[vps] cycle warnings: {raw.get('metadata', {}).get('warnings', [])}")
        time.sleep(1800)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
