export type SlashRange = {
  from: number;
  to: number;
};

export type SlashCommand<TEditor = unknown> = {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  run: (editor: TEditor, range: SlashRange) => void;
};

export type SlashMenuState<TEditor = unknown> = {
  open: boolean;
  query: string;
  x: number;
  y: number;
  index: number;
  range: SlashRange | null;
  items: Array<SlashCommand<TEditor>>;
};

export type MentionSuggestion = {
  id: string;
  handle: string;
  full_name: string | null;
  email: string | null;
};

export type MentionMenuState = {
  open: boolean;
  query: string;
  x: number;
  y: number;
  index: number;
  range: SlashRange | null;
  items: MentionSuggestion[];
  loading: boolean;
};

type TextMatchEditor = {
  state: {
    selection: {
      empty: boolean;
      from: number;
    };
    doc: {
      textBetween(
        from: number,
        to: number,
        blockSeparator?: string,
        leafText?: string
      ): string;
    };
  };
};

export function getSlashMatch(editor: TextMatchEditor) {
  const { state } = editor;
  if (!state.selection.empty) {
    return null;
  }

  const { from } = state.selection;
  const start = Math.max(0, from - 120);
  const textBefore = state.doc.textBetween(start, from, "\n", "\n");
  const slashIndex = textBefore.lastIndexOf("/");

  if (slashIndex === -1) {
    return null;
  }

  const charBefore = slashIndex > 0 ? textBefore[slashIndex - 1] : " ";
  if (charBefore && !/\s/.test(charBefore)) {
    return null;
  }

  const query = textBefore.slice(slashIndex + 1);
  if (query.includes(" ") || query.length > 32) {
    return null;
  }

  const fromPos = from - query.length - 1;
  return {
    range: { from: fromPos, to: from },
    query,
  };
}

export function filterSlashCommands<TEditor>(
  commands: Array<SlashCommand<TEditor>>,
  query: string
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return commands;
  }
  return commands.filter((command) => {
    const label = command.label.toLowerCase();
    if (label.includes(normalized)) {
      return true;
    }
    return command.keywords.some((keyword) => keyword.includes(normalized));
  });
}

export function getMentionMatch(editor: TextMatchEditor) {
  const { state } = editor;
  if (!state.selection.empty) {
    return null;
  }

  const { from } = state.selection;
  const start = Math.max(0, from - 160);
  const textBefore = state.doc.textBetween(start, from, "\n", "\n");
  const match = textBefore.match(/(^|[^a-zA-Z0-9_])@([a-zA-Z0-9._@-]{0,127})$/);
  if (!match) {
    return null;
  }

  const mentionQuery = String(match[2] || "");
  const mentionToken = `@${mentionQuery}`;
  const tokenStartInText = textBefore.lastIndexOf(mentionToken);
  if (tokenStartInText < 0) {
    return null;
  }

  return {
    range: {
      from: start + tokenStartInText,
      to: from,
    },
    query: mentionQuery.toLowerCase(),
  };
}
