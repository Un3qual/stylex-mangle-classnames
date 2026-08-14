import {
  DecodingMode,
  EntityDecoder,
  fromCodePoint,
  htmlDecodeTree,
} from "entities/decode";
import { parse, type DefaultTreeAdapterTypes } from "parse5";

export type HtmlStartTag = {
  attributes: HtmlAttribute[];
  contentEnd?: number;
  contentStart?: number;
  end: number;
  source: string;
  start: number;
  tagName: string;
};

export type HtmlAttribute = {
  decodedValue?: string;
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
type HtmlNode = DefaultTreeAdapterTypes.Node;

function isHtmlElement(
  node: HtmlNode,
): node is DefaultTreeAdapterTypes.Element {
  return "tagName" in node;
}

function htmlAttribute(
  source: string,
  tagStart: number,
  name: string,
  decodedValue: string,
  location: { endOffset: number; startOffset: number },
): HtmlAttribute {
  const attributeSource = source.slice(location.startOffset, location.endOffset);
  const equals = attributeSource.indexOf("=");

  if (equals < 0) {
    return { name };
  }

  let valueStart = equals + 1;

  while (htmlSpacePattern.test(attributeSource.charAt(valueStart))) {
    valueStart += 1;
  }

  const quote = attributeSource.charAt(valueStart);
  const quoted = quote === "\"" || quote === "'";
  valueStart += quoted ? 1 : 0;
  const valueEnd = quoted ? attributeSource.lastIndexOf(quote) : attributeSource.length;
  const absoluteValueStart = location.startOffset + valueStart;
  const absoluteValueEnd = location.startOffset + Math.max(valueStart, valueEnd);

  return {
    decodedValue,
    name,
    value: source.slice(absoluteValueStart, absoluteValueEnd),
    valueEnd: absoluteValueEnd - tagStart,
    valueStart: absoluteValueStart - tagStart,
  };
}

export function findHtmlStartTags(source: string): HtmlStartTag[] {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const tags: HtmlStartTag[] = [];

  function visit(node: HtmlNode): void {
    if (isHtmlElement(node)) {
      const location = node.sourceCodeLocation;
      const startTag = location?.startTag;

      if (location !== null && location !== undefined && startTag !== undefined) {
        const attributes = node.attrs.flatMap((attribute) => {
          const attributeLocation = location.attrs?.[attribute.name];

          return attributeLocation === undefined
            ? []
            : [
                htmlAttribute(
                  source,
                  startTag.startOffset,
                  attribute.name,
                  attribute.value,
                  attributeLocation,
                ),
              ];
        });
        const tag: HtmlStartTag = {
          attributes,
          end: startTag.endOffset,
          source: source.slice(startTag.startOffset, startTag.endOffset),
          start: startTag.startOffset,
          tagName: node.tagName,
        };

        if (location.endTag !== undefined) {
          tag.contentStart = startTag.endOffset;
          tag.contentEnd = location.endTag.startOffset;
        } else if (node.tagName === "plaintext") {
          tag.contentStart = startTag.endOffset;
          tag.contentEnd = location.endOffset;
        }

        tags.push(tag);
      }

      if (node.nodeName === "template") {
        visit((node as DefaultTreeAdapterTypes.Template).content);
      }
    }

    if ("childNodes" in node) {
      for (const child of node.childNodes) {
        visit(child);
      }
    }
  }

  visit(document);
  return tags.sort((left, right) => left.start - right.start);
}

export function findHtmlAttributes(tag: HtmlStartTag): HtmlAttribute[] {
  return tag.attributes;
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
