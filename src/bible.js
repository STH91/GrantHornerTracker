// Professor Grant Horner's Bible-Reading System: the ten lists.
//
// A list is an ordered sequence of books. Flattening it gives a chapter
// sequence, and a reader's position in a list is just an offset into that
// sequence. Advancing past the end wraps to the start and completes a cycle.
//
// List lengths below are asserted in test/bible.test.js against Horner's
// published figures: 89, 187, 78, 65, 62, 150, 31, 249, 250, 28.

const CHAPTERS = {
  'Genesis': 50, 'Exodus': 40, 'Leviticus': 27, 'Numbers': 36, 'Deuteronomy': 34,
  'Joshua': 24, 'Judges': 21, 'Ruth': 4, '1 Samuel': 31, '2 Samuel': 24,
  '1 Kings': 22, '2 Kings': 25, '1 Chronicles': 29, '2 Chronicles': 36,
  'Ezra': 10, 'Nehemiah': 13, 'Esther': 10, 'Job': 42, 'Psalms': 150,
  'Proverbs': 31, 'Ecclesiastes': 12, 'Song of Solomon': 8, 'Isaiah': 66,
  'Jeremiah': 52, 'Lamentations': 5, 'Ezekiel': 48, 'Daniel': 12, 'Hosea': 14,
  'Joel': 3, 'Amos': 9, 'Obadiah': 1, 'Jonah': 4, 'Micah': 7, 'Nahum': 3,
  'Habakkuk': 3, 'Zephaniah': 3, 'Haggai': 2, 'Zechariah': 14, 'Malachi': 4,
  'Matthew': 28, 'Mark': 16, 'Luke': 24, 'John': 21, 'Acts': 28, 'Romans': 16,
  '1 Corinthians': 16, '2 Corinthians': 13, 'Galatians': 6, 'Ephesians': 6,
  'Philippians': 4, 'Colossians': 4, '1 Thessalonians': 5, '2 Thessalonians': 3,
  '1 Timothy': 6, '2 Timothy': 4, 'Titus': 3, 'Philemon': 1, 'Hebrews': 13,
  'James': 5, '1 Peter': 5, '2 Peter': 3, '1 John': 5, '2 John': 1, '3 John': 1,
  'Jude': 1, 'Revelation': 22,
};

const DEFINITIONS = [
  { no: 1, name: 'Gospels', books: ['Matthew', 'Mark', 'Luke', 'John'] },
  { no: 2, name: 'Pentateuch', books: ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'] },
  { no: 3, name: 'Pauline Letters', books: ['Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', 'Hebrews'] },
  { no: 4, name: 'Letters & Revelation', books: ['1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation'] },
  { no: 5, name: 'Wisdom', books: ['Job', 'Ecclesiastes', 'Song of Solomon'] },
  { no: 6, name: 'Psalms', books: ['Psalms'] },
  { no: 7, name: 'Proverbs', books: ['Proverbs'] },
  { no: 8, name: 'Old Testament History', books: ['Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther'] },
  { no: 9, name: 'Prophets', books: ['Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi'] },
  { no: 10, name: 'Acts', books: ['Acts'] },
];

// Each list gets a cumulative index so resolving an offset is a short scan
// rather than a walk over every chapter.
export const LISTS = DEFINITIONS.map((def) => {
  let running = 0;
  const spans = def.books.map((book) => {
    const span = { book, chapters: CHAPTERS[book], start: running };
    running += span.chapters;
    return span;
  });
  return { ...def, spans, total: running };
});

export const LIST_COUNT = LISTS.length;

export function getList(listNo) {
  const list = LISTS[listNo - 1];
  if (!list) throw new RangeError(`no such list: ${listNo}`);
  return list;
}

// An offset is 0-based over the list's flattened chapters. Returns the book
// and 1-based chapter it lands on.
export function resolve(listNo, offset) {
  const list = getList(listNo);
  if (!Number.isInteger(offset) || offset < 0 || offset >= list.total) {
    throw new RangeError(`offset ${offset} out of range for list ${listNo}`);
  }
  const span = list.spans.findLast((s) => s.start <= offset);
  return { book: span.book, chapter: offset - span.start + 1 };
}

// Marking a chapter read moves one forward, wrapping at the end of the list
// and banking a completed cycle.
export function advance(listNo, offset, cycles) {
  const { total } = getList(listNo);
  const next = offset + 1;
  return next >= total
    ? { offset: 0, cycles: cycles + 1 }
    : { offset: next, cycles };
}

// Undo restores the offset that was logged as read. It wrapped if and only if
// that offset was the last chapter in the list.
export function rewind(listNo, loggedOffset, cycles) {
  const { total } = getList(listNo);
  const wrapped = loggedOffset === total - 1;
  return {
    offset: loggedOffset,
    cycles: wrapped ? Math.max(0, cycles - 1) : cycles,
  };
}

// The shape the client renders. Nothing about scripture lives client-side.
export function describe(listNo, offset, cycles, canUndo) {
  const list = getList(listNo);
  const { book, chapter } = resolve(listNo, offset);
  return {
    list: list.no,
    name: list.name,
    book,
    chapter,
    reference: `${book} ${chapter}`,
    position: offset + 1,
    total: list.total,
    cycles,
    canUndo,
  };
}
