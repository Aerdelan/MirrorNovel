const fs = require('node:fs');
const path = require('node:path');
const { assessStoryCompletion, matchHookResolutionEvidence, matchStoryEndingEvidence } = require('../server/services/storyState');
const { detectRepeatedOpening, detectRepeatedEnding } = require('../server/services/chapterRepetition');
const { readOutlineForeshadowing } = require('../server/services/outlineForeshadowing');

function readJson(directory, name) {
  return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
}

function readEvents(directory) {
  const file = path.join(directory, 'events.ndjson');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.flatMap((line, index) => {
    try { return [JSON.parse(line)]; }
    catch (error) {
      if (index === lines.length - 1) return [];
      throw error;
    }
  });
}

function exactText(value) { return String(value || '').replace(/\s/g, ''); }
function narrativeText(value) { return exactText(value).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(); }

function summarizeProofOrder(chapter) {
  const proof = matchStoryEndingEvidence(chapter?.content, chapter?.qualityReport?.endingVerification);
  if (!proof) return null;
  const source = narrativeText(chapter.content);
  const range = evidence => {
    const whole = narrativeText(evidence);
    const exactStart = source.indexOf(whole);
    if (exactStart >= 0) return { start: exactStart, end: exactStart + whole.length };
    // The production matcher accepts several source clauses in forward order
    // even when there are other clauses between them in the manuscript.
    const pieces = evidence.split(/[。！？!?]+| … /u).map(narrativeText).filter(Boolean);
    let start = -1;
    let end = 0;
    for (const piece of pieces) {
      const found = source.indexOf(piece, end);
      if (found === -1) return null;
      if (start === -1) start = found;
      end = found + piece.length;
    }
    return start >= 0 ? { start, end } : null;
  };
  const conclusion = range(proof.conclusionEvidence);
  const settledState = range(proof.settledStateEvidence);
  return { ...proof, conclusion, settledState, settledStateFollowsConclusion: Boolean(conclusion && settledState && settledState.start >= conclusion.end) };
}

