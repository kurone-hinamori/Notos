import JSZip from "jszip";
import type { Anthology, Bible, Story } from "../types";

/** EPUB にする本の中身(長編・短編集の共通形式) */
export interface Book {
  title: string;
  tagline: string;
  author: string;
  synopsis: string;
  chapters: { heading: string; body: string }[];
  appendix: { title: string; html: string }[];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 縦書き用に、2桁の半角数字と「!!」「!?」を縦中横にする。 */
function inline(text: string): string {
  return esc(text)
    .replace(/(?<![0-9])[0-9]{2}(?![0-9])/g, '<span class="tcy">$&</span>')
    .replace(/(?<![!?])[!?]{2}(?![!?])/g, '<span class="tcy">$&</span>');
}

function paragraphs(body: string): string {
  const out: string[] = [];
  let blank = false;
  for (const line of body.split("\n")) {
    if (!line.trim()) {
      if (!blank && out.length) out.push('<p class="sb">&#160;</p>');
      blank = true;
      continue;
    }
    blank = false;
    const noIndent = /^[「『（(【〈《“]/.test(line);
    out.push(`<p${noIndent ? ' class="nd"' : ""}>${inline(line.trim())}</p>`);
  }
  return out.join("\n");
}

const xhtml = (title: string, body: string, cls = "") => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head>
<meta charset="UTF-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body${cls ? ` class="${cls}"` : ""}>
${body}
</body>
</html>`;

const CSS = `@charset "UTF-8";
html {
  writing-mode: vertical-rl;
  -epub-writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
}
body {
  font-family: serif;
  line-height: 1.8;
  margin: 0;
  padding: 0;
  text-align: justify;
  line-break: strict;
  -epub-line-break: strict;
  word-break: normal;
}
p { margin: 0; text-indent: 1em; }
p.nd { text-indent: 0; }
p.sb { text-indent: 0; margin: 0; }
.tcy { text-combine-upright: all; -webkit-text-combine: horizontal; -epub-text-combine: horizontal; }
h1, h2 { font-weight: bold; margin: 0; line-height: 1.6; text-indent: 0; }
h1 { font-size: 1.5em; margin-left: 2em; }
h2 { font-size: 1.2em; margin-left: 1.5em; }
h3 { font-size: 1em; font-weight: bold; margin: 0 1em 0 0; text-indent: 0; }
.title-page { text-align: center; }
.title-page .main { font-size: 2em; font-weight: bold; margin-left: 2em; }
.title-page .sub { font-size: 1em; margin-left: 2em; }
.title-page .author { font-size: 1.2em; margin-left: 1em; }
.chapter-head { margin-left: 3em; }
.colophon { font-size: 0.9em; }
.colophon p { text-indent: 0; margin-left: 0.5em; }
.bible p { text-indent: 0; margin-left: 0.4em; }
ul.toc { list-style: none; padding: 0; margin: 0; }
`;

function bibleSections(b: Bible): { title: string; html: string }[] {
  const dl = (rows: [string, string][]) =>
    rows
      .filter(([, v]) => v?.trim())
      .map(([k, v]) => `<p>${inline(`${k}:${v.trim()}`)}</p>`)
      .join("\n");
  const sections: { title: string; html: string }[] = [];
  const overview = dl([
    ["前提", b.premise],
    ["世界観", b.worldview],
    ["年表", b.timeline],
  ]);
  if (overview) sections.push({ title: "世界観", html: overview });
  if (b.characters.length)
    sections.push({
      title: "登場人物",
      html: b.characters
        .map(
          (c) =>
            `<h3>${inline(c.name)}${c.reading ? `(${inline(c.reading)})` : ""}</h3>\n` +
            dl([
              ["役割", c.role],
              ["年齢", c.age],
              ["外見", c.appearance],
              ["性格", c.personality],
              ["口調", c.speech],
              ["経歴", c.background],
              ["関係", c.relations],
              ["補足", c.notes],
            ]),
        )
        .join("\n"),
    });
  for (const [title, list] of [
    ["地名・場所", b.places],
    ["重要な品物", b.items],
    ["用語", b.terms],
  ] as const) {
    if (list.length)
      sections.push({
        title,
        html: list
          .map(
            (e) =>
              `<h3>${inline(e.name)}</h3>\n` +
              dl([
                ["", e.description],
                ["補足", e.notes],
              ]).replace(/<p>:/g, "<p>"),
          )
          .join("\n"),
      });
  }
  return sections;
}

export function novelBook(story: Story, author: string, includeBible: boolean): Book {
  return {
    title: story.title,
    tagline: story.tagline,
    author,
    synopsis: story.synopsis,
    chapters: story.chapters.map((c, i) => ({ heading: `第${i + 1}章　${c.title}`, body: c.body })),
    appendix: includeBible && story.bible.generated ? bibleSections(story.bible).map((s) => ({ title: `設定資料 ${s.title}`, html: s.html })) : [],
  };
}

/** 短編集を1冊にする。各話が1章になり、本文のない話は含めない。 */
export function anthologyBook(a: Anthology, author: string, includeBible: boolean): Book {
  const eps = a.episodes.map((e, i) => ({ e, n: i + 1 })).filter(({ e }) => e.chapters.some((c) => c.body.trim()));
  return {
    title: a.title,
    tagline: "",
    author,
    synopsis: eps.map(({ e, n }) => `第${n}話 ${e.title}`).join(" / "),
    chapters: eps.map(({ e, n }) => ({
      heading: `第${n}話　${e.title}`,
      body: e.chapters.map((c) => c.body).filter(Boolean).join("\n\n"),
    })),
    appendix: includeBible
      ? eps.flatMap(({ e, n }) =>
          e.bible.generated ? bibleSections(e.bible).map((s) => ({ title: `第${n}話 設定資料 ${s.title}`, html: s.html })) : [],
        )
      : [],
  };
}

export async function buildEpub(book: Book): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );

  type Page = { id: string; file: string; title: string; nav: boolean; html: string };
  const pages: Page[] = [];
  const author = book.author.trim() || "Notos";

  pages.push({
    id: "titlepage",
    file: "titlepage.xhtml",
    title: book.title,
    nav: false,
    html: xhtml(
      book.title,
      `<div class="title-page"><h1 class="main">${inline(book.title)}</h1>${
        book.tagline ? `<p class="sub">${inline(book.tagline)}</p>` : ""
      }<p class="author">${inline(author)}</p></div>`,
    ),
  });

  book.chapters.forEach((c, i) => {
    const heading = c.heading;
    pages.push({
      id: `chapter${i + 1}`,
      file: `chapter${i + 1}.xhtml`,
      title: heading,
      nav: true,
      html: xhtml(heading, `<h1 class="chapter-head">${inline(heading)}</h1>\n${paragraphs(c.body)}`),
    });
  });

  book.appendix.forEach((sec, i) => {
    pages.push({
      id: `bible${i + 1}`,
      file: `bible${i + 1}.xhtml`,
      title: sec.title,
      nav: true,
      html: xhtml(sec.title, `<h2>${inline(sec.title)}</h2>
<div class="bible">${sec.html}</div>`),
    });
  });

  const now = new Date();
  const modified = now.toISOString().replace(/\.\d+Z$/, "Z");
  pages.push({
    id: "colophon",
    file: "colophon.xhtml",
    title: "奥付",
    nav: false,
    html: xhtml(
      "奥付",
      `<div class="colophon"><p>${inline(book.title)}</p><p>著者:${inline(author)}</p><p>${now.getFullYear()}年${
        now.getMonth() + 1
      }月${now.getDate()}日 作成</p><p>本書は Notos(ローカルLLM)で生成されました。</p></div>`,
    ),
  });

  const bookId = `urn:uuid:${crypto.randomUUID()}`;
  const manifest = pages
    .map((p) => `<item id="${p.id}" href="${p.file}" media-type="application/xhtml+xml"/>`)
    .join("\n    ");
  const spine = pages.map((p) => `<itemref idref="${p.id}"/>`).join("\n    ");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ja">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${esc(book.title)}</dc:title>
    <dc:creator>${esc(author)}</dc:creator>
    <dc:language>ja</dc:language>
    <dc:description>${esc(book.synopsis)}</dc:description>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${manifest}
  </manifest>
  <spine toc="ncx" page-progression-direction="rtl">
    ${spine}
  </spine>
</package>`,
  );

  const navPages = pages.filter((p) => p.nav);
  zip.file(
    "OEBPS/nav.xhtml",
    xhtml(
      "目次",
      `<nav epub:type="toc" id="toc"><h1>目次</h1>\n<ol class="toc">${navPages
        .map((p) => `<li><a href="${p.file}">${esc(p.title)}</a></li>`)
        .join("\n")}</ol></nav>`,
    ),
  );
  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${bookId}"/></head>
  <docTitle><text>${esc(book.title)}</text></docTitle>
  <navMap>
${navPages
  .map(
    (p, i) =>
      `    <navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(p.title)}</text></navLabel><content src="${p.file}"/></navPoint>`,
  )
  .join("\n")}
  </navMap>
</ncx>`,
  );
  zip.file("OEBPS/style.css", CSS);
  for (const p of pages) zip.file(`OEBPS/${p.file}`, p.html);

  return zip.generateAsync({ type: "uint8array", mimeType: "application/epub+zip", compression: "DEFLATE" });
}
