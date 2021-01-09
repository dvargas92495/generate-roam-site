import puppeteer from "puppeteer";
import path from "path";
import watch from "node-watch";
import fs from "fs";
import jszip from "jszip";
import marked from "roam-marked";

const CONFIG_PAGE_NAME = "roam/js/public-garden";

type Config = {
  index: string;
  titleFilter: (title: string) => boolean;
  contentFilter: (content: string) => boolean;
  template: string;
  referenceTemplate: string;
};

type RoamBlock = {
  title?: string;
  time?: number;
  id?: number;
  uid?: string;
};

declare global {
  interface Window {
    roamAlphaAPI: {
      q: (query: string) => RoamBlock[][];
    };
  }
}

const extractTag = (tag: string) =>
  tag.startsWith("#[[") && tag.endsWith("]]")
    ? tag.substring(3, tag.length - 2)
    : tag.startsWith("[[") && tag.endsWith("]]")
    ? tag.substring(2, tag.length - 2)
    : tag.startsWith("#")
    ? tag.substring(1)
    : tag;

export const defaultConfig = {
  index: "Website Index",
  titleFilter: (title: string): boolean => title !== `${CONFIG_PAGE_NAME}.md`,
  contentFilter: (): boolean => true,
  template: `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>$\{PAGE_NAME}</title>
<style>
.rm-highlight {
  background-color: hsl(51, 98%, 81%);
  margin: -2px;
  padding: 2px;
}
</style>
</head>
<body>
<div id="content">
$\{PAGE_CONTENT}
</div>
<div id="references">
<ul>
$\{REFERENCES}
</ul>
</div>
</body>
</html>`,
  referenceTemplate: '<li><a href="${LINK}">${REFERENCE}</a></li>',
};

type Node = {
  text: string;
  children: Node[];
};

const getTitleRuleFromNode = (n: Node) => {
  const { text, children } = n;
  if (text.trim().toUpperCase() === "STARTS WITH" && children.length) {
    return (title: string) => title.startsWith(extractTag(children[0].text));
  } else {
    return defaultConfig.titleFilter;
  }
};

const getContentRuleFromNode = (n: Node) => {
  const { text, children } = n;
  if (text.trim().toUpperCase() === "TAGGED WITH" && children.length) {
    const tag = extractTag(children[0].text);
    return (content: string) =>
      content.includes(`#${tag}`) ||
      content.includes(`[[${tag}]]`) ||
      content.includes(`${tag}::`);
  } else {
    return () => true;
  }
};

const getParsedTree = (content: string) => {
  const contentParts = content.split("\n");
  const parsedTree: Node[] = [];
  let currentNode = { children: parsedTree };
  let currentIndent = 0;
  for (const text of contentParts) {
    const node = { text: text.substring(text.indexOf("- ") + 2), children: [] };
    const indent = text.indexOf("- ") / 4;
    if (indent < 0) {
      const lastNode = currentNode.children[currentNode.children.length - 1];
      lastNode.text = `${lastNode.text}\n${text}`;
    } else if (indent === currentIndent) {
      currentNode.children.push(node);
    } else if (indent > currentIndent) {
      currentNode = currentNode.children[currentNode.children.length - 1];
      currentNode.children.push(node);
      currentIndent = indent;
    } else {
      currentNode = { children: parsedTree };
      for (let i = 1; i < indent; i++) {
        currentNode = currentNode.children[currentNode.children.length - 1];
      }
      currentIndent = indent;
      currentNode.children.push(node);
    }
  }
  return parsedTree;
};

const getConfigFromPage = async (page: jszip.JSZipObject) => {
  const content = await page.async("text");
  const parsedTree = getParsedTree(content);

  const getConfigNode = (key: string) =>
    parsedTree.find((n) => n.text.trim().toUpperCase() === key.toUpperCase());
  const indexNode = getConfigNode("index");
  const filterNode = getConfigNode("filter");
  const templateNode = getConfigNode("template");
  const referenceTemplateNode = getConfigNode("reference template");
  const getCode = (node?: Node) =>
    (node?.children || [])
      .map((s) => s.text.match(new RegExp("```html\n(.*)```", "s")))
      .find((s) => !!s)?.[1];
  const template = getCode(templateNode);
  const referenceTemplate = getCode(referenceTemplateNode);
  const withIndex: Partial<Config> = indexNode?.children?.length
    ? { index: extractTag(indexNode.children[0].text.trim()) }
    : {};
  const withFilter: Partial<Config> = filterNode?.children?.length
    ? {
        titleFilter: (t: string) =>
          t === withIndex.index ||
          filterNode.children.map(getTitleRuleFromNode).some((r) => r(t)),
        contentFilter: (c: string) =>
          filterNode.children.map(getContentRuleFromNode).some((r) => r(c)),
      }
    : {};
  const withTemplate: Partial<Config> = template
    ? {
        template,
      }
    : {};
  const withReferenceTemplate: Partial<Config> = referenceTemplate
    ? { referenceTemplate }
    : {};
  return {
    ...withIndex,
    ...withFilter,
    ...withTemplate,
    ...withReferenceTemplate,
  };
};