function summarizeRun(directory, fullEdges) {
  const { run, novels = [], jobs = [] } = readJson(directory, 'checkpoint.json');
  const events = readEvents(directory);
  const novel = novels.find(item => String(item._id) === String(run.novelId)) || novels.at(-1);
  const target = Number(run.input?.targetChapterCount || novel?.targetChapterCount);
  const plannedNumbers = Array.from({ length: target }, (_, index) => index + 1);
  const chapters = novel?.chapters || [];
  const nums = chapters.map(chapter => Number(chapter.chapterNumber));
  const chapterByNumber = new Map(chapters.map(chapter => [Number(chapter.chapterNumber), chapter]));
  const savedOrder = nums.every((number, index) => number === plannedNumbers[index]);
  const repeatedBodies = [];
  const fullText = new Map();
  const repeatedEdges = [];
  for (let index = 0; index < chapters.length; index++) {
    const chapter = chapters[index];
    const number = Number(chapter.chapterNumber);
    const normalized = narrativeText(chapter.content);
    if (normalized && fullText.has(normalized)) repeatedBodies.push([fullText.get(normalized), number]);
    if (normalized && !fullText.has(normalized)) fullText.set(normalized, number);
    if (!fullEdges) continue;
    const previous = chapters.slice(0, index);
    for (const [edge, detect] of [['opening', detectRepeatedOpening], ['ending', detectRepeatedEnding]]) {
      const match = detect(chapter.content, previous, number);
      if (match) repeatedEdges.push({ edge, currentChapter: number, earlierChapter: match.chapterNumber, matchedChars: match.matchedChars,
        approximate: Boolean(match.approximate), excerpt: match.excerpt.slice(0, 180) });
    }
  }

  const ledger = novel?.foreshadowingLedger || [];
  const paid = ledger.filter(hook => hook.status === 'resolved' || hook.status === 'paid_off' || hook.stage === 'paid_off');
  const invalidPayoffs = paid.flatMap(hook => {
    const chapter = chapterByNumber.get(Number(hook.resolvedChapter));
    return matchHookResolutionEvidence(chapter?.content, hook.resolutionEvidence) ? [] : [{ id: hook.id, name: hook.content, chapterNumber: hook.resolvedChapter }];
  });
  const plannedPayoffs = readOutlineForeshadowing(run.outline, target).map(hook => {
    const matches = ledger.filter(item => narrativeText(item.content) === narrativeText(hook.name)
      && Number(item.setChapter) === hook.setupChapter);
    const entry = matches.find(item => Number(item.targetChapter) === hook.payoffChapter && item.payoffPlan)
      || matches.find(item => item.content === hook.name && Number(item.targetChapter) === hook.payoffChapter);
    const aliases = matches.filter(item => item !== entry).map(item => ({
      id: item.id, status: item.status, actual: item.resolvedChapter, expected: item.targetChapter,
    }));
    return { name: hook.name, expected: hook.payoffChapter, status: entry?.status || 'not_matched_to_plan',
      actual: entry?.resolvedChapter, aliases };
  });
  const completion = novel && assessStoryCompletion(novel, novel.chapterPlanData, novel.targetWordCount, {
    fixedChapterCount: target, requireEndingVerification: true,
  });
  const chapterEnds = events.filter(event => event.kind === 'event' && event.type === 'chapter_end').map(event => Number(event.chapterNumber));
  const completedEvent = events.some(event => event.kind === 'event' && event.type === 'completed' && event.stage === 'book' && Number(event.targetChapterCount) === target);
  const assistedEvents = [...new Set(events.filter(event => /author_inserted|historical_claims|restored_reviewed|restored_distinct|testimony_claims|testimony_payoff_plan/.test(event.kind)).map(event => event.kind))];
  const endsCoverInOrder = [...new Set(chapterEnds)].length === target && [...new Set(chapterEnds)].every((number, index) => number === plannedNumbers[index]);
  const phaseEndNumbers = (novel?.storyBlueprint?.phases || []).map(phase => Number(phase.endChapter)).filter(number => number < target && chapterByNumber.has(number));
  const progressProofs = chapters.filter(chapter => chapter.qualityReport?.progressVerification?.passed);
  const invalidProgressReferences = progressProofs.flatMap(chapter => (chapter.qualityReport.progressVerification.evidence || []).flatMap(proof => {
    return exactText(chapterByNumber.get(Number(proof.chapterNumber))?.content).includes(exactText(proof.excerpt)) && proof.excerpt?.trim()
      ? [] : [{ chapterNumber: chapter.chapterNumber, citedChapter: proof.chapterNumber, excerpt: proof.excerpt }];
  }));
  const terminal = chapterByNumber.get(target);
  const ending = summarizeProofOrder(terminal);
  const modelRequests = {};
  for (const event of events.filter(item => item.kind === 'model_start')) {
    modelRequests[event.task || 'unspecified'] = (modelRequests[event.task || 'unspecified'] || 0) + 1;
  }
  const generationErrors = events.filter(event => event.kind === 'event' && event.type === 'error');
  const memoryWarnings = events.filter(event => event.kind === 'event' && event.type === 'status' && /语义记忆待补齐|剧情记忆整理暂不可用/.test(event.message || ''));
  const abandoned = ledger.filter(hook => hook.status === 'abandoned').length;
  const pass = Boolean(savedOrder && chapters.length === target && novel?.status === 'completed' && completedEvent && endsCoverInOrder
    && completion?.complete && !assistedEvents.length && !invalidPayoffs.length && !abandoned && !invalidProgressReferences.length
    && !repeatedBodies.length && !repeatedEdges.length && ending?.settledStateFollowsConclusion);

  return {
    directory, stage: run.stage, status: novel?.status, target, saved: chapters.length, savedOrder, completedEvent,
    chapterEndEvents: chapterEnds.length, uniqueChapterEndEvents: new Set(chapterEnds).size, endsCoverInOrder,
    pass: fullEdges ? pass : null, completedAt: run.updatedAt, lastEvent: run.lastEvent,
    activeJobs: jobs.filter(job => ['running', 'pause_requested', 'paused'].includes(job.status)).map(job => ({
      status: job.status, phase: job.phase, next: job.chapterNumber, lastCommittedChapter: job.lastCommittedChapter, draftChars: (job.draft || '').length,
    })),
    modelRequests, resumes: events.filter(event => event.kind === 'resume').length, assistedEvents,
    generationErrors: { count: generationErrors.length, last: generationErrors.at(-1)?.message },
    memoryWarnings: { count: memoryWarnings.length, last: memoryWarnings.at(-1)?.message },
    completion, ledger: { entries: ledger.length, resolved: paid.length, matchingProofs: paid.length - invalidPayoffs.length, invalidPayoffs,
      unconfirmed: ledger.filter(hook => hook.setupStatus === 'unconfirmed').length, abandoned,
      resolvedInTerminal: paid.filter(hook => Number(hook.resolvedChapter) === target).length, plannedPayoffs },
    progress: { auditedChapters: progressProofs.length, phaseEnds: phaseEndNumbers,
      phaseEndsMissingAudit: phaseEndNumbers.filter(number => !chapterByNumber.get(number)?.qualityReport?.progressVerification?.passed), invalidProgressReferences },
    repeatedBodies, checkedRepeatedEdges: fullEdges, repeatedEdges,
    terminal: terminal ? { proof: ending, chars: terminal.content.length, closingParagraph: terminal.content.trim().split(/\n\s*\n/).at(-1) } : null,
    tail: chapters.slice(-5).map(chapter => ({ number: chapter.chapterNumber, title: chapter.title, chars: chapter.content.length })),
  };
}

const args = process.argv.slice(2);
const fullEdges = args.includes('--edges');
const directories = args.filter(arg => arg !== '--edges');
if (!directories.length) throw new Error('Usage: node tmp/audit-live-book-run.cjs [--edges] <run directory> [...]');
console.log(JSON.stringify(directories.map(directory => summarizeRun(path.resolve(directory), fullEdges)), null, 2));
