import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { chapterActivity, appendChapterActivity, defaultReviewChapters } from '../src/utils/chapterReviewActivity';
import { prepareChapters, applyChapterNumberFormat } from '../src/utils/chapters';
import type { AudiobookJob, ChapterEntry } from '../src/types';
const original: ChapterEntry[] = [{id:'a',title:'Chapter 1',start:'00:00:00.000',end:'00:00:59.999'},{id:'b',title:'Chapter 2',start:'00:01:00.000'}];
test('activity tracks edits, membership and ordering but ignores automatic ends', () => {
  const next = original.map(chapter => ({...chapter}));
  next[1].start = '00:01:05.125'; next[0].end = '00:01:05.124';
  const events = chapterActivity(original,next,1);
  assert.equal(events.length,1); assert.match(events[0].message,/Chapter 2: set start to 00:01:05.125/);
  assert.match(chapterActivity(original,[original[1],original[0]],2)[0].message,/Reordered/);
  assert.match(chapterActivity(original,[original[0]],2)[0].message,/Removed Chapter 2/);
  assert.match(chapterActivity([],original,2)[0].message,/Added Chapter 1/);
});
test('typing coalesces and the local activity history stays bounded', () => {
  const first = {key:'a:title',message:'Renamed chapter to C',at:1};
  assert.deepEqual(appendChapterActivity([first],[{...first,message:'Renamed chapter to Chapter',at:100}]),[{...first,message:'Renamed chapter to Chapter',at:100}]);
  assert.equal(appendChapterActivity([],Array.from({length:70},(_,i)=>({key:String(i),message:String(i),at:i}))).length,50);
});
test('default chapters use preserved generation data rather than saved edits, with legacy fallbacks', () => {
  const job = { chapters:[{...original[0],title:'Edited'}],chapterReviewBaseline:original,candidates:[],chapterSource:'existing_chapters'} as AudiobookJob;
  const baseline = defaultReviewChapters(job)!; baseline[0].title='Mutated';
  assert.equal(original[0].title,'Chapter 1');
  assert.equal(defaultReviewChapters({...job,chapterReviewBaseline:undefined,existingChapters:original})![0].title,'Chapter 1');
  assert.equal(defaultReviewChapters({...job,chapterReviewBaseline:undefined,chapterSource:'manual'}),undefined);
  const legacy = defaultReviewChapters({...job,chapterReviewBaseline:undefined,chapterSource:'whisperx',candidates:[{candidate_start:'00:01:00.000',proposed_title:'Detected'} as any]})!;
  assert.equal(legacy[0].id,'opening'); assert.equal(legacy[1].title,'Detected');
});
test('reset requires confirmation, changes only the draft and clears stale edit state', () => {
  const source = fs.readFileSync('src/components/Step2ChapterReview.tsx','utf8');
  const code = source.slice(source.indexOf('  const handleResetChapters ='),source.indexOf('  const nextAction ='));
  for (const approved of [false,true]) {
    let updated: ChapterEntry[] | undefined;  let cleared=false;
    const context = {baseline:original,isSaving:false,resetRequested:approved,setResetRequested(){},applyChapterNumberFormat,prepareChapters,job:{totalDurationSeconds:120},chapterNumberFormat:'numerical',previousChapters:{current:original},setChapters:(value:ChapterEntry[])=>{updated=value;},setIsPlaying(){},setActiveTrack(){},setEditingChapterId(){cleared=true;},setSelectedChapterIds(){},setTitleCleanupUndo(){},setBulkEditUndo(){},setShowBulkEditor(){},setSaveSuccess(){},setValidationError(){},validateChaptersList:()=>null,recordActivity(){}};
    vm.runInNewContext(transformSync(code+'\nhandleResetChapters();',{loader:'ts'}).code,context);
    assert.equal(!!updated,approved); assert.equal(cleared,approved);

  }
});