const convertPageToName = (p: string) => p.replace(/\.md$/, "");

const convertPageToHtml = ({ name, index }: { name: string; index: string }) =>
  name === index
    ? "index.html"
    : `${encodeURIComponent(name.replace(/ /g, "_"))}.html`;

const prepareContent = ({
  content,
  pageNames,
  index,
}: {
  content: string;
  pageNames: string[];
  index: string;
}) => {
  let ignoreIndent = -1;
  let codeBlockIndent = -1;
  const pageViewedAsDocument = !content.startsWith("- ");
  const filteredContent = content
    .split("\n")
    .filter((l) => {
      const numSpaces = l.search(/\S/);
      const indent = numSpaces / 4;
      if (ignoreIndent >= 0 && (indent > ignoreIndent || codeBlockIndent > 0)) {
        if (l.includes("```")) {
          if (codeBlockIndent >= 0) {
            codeBlockIndent = -1;
          } else {
            codeBlockIndent = indent;
          }
        }
        return false;
      }
      const bullet = l.substring(numSpaces);
      const text = bullet.startsWith("- ") ? bullet.substring(2) : bullet;
      const isIgnore = extractTag(text.trim()) === `${CONFIG_PAGE_NAME}/ignore`;
      if (isIgnore) {
        ignoreIndent = indent;
        return false;
      }
      ignoreIndent = -1;
      return true;
    })
    .map((s, i) => {
      if (s.trimStart().startsWith("- ")) {
        const numSpaces = s.search(/\S/);
        const normalizeS = pageViewedAsDocument ? s.substring(4) : s;
        const text = s.substring(numSpaces + 2);
        if (text.startsWith("```")) {
          codeBlockIndent = numSpaces / 4;
          return `${normalizeS.substring(
            0,
            normalizeS.length - text.length
          )}\n`;
        }
        return normalizeS;
      }
      if (codeBlockIndent > -1) {
        const indent = "".padStart((codeBlockIndent + 2) * 4, " ");
        if (s.endsWith("```")) {
          codeBlockIndent = -1;
          return `${indent}${s.substring(0, s.length - 3)}`;
        }
        return `${indent}${s}`;
      }
      if (s.startsWith("```")) {
        codeBlockIndent = 0;
        return "";
      }
      return i > 0 ? `\n${s}` : s;
    })
    .join("\n");

  const pageNameOrs = pageNames.join("|");
  const hashOrs = pageNames.filter((p) => !p.includes(" "));
  return filteredContent
    .replace(
      new RegExp(`#?\\[\\[(${pageNameOrs})\\]\\]`, "g"),
      (_, name) => `[${name}](/${convertPageToHtml({ name, index })})`
    )
    .replace(
      new RegExp(`(${pageNameOrs})::`, "g"),
      (_, name) => `[${name}](/${convertPageToHtml({ name, index })})`
    )
    .replace(
      new RegExp(`#(${hashOrs})`, "g"),
      (_, name) => `[${name}](/${convertPageToHtml({ name, index })})`
    )
    .replace(new RegExp("#\\[\\[|\\[\\[|\\]\\]", "g"), "");
};

export const renderHtmlFromPage = ({
  outputPath,
  pageContent,
  p,
  config,
  pageNames,
}: {
  outputPath: string;
  pageContent: {
    content: string;
    references: string[];
    title: string;
    head: string;
  };
  p: string;
  config: Config;
  pageNames: string[];
}): void => {
  const { content, references, title, head } = pageContent;
  const preMarked = prepareContent({
    content,
    pageNames,
    index: config.index,
  });
  const pageNameSet = new Set(pageNames);
  const markedContent = marked(preMarked);
  const hydratedHtml = config.template
    .replace('</head>', `${head}</head>`)
    .replace(/\${PAGE_NAME}/g, title)
    .replace(/\${PAGE_CONTENT}/g, markedContent)
    .replace(
      /\${REFERENCES}/,
      references
        .filter(r => pageNameSet.has(r))
        .map((r) =>
          config.referenceTemplate.replace(/\${REFERENCE}/, r).replace(
            /\${LINK}/,
            convertPageToHtml({
              name: r,
              index: config.index,
            })
          )
        )
        .join("\n")
    );
  const htmlFileName = convertPageToHtml({
    name: convertPageToName(p),
    index: config.index,
  });
  fs.writeFileSync(path.join(outputPath, htmlFileName), hydratedHtml);
};

