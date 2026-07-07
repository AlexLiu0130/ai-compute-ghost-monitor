LAYERS = {
    "hyperscaler": ["META", "MSFT", "GOOGL", "AMZN", "ORCL"],
    "accelerator": ["NVDA", "AMD", "AVGO", "MRVL", "INTC", "QCOM", "ANET"],
    "foundry_equipment_eda": ["TSM", "ASML", "AMAT", "LRCX", "KLAC", "SNPS", "CDNS"],
    "memory_storage": ["MU", "WDC", "SNDK", "STX", "005930.KS", "000660.KS"],
    "server_infra": ["SMCI", "DELL", "HPE", "VRT", "ETN", "APH", "GLW"],
    "compute_leasing": ["CRWV", "NBIS"],
    "power_cooling": ["CEG", "VST", "NRG", "PWR", "TT", "CARR"],
    "basket": ["SMH", "SOXX", "QQQ", "XLK"],
}

ALIASES = {
    "SAMSUNG": "005930.KS",
    "SAMSUNG ELECTRONICS": "005930.KS",
    "SK HYNIX": "000660.KS",
    "SKHYNIX": "000660.KS",
    "HYNIX": "000660.KS",
}

SYMBOL_TO_LAYER = {symbol: layer for layer, symbols in LAYERS.items() for symbol in symbols}
