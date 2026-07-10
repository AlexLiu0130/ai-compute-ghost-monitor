import json
import unittest
from pathlib import Path

from ghost_monitor.scorer import analyze
from ghost_monitor.scorer import normalize_ghost_score
from ghost_monitor.firecrawl_client import is_bad_markdown
from ghost_monitor.server import _capture_queries, _next_capture_mode
from ghost_monitor.backfill_history import case_from_analysis
from ghost_monitor.market_impact import latest_available_trading_day
from ghost_monitor.translator import cache_key, translation_needed
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]


class ScorerTest(unittest.TestCase):
    def test_meta_excess_compute_is_alert_and_bearish_suppliers(self):
        row = analyze(json.loads((ROOT / "samples/meta_excess_compute.json").read_text()))
        self.assertEqual(row.ghost_type, "compute_overcapacity")
        self.assertEqual(row.alert_level, "alert")
        self.assertEqual(row.ticker_directions["NVDA"], "bearish")
        self.assertEqual(row.ticker_directions["MU"], "bearish")
        self.assertEqual(row.ticker_directions["META"], "mixed")

    def test_capacity_expansion_is_bearish_for_memory(self):
        row = analyze(json.loads((ROOT / "samples/korea_chip_investment.json").read_text()))
        self.assertEqual(row.ghost_type, "capacity_flood")
        self.assertEqual(row.ticker_directions["MU"], "bearish")

    def test_sk_hynix_alias_maps_to_korea_symbol(self):
        row = analyze({"title": "SK Hynix HBM shortage sold out", "source": "Reuters"})
        self.assertIn("000660.KS", row.symbols)
        self.assertEqual(row.ticker_directions["000660.KS"], "bullish")

    def test_ordinary_ai_news_stays_log(self):
        row = analyze({"title": "AI software company launches feature", "source": "blog"})
        self.assertEqual(row.alert_level, "log")

    def test_sk_hynix_listing_is_watch(self):
        row = analyze(json.loads((ROOT / "samples/sk_hynix_listing.json").read_text()))
        self.assertEqual(row.ghost_type, "capital_markets_memory")
        self.assertEqual(row.alert_level, "watch")

    def test_routing_does_not_match_chip_rout(self):
        row = analyze({
            "title": "What Makes Arista Networks One of BlackRock's Most Important AI Stocks",
            "summary": "The company specializes in networking solutions for AI, data centers, and routing architectures.",
            "source": "Yahoo Finance",
            "symbols": ["ANET"],
        })
        self.assertEqual(row.ghost_type, "ordinary_ai_news")
        self.assertEqual(row.alert_level, "log")

    def test_firecrawl_rejects_block_pages(self):
        self.assertTrue(is_bad_markdown("Oops, something went wrong. Try again later."))
        self.assertFalse(is_bad_markdown("AI compute capacity " * 40))

    def test_capture_schedule_uses_tiered_queries(self):
        self.assertEqual(_capture_queries("global"), [[]])
        self.assertEqual(len(_capture_queries("core")), 1)
        self.assertGreater(len(_capture_queries("full")), 1)
        self.assertEqual(_next_capture_mode(datetime(2026, 7, 7, 21, 5), {}), "full_eod")

    def test_backfill_case_id_is_stable(self):
        item = {"published_at": "20260707T120000", "url": "https://example.com/a", "title": "A", "summary": "", "source": "x"}
        analysis = {"ghost_type": "hbm_shortage", "ticker_directions": {}, "symbols": [], "ghost_score": 1, "alert_level": "log"}
        self.assertEqual(case_from_analysis(item, analysis)["id"], case_from_analysis(item, analysis)["id"])

    def test_ghost_score_curve_keeps_alerts_visible(self):
        self.assertEqual(normalize_ghost_score(1), 0)
        self.assertGreaterEqual(normalize_ghost_score(81), 60)
        self.assertEqual(normalize_ghost_score(243), 100)

    def test_reaction_bar_becomes_available_after_market_close(self):
        self.assertEqual(latest_available_trading_day(datetime(2026, 7, 10, 20, 59)).isoformat(), "2026-07-09")
        self.assertEqual(latest_available_trading_day(datetime(2026, 7, 10, 21, 1)).isoformat(), "2026-07-10")

    def test_empty_translation_cache_entry_is_retried(self):
        row = {"title": "AI compute warning", "summary": "Demand may weaken."}
        key = cache_key(row["title"], row["summary"])
        self.assertTrue(translation_needed(row, {key: {"title_zh": "", "summary_zh": ""}}))
        self.assertFalse(translation_needed(row, {key: {"title_zh": "AI 算力警告", "summary_zh": "需求可能走弱。"}}))


if __name__ == "__main__":
    unittest.main()
