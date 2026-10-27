import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChapterSuggestions } from '../src/components/ChapterSuggestions';
import { candidateChapter } from '../src/utils/chapterSuggestions';
import type { ChapterCandidate } from '../src/types';

const candidate: ChapterCandidate = { candidate_id: 1, candidate_start: '00:01:40.000', candidate_end: '00:01:40.700',
  proposed_title: 'Section 2', headingType: 'numbered_section', parentChapterStart: '00:00:10.000', suggestionOnly: true,
  status: 'review', matched_text: 'Two.', context_before: '', context_after: '', confidence: '.81', notes: '', evidence: ['Consecutive spoken section sequence'] };

test('suggestions show evidence, parent and review actions without a misleading probability', () => {
  const html = renderToStaticMarkup(<ChapterSuggestions candidates={[candidate]} chapters={[]} onPlay={() => {}} onAccept={() => {}} />);
  assert.match(html, /Experimental suggestions \(1\)/);
  assert.match(html, /Consecutive spoken section sequence/);
  assert.match(html, /Within chapter at 00:00:10.000/);
  assert.match(html, /Accept suggestion Section 2 at 00:01:40.000/);
  assert.match(html, /Listen to suggestion/);
  assert.doesNotMatch(html, /81%/);
});

test('membership in the draft hides accepted suggestions; removing it makes the suggestion available again', () => {
  const render = (accepted: boolean) => renderToStaticMarkup(<ChapterSuggestions candidates={[{ ...candidate, status: 'approved' }]}
    chapters={accepted ? [candidateChapter(candidate, 'accepted')] : []} onPlay={() => {}} onAccept={() => {}} />);
  assert.doesNotMatch(render(true), /Accept suggestion/);
  assert.match(render(false), /Accept suggestion/);
});
