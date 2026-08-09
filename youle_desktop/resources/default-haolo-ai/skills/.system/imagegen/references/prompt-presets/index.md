# Youle Image Prompt Presets

This directory contains Youle-specific prompt presets for common Chinese image generation workflows.

This index is the local data source for `scripts/resolve_prompt_preset.py`. For every image-generation request, run that resolver first; merge its selected preset text or retain its explicit `preset_id=none` check, then submit through the gated Director using canonical model `aihubcc/gpt-image-2`. Do not manually scan this index on the normal path. Preserve user-provided subject matter, exact visible text, product facts, dimensions, identity constraints, and avoid items.

## Presets

- `上报纸` / `报纸头版` / `新闻报纸`: `上报纸提示词.txt`
- `发型设计` / `发型分析` / `发型咨询` / `换发型`: `发型设计提示词.txt`
- `古风摄影` / `古风写真` / `汉服摄影`: `古风摄影提示词.txt`
- `图片标记` / `图片标注` / `图中标记`: `图片标记提示词.txt`
- `婴儿四维彩超` / `四维彩超` / `宝宝彩超`: `婴儿四维彩超提示词.txt`
- `小红书卡片` / `小红书笔记卡片` / `种草卡片`: `小红书卡片提示词.txt`
- `小红书封面图` / `小红书封面` / `小红书生活方式封面`: `小红书封面图提示词.txt`
- `情侣头像` / `情侣头像生成`: `情侣头像提示词.txt`
- `手相` / `手相分析`: `手相提示词.txt`
- `掌纹` / `掌纹分析`: `掌纹提示词.txt`
- `数据转图` / `数据可视化图` / `把数据变成图`: `数据转图提示词.txt`
- `日记变漫画` / `日记漫画` / `漫画日记`: `日记变漫画提示词.txt`
- `旧报纸风格` / `复古报纸` / `老报纸风格`: `旧报纸风格提示词.txt`
- `植物识别` / `识别植物` / `植物科普图`: `植物识别提示词.txt`
- `流程图` / `业务流程图` / `流程图海报`: `流程图提示词.txt`
- `海报` / `活动海报` / `宣传海报`: `海报提示词.txt`
- `照片拼贴` / `拼贴图` / `照片墙`: `照片拼贴提示词.txt`
- `电商展示图` / `商品展示图` / `电商主图`: `电商展示图提示词.txt`
- `电商详情页` / `商品详情页` / `详情页长图`: `电商详情页提示词.txt`
- `真实照片` / `真实摄影` / `真人实拍感`: `真实照片提示词.txt`
- `老照片修复` / `旧照片修复` / `照片修复上色`: `老照片修复提示词.txt`
- `聊天界面` / `聊天截图` / `对话界面`: `聊天界面提示词.txt`
- `表情包` / `梗图` / `微信表情`: `表情包提示词.txt`
- `邀请函` / `请柬` / `活动邀请`: `邀请函提示词.txt`
- `面相` / `面相分析`: `面相提示词.txt`

## Merge Rules

1. Treat preset text as a style and structure guide, not as a replacement for the user's request.
2. Keep exact user text verbatim when the user specifies titles, captions, labels, names, dates, prices, CTAs, or product facts.
3. Remove preset requirements that conflict with the user's explicit constraints.
4. Prefer the most specific matching preset. For example, use `小红书封面图提示词.txt` for a cover and `小红书卡片提示词.txt` for a content card.
5. If multiple presets may apply, load the most important one first and borrow only a short compatible detail from the second one.
6. Do not use this index as a reason to delay execution: match, merge, submit.
