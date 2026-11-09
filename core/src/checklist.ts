/**
 * 达标要求（Checklist）的智能合并 —— 纯函数，供 UI / 同步 / 手机端复用。
 *
 * 合并规则（对应用户需求"更新或补充计划要求"）：
 * 1. 去重：与新条目文本相同（忽略空白与大小写）的已有条目 → 跳过不重复添加；
 * 2. 补充：已有条目里没有的 → 自动追加；
 * 3. 变动更新：同 key（同一来源，如同一链接/同一文件名）但文本已变化的 → 就地更新文本并重置完成状态；
 * 4. 手动条目不受影响：没有 key 的旧条目只按文本去重，永远不会被自动改写。
 */

/** 文本规范化：去空白、转小写，用于重复判定 */
function normText(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

export interface MergeResult {
  list: ChecklistItemLike[];
  added: number;      // 新增条数
  updated: number;    // 变动更新条数
  skipped: number;    // 重复跳过条数
}

/** 宽松类型（避免与 UI 层耦合） */
export interface ChecklistItemLike {
  id: string;
  text: string;
  done: boolean;
  doneAt?: string;
  key?: string;
}

export function mergeChecklist(
  existing: ChecklistItemLike[] | undefined,
  incoming: ChecklistItemLike[],
): MergeResult {
  const list: ChecklistItemLike[] = [...(existing || [])];
  let added = 0, updated = 0, skipped = 0;

  for (const item of incoming) {
    const nText = normText(item.text);
    const isDup = list.some((c) => normText(c.text) === nText);
    if (isDup) { skipped++; continue; }

    if (item.key) {
      const idx = list.findIndex((c) => c.key && c.key === item.key);
      if (idx >= 0) {
        // 同一来源且文本有变化 → 更新文本，重置完成状态（内容变了需重做）
        list[idx] = { ...list[idx], text: item.text, done: false, doneAt: undefined };
        updated++;
        continue;
      }
    }
    list.push({ ...item });
    added++;
  }
  return { list, added, updated, skipped };
}
