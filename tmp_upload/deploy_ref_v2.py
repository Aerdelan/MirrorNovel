import json, os

# This script generates the correct reference.js on the server
# Read the current file and make targeted edits

target = "/root/fanqiexiaoshuo_20260527210719/server/routes/reference.js"

with open(target) as f:
    c = f.read()

# 1. Add dedup to upload route - insert after the field validation block
dedup_code = """
    // Dedup check
    const dupCheck = await ReferenceNovel.findOne({ title, mainCategory });
    if (dupCheck) {
      return res.status(409).json({
        message: \x60《\x24{title}》已存在于蒸馏库中，如需重新蒸馏请先删除旧记录\x60,
        existingId: dupCheck._id,
      });
    }
"""

# Insert after the mainCategory validation check
marker = """return res.status(400).json({ message: '请填写小说名称和分类' })
    }"""
c = c.replace(marker, marker + dedup_code)

# 2. Add dedup to fanqie-import - insert before creating the doc
fanqie_marker = """    // 创建参考小说记录（异步后台处理）
    const doc = await ReferenceNovel.create({"""
c = c.replace(fanqie_marker, """    // Dedup check for fanqie import
    const fanqieDup = await ReferenceNovel.findOne({ title: realTitle, mainCategory });
    if (fanqieDup) {
      console.log(\x60[Dedup] 《\x24{realTitle}》已存在，跳过导入\x60);
      return;
    }

    // 创建参考小说记录（异步后台处理）
    const doc = await ReferenceNovel.create({""")

with open(target, 'w') as f:
    f.write(c)

print("Dedup added")
print("File size:", os.path.getsize(target))
