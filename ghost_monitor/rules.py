SOURCE_TIER = {
    "sec": 3,
    "company ir": 3,
    "earnings call": 3,
    "earnings transcript": 3,
    "reuters": 3,
    "bloomberg": 3,
    "dow jones": 3,
    "wall street journal": 2,
    "wsj": 2,
    "financial times": 2,
    "ft": 2,
    "cnbc": 2,
    "techcrunch": 2,
    "business insider": 2,
    "fortune": 2,
    "barron's": 2,
    "tom's hardware": 2,
    "yahoo": 2,
    "alpha vantage": 2,
    "finnhub": 2,
}

GHOST_TYPES = {
    "compute_overcapacity": {
        "keywords": ["excess compute", "excess ai compute", "excess ai computing", "excess capacity", "sell compute", "selling capacity", "low utilization", "overcapacity", "compute glut"],
        "layers": {
            "hyperscaler": "mixed",
            "accelerator": "bearish",
            "foundry_equipment_eda": "bearish",
            "memory_storage": "bearish",
            "server_infra": "bearish",
            "compute_leasing": "bearish",
            "power_cooling": "bearish",
            "basket": "bearish",
        },
    },
    "capex_roi_doubt": {
        "keywords": ["roi", "return on investment", "overspending", "capex too high", "free cash flow pressure", "monetization weak", "spending concerns", "ai spending", "cheaper model", "efficiency shock"],
        "layers": {
            "hyperscaler": "bearish",
            "accelerator": "bearish",
            "foundry_equipment_eda": "bearish",
            "memory_storage": "bearish",
            "server_infra": "bearish",
            "basket": "bearish",
        },
    },
    "order_inventory_weakness": {
        "keywords": ["order cut", "orders cut", "inventory build", "lead time down", "backlog weakness", "cancelled order", "weak report", "selloff", "rout", "slump", "tumbling"],
        "layers": {
            "accelerator": "bearish",
            "foundry_equipment_eda": "bearish",
            "memory_storage": "bearish",
            "server_infra": "bearish",
            "basket": "bearish",
        },
    },
    "hbm_shortage": {
        "keywords": ["hbm shortage", "sold out", "memory shortage", "price hike", "allocation", "supply tight", "reserved supply"],
        "layers": {
            "memory_storage": "bullish",
            "foundry_equipment_eda": "bullish",
            "accelerator": "mixed",
            "basket": "bullish",
        },
    },
    "capacity_flood": {
        "keywords": ["new fabs", "capacity expansion", "supply flood", "price war", "massive investment", "production capacity"],
        "layers": {
            "memory_storage": "bearish",
            "foundry_equipment_eda": "bullish",
            "accelerator": "bullish",
            "basket": "mixed",
        },
    },
    "data_center_delay": {
        "keywords": ["data center delay", "lease cancellation", "power constraint", "permitting delay", "grid constraint"],
        "layers": {
            "hyperscaler": "bearish",
            "compute_leasing": "bearish",
            "server_infra": "mixed",
            "power_cooling": "bullish",
        },
    },
    "financing_stress": {
        "keywords": ["debt financing", "equity raise", "negative free cash flow", "customer concentration", "refinancing"],
        "layers": {
            "compute_leasing": "bearish",
            "server_infra": "bearish",
            "basket": "bearish",
        },
    },
    "capital_markets_memory": {
        "keywords": ["nasdaq listing", "us listing", "adr listing", "public offering", "ai memory trade"],
        "layers": {
            "memory_storage": "mixed",
            "basket": "mixed",
        },
    },
    "export_regulatory": {
        "keywords": ["export control", "restriction", "sanction", "antitrust", "doj", "ftc", "eu probe"],
        "layers": {
            "accelerator": "bearish",
            "foundry_equipment_eda": "bearish",
            "basket": "bearish",
        },
    },
}
