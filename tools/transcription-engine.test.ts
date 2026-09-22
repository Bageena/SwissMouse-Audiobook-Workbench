import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNormalizedTranscription } from './transcription-engine';
import { detectChapterHeadings } from './chapter-detection';
import type { NormalizedSegment } from './transcription-engine';
import vm from 'node:vm';

function chapterSegment(text: string, start = 10): NormalizedSegment {
  return { id: 0, start, end: start + 4, text, words: [] };
}

for (const text of ['Chapter 12', 'Chapter Twelve', 'Chapter Twenty Three',
  'CHAPTER TWENTY-THREE', 'chapter:  23', 'Chapter\nTwenty—Three', 'Chapter23',
  'Chapter One Hundred and Twelve']) {
  test(`detects heading formatting: ${JSON.stringify(text)}`, () => {
    const headings = detectChapterHeadings([chapterSegment(text)]);
    assert.equal(headings.length, 1);
    assert.equal(headings[0].text, text.replace(/\s+/g, ' '));
    assert.equal(headings[0].start, 10);
  });
}

test('joins split headings and preserves the first spoken word timestamp', () => {
  const headings = detectChapterHeadings([
    { ...chapterSegment('The end. Chapter', 10), words: [
      { word: 'The', start: 10, end: 10.3 }, { word: 'end.', start: 10.4, end: 11 },
      { word: 'Chapter', start: 12.375, end: 13 },
    ] },
    { ...chapterSegment('Twenty Three. A beginning.', 14), words: [
      { word: 'Twenty', start: 14, end: 14.3 }, { word: 'Three.', start: 14.4, end: 14.8 },
      { word: 'A', start: 15, end: 15.1 }, { word: 'beginning.', start: 15.2, end: 16 },
    ] },
  ]);
  assert.deepEqual(headings, [{ text: 'Chapter Twenty Three', start: 12.375, end: 14.8, headingType: 'numbered_chapter', chapterNumber: 23, transcriptWordIndex: 2 }]);
});

test('joins a compound number across segments without emitting a partial duplicate', () => {
  assert.deepEqual(detectChapterHeadings([
    chapterSegment('Chapter Twenty', 10), chapterSegment('Three', 14),
  ]), [{ text: 'Chapter Twenty Three', start: 10, end: 18, headingType: 'numbered_chapter', chapterNumber: 23 }]);
});

test('keeps close chapters, repeated numbers and nonsequential chapters at low confidence', () => {
  const segments = ['Chapter 12', 'Chapter Twelve', 'Chapter 23'].map((text, i) => ({
    ...chapterSegment(text, 10 + i * 2), averageLogProbability: -10, noSpeechProbability: 0.99,
  }));
  assert.deepEqual(detectChapterHeadings(segments).map(h => h.start), [10, 12, 14]);
});

test('finds multiple headings in one segment with distinct word timestamps', () => {
  const words = ['Chapter', '12.', 'Chapter', '13.'].map((word, i) => ({ word, start: 10 + i, end: 10.5 + i }));
  assert.deepEqual(detectChapterHeadings([{ ...chapterSegment('Chapter 12. Chapter 13.'), words }]), [
    { text: 'Chapter 12', start: 10, end: 11.5, headingType: 'numbered_chapter', chapterNumber: 12, transcriptWordIndex: 0 },
    { text: 'Chapter 13', start: 12, end: 13.5, headingType: 'numbered_chapter', chapterNumber: 13, transcriptWordIndex: 2 },
  ]);
});

test('retains unnumbered headings and requires complete heading words', () => {
  assert.deepEqual(detectChapterHeadings([chapterSegment('Prologue. Introduction. Epilogue.')]).map(h => h.text),
    ['Prologue', 'Introduction', 'Epilogue']);
  assert.deepEqual(detectChapterHeadings([chapterSegment('subchapter twelve introductory chapter about life')]), []);
});


for (const [text, number] of [
  ['Chapter Twenty-Three', 23], ['Chapter Twenty-Third', 23], ['Chapter XXIII', 23],
  ['Chapter First', 1], ['Chapter Twelfth', 12], ['Chapter Fortieth', 40],
  ['“CHAPTER:  twenty\u2011third”', 23],
] as const) {
  test(`parses chapter number: ${text}`, () => {
    const [heading] = detectChapterHeadings([chapterSegment(text)]);
    assert.equal(heading.chapterNumber, number);
    assert.equal(heading.headingType, 'numbered_chapter');
  });
}

