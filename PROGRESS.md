# 📌 项目检查点（PROGRESS.md）— 断点续做文件

> **本文件是项目的"存档点"**。每次完成实质性工作并提交后必须更新此文件。
> 任何新会话（包括电脑关机重启后）开工前，**必须先读本文件**，按「下一步」继续，
> 并用 `git log --oneline -5` 确认最新提交。进度永不丢失：代码在磁盘、提交在 Git、状态在本文件。

- **最后更新**：2026-11-09 18:30
- **当前阶段**：v0.2 自然语言 LLM 双路由完成并推送（f3d7599）
  - 新增 core/src/nlp.ts：parseRule 规则引擎（时长半小时/一个半小时/1.5小时、时刻下午3点/晚上8点半、日期明天/后天/周X/大后天/已过月日自动推明年、优先级重要紧急、12 类关键词映射、标题清洗）、parseViaLLM（OpenAI 兼容，8s 超时，JSON 截取容错 markdown 围栏）、parseDual 双路由失败自动降级
  - UI：一句话加计划走双路由（预览/提交）；🎛️ 强度参数面板新增「🤖 AI 智能解析设置」折叠区（endpoint/model/key 存 LS 仅本机，llm-save/llm-clear）；旧 app.js parseQuick 下沉为 NLP.parseRule 包装
  - 调试记录：组合正则 alternation「一」分支不在捕获组导致 combo[1] 恒 undefined → 并入捕获组修复
  - 测试 24+7+5+5+12 = 53 全绿（新增 nlp.test.ts 12 用例含 mock fetch 双路由）；自测 12 步全通过；已推送 GitHub
  - engine.incrementalReschedule 从 TODO 桩落地：保留已结束/进行中/锁定块；释放未来未锁定块；剩余时长=总时长−保留块占用；保留块未来段转一次性固定占用防重叠；当天 fromTime 前整体封禁（防止排进过去）；7 天排程窗口
  - UI 接入：加任务（一句话/手动/图片/链接）与达标勾选状态变化 → 增量重排（不打乱当前安排）；课表增删/撤销/导入/强度参数 → 仍全量重排
  - vitest shim 补 toBeDefined；engine 测试 19→24（新增 5 用例：保留/剩余入队/不重叠/幂等/参数收紧）
  - 自测 12 步全通过（新增「增量重排生效」）；ES2020 真实残留无
  - 测试 24+7+5+5 全绿；已推送 GitHub
  - 仓库：https://github.com/Xixi979/desktop-plan-pal（Public，23+ 提交，main 分支）
  - Release v0.2.0：含下载资产 desktop-plan-pal-v0.2.0.html（https://github.com/Xixi979/desktop-plan-pal/releases/tag/v0.2.0）
  - 凭据：PAT 存于 ~/.git-credentials（credential.helper store），后续 push 免密；git remote origin 已配置
  - 连接器 GitHub OAuth 授权两次失败（403 无写权限→重授权后 401），最终改走用户 PAT 方案成功
  - v0.2.0 小人动画：ui/src/pet.js（SVG 小机器人 + 六态状态机 window.Pet），app.js updatePet 改为数据驱动 Pet.setState；样式六组 keyframes（style.css v0.2 段）
  - 六态：idle 呼吸眨眼 / working 敲击 / break 摇摆端茶 / happy 跳跃庆祝（达标全勾或今日全完成）/ tired 流汗（今日剩余负载>容量）/ sleeping 打瞌睡（23:00-6:00）
  - selftest 改为构建自动生成：ui/selftest.inject.js（注入脚本）→ build-browser.mjs 产出 ui/selftest.html；新增小人 SVG 渲染 + 六态切换两步，11 步全 OK
  - 版本化文件：ui/桌面计划小人-v0.2.0.html（旧 v0.1.11 已删）
  - 自测 11 步全通过；四套测试 19+7+5+5 全绿；ES2020 扫描仅剩兼容预检代码与注释两处误报
  - **GitHub 发布受阻**：mcp github 连接器 token 403（无建仓写权限，仅读）；npm 源仍不通。需用户：① 在 github.com 手动建空仓 desktop-plan-pal 并提供 PAT，或 ② 授权连接器写权限
  - v0.1.9 ICS 导入：core/src/ics.ts（RFC5545 子集：折行展开、\, \n 转义、DTSTART/DTEND 本地时刻、RRULE FREQ=DAILY/WEEKLY+BYDAY、跨天收缩为当天 24:00、全天事件跳过并计数、同名同时段去重导入），测试 5/5
  - v0.1.9 周视图：本周一~周日 7 列日程概览（固定🔒+任务块按时间排序，今日高亮），「🕐 今日时间轴」标题栏「切周视图/切日视图」切换
  - selftest.html 新增周视图切换步骤；无头 Edge 真实点击自测全通过；无 ES2020 残留（构建后扫描已纳入流程）

## ✅ 已完成（此前）

- [x] 整体方案设计（docs/design/整体方案.md）+ GitHub/B站调研
- [x] 仓库骨架：README、ROADMAP、MIT、ui/pet/sync 占位
- [x] 排程引擎 v0.1：空闲槽构造 / 多因子评分 / 轮转贪心排程 / 约束校验 / 容量预警（19/19 测试通过）
- [x] 数据层 v0.1：ChangeLog 追加 + 快照恢复 + 撤销（StorageAdapter 抽象：Memory/File/浏览器 localStorage，5/5 测试通过）
  - 调试修复：对象别名污染（commit 深拷贝冻结）、补偿条目防翻转、轮转扫描重构
