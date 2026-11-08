# 智能厨房管家 Agent Demo

可在浏览器运行的移动端 Web Demo：底部包含首页、冰箱、菜谱、我的；采购清单整合在首页。

## 本地运行

1. 复制 `.env.example` 为 `.env`，填写 DeepSeek API Key。
2. 运行 `ruby server.rb`。
3. 打开 `http://127.0.0.1:4567`。

AI 文本录入使用 `DEEPSEEK_MODEL`，拍照识别使用 `DEEPSEEK_VISION_MODEL`。电脑或手机使用实时摄像头时，本地 `localhost` 可直接申请权限；线上部署必须使用 HTTPS。

## 安全

`.env` 与 `data.json` 已被 `.gitignore` 排除，请勿提交真实 API Key 或个人数据。

## 食材知识库

`food_knowledge.json` 收录常见蔬菜、菌菇、水果、肉类、蛋类、海鲜、谷物杂粮、豆制品、乳制品和烘焙甜点，包含标准名称、常用名称、品类标签、别名、食材图标、常用计量单位、单位估算克数，以及常温、冷藏、冷冻条件下的大致保存期。录入时可通过任一常用名称匹配同一条标准食材记录。

每条知识库记录还包含 `household_freshness_profile` 和按储存方式生成的 `freshness_standard`。模型会根据食材易损程度，预先扣除运输、仓储和零售阶段造成的新鲜度损耗，再按存入日期显示“新鲜”“尽快食用”“不宜食用”。这些状态是家庭管理提示，不替代包装标签、感官检查或食品安全判断。

修改 `scripts/build_food_knowledge.rb` 后运行 `ruby scripts/build_food_knowledge.rb`，可重新生成知识库。
