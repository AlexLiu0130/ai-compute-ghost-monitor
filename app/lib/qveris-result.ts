export function recoverTruncatedFeed(value: unknown) {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as { feed?: unknown[] };
    return Array.isArray(parsed.feed) ? parsed.feed : [];
  } catch {
    // QVeris can return a valid prefix when its full-result URL is unavailable.
  }

  const marker = value.indexOf('"feed"');
  const arrayStart = marker >= 0 ? value.indexOf("[", marker) : -1;
  if (arrayStart < 0) return [];

  const rows: unknown[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = arrayStart + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          rows.push(JSON.parse(value.slice(start, index + 1)));
        } catch {
          // Only complete, independently valid feed entries are accepted.
        }
        start = -1;
      }
    }
  }
  return rows;
}
