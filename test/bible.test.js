import test from 'node:test';
import assert from 'node:assert/strict';
import { LISTS, getList, resolve, advance, rewind, describe } from '../src/bible.js';

// Horner's published list lengths, from the system's own documentation.
const PUBLISHED_LENGTHS = [89, 187, 78, 65, 62, 150, 31, 249, 250, 28];

test('each list is as long as Horner says it is', () => {
  assert.deepEqual(LISTS.map((list) => list.total), PUBLISHED_LENGTHS);
});

test('the ten lists cover all 66 books exactly once', () => {
  const books = LISTS.flatMap((list) => list.books);
  assert.equal(books.length, 66);
  assert.equal(new Set(books).size, 66);
  assert.equal(LISTS.reduce((sum, list) => sum + list.total, 0), 1189);
});

test('offset zero is the first chapter of the first book', () => {
  assert.deepEqual(resolve(1, 0), { book: 'Matthew', chapter: 1 });
  assert.deepEqual(resolve(2, 0), { book: 'Genesis', chapter: 1 });
  assert.deepEqual(resolve(10, 0), { book: 'Acts', chapter: 1 });
});

test('the last offset is the last chapter of the last book', () => {
  assert.deepEqual(resolve(1, 88), { book: 'John', chapter: 21 });
  assert.deepEqual(resolve(4, 64), { book: 'Revelation', chapter: 22 });
  assert.deepEqual(resolve(9, 249), { book: 'Malachi', chapter: 4 });
});

test('offsets resolve across book boundaries', () => {
  assert.deepEqual(resolve(1, 27), { book: 'Matthew', chapter: 28 });
  assert.deepEqual(resolve(1, 28), { book: 'Mark', chapter: 1 });
  // List 4 has several single-chapter books in a row.
  assert.deepEqual(resolve(4, 39), { book: '1 John', chapter: 5 });
  assert.deepEqual(resolve(4, 40), { book: '2 John', chapter: 1 });
  assert.deepEqual(resolve(4, 41), { book: '3 John', chapter: 1 });
  assert.deepEqual(resolve(4, 42), { book: 'Jude', chapter: 1 });
  assert.deepEqual(resolve(4, 43), { book: 'Revelation', chapter: 1 });
});

test('every offset in every list resolves to a real chapter', () => {
  for (const list of LISTS) {
    for (let offset = 0; offset < list.total; offset += 1) {
      const { book, chapter } = resolve(list.no, offset);
      assert.ok(list.books.includes(book), `list ${list.no} offset ${offset} gave ${book}`);
      assert.ok(chapter >= 1, `chapter ${chapter} is not 1-based`);
    }
  }
});

test('offsets outside a list are rejected', () => {
  assert.throws(() => resolve(7, 31), RangeError);
  assert.throws(() => resolve(7, -1), RangeError);
  assert.throws(() => resolve(11, 0), RangeError);
  assert.throws(() => getList(0), RangeError);
});

test('advancing moves one chapter forward', () => {
  assert.deepEqual(advance(6, 0, 0), { offset: 1, cycles: 0 });
  assert.deepEqual(advance(6, 148, 3), { offset: 149, cycles: 3 });
});

test('advancing past the end wraps and banks a cycle', () => {
  assert.deepEqual(advance(7, 30, 0), { offset: 0, cycles: 1 });   // Proverbs 31
  assert.deepEqual(advance(10, 27, 11), { offset: 0, cycles: 12 }); // Acts 28
});

test('undo reverses an advance from any offset in any list', () => {
  for (const list of LISTS) {
    for (let offset = 0; offset < list.total; offset += 1) {
      const cycles = 2;
      const next = advance(list.no, offset, cycles);
      assert.deepEqual(rewind(list.no, offset, next.cycles), { offset, cycles });
    }
  }
});

test('undo never drives the cycle count below zero', () => {
  assert.deepEqual(rewind(7, 30, 0), { offset: 30, cycles: 0 });
});

test('describe carries everything the client renders', () => {
  assert.deepEqual(describe(6, 46, 2, true), {
    list: 6,
    name: 'Psalms',
    book: 'Psalms',
    chapter: 47,
    reference: 'Psalms 47',
    position: 47,
    total: 150,
    cycles: 2,
    canUndo: true,
  });
});