for (const [type, titles] of [
  ['front_matter', ['Introduction', 'Foreword', 'Preface', 'Prologue']],
  ['chapter_like', ['Interlude', 'Prelude', 'Coda']],
  ['back_matter', ['Epilogue', 'Afterword', 'Conclusion', 'Appendix', 'Appendices', 'Notes', 'Acknowledgments', 'Acknowledgements']],
] as const) {
  for (const title of titles) test(`detects ${title} as ${type}`, () => {
    assert.equal(detectChapterHeadings([chapterSegment(title)])[0]?.headingType, type);
  });
}

test('structural headings accept digits, words and Roman numerals', () => {
  for (const prefix of ['Part', 'Book', 'Section']) {
    for (const number of ['1', 'One', 'I']) {
      const [heading] = detectChapterHeadings([chapterSegment(`${prefix} ${number}`)]);
      assert.equal(heading.headingType, 'section_divider');
      assert.equal(heading.chapterNumber, 1);
    }
  }
});

test('keeps Part Two followed shortly by Chapter Twelve', () => {
  const headings = detectChapterHeadings([chapterSegment('Part Two', 10), chapterSegment('Chapter Twelve', 11)]);
  assert.deepEqual(headings.map(h => [h.headingType, h.chapterNumber, h.start]), [
    ['section_divider', 2, 10], ['numbered_chapter', 12, 11],
  ]);
});

test('exact Chapter 15 between 14 and 16 needs no recovery and appears once', () => {
  const headings = detectChapterHeadings([14, 15, 16].map((n, i) => chapterSegment(`Chapter ${n}`, 10 + i * 10)));
  assert.deepEqual(headings.map(h => h.chapterNumber), [14, 15, 16]);
  assert.ok(headings.every(h => !h.recovered));
});

for (const variant of ['Chaptor Fifteen', 'Chap ter Fifteen', 'Chapter number Fifteen']) {
  test(`recovers only the expected missing chapter: ${variant}`, () => {
    const headings = detectChapterHeadings([
      chapterSegment('Chapter 14', 10), chapterSegment(variant, 20), chapterSegment('Chapter 16', 30),
    ]);
    assert.deepEqual(headings.map(h => h.chapterNumber), [14, 15, 16]);
    assert.equal(headings[1].start, 20);
    assert.equal(headings[1].recovered, true);
    assert.equal(detectChapterHeadings([chapterSegment(variant)]).length, 0);
  });
}

test('recovery preserves word timing across segments', () => {
  const headings = detectChapterHeadings([
    chapterSegment('Chapter 14', 10),
    { ...chapterSegment('The end. Chaptor', 20), words: [
      { word: 'The', start: 20, end: 20.2 }, { word: 'end.', start: 20.3, end: 20.5 },
      { word: 'Chaptor', start: 22.375, end: 23 },
    ] },
    { ...chapterSegment('Fifteen.', 24), words: [{ word: 'Fifteen.', start: 24, end: 24.5 }] },
    chapterSegment('Chapter 16', 30),
  ]);
  assert.equal(headings[1].start, 22.375);
  assert.equal(headings[1].end, 24.5);
  assert.equal(headings[1].recovered, true);
});

test('gaps never reject valid chapters or invent missing chapters', () => {
  for (const prose of ['There were fifteen birds.', 'See chaptor fifteen for details.', 'Chaptor Seventeen']) {
    assert.deepEqual(detectChapterHeadings([
      chapterSegment('Chapter 14', 10), chapterSegment(prose, 20), chapterSegment('Chapter 16', 30),
    ]).map(h => h.chapterNumber), [14, 16]);
  }
  assert.deepEqual(detectChapterHeadings([chapterSegment('Chapter 9'), chapterSegment('Chapter 11', 20)]).map(h => h.chapterNumber), [9, 11]);
});

test('ordinary prose and invalid Roman numerals do not become headings', () => {
  for (const text of ['There were twenty three people and twelve books.', 'Read chapter twelve next.',
    'I made notes in the book.', 'Notes were scattered across the desk.', 'Conclusion is a difficult word.',
    'An introduction to the subject.', 'This is part two of our discussion.', 'Chapter IIX', 'Chapter CIVIL']) {
    assert.deepEqual(detectChapterHeadings([chapterSegment(text)]), [], text);
  }
});

