/**
 * 小说文档持久化兜底
 *
 * 背景：长篇生成过程中，同一部小说会被多个请求并发保存（续写循环、章节编辑、
 * 蓝图应用、计划修订等）。Mongoose 的全量 save() 带版本号校验，一旦并发写入
 * 使 __v 变化，正在运行的长任务会在下一次保存时抛 VersionError 并整体报废
 * （线上日志反复出现 "No matching document found for id ... version N"）。
 *
 * 策略：VersionError 时不再整份文档重放，而是**只写回本进程真正改动过的字段**
 * （doc.modifiedPaths()）。这样：
 *   - 本次操作的结果不会丢（原本是整次失败）；
 *   - 其他请求刚写入的、本次并未触碰的字段不会被顺带覆盖（避免数据丢失）。
 * 同名字段的并发写入仍是最后写入胜出——这是无法避免的冲突，但不是静默丢字段。
 */

const Novel = require('../models/Novel');

// MongoDB 不允许在同一次 $set 里同时更新父子路径（会报 conflict），
// 因此父路径入选后要跳过它的子路径。
function isCoveredBy(path, parents) {
  return parents.some((parent) => path === parent || path.startsWith(`${parent}.`));
}

function collectModifiedUpdates(novel) {
  const paths = typeof novel.modifiedPaths === 'function' ? novel.modifiedPaths() : [];
  const updates = {};
  const chosen = [];
  for (const path of paths) {
    if (!path || path === '__v' || path === 'updatedAt') continue;
    if (isCoveredBy(path, chosen)) continue;
    chosen.push(path);
    updates[path] = typeof novel.get === 'function' ? novel.get(path) : novel[path];
  }
  return updates;
}

/**
 * 保存小说文档；遇 VersionError 时降级为"仅写回已修改字段"。
 * @param {Object} novel - mongoose 文档
 * @param {Object} [options]
 * @param {Object} [options.NovelModel] - 便于测试注入的模型替身
 * @returns {Promise<Object>} 传入的 novel 文档
 */
async function saveNovelDoc(novel, options = {}) {
  const NovelModel = options.NovelModel || Novel;
  try {
    return await novel.save();
  } catch (error) {
    if (error?.name !== 'VersionError') throw error;

    const updates = collectModifiedUpdates(novel);
    // 没有任何可写字段时无法安全降级，保留原始错误交给调用方处理。
    if (!Object.keys(updates).length) throw error;

    await NovelModel.updateOne({ _id: novel._id }, { $set: updates });

    // 对齐内存中的版本号，让后续保存不再连续撞版本。
    const fresh = await NovelModel.findById(novel._id).select('__v').lean();
    if (fresh && typeof fresh.__v === 'number') novel.__v = fresh.__v;

    return novel;
  }
}

module.exports = { saveNovelDoc };
