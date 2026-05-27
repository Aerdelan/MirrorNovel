const mongoose = require('mongoose')

const referenceNovelSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  novelType: { type: String, enum: ['normal', 'lightnovel'], default: 'normal' }, // normal=国产网文, lightnovel=轻小说
  // 分类路径：gender → mainCategory → subCategory → tags
  gender: { type: String, enum: ['male', 'female', 'unisex'], default: 'male' },
  mainCategory: { type: String, default: '' },
  subCategory: { type: String, default: '' },
  tags: [String],

  // AI 提取的风格信息
  styleProfile: { type: String, default: '' },        // 800-1000 字风格描述
  keyExcerpts: [{ type: String }],                      // 8-10 段精选片段
  writingCharacteristics: { type: String, default: '' }, // 写作特点分析
  vocabularyBank: [String],                             // 特色词汇
  chapterStructure: { type: String, default: '' },     // 章节结构描述

  // 原始文件信息
  originalFileName: { type: String, default: '' },
  originalLength: { type: Number, default: 0 },        // 原始文件字数
  aiProcessed: { type: Boolean, default: false },
  qualityScore: { type: Number, default: 0, min: 0, max: 100 },

  // 下载统计（番茄导入专用）
  downloadStats: {
    totalChapters: { type: Number, default: 0 },     // 总章节数
    downloadedChapters: { type: Number, default: 0 }, // 成功下载数
    failedChapters: { type: Number, default: 0 },     // 失败数
    avgChapterLength: { type: Number, default: 0 },   // 平均每章字数
  },
}, { timestamps: true })

module.exports = mongoose.model('ReferenceNovel', referenceNovelSchema)
