import path from "path";
import fs from "fs";
import chromium from "chrome-aws-lambda";
import marked from "roam-marked";
import { Page } from "puppeteer";
import { RoamBlock, TreeNode, ViewType } from "roam-client";

const CONFIG_PAGE_NAMES = ["roam/js/static-site", "roam/js/public-garden"];
const IGNORE_BLOCKS = CONFIG_PAGE_NAMES.map((c) => `${c}/ignore`);
const TITLE_REGEX = new RegExp(
  `(?:${CONFIG_PAGE_NAMES.map((c) => `${c.replace("/", "\\/")}/title`).join(
    "|"
  )})::(.*)`
);
const HEAD_REGEX = new RegExp(
  `(?:${CONFIG_PAGE_NAMES.map((c) => `${c.replace("/", "\\/")}}/head`).join(
    "|"
  )})::`
);
const HTML_REGEX = new RegExp("```html\n(.*)```", "s");

type Config = {
  index: string;
  titleFilter: (title: string) => boolean;
  contentFilter: (content: TreeNode[]) => boolean;
  template: string;
  referenceTemplate: string;
};

declare global {
  interface Window {
    fixViewType: (t: { c: TreeNode; v: ViewType }) => TreeNode;
    getTreeByBlockId: (id: number) => TreeNode;
    getTreeByPageName: (name: string) => TreeNode[];
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
  titleFilter: (title: string): boolean => !CONFIG_PAGE_NAMES.includes(title),
  contentFilter: (): boolean => true,
  template: `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>$\{PAGE_NAME}</title>
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

const DEFAULT_STYLE = `<style>
.rm-highlight {
  background-color: hsl(51, 98%, 81%);
  margin: -2px;
  padding: 2px;
}
.rm-bold {
  font-weight: bold;
}
</style>
`;

const getTitleRuleFromNode = (n: TreeNode) => {
  const { text, children } = n;
  if (text.trim().toUpperCase() === "STARTS WITH" && children.length) {
    return (title: string) => title.startsWith(extractTag(children[0].text));
  } else {
    return defaultConfig.titleFilter;
  }
};

const getContentRuleFromNode = (n: TreeNode) => {
  const { text = "", children = [] } = n;
  if (text.trim().toUpperCase() === "TAGGED WITH" && children.length) {
    const tag = extractTag(children[0].text);
    const findTag = (content: TreeNode) =>
      content.text.includes(`#${tag}`) ||
      content.text.includes(`[[${tag}]]`) ||
      content.text.includes(`${tag}::`) ||
      content.children.some(findTag);
    return (content: TreeNode[]) => content.some(findTag);
  } else {
    return () => true;
  }
};

const getParsedTree = async ({
  page,
  pageName,
}: {
  page: Page;
  pageName: string;
}) => {
  try {
    return await page.evaluate(
      (pageName: string) => window.getTreeByPageName(pageName),
      pageName
    );
  } catch (e) {
    console.error(`Failed to get Tree for ${pageName}`);
    throw new Error(e);
  }
};

