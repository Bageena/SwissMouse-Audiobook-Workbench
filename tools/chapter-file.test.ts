import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseChapterFile } from './chapter-file';

const directory=path.resolve('.cache/chapter-parser-fixture');
const sources=['one.mp3','two.mp3'].map((file,index)=>({file:path.join(directory,file),durationSeconds:index?30:60,chapters:[]}));
const formats:[string,string,'tracks'|'markers'][]=[
  ['book.cue','FILE "one.mp3" MP3\n TRACK 01 AUDIO\n TITLE "One"\n INDEX 01 00:00:00\nFILE "two.mp3" MP3\n TRACK 02 AUDIO\n TITLE "Two"\n INDEX 01 00:00:00','markers'],
  ['book.m3u','#EXTM3U\n#EXTINF:999,One\none.mp3\n#EXTINF:999,Two\ntwo.mp3','tracks'],
  ['book.m3u8','#EXTM3U\n#EXTINF:60,One\none.mp3\n#EXTINF:30,Two\ntwo.mp3','tracks'],
  ['book.pls','[playlist]\nFile1=one.mp3\nTitle1=One\nFile2=two.mp3\nTitle2=Two\nNumberOfEntries=2\nVersion=2','tracks'],
  ['book.xspf','<playlist xmlns="http://xspf.org/ns/0/" version="1"><trackList><track><location>one.mp3</location><title>One</title></track><track><location>two.mp3</location><title>Two</title></track></trackList></playlist>','tracks'],
  ['book.wpl','<?wpl version="1.0"?><smil><body><seq><media src="one.mp3"/><media src="two.mp3"/></seq></body></smil>','tracks'],
  ['book.asx','<ASX version="3"><ENTRY><TITLE>One</TITLE><REF HREF="one.mp3"/></ENTRY><ENTRY><TITLE>Two</TITLE><REF HREF="two.mp3"/></ENTRY></ASX>','tracks'],
  ['book.ffmeta',';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=60000\ntitle=One\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=60000\nEND=90000\ntitle=Two','markers'],
  ['book.ffmetadata',';FFMETADATA1\n[CHAPTER]\nSTART=0\nEND=60000000000\ntitle=One\n[CHAPTER]\nSTART=60000000000\nEND=90000000000\ntitle=Two','markers'],
  ['book.txt','CHAPTER01=00:00:00.000\nCHAPTER01NAME=One\nCHAPTER02=00:01:00.000\nCHAPTER02NAME=Two','markers'],
  ['book.txt','00:00:00.000 One\n00:01:00.000 Two','markers'],
  ['book.xml','<!DOCTYPE Chapters SYSTEM "matroskachapters.dtd"><Chapters><EditionEntry><ChapterAtom><ChapterTimeStart>00:00:00.000000000</ChapterTimeStart><ChapterDisplay><ChapterString>One</ChapterString></ChapterDisplay></ChapterAtom><ChapterAtom><ChapterTimeStart>00:01:00.000000000</ChapterTimeStart><ChapterDisplay><ChapterString>Two</ChapterString></ChapterDisplay></ChapterAtom></EditionEntry></Chapters>','markers'],
  ['book.vtt','WEBVTT\n\n00:00.000 --> 01:00.000\nOne\n\n01:00.000 --> 01:30.000\nTwo','markers'],
];
for(const [index,[name,text,kind]] of formats.entries())test(`chapter/playlist format ${index+1}: ${name}`,()=>{
  const result=parseChapterFile(name,text,sources,directory);
  assert.equal(result.kind,kind);
  assert.deepEqual(result.chapters.map(chapter=>chapter.start),['00:00:00.000','00:01:00.000']);
  if(!name.endsWith('.wpl'))assert.deepEqual(result.chapters.map(chapter=>chapter.title),['One','Two']);
});

test('playlists cannot fetch URLs, attach extra files, reorder sources or duplicate recordings',()=>{
  for(const text of ['https://example.com/audio.mp3\ntwo.mp3','one.mp3\nmissing.mp3','two.mp3\none.mp3','one.mp3\none.mp3','one.mp3','#EXTM3U\n#EXT-X-VERSION:3\none.mp3\ntwo.mp3']){
    assert.throws(()=>parseChapterFile('book.m3u',text,sources,directory));
  }
});
test('malformed, oversized and out-of-range chapter files are rejected',()=>{
  assert.throws(()=>parseChapterFile('book.txt','x'.repeat(1024*1024+1),sources,directory),/1 MiB/);
  assert.throws(()=>parseChapterFile('book.txt','00:01:30.000 Past end',sources,directory),/out-of-range/);
  assert.throws(()=>parseChapterFile('book.txt','00:01:00.000 Two\n00:00:00.000 One',sources,directory),/out-of-order/);
  assert.throws(()=>parseChapterFile('book.ffmeta',';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/0\nSTART=0',sources,directory),/timebase/);
  assert.throws(()=>parseChapterFile('book.xspf','<!DOCTYPE playlist [<!ENTITY test SYSTEM "file:///secret">]><playlist>&test;</playlist>',sources,directory),/document types/);
  assert.throws(()=>parseChapterFile('book.xspf','<playlist><trackList></playlist>',sources,directory));
});
