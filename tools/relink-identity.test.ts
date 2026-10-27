import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRelinkIdentity } from './relink-identity';

const expected = { title: 'A Book', narrator: 'A Narrator' };
test('same book and narrator tolerate case and whitespace without deriving IDs from tags', () => {
  assert.equal(checkRelinkIdentity(expected, [{ album: ' a  book ', composer: 'A NARRATOR' }], true), null);
});
test('different narrator or book must remain a separate project', () => {
  for (const tags of [{ album: 'A Book', composer: 'Someone Else' }, { album: 'Other Book', composer: 'A Narrator' }])
    assert.equal(checkRelinkIdentity(expected, [tags], true)?.code, 'RELINK_DIFFERENT_RECORDING');
});
test('missing tags require confirmation and multipart track titles are not book titles', () => {
  assert.equal(checkRelinkIdentity(expected, [{}], true)?.code, 'RELINK_CONFIRM_IDENTITY');
  assert.equal(checkRelinkIdentity(expected, [{ title: 'Chapter 1', composer: 'A Narrator' }], false)?.code, 'RELINK_CONFIRM_IDENTITY');
  assert.equal(checkRelinkIdentity(expected, [{ album: 'A Book', title: 'Chapter 1', composer: 'A Narrator' }, { album: 'A Book', composer: 'Other' }], false)?.code, 'RELINK_DIFFERENT_RECORDING');
});