- [x] 构建链：core/scripts/build-browser.mjs（Node stripTypeScriptTypes → 自包含单文件 UI）
- [x] 最简界面 v0.1：ui/index.html（时间轴 / 计划+课表增删改 / 一句话录入规则版 / 强度面板 / 小人状态气泡 / 撤销 / 导出数据）
- [x] v0.1.5 三大增强（2026-11-09 上午，用户需求）：
  - 多通道录入：一句话 / 图片（选文件·拖入·Ctrl+V 粘贴，canvas 压缩 ≤640px 存预览）/ 链接（站点映射 + slug 标题规则识别），Tab 切换
  - 达标机制：Task.checklist 逐条打勾，全部达标自动 done / 取消任一条自动回退 scheduled（规则下沉到 store.updateTask，UI/同步/手机端一致生效）；勾完自动重排
  - 计划关联文件夹：Task.folderPath，详情内设置/保存/复制路径；Tauri 端预留 📂 打开按钮（window.__TAURI__ 探测）
  - 测试：store.test.ts 新增达标清单用例（6/6）；shim 增加 .not 断言与失败堆栈；DOM 插入统一 esc() 转义
  - 修复（f71055a）：预览沙盒 iframe 禁用 localStorage → store.open() 保存快照抛错 → 初始化中断、全部按钮失灵；新增安全存储层 LS（不可用时降级内存）+ 顶部可见错误横幅；模拟禁用环境验证四入口全部绑定
- [x] v0.1.6 录入与达标增强（2026-11-09 10:50，用户四项需求）：
  - 多图/多链接录入：图片多选/多拖/多粘贴（缩略图可移除，≤12 张，480px 压缩）；链接一次粘贴多条（空格/换行分隔，条目可移除）；两通道均支持自定义计划名称
  - 目标计划下拉（新建 or 并入已有计划）：图片/链接通道可把新内容补充到已有计划
  - 达标要求自动解析：备注按「、；/然后」拆分逐条生成；文件名生成"处理图片资料：X"；每条链接生成"查看内容 + 整理要点"；无内容时兜底"完成「标题」"
  - 智能合并 core/src/checklist.ts mergeChecklist：文本重复跳过、缺失自动补、同 key 来源文本变动就地更新（重置完成状态）、无 key 手动条目永不改写；测试 5/5
  - 一句话录入同名计划自动并入（normTitle 匹配）；计划列表不再渲染图片大图（改 🖼️ ×N 徽标），链接仍可点击
- [x] v0.1.7 极简界面 + 图片 OCR（2026-11-09 11:10，用户两项需求）：
  - 图片内容自动 OCR：Tesseract.js v5（chi_sim+eng）按需从 jsDelivr CDN 加载，识别行自动去重并入备注 → 提交时生成达标要求；失败（无网络/超时）自动降级文件名规则并提示；OCR 用 1200px 高清副本（不持久化），存储仍用 480px 压缩图
  - 极简布局：顶部导航条 4 个单按钮（⚡加计划/📅固定课表/🎛️强度参数/🕐今日时间轴），除「计划列表」外默认全部隐藏，点击展开/收起；计划列表全宽置顶；所有按钮功能保留
  - 修复遗留 bug：手动表单 ➕ 按钮（task-add）在 v0.1.5 重写时绑定丢失，已恢复（并自动生成"完成「标题」"达标项）
  - 冒烟验证：全部按钮绑定 ✓、默认折叠 ✓、无运行错误 ✓；测试 5/5+6/6+19/19
  - 追加修复（13:59 用户反馈"红色按钮不能用"）：课表列表 ✕ 删除绑定与手动表单 ➕ 绑定同批在 v0.1.5 重写时丢失（✕ 本次发现并恢复）；模拟真实点击验证三按钮 ①➕计划 ②➕课表 ③✕删除 全部生效；页头加版本标识（v0.1.7 + 构建时间）用于识别旧缓存——用户截图为 v0.1.6 前的旧版布局，需刷新/重新打开文件

## ⏭️ 下一步（按顺序）

1. SQLite 落地：待 npm 源可用（装 better-sqlite3）或 Tauri 打包时接 rusqlite；接口已抽象好（StorageAdapter）
2. v0.2 收尾：📂 打开文件夹接 Tauri（window.__TAURI__ 探测已预留）；LLM 双路由已完成（f3d7599）、增量重排已完成（062bfff）、小人动画已完成（063be81）
3. 用户试用 v0.2.0 收集反馈：认准页头 v0.2.0；Release 资产或 ui/桌面计划小人-v0.2.0.html 均可

## 🔧 环境备注（重要）

- **npm 源不可用**（沙盒网络限制）。测试用本地 vitest shim（core/node_modules/vitest/index.js）：
  - `cd core && node --experimental-strip-types --no-warnings tests/engine.test.ts`
  - `cd core && node --experimental-strip-types --no-warnings tests/store.test.ts`
- **构建 UI**：`node core/scripts/build-browser.mjs` → 生成 ui/index.html（自包含 45KB，双击即开）
- Node v22.22.2。网络恢复后：`cd core && npm install --registry=https://registry.npmmirror.com` 切回官方 vitest（shim 可删）。

## 📋 断点续做协议（新会话必读）

1. 读本文件 → 看「进行中 / 下一步」；
2. `git log --oneline -5` + `git status` 确认磁盘状态与已提交内容一致；
3. 从「下一步」第一条继续；做完一步就 commit 一次并更新本文件；
4. 若上次中断时有未提交的半成品：先 `git diff` 检查，能跑通就补提交，跑不通就修复后再提交。