const getConfigFromPage = async ({
  page,
  configPage,
}: {
  page: Page;
  configPage: string;
}) => {
  const parsedTree = await getParsedTree({ page, pageName: configPage });

  const getConfigNode = (key: string) =>
    parsedTree.find((n) => n.text.trim().toUpperCase() === key.toUpperCase());
  const indexNode = getConfigNode("index");
  const filterNode = getConfigNode("filter");
  const templateNode = getConfigNode("template");
  const referenceTemplateNode = getConfigNode("reference template");
  const getCode = (node?: TreeNode) =>
    (node?.children || [])
      .map((s) => s.text.match(HTML_REGEX))
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
        contentFilter: (c: TreeNode[]) =>
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

const convertPageToHtml = ({ name, index }: { name: string; index: string }) =>
  name === index
    ? "index.html"
    : `${encodeURIComponent(
        name.replace(/ /g, "_").replace(/[",?#:$;/@&=+']/g, "")
      )}.html`;

const prepareContent = ({
  content,
  index,
}: {
  content: TreeNode[];
  index: string;
}) => {
  const filterIgnore = (t: TreeNode) => {
    if (IGNORE_BLOCKS.includes(extractTag(t.text.trim()))) {
      return false;
    }
    t.children = t.children.filter(filterIgnore);
    return true;
  };
  const filteredContent = content.filter(filterIgnore);

  const convertLinks = (t: TreeNode) => {
    t.text = t.text
      .replace(
        new RegExp(`#?\\[\\[([^\\]]*)\\]\\]`, "g"),
        (_, name) =>
          `[${name}](/${convertPageToHtml({ name, index }).replace(
            /^index\.html$/,
            ""
          )})`
      )
      .replace(
        new RegExp(`(.*)::`, "g"),
        (_, name) =>
          `**[${name}:](/${convertPageToHtml({ name, index }).replace(
            /^index\.html$/,
            ""
          )})**`
      )
      .replace(
        new RegExp(/#([0-9a-zA-Z\-_/\\]*)/, "g"),
        (_, name) =>
          `[${name}](/${convertPageToHtml({ name, index }).replace(
            /^index\.html$/,
            ""
          )})`
      )
      .replace(new RegExp("#\\[\\[|\\[\\[|\\]\\]", "g"), "");
    t.children.forEach(convertLinks);
    if (t.heading > 0) {
      t.text = `${"".padStart(t.heading, "#")} ${t.text}`;
    }
  };
  filteredContent.forEach(convertLinks);
  return filteredContent;
};

const VIEW_CONTAINER = {
  bullet: "ul",
  document: "div",
  numbered: "ol",
};

const VIEW_ITEM = {
  bullet: "li",
  document: "p",
  numbered: "li",
};

const convertContentToHtml = ({
  content,
  viewType,
}: {
  content: TreeNode[];
  viewType: ViewType;
}): string => {
  const items = content.map((t) => {
    const inlineMarked = marked(t.text);
    const children = convertContentToHtml({
      content: t.children,
      viewType: t.viewType,
    });
    return `<${VIEW_ITEM[viewType]}>${inlineMarked}\n${children}</${VIEW_ITEM[viewType]}>`;
  });
  return `<${VIEW_CONTAINER[viewType]}>${items.join("\n")}</${
    VIEW_CONTAINER[viewType]
  }>`;
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
    content: TreeNode[];
    references: string[];
    title: string;
    head: string;
    viewType: ViewType;
  };
  p: string;
  config: Config;
  pageNames: string[];
}): void => {
  const { content, references, title, head } = pageContent;
  const preparedContent = prepareContent({
    content,
    index: config.index,
  });
  const pageNameSet = new Set(pageNames);
  const markedContent = convertContentToHtml({
    content: preparedContent,
    viewType: pageContent.viewType,
  });
  const hydratedHtml = config.template
    .replace("</head>", `${DEFAULT_STYLE}${head}</head>`)
    .replace(/\${PAGE_NAME}/g, title)
    .replace(/\${PAGE_CONTENT}/g, markedContent)
    .replace(
      /\${REFERENCES}/g,
      references
        .filter((r) => pageNameSet.has(r))
        .map((r) =>
          config.referenceTemplate.replace(/\${REFERENCE}/g, r).replace(
            /\${LINK}/g,
            convertPageToHtml({
              name: r,
              index: config.index,
            })
          )
        )
        .join("\n")
    );
  const htmlFileName = convertPageToHtml({
    name: p,
    index: config.index,
  });
  fs.writeFileSync(path.join(outputPath, htmlFileName), hydratedHtml);
};

