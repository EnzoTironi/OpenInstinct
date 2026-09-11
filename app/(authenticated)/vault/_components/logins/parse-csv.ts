interface CsvParseState {
  field: string;
  index: number;
  quoted: boolean;
  row: string[];
  rows: string[][];
}

function appendField(state: CsvParseState): CsvParseState {
  return {
    ...state,
    field: "",
    row: [...state.row, state.field],
  };
}

function finishRow(state: CsvParseState): CsvParseState {
  const withField = appendField(state);

  return {
    ...withField,
    row: [],
    rows: [...withField.rows, withField.row],
  };
}

function handleEscapedQuote(state: CsvParseState): CsvParseState {
  return {
    ...state,
    field: `${state.field}"`,
    index: state.index + 1,
  };
}

function handleQuotedCharacter(
  state: CsvParseState,
  csv: string,
  character: string
): CsvParseState {
  if (character !== '"') {
    return { ...state, field: state.field + character };
  }

  if (csv[state.index + 1] === '"') {
    return handleEscapedQuote(state);
  }

  return { ...state, quoted: false };
}

function handleLineBreak(state: CsvParseState, csv: string, character: string) {
  let next = finishRow(state);

  if (character === "\r" && csv[state.index + 1] === "\n") {
    next = { ...next, index: state.index + 1 };
  }

  return next;
}

function handleUnquotedCharacter(
  state: CsvParseState,
  csv: string,
  character: string
): CsvParseState {
  if (character === '"' && state.field.length === 0) {
    return { ...state, quoted: true };
  }

  if (character === ",") {
    return appendField(state);
  }

  if (character === "\n" || character === "\r") {
    return handleLineBreak(state, csv, character);
  }

  return { ...state, field: state.field + character };
}

function advanceCsv(state: CsvParseState, csv: string): CsvParseState {
  const character = csv.charAt(state.index);

  if (state.quoted) {
    return handleQuotedCharacter(state, csv, character);
  }

  return handleUnquotedCharacter(state, csv, character);
}

function finalizeCsv(state: CsvParseState): string[][] {
  if (state.quoted) {
    throw new Error("This CSV has an unfinished quoted value.");
  }

  if (state.field.length === 0 && state.row.length === 0) {
    return state.rows;
  }

  return finishRow(state).rows;
}

export function parseCsv(csv: string): string[][] {
  let state: CsvParseState = {
    field: "",
    index: 0,
    quoted: false,
    row: [],
    rows: [],
  };

  while (state.index < csv.length) {
    state = advanceCsv(state, csv);
    state = Object.assign({}, state, { index: state.index + 1 });
  }

  return finalizeCsv(state);
}
