import {
  DecodingMode,
  EntityDecoder,
  fromCodePoint,
  htmlDecodeTree,
} from "entities/decode";

export type HtmlStartTag = {
  contentEnd?: number;
  contentStart?: number;
  end: number;
  source: string;
  start: number;
  tagName: string;
};

export type HtmlAttribute = {
  name: string;
  value?: string;
  valueEnd?: number;
  valueStart?: number;
};

export type HtmlAttributeValueToken = {
  end: number;
  start: number;
  value: string;
};

const htmlSpacePattern = /[\t\n\f\r ]/;
const rawTextTagNames = new Set([
  "iframe",
  "noembed",
  "noframes",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

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

    const tagNameMatch = /^<([A-Za-z][A-Za-z\d:-]*)(?=[\t\n\f\r />])/.exec(
      source.slice(start),
    );

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

    if (tagName === "plaintext") {
      tag.contentStart = end;
      tag.contentEnd = source.length;
      tags.push(tag);
      break;
    }

    if (!rawTextTagNames.has(tagName)) {
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

export function findHtmlAttributes(tag: HtmlStartTag): HtmlAttribute[] {
  const attributes: HtmlAttribute[] = [];
  const tagName = /^<[A-Za-z][A-Za-z\d:-]*(?=[\t\n\f\r />])/.exec(
    tag.source,
  )?.[0];

  if (tagName === undefined) {
    return attributes;
  }

  let index = tagName.length;

  while (index < tag.source.length) {
    while (htmlSpacePattern.test(tag.source.charAt(index))) {
      index += 1;
    }

    if (index >= tag.source.length || /[/>]/.test(tag.source.charAt(index))) {
      break;
    }

    const nameStart = index;

    while (
      index < tag.source.length &&
      !/[\t\n\f\r =/>]/.test(tag.source.charAt(index))
    ) {
      index += 1;
    }

    const name = tag.source.slice(nameStart, index).toLowerCase();

    while (htmlSpacePattern.test(tag.source.charAt(index))) {
      index += 1;
    }

    if (tag.source.charAt(index) !== "=") {
      attributes.push({ name });
      continue;
    }

    index += 1;

    while (htmlSpacePattern.test(tag.source.charAt(index))) {
      index += 1;
    }

    const quote = tag.source.charAt(index);

    if (quote === "\"" || quote === "'") {
      const valueStart = index + 1;
      const valueEnd = tag.source.indexOf(quote, valueStart);

      if (valueEnd < 0) {
        break;
      }

      attributes.push({
        name,
        value: tag.source.slice(valueStart, valueEnd),
        valueEnd,
        valueStart,
      });
      index = valueEnd + 1;
      continue;
    }

    const valueStart = index;

    while (
      index < tag.source.length &&
      !/[\t\n\f\r >]/.test(tag.source.charAt(index))
    ) {
      index += 1;
    }

    attributes.push({
      name,
      value: tag.source.slice(valueStart, index),
      valueEnd: index,
      valueStart,
    });
  }

  return attributes;
}

export function htmlAttributeValueTokens(
  value: string,
): HtmlAttributeValueToken[] {
  const tokens: HtmlAttributeValueToken[] = [];
  let current: HtmlAttributeValueToken | undefined;
  let decodedEntity = "";
  const decoder = new EntityDecoder(htmlDecodeTree, (codePoint) => {
    decodedEntity += fromCodePoint(codePoint);
  });

  function append(decoded: string, start: number, end: number): void {
    if ([...decoded].every((character) => htmlSpacePattern.test(character))) {
      if (current !== undefined) {
        tokens.push(current);
        current = undefined;
      }
      return;
    }

    if (current === undefined) {
      current = { end, start, value: decoded };
    } else {
      current.end = end;
      current.value += decoded;
    }
  }

  let index = 0;

  while (index < value.length) {
    if (value.charAt(index) === "&") {
      decodedEntity = "";
      decoder.startEntity(DecodingMode.Attribute);
      let consumed = decoder.write(value, index + 1);

      if (consumed < 0) {
        consumed = decoder.end();
      }

      if (consumed > 0) {
        append(decodedEntity, index, index + consumed);
        index += consumed;
        continue;
      }
    }

    append(value.charAt(index), index, index + 1);
    index += 1;
  }

  if (current !== undefined) {
    tokens.push(current);
  }

  return tokens;
}
