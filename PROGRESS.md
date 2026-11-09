# 📌 项目检查点（PROGRESS.md）— 断点续做文件

> **本文件是项目的"存档点"**。每次完成实质性工作并提交后必须更新此文件。
> 任何新会话（包括电脑关机重启后）开工前，**必须先读本文件**，按「下一步」继续，
> 并用 `git log --oneline -5` 确认最新提交。进度永不丢失：代码在磁盘、提交在 Git、状态在本文件。

- **最后更新**：2026-11-09 09:45
- **最新提交**：`b383b6e` feat(core): 排程引擎 v0.1（19/19 测试通过）
- **当前阶段**：v0.1 单机最小可用版（进行中）

## ✅ 已完成

- [x] 整体方案设计（docs/design/整体方案.md）+ GitHub/B站调研
- [x] 仓库骨架：README、ROADMAP、MIT、ui/pet/sync 占位
- [x] 排程引擎 v0.1：buildFreeSlots / scorePlacement / greedySchedule（轮转扫描）/ validateConstraints / 容量预警
- [x] 测试 19/19 通过（engine.test.ts，5 个 v0.2 用例按计划跳过）

## 🚧 进行中

- 数据层 store.ts（ChangeLog 驱动 + 快照，零依赖）
- 最简界面 ui/index.html（自包含单文件，无构建依赖）

## ⏭️ 下一步（按顺序）

1. 数据层：core/src/store.ts + tests/store.test.ts → 跑通
2. 浏览器构建脚本：core/scripts/build-browser.mjs（Node stripTypeScriptTypes → window.Engine）
3. 最简界面：ui/src/app.js + ui/src/style.css → 生成自包含 ui/index.html（时间轴/表单/一句话录入/强度面板/小人占位）
4. 提交 + 更新本文件

## 🔧 环境备注（重要）

- **npm 源不可用**（沙盒网络限制）：官方源 502、镜像超时。测试用本地 vitest shim（core/node_modules/vitest/index.js）+ `node --experimental-strip-types` 运行：
  - 引擎测试：`cd core && node --experimental-strip-types --no-warnings tests/engine.test.ts`
  - 数据层测试：`cd core && node --experimental-strip-types --no-warnings tests/store.test.ts`
- Node v22.22.2，支持 stripTypeScriptTypes（构建浏览器包用）。
- 网络恢复后：`cd core && npm install --registry=https://registry.npmmirror.com` 切回官方 vitest（接口兼容，shim 可删）。

## 📋 断点续做协议（新会话必读）

1. 读本文件 → 看「进行中 / 下一步」；
2. `git log --oneline -5` + `git status` 确认磁盘状态与已提交内容一致；
3. 从「下一步」第一条继续；做完一步就 commit 一次并更新本文件；
4. 若上次中断时有未提交的半成品：先 `git diff` 检查，能跑通就补提交，跑不通就修复后再提交。