export const run = async ({
  roamUsername,
  roamPassword,
  roamGraph,
  logger = { info: console.log, error: console.error },
  pathRoot = process.cwd(),
}: {
  roamUsername: string;
  roamPassword: string;
  roamGraph: string;
  logger?: {
    info: (s: string) => void;
    error: (s: string) => void;
  };
  pathRoot?: string;
}): Promise<void> => {
  const { info, error } = logger;
  info(`Hello ${roamUsername}! Fetching from ${roamGraph}...`);

  const chromiumPath = await chromium.executablePath;
  const executablePath = chromiumPath
    ? chromiumPath
    : process.platform === "win32"
    ? "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/google-chrome-stable";

  return chromium.puppeteer
    .launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: true,
      ignoreHTTPSErrors: true,
    })
    .then(async (browser) => {
      const page = await browser.newPage();
      try {
        const downloadPath = path.join(pathRoot, "downloads");
        const outputPath = path.join(pathRoot, "out");
        fs.mkdirSync(downloadPath, { recursive: true });
        fs.mkdirSync(outputPath, { recursive: true });
        const cdp = await page.target().createCDPSession();
        cdp.send("Page.setDownloadBehavior", {
          behavior: "allow",
          downloadPath,
        });

        await page.goto("https://roamresearch.com/#/signin?disablejs=true", {
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
        const allPageNames = await page.evaluate(() => {
          return window.roamAlphaAPI
            .q("[:find ?s :where [?e :node/title ?s]]")
            .map((b) => b[0] as string);
        });
        await page.evaluate(() => {
          window.getTreeByBlockId = (blockId: number): TreeNode => {
            const block = window.roamAlphaAPI.pull(
              "[:block/children, :block/string, :block/order, :block/uid, :block/heading, :block/open, :children/view-type]",
              blockId
            );
            const children = block[":block/children"] || [];
            return {
              text: block[":block/string"] || "",
              order: block[":block/order"] || 0,
              uid: block[":block/uid"] || "",
              children: children
                .map((c) => window.getTreeByBlockId(c[":db/id"]))
                .sort((a, b) => a.order - b.order),
              heading: block[":block/heading"] || 0,
              open: block[":block/open"] || true,
              viewType: block[":children/view-type"]?.substring(1) as ViewType,
            };
          };
          window.fixViewType = ({
            c,
            v,
          }: {
            c: TreeNode;
            v: ViewType;
          }): TreeNode => {
            if (!c.viewType) {
              c.viewType = v;
            }
            c.children.forEach((cc) =>
              window.fixViewType({ c: cc, v: c.viewType })
            );
            return c;
          };
          window.getTreeByPageName = (name: string): TreeNode[] => {
            const result = window.roamAlphaAPI.q(
              `[:find (pull ?e [:block/children :children/view-type]) :where [?e :node/title "${name.replace(
                /"/g,
                '\\"'
              )}"]]`
            );
            if (!result.length) {
              return [];
            }
            const block = result[0][0] as RoamBlock;
            const children = block?.children || [];
            const viewType = block?.["view-type"] || "bullet";
            return children
              .map((c) => window.getTreeByBlockId(c.id))
              .sort((a, b) => a.order - b.order)
              .map((c) => window.fixViewType({ c, v: viewType }));
          };
        });
        const configPage =
          allPageNames.find((c) => CONFIG_PAGE_NAMES.includes(c)) || "";
        const config = {
          ...defaultConfig,
          ...(await (configPage
            ? getConfigFromPage({ configPage, page })
            : Promise.resolve({}))),
        } as Config;

        const pages: {
          [key: string]: {
            content: TreeNode[];
            references: string[];
            title: string;
            head: string;
            viewType: ViewType;
          };
        } = {};
        info(`quering data ${new Date().toLocaleTimeString()}`);
        await Promise.all(
          allPageNames.filter(config.titleFilter).map(async (pageName) => {
            const content = await getParsedTree({ page, pageName });
            if (pageName === config.index || config.contentFilter(content)) {
              const references = await page
                .evaluate((pageName: string) => {
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
                }, pageName)
                .catch((e) => {
                  console.error("Failed to find references for page", pageName);
                  throw new Error(e);
                });
              const viewType = await page
                .evaluate(
                  (pageName) =>
                    (window.roamAlphaAPI.q(
                      `[:find ?v :where [?e :children/view-type ?v] [?e :node/title "${pageName.replace(
                        /"/g,
                        '\\"'
                      )}"]]`
                    )?.[0]?.[0] as ViewType) || "bullet",
                  pageName
                )
                .catch((e) => {
                  console.error("Failed to fetch view type for page", pageName);
                  throw new Error(e);
                });
              const titleMatch = content
                .find((s) => TITLE_REGEX.test(s.text))
                ?.text?.match?.(TITLE_REGEX);
              const headMatch = content
                .find((s) => HEAD_REGEX.test(s.text))
                ?.children?.[0]?.text?.match?.(HTML_REGEX);
              const title = titleMatch ? titleMatch[1].trim() : pageName;
              const head = headMatch ? headMatch[1] : "";
              pages[pageName] = { content, references, title, head, viewType };
            }
          })
        );
        await page.close();
        await browser.close();
        return { pages, outputPath, config };
      } catch (e) {
        await page.screenshot({ path: path.join(pathRoot, "error.png") });
        error("took screenshot");
        throw new Error(e);
      }
    })
    .then(({ pages, outputPath, config }) => {
      const pageNames = Object.keys(pages);
      info(`resolving ${pageNames.length} pages`);
      info(`Here are some: ${pageNames.slice(0, 5)}`);
      pageNames.map((p) => {
        if (process.env.NODE_ENV === "test") {
          try {
            fs.writeFileSync(
              path.join(outputPath, `${encodeURIComponent(p)}.json`),
              JSON.stringify(pages[p].content, null, 4)
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
    })
    .catch((e) => {
      error(e.message);
      throw new Error(e);
    });
};

export default run;
