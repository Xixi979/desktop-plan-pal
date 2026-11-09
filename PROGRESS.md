# 📌 项目检查点（PROGRESS.md）— 断点续做文件

> **本文件是项目的"存档点"**。每次完成实质性工作并提交后必须更新此文件。
> 任何新会话（包括电脑关机重启后）开工前，**必须先读本文件**，按「下一步」继续，
> 并用 `git log --oneline -5` 确认最新提交。进度永不丢失：代码在磁盘、提交在 Git、状态在本文件。

- **最后更新**：2026-11-09 09:55
- **当前阶段**：v0.1 单机最小可用版（收尾中）

## ✅ 已完成

- [x] 整体方案设计（docs/design/整体方案.md）+ GitHub/B站调研
- [x] 仓库骨架：README、ROADMAP、MIT、ui/pet/sync 占位
- [x] 排程引擎 v0.1：空闲槽构造 / 多因子评分 / 轮转贪心排程 / 约束校验 / 容量预警（19/19 测试通过）
- [x] 数据层 v0.1：ChangeLog 追加 + 快照恢复 + 撤销（StorageAdapter 抽象：Memory/File/浏览器 localStorage，5/5 测试通过）
  - 调试修复：对象别名污染（commit 深拷贝冻结）、补偿条目防翻转、轮转扫描重构
- [x] 构建链：core/scripts/build-browser.mjs（Node stripTypeScriptTypes → 自包含单文件 UI）
- [x] 最简界面 v0.1：ui/index.html（时间轴 / 计划+课表增删改 / 一句话录入规则版 / 强度面板 / 小人状态气泡 / 撤销 / 导出数据）

## ⏭️ 下一步（按顺序）

1. **UI 实测**：浏览器打开 ui/index.html 验证全流程（载入示例课表 → 加计划 → 排程 → 完成任务），发现的问题逐一修复
2. ICS 日历文件导入（固定事件）
3. 周视图（多日排程展示，引擎已支持 rangeStart-rangeEnd）
4. SQLite 落地（v0.1 数据层当前为 JSONL；Tauri 侧接 better-sqlite3 或 Rust rusqlite，接口已抽象好）
5. v0.1 发布：打包安装包 + GitHub Releases + README 动图
6. 进入 v0.2：小人动画（Sprite + 状态机）、自然语言 LLM 双路由、增量重排

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
