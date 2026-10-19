// Shared question contract: renderer and host must validate the same choices.
export const TRADING_PREFERENCE_CHOICE_FIELDS = {
  1: [{
    id: "risk", title: "单笔最大亏损占账户净值的比例", defaultValue: "2",
    options: ["0.5", "1", "2", "3"].map((value) => ({ value, label: value === "2" ? "2%（推荐）" : `${value}%` })),
    placeholder: "例如：1.5%，仅在信号充分时交易",
  }],
  2: [{
    id: "breakEven", title: "何时将止损移动到保本位置？", defaultValue: "1",
    options: [
      { value: "0.5", label: "浮盈达到 0.5R" },
      { value: "1", label: "浮盈达到 1R（推荐）" },
      { value: "1.5", label: "浮盈达到 1.5R" },
      { value: "2", label: "浮盈达到 2R" },
      { value: "off", label: "不自动移动保本" },
    ],
    placeholder: "例如：1.2R，保本时覆盖手续费和滑点；或填写“不移动保本”及说明",
  }, {
    id: "ratio", title: "最低可接受的净盈亏比", defaultValue: "0.4",
    options: ["0.4", "1", "1.5", "2", "3"].map((value) => ({ value, label: value === "0.4" ? "1:0.4（推荐）" : `1:${value}` })),
    placeholder: "例如：1:1.8，仅考虑扣除交易成本后的盈利空间",
  }],
  3: [{
    id: "style", title: "默认分析方式", defaultValue: "concise",
    options: [{ value: "concise", label: "简洁，遇到高风险时详细说明（推荐）" }, { value: "detailed", label: "详细，展开分析依据和过程" }],
    placeholder: "例如：先给结论，再用三条要点解释原因",
  }, {
    id: "sections", title: "持仓分析和交易计划的内容", defaultValue: "fixed",
    options: [{ value: "fixed", label: "固定包含完整分析栏目（推荐）" }, { value: "adaptive", label: "根据当前问题按需选择栏目" }],
    placeholder: "例如：固定包含关键价位、止损、止盈和失效条件",
  }, {
    id: "discipline", title: "需要补充的交易纪律", multiple: true, defaultValue: "none",
    options: [
      { value: "no-add", label: "不允许亏损加仓" },
      { value: "trend", label: "不做逆势交易" },
      { value: "news", label: "不在重大数据公布前开仓" },
      { value: "no-chase", label: "不追涨杀跌" },
      { value: "none", label: "暂无补充，沿用基础交易纪律" },
    ],
    placeholder: "填写其他纪律或具体说明，可与上面的选项一起勾选",
  }],
};
