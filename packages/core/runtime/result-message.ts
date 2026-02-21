const DEFAULT_RESULT_MESSAGE_LIMIT = 3_000;

function splitTextByLimit(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= maxChars) {
      chunks.push(text.slice(cursor));
      break;
    }

    const slice = text.slice(cursor, cursor + maxChars);
    let splitAt = slice.lastIndexOf("\n");
    if (splitAt <= 0) {
      splitAt = slice.lastIndexOf(" ");
    }
    if (splitAt <= 0) {
      splitAt = maxChars;
    }

    const nextChunk = text.slice(cursor, cursor + splitAt);
    if (nextChunk.length > 0) {
      chunks.push(nextChunk);
    }

    cursor += splitAt;
    while (cursor < text.length && /\s/.test(text[cursor] || "")) {
      cursor += 1;
    }
  }

  return chunks.length > 0 ? chunks : [text];
}

export function splitResultMessage(text: string, maxChars = DEFAULT_RESULT_MESSAGE_LIMIT): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  let estimatedCount = 1;
  let contentChunks: string[] = [];

  while (true) {
    const prefixLength = `(${estimatedCount}/${estimatedCount}) `.length;
    const payloadLimit = Math.max(1, maxChars - prefixLength);
    contentChunks = splitTextByLimit(text, payloadLimit);

    if (contentChunks.length === estimatedCount) {
      break;
    }

    estimatedCount = contentChunks.length;
  }

  const total = contentChunks.length;
  return contentChunks.map((chunk, index) => `(${index + 1}/${total}) ${chunk}`);
}
