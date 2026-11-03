module.exports = function initialBlueprint() {
  const stage = (title, startChapter, endChapter) => ({
    title, startChapter, endChapter, goal: '核对签收联并承担经营代价', obstacle: '交接记录和司机意见不一致',
    reversal: '现场证据改变责任划分', threads: ['仓库交接'], tagCommitments: ['职场：现场交接和回款约束'],
    characterBeats: [{ character: '周行舟', goal: '减少返工', conflict: '司机不信任', change: '公开责任表', voiceGuard: '口语与自嘲' }],
    requiredScenes: ['夜班交接'], forbiddenDrift: ['禁止天降资本'], entryCondition: '此前交接结果成立', exitCondition: '责任表得到签署',
    foreshadowing: [{ name: '缺页的维修账本', setupChapter: startChapter, payoffChapter: endChapter, plan: '凭现场证据核对缺页' }],
    unresolvedQuestions: ['维修款由谁承担'],
  });
  return {
    blueprintLevel: 3, mainArc: '周行舟通过一次次承担选择的代价，让顺河货运成为稳健的区域企业', lockedFacts: ['没有超能力'],
    phases: Array.from({ length: 10 }, (_, index) => {
      const start = index * 6 + 1;
      return { ...stage(`篇章${index + 1}`, start, start + 5),
        subphases: [stage('调查与选择', start, start + 2), stage('代价与结果', start + 3, start + 5)] };
    }),
    rollingPlan: { startChapter: 1, endChapter: 20, objective: '建立交接与回款规则',
      tagCommitments: ['职场'], forbiddenDrift: ['禁止霸总化'],
      chapters: Array.from({ length: 20 }, (_, index) => ({
        chapterNumber: index + 1, title: `交接新证据${index + 1}`, purpose: `核对第${index + 1}份交接证据并改变责任`,
        tagCommitments: ['职场：夜班交接'], characterBeats: [{ character: '周行舟', goal: '核对证据', conflict: '意见不同', change: '承担选择', voiceGuard: '具体口语' }],
        requiredScenes: ['仓库'], relationshipChange: '获得同事有限信任', foreshadowingActions: ['核对账本'], exitHook: '出现待核对证据',
      })),
    },
  };
};
