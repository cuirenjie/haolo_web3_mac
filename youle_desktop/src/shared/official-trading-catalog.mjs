// Public UI metadata. Official calculation and strategy prompts are server-owned.
export const OFFICIAL_TRADING_CATALOG = Object.freeze([
  {
    "schemaVersion": 1,
    "id": "chan",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "缠论",
      "group": "strategy",
      "sortOrder": 10
    },
    "mentions": {
      "canonical": "缠论",
      "aliases": []
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "macd-analysis",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "MACD",
      "group": "indicator",
      "sortOrder": 10
    },
    "mentions": {
      "canonical": "MACD",
      "aliases": [
        "MACD指标",
        "MACD分析",
        "指数平滑异同移动平均线"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "chartIndicator": {
      "id": "macd",
      "scope": "sub",
      "parameters": [
        12,
        26,
        9
      ]
    },
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "moving-average-analysis",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "均线",
      "group": "indicator",
      "sortOrder": 15
    },
    "mentions": {
      "canonical": "均线",
      "aliases": [
        "MA",
        "MA指标",
        "移动平均线",
        "均线系统",
        "均线分析",
        "SMA"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "chartIndicator": {
      "id": "ma",
      "scope": "main",
      "parameters": [
        5,
        20,
        60
      ]
    },
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "bollinger-bands-analysis",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "布林带",
      "group": "indicator",
      "sortOrder": 20
    },
    "mentions": {
      "canonical": "布林带",
      "aliases": [
        "BOLL",
        "BOLL指标",
        "布林线",
        "布林带分析",
        "Bollinger Bands"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "chartIndicator": {
      "id": "boll",
      "scope": "main",
      "parameters": [
        20,
        2
      ]
    },
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "order-flow",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "订单流",
      "group": "strategy",
      "sortOrder": 20
    },
    "mentions": {
      "canonical": "订单流",
      "aliases": [
        "Order Flow"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "ict-smc",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "ICT / SMC",
      "group": "strategy",
      "sortOrder": 25
    },
    "mentions": {
      "canonical": "ICT/SMC",
      "aliases": [
        "ICT",
        "SMC",
        "聪明钱概念",
        "Smart Money Concepts"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "smt-divergence",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "SMT 背离",
      "group": "strategy",
      "sortOrder": 28
    },
    "mentions": {
      "canonical": "SMT背离",
      "aliases": [
        "SMT",
        "Smart Money Technique"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "rsi-analysis",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "RSI",
      "group": "indicator",
      "sortOrder": 30
    },
    "mentions": {
      "canonical": "RSI",
      "aliases": [
        "RSI指标",
        "RSI分析",
        "相对强弱指标",
        "相对强弱指数",
        "超买超卖",
        "RSI背离",
        "失败摆动"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "chartIndicator": {
      "id": "rsi",
      "scope": "sub",
      "parameters": [
        14
      ]
    },
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "wave",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "波浪理论",
      "group": "strategy",
      "sortOrder": 30
    },
    "mentions": {
      "canonical": "波浪理论",
      "aliases": [
        "波浪",
        "Elliott Wave"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "kdj-analysis",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "KDJ",
      "group": "indicator",
      "sortOrder": 35
    },
    "mentions": {
      "canonical": "KDJ",
      "aliases": [
        "KDJ指标",
        "KDJ分析",
        "随机指标KDJ",
        "随机指标",
        "KDJ金叉",
        "KDJ死叉",
        "KDJ背离"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "chartIndicator": {
      "id": "kdj",
      "scope": "sub",
      "parameters": [
        9,
        3,
        3
      ]
    },
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "vpvr-analysis",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "VPVR",
      "group": "indicator",
      "sortOrder": 40
    },
    "mentions": {
      "canonical": "VPVR",
      "aliases": [
        "VPVR分析",
        "可见范围成交量分布",
        "成交量分布",
        "Volume Profile",
        "POC分析",
        "价值区分析"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing"
    ],
    "chartIndicator": {
      "id": "vpvr",
      "scope": "main",
      "parameters": [
        96
      ]
    },
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "wyckoff",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "威科夫",
      "group": "strategy",
      "sortOrder": 40
    },
    "mentions": {
      "canonical": "威科夫",
      "aliases": [
        "Wyckoff"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "harmonic",
    "version": "2.3.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "谐波形态",
      "group": "strategy",
      "sortOrder": 50
    },
    "mentions": {
      "canonical": "谐波形态",
      "aliases": [
        "谐波",
        "Harmonic"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "chart-patterns",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "图表形态学",
      "group": "strategy",
      "sortOrder": 60
    },
    "mentions": {
      "canonical": "图表形态学",
      "aliases": [
        "图表形态",
        "传统图表形态",
        "Chart Patterns"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "price-action",
    "version": "1.1.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "裸K分析",
      "group": "strategy",
      "sortOrder": 70
    },
    "mentions": {
      "canonical": "裸K分析",
      "aliases": [
        "裸K",
        "价格行为学",
        "价格行为",
        "Price Action"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "dow-theory",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "道氏理论",
      "group": "strategy",
      "sortOrder": 80
    },
    "mentions": {
      "canonical": "道氏理论",
      "aliases": [
        "道氏",
        "道氏趋势",
        "Dow Theory"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  },
  {
    "schemaVersion": 1,
    "id": "gann-theory",
    "version": "1.0.0",
    "publisher": {
      "id": "haolo",
      "type": "official"
    },
    "display": {
      "name": "江恩理论",
      "group": "strategy",
      "sortOrder": 90
    },
    "mentions": {
      "canonical": "江恩理论",
      "aliases": [
        "江恩",
        "江恩角度线",
        "Gann Theory"
      ]
    },
    "capabilities": [
      "conversation",
      "chart-analysis",
      "drawing",
      "execution-plan"
    ],
    "implementation": {
      "kind": "cloud-v1"
    },
    "enabled": true
  }
].map(item => Object.freeze(item)));