test('suppresses exact repeated observations but keeps later occurrences', () => {
  const headings = detectChapterHeadings([chapterSegment('Chapter 12', 10), chapterSegment('Chapter 12', 10), chapterSegment('Chapter 12', 11)]);
  assert.deepEqual(headings.map(h => h.start), [10, 11]);
});


test('recovery rejects ambiguous matches and matches outside the anchor timestamps', () => {
  for (const middle of [
    [chapterSegment('Chaptor Fifteen', 20), chapterSegment('Chaptor Fifteen', 25)],
    [chapterSegment('Chaptor Fifteen', 35)],
  ]) {
    const headings = detectChapterHeadings([chapterSegment('Chapter 14', 10), ...middle, chapterSegment('Chapter 16', 30)]);
    assert.deepEqual(headings.map(h => h.chapterNumber), [14, 16]);
  }
});

test('a structural divider does not serve as a numbered chapter recovery anchor', () => {
  assert.deepEqual(detectChapterHeadings([
    chapterSegment('Part Fourteen', 10), chapterSegment('Chaptor Fifteen', 20), chapterSegment('Chapter 16', 30),
  ]).map(h => h.text), ['Part Fourteen', 'Chapter 16']);
});

test('chapter detection scales across a long transcript in one indexed pass', { timeout: 5000 }, () => {
  const segments: NormalizedSegment[] = [];
  let seconds = 0;
  for (let segmentIndex = 0; segmentIndex < 2000; segmentIndex++) {
    const words = Array.from({ length: 50 }, (_, wordIndex) => {
      const isChapter = segmentIndex % 100 === 0 && wordIndex === 0;
      const isNumber = segmentIndex % 100 === 0 && wordIndex === 1;
      const word = isChapter ? 'Chapter' : isNumber ? String(segmentIndex / 100 + 1) : 'narration';
      const timed = { word, start: seconds, end: seconds + 0.2, probability: 0.95 };
      seconds += 0.25;
      return timed;
    });
    segments.push({ id: segmentIndex, start: words[0].start, end: words[49].end, text: words.map(word => word.word).join(' ') + '.', words });
  }
  const started = performance.now();
  const headings = detectChapterHeadings(segments);
  const elapsed = performance.now() - started;
  assert.equal(headings.length, 20);
  assert.deepEqual(headings.map(heading => heading.chapterNumber), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.ok(elapsed < 3000, `100,000-word detection took ${Math.round(elapsed)}ms`);
});

test('normalized output preserves segment and word timestamps', () => {
  const value = validateNormalizedTranscription({
    engine: 'faster-whisper', model: 'small', device: 'cpu', computeType: 'int8',
    segments: [{ id: 0, start: 12.5, end: 14, text: 'Chapter one', words: [
      { word: 'Chapter', start: 12.5, end: 13.1, probability: 0.97 },
      { word: 'one', start: 13.2, end: 14, probability: 0.95 },
    ] }],
  });
  assert.equal(value.segments[0].words[1].start, 13.2);
});

test('invalid shifted timelines are rejected', () => {
  assert.throws(() => validateNormalizedTranscription({
    engine: 'faster-whisper', model: 'small', device: 'cpu', computeType: 'int8',
    segments: [{ id: 0, start: 3, end: 2, text: '', words: [] }],
  }), /invalid segment timeline/);
});
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { transcriptionEngines } from './transcription-engine';

test('draft chapter finalization retains every candidate even when source chapters exist', () => {
  // Exercise the server's actual finalization block without starting transcription
  // or a server; existing source chapters remain available for manual selection.
  const server = fs.readFileSync(path.resolve('server.ts'), 'utf8');
  const start = server.indexOf('  job.candidates = generatedCandidates;');
  const end = server.indexOf("  job.status = 'transcribed';", start);
  assert.ok(start >= 0 && end > start);
  const generatedCandidates = [
    { candidate_start: '00:00:10.000', proposed_title: 'Chapter Twelve', confidence: '0', status: 'review' },
    { candidate_start: '00:00:12.000', proposed_title: 'Chapter Twenty Three', confidence: '0', status: 'review', headingType: 'numbered_chapter', chapterNumber: 23, recovered: true, transcriptWordIndex: 42 },
  ];
  const existingChapters = [{ start: '00:00:00.000', title: 'Source chapter' }];
  const job = { candidates: [], chapters: [], existingChapters };
  vm.runInNewContext(server.slice(start, end), { job, generatedCandidates, setStep1Stage() {} });
  assert.equal(job.candidates, generatedCandidates);
  assert.equal(job.chapters.length, 3);
  assert.equal(job.chapters[0].title, 'Opening');
  assert.equal(job.chapters[1].title, 'Chapter Twelve');
  assert.equal(job.chapters[2].start, '00:00:12.000');
  assert.equal(job.chapters[2].headingType, 'numbered_chapter');
  assert.equal(job.chapters[2].chapterNumber, 23);
  assert.equal(job.chapters[2].recovered, true);
  assert.equal(job.chapters[2].transcriptWordIndex, 42);
  assert.equal(job.existingChapters, existingChapters);
});

const python = path.resolve('runtime/venv/Scripts/python.exe');
test('Python execution routes each engine and cache independently', { skip: !fs.existsSync(python) }, async () => {
  const root = fs.mkdtempSync(path.resolve('.cache/transcription-routing-'));
  // Test-only modules record the actual arguments delivered to each Python backend.
  fs.writeFileSync(path.join(root, 'faster_whisper.py'), `
from types import SimpleNamespace
class WhisperModel:
    def __init__(self, name, device, compute_type, download_root):
        assert name == 'test/ct2-model'
        assert device == 'cpu' and compute_type == 'int8'
        assert download_root.endswith('ct2-cache')
    def transcribe(self, audio, **kwargs):
        assert kwargs['word_timestamps']
        return [], SimpleNamespace(language='en', language_probability=1, duration=1)
`);
  fs.writeFileSync(path.join(root, 'whisper.py'), `
class Model:
    def transcribe(self, audio, **kwargs):
        assert kwargs['word_timestamps']
        return {'segments': [], 'language': 'en'}
def load_model(name, device, download_root):
    assert name == 'tiny' and device == 'cpu'
    assert download_root.endswith('pt-cache')
    return Model()
`);
  for (const engine of ['faster-whisper', 'openai-whisper'] as const) {
    const result = await transcriptionEngines[engine].transcribe({
      pythonPath: python, audioPath: path.join(root, 'input.wav'), outputPath: path.join(root, engine + '.json'),
      modelId: 'tiny', fasterModelRepository: 'test/ct2-model', engine, device: 'cpu',
      computeType: engine === 'faster-whisper' ? 'int8' : 'float32',
      fasterCacheDir: path.join(root, 'ct2-cache'), openAiCacheDir: path.join(root, 'pt-cache'),
      env: {...process.env, PYTHONPATH: root},
    });
    assert.equal(result.engine, engine);
    assert.equal(result.device, 'cpu');
  }
});

const snapshots = path.resolve('models/whisperx/models--Systran--faster-whisper-tiny/snapshots');
const snapshot = fs.existsSync(snapshots) ? fs.readdirSync(snapshots).map(name => path.join(snapshots, name)).find(dir => fs.existsSync(path.join(dir, 'model.bin'))) : undefined;
test('installed Faster Whisper performs real offline CPU inference', { skip: !fs.existsSync(python) || !snapshot, timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.resolve('.cache/transcription-live-'));
  const audio = path.join(root, 'silence.wav');
  execFileSync(python, ['-c', 'import wave,sys; w=wave.open(sys.argv[1],"wb"); w.setparams((1,2,16000,0,"NONE","not compressed")); w.writeframes(bytes(32000)); w.close()', audio], {windowsHide:true});
  const result = await transcriptionEngines['faster-whisper'].transcribe({
    pythonPath: python, audioPath: audio, outputPath: path.join(root, 'result.json'), modelId: 'tiny',
    fasterModelRepository: snapshot, engine: 'faster-whisper', device: 'cpu', computeType: 'int8',
    fasterCacheDir: path.resolve('models/whisperx'), openAiCacheDir: path.join(root, 'unused'), language: 'en',
    env: {...process.env, HF_HUB_OFFLINE:'1'},
  });
  assert.equal(result.engine, 'faster-whisper');
  assert.equal(result.computeType, 'int8');
  assert.ok(Array.isArray(result.segments));
});
