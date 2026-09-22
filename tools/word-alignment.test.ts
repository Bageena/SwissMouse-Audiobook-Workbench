import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscriptWords, findClosestTranscriptWordIndex, findTranscriptWordIndex, formatTimestamp, getTranscriptWordsNear, refineChapterStartIndex, transcriptPageOffset } from '../src/utils/wordAlignment';
import { detectChapterHeadings } from './chapter-detection';
import type { NormalizedSegment } from './transcription-engine';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

test('transcript context follows a changed chapter timestamp', () => {
  const words = [
    { word: 'earlier', start: '00:00:04.000', startSeconds: 4, endSeconds: 4.5 },
    { word: 'near', start: '00:00:30.000', startSeconds: 30, endSeconds: 30.5 },
    { word: 'selected', start: '00:00:45.000', startSeconds: 45, endSeconds: 45.5 },
    { word: 'later', start: '00:01:11.000', startSeconds: 71, endSeconds: 71.5 },
  ];

  assert.deepEqual(getTranscriptWordsNear(words, 45).map(word => word.word), ['near', 'selected']);
  assert.deepEqual(getTranscriptWordsNear(words, 71).map(word => word.word), ['later']);
});

test('timestamp lookup is indexed and chapter lead-in stays on Whisper word boundaries', () => {
  const words = buildTranscriptWords([{ words: [
    { word: 'the', start: 9, end: 9.2 },
    { word: 'end', start: 9.5, end: 9.8 },
    { word: 'chapter', start: 10, end: 10.4 },
    { word: 'twelve', start: 10.5, end: 11 },
  ] }]);
  const headingIndex = findTranscriptWordIndex(words, 9.98);
  assert.equal(headingIndex, 2);
  assert.equal(words[refineChapterStartIndex(words, headingIndex, 1.5)].startSeconds, 9);
  assert.equal(refineChapterStartIndex(words, headingIndex, 0), headingIndex);
});

test('chapter navigation resolves the closest word and its distant transcript page', () => {
  const words = Array.from({ length: 3000 }, (_, index) => ({
    word: `word-${index}`,
    start: formatTimestamp(index / 4),
    startSeconds: index / 4,
    endSeconds: index / 4 + 0.2,
  }));
  const selected = findClosestTranscriptWordIndex(words, 601.27);
  assert.equal(selected, 2405);
  assert.equal(transcriptPageOffset(selected, 1200), 2400);
});

function spokenHeading(title: string, mismatchedText = false): NormalizedSegment {
  const words = [
    { word: 'The', start: 10, end: 10.2 }, { word: 'end.', start: 10.3, end: 11 },
    ...title.split(' ').map((word, i) => ({ word, start: 15.375 + i, end: 15.8 + i, probability: 0.95 })),
  ];
  return { id: 0, start: 10, end: 20, text: `${mismatchedText ? 'And that was ' : ''}The end. ${title}`, words };
}

for (const title of ['Chapter Twelve', 'Introduction', 'Foreword', 'Preface', 'Prologue', 'Epilogue',
  'Afterword', 'Part Two', 'Book I', 'Section One', 'Conclusion', 'Interlude', 'Prelude', 'Coda',
  'Appendix', 'Appendices', 'Notes', 'Acknowledgments', 'Acknowledgements']) {
  test(`${title} uses its first word timestamp even when segment text differs`, () => {
    for (const mismatch of [false, true]) {
      const segments = [spokenHeading(title, mismatch)];
      const playerWords = buildTranscriptWords(segments);
      const [heading] = detectChapterHeadings(segments);
      assert.equal(heading.start, 15.375);
      assert.equal(heading.transcriptWordIndex, 2);
      assert.equal(heading.start, playerWords[2].startSeconds);
      assert.equal(formatTimestamp(heading.start), playerWords[2].start);
    }
  });
}

test('a split heading with mismatched segment text retains the first word timestamp', () => {
  const segments = [spokenHeading('Chapter', true), {
    id: 1, start: 20, end: 25, text: '23. A beginning.', words: [
      { word: 'Twenty', start: 21, end: 21.5 }, { word: 'Three.', start: 22, end: 22.5 },
      { word: 'A', start: 23, end: 23.1 }, { word: 'beginning.', start: 23.2, end: 24 },
    ],
  }];
  const [heading] = detectChapterHeadings(segments);
  assert.equal(heading.text, 'Chapter Twenty Three');
  assert.equal(heading.start, buildTranscriptWords(segments)[2].startSeconds);
  assert.equal(heading.end, 22.5);
});

test('wordless legacy segments retain their real segment bounds', () => {
  const [heading] = detectChapterHeadings([{ id: 0, start: 10, end: 20, text: 'Chapter Twelve', words: [] }]);
  assert.equal(heading.start, 10);
  assert.equal(heading.end, 20);
});

test('server candidates refine lead-in to player word timestamps', () => {
  const source = fs.readFileSync('server.ts', 'utf8');
  const start = source.indexOf('function buildChapterCandidates(');
  const end = source.indexOf('\nasync function transcribeExistingPreview', start);
  assert.ok(start >= 0 && end > start);
  const transcriptSegments = [spokenHeading('Chapter Twelve', true)];
  const transcriptWords = buildTranscriptWords(transcriptSegments);
  const context: any = {
    transcriptSegments, transcriptWords, generatedCandidates: [],
    detectChapterHeadings, findTranscriptWordIndex, refineChapterStartIndex, formatTimestamp,
    normalized: { engine: 'faster-whisper' }, currentConfig: { lead_in_seconds: 1.5 },
  };
  const exercise = `${source.slice(start, end)}\ngeneratedCandidates = buildChapterCandidates(transcriptSegments, transcriptWords, normalized.engine);`;
  vm.runInNewContext(transformSync(exercise, { loader: 'ts' }).code, context);
  assert.equal(context.generatedCandidates[0].candidate_start, transcriptWords[2].start);
  assert.equal(context.generatedCandidates[0].candidate_start, '00:00:15.375');
  assert.equal(context.generatedCandidates[0].transcriptWordIndex, 2);
});

test('the existing player word-click handler seeks and selects the saved timestamp unchanged', () => {
  const source = fs.readFileSync('src/components/ChapterAudioPlayer.tsx', 'utf8');
  const start = source.indexOf('  const handleWordClicked =');
  const end = source.indexOf('\n  };', start) + '\n  };'.length;
  assert.ok(start >= 0 && end > start);
  const word = buildTranscriptWords([spokenHeading('Chapter Twelve', true)])[2];
  const audioRef = { current: { currentTime: 0 } };
  let currentTime: number, selection: any[];
  vm.runInNewContext(transformSync(source.slice(start, end) + '\nhandleWordClicked(word);', { loader: 'ts' }).code, {
    word, audioRef, audioUrl: '/preview', isPlaying: true, playWordChime() {}, setLastClickedWord() {},
    setCurrentTime(seconds: number) { currentTime = seconds; },
    onWordClick(...args: any[]) { selection = args; },
  });
  assert.equal(audioRef.current.currentTime, 15.375);
  assert.equal(currentTime!, word.startSeconds);
  assert.deepEqual(selection!, [word.start, word.word, word.startSeconds]);
});