export const run = async ({
  roamUsername,
  roamPassword,
  roamGraph,
  logger = { info: console.log, error: console.error },
}: {
  roamUsername: string;
  roamPassword: string;
  roamGraph: string;
  logger?: {
    info: (s: string) => void;
    error: (s: string) => void;
  };
}): Promise<void> => {
  const { info, error } = logger;
  info(`Hello ${roamUsername}! Fetching from ${roamGraph}...`);

  return puppeteer
    .launch(
      process.platform === "win32"
        ? {
            executablePath:
              "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          }
        : {
            executablePath: "/usr/bin/google-chrome-stable",
          }
    )
    .then(async (browser) => {
      const page = await browser.newPage();
      try {
        const downloadPath = path.join(process.cwd(), "downloads");
        const outputPath = path.join(process.cwd(), "out");
        fs.mkdirSync(downloadPath, { recursive: true });
        fs.mkdirSync(outputPath, { recursive: true });
        const cdp = await page.target().createCDPSession();
        cdp.send("Page.setDownloadBehavior", {
          behavior: "allow",
          downloadPath,
        });

        await page.goto("https://roamresearch.com/#/signin", {
          waitUntil: "networkidle0",
        });
        await page.waitForSelector("input[name=email]", {
          timeout: 120000,
        });
        await page.type("input[name=email]", roamUsername);
        await page.type("input[name=password]", roamPassword);
        await page.click("button.bp3-button");
        info(`Signing in ${new Date().toLocaleTimeString()}`);
        await page.waitForSelector(`a[href="#/app/${roamGraph}"]`, {
          timeout: 120000,
        });
        info("Done waiting for graph to be selectable");
        await page.click(`a[href="#/app/${roamGraph}"]`);
        info(`entering graph ${new Date().toLocaleTimeString()}`);
        await page.waitForSelector("span.bp3-icon-more", {
          timeout: 120000,
        });
        await page.click(`span.bp3-icon-more`);
        await page.waitForXPath("//div[text()='Export All']", {
          timeout: 120000,
        });
        const [exporter] = await page.$x("//div[text()='Export All']");
        await exporter.click();
        await page.waitForSelector(".bp3-intent-primary");
        await page.click(".bp3-intent-primary");
        info(`exporting ${new Date().toLocaleTimeString()}`);
        const zipPath = await new Promise<string>((res) => {
          const watcher = watch(
            downloadPath,
            { filter: /\.zip$/ },
            (eventType?: "update" | "remove", filename?: string) => {
              if (eventType == "update" && filename) {
                watcher.close();
                res(filename);
              }
            }
          );
        });
        info(`done waiting ${new Date().toLocaleTimeString()}`);
        const data = await fs.readFileSync(zipPath);
        const zip = await jszip.loadAsync(data);

        const configPage = zip.files[`${CONFIG_PAGE_NAME}.md`];
        const config = {
          ...defaultConfig,
          ...(await (configPage
            ? getConfigFromPage(configPage)
            : Promise.resolve({}))),
        } as Config;

        const pages: {
          [key: string]: {
            content: string;
            references: string[];
            title: string;
            head: string;
          };
        } = {};
        await Promise.all(
          Object.keys(zip.files)
            .filter(config.titleFilter)
            .map(async (k) => {
              const content = await zip.files[k].async("text");
              const pageName = convertPageToName(k);
              if (config.contentFilter(content)) {
                const references = await page.evaluate((pageName: string) => {
                  const findParentBlock: (b: RoamBlock) => RoamBlock = (
                    b: RoamBlock
                  ) =>
                    b.title
                      ? b
                      : findParentBlock(
                          window.roamAlphaAPI.q(
                            `[:find (pull ?e [*]) :where [?e :block/children ${b.id}]]`
                          )[0][0] as RoamBlock
                        );
                  const parentBlocks = window.roamAlphaAPI
                    .q(
                      `[:find (pull ?parentPage [*]) :where [?parentPage :block/children ?referencingBlock] [?referencingBlock :block/refs ?referencedPage] [?referencedPage :node/title "${pageName.replace(
                        /"/g,
                        '\\"'
                      )}"]]`
                    )
                    .filter((block) => block.length);
                  const blocks = parentBlocks.map((b) =>
                    findParentBlock(b[0])
                  ) as RoamBlock[];
                  return Array.from(
                    new Set(blocks.map((b) => b.title || "").filter((t) => !!t))
                  );
                }, k);
                const titleMatch = content.match(
                  "roam/js/public-garden/title::(.*)\n"
                );
                const headMatch = content.match(
                  new RegExp(
                    /roam\/js\/public-garden\/head::\s*- ```html\n(.*)```/,
                    "s"
                  )
                );
                const title = titleMatch ? titleMatch[1].trim() : pageName;
                const head = headMatch ? headMatch[1] : "";
                pages[k] = { content, references, title, head };
              }
            })
        );
        await page.close();
        await browser.close();
        const pageNames = Object.keys(pages).map(convertPageToName);
        info(`resolving ${pageNames.length} pages`);
        info(`Here are some: ${pageNames.slice(0, 5)}`);
        Object.keys(pages).map((p) => {
          if (process.env.NODE_ENV === "test") {
            try {
              fs.writeFileSync(
                path.join(outputPath, encodeURIComponent(p)),
                pages[p].content
              );
            } catch {
              console.warn("failed to output md for", p);
            }
          }
          renderHtmlFromPage({
            outputPath,
            config,
            pageContent: pages[p],
            p,
            pageNames,
          });
        });
        return;
      } catch (e) {
        await page.screenshot({ path: "error.png" });
        error("took screenshot");
        throw new Error(e);
      }
    })
    .catch((e) => {
      error(e.message);
      throw new Error(e);
    });
};

export default run;
