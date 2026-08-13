export type HtmlStartTag = {
  contentEnd?: number;
  contentStart?: number;
  end: number;
  source: string;
  start: number;
  tagName: string;
};

const rawTextTagNames = new Set(["script", "style", "textarea", "title"]);

function findStartTagEnd(source: string, start: number): number | null {
  let quote: "\"" | "'" | null = null;

  for (let index = start + 1; index < source.length; index += 1) {
    const character = source.charAt(index);

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }

  return null;
}

export function findHtmlStartTags(source: string): HtmlStartTag[] {
  const tags: HtmlStartTag[] = [];
  let index = 0;

  while (index < source.length) {
    const start = source.indexOf("<", index);

    if (start < 0) {
      break;
    }

    if (source.startsWith("<!--", start)) {
      const commentEnd = source.indexOf("-->", start + 4);
      index = commentEnd < 0 ? source.length : commentEnd + 3;
      continue;
    }

    const tagNameMatch = /^<([A-Za-z][A-Za-z\d:-]*)\b/.exec(source.slice(start));

    if (tagNameMatch === null) {
      index = start + 1;
      continue;
    }

    const end = findStartTagEnd(source, start);

    if (end === null) {
      break;
    }

    const tagName = (tagNameMatch[1] ?? "").toLowerCase();
    const tag: HtmlStartTag = {
      end,
      source: source.slice(start, end),
      start,
      tagName,
    };

    if (!rawTextTagNames.has(tagName) || /\/\s*>$/.test(tag.source)) {
      tags.push(tag);
      index = end;
      continue;
    }

    const closingTagPattern = new RegExp(`</${tagName}\\s*>`, "gi");
    closingTagPattern.lastIndex = end;
    const closingTag = closingTagPattern.exec(source);

    if (closingTag === null) {
      tags.push(tag);
      index = end;
      continue;
    }

    tag.contentStart = end;
    tag.contentEnd = closingTag.index;
    tags.push(tag);
    index = closingTag.index + closingTag[0].length;
  }

  return tags;
}
