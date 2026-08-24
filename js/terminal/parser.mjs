const ASCII_WHITESPACE = /[\t\n\v\f\r ]/u;

function isEscapable(character, quote) {
  return character === '\\'
    || ASCII_WHITESPACE.test(character || '')
    || (quote ? character === quote : character === '"' || character === "'");
}

export function parseCommand(input, cursor = String(input ?? '').length) {
  const source = String(input ?? '');
  const tokens = [];
  let value = '';
  let start = -1;
  let quote = null;

  for (let index = 0; index <= source.length; index += 1) {
    const character = source[index];

    if (character === '\\' && index < source.length) {
      const next = source[index + 1];
      if (isEscapable(next, quote)) {
        if (start < 0) start = index;
        value += next;
        index += 1;
        continue;
      }
    }

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else if (character !== undefined) {
        value += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      if (start < 0) start = index;
      quote = character;
      continue;
    }

    if (character === undefined || ASCII_WHITESPACE.test(character)) {
      if (start >= 0) {
        tokens.push({ value, range: [start, index] });
        value = '';
        start = -1;
      }
      continue;
    }

    if (start < 0) start = index;
    value += character;
  }

  if (quote !== null) {
    return {
      command: '',
      args: [],
      tokens,
      activeToken: null,
      error: { code: 'UNCLOSED_QUOTE' }
    };
  }

  const position = Math.max(0, Math.min(source.length, Number.isFinite(cursor) ? Math.trunc(cursor) : source.length));
  const activeToken = tokens.find(token => position >= token.range[0] && position <= token.range[1])
    || { value: '', range: [position, position] };

  return {
    command: (tokens[0]?.value || '').replace(/[A-Z]/gu, character => character.toLowerCase()),
    args: tokens.slice(1).map(token => token.value),
    tokens,
    activeToken,
    error: null
  };
}
