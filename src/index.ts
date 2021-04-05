import path from "path";
import fs from "fs";
import chromium from "chrome-aws-lambda";
import marked from "roam-marked";
import { Page } from "puppeteer";
import { parseRoamDate, RoamBlock, TreeNode, ViewType } from "roam-client";
import React from "react";
import ReactDOMServer from "react-dom/server";
import DailyLog from "./DailyLog";

const CONFIG_PAGE_NAMES = ["roam/js/static-site", "roam/js/public-garden"];
const IGNORE_BLOCKS = CONFIG_PAGE_NAMES.map((c) => `${c}/ignore`);
const TITLE_REGEX = new RegExp(
  `(?:${CONFIG_PAGE_NAMES.map((c) => `${c.replace("/", "\\/")}/title`).join(
    "|"
  )})::(.*)`
);
const HEAD_REGEX = new RegExp(
  `(?:${CONFIG_PAGE_NAMES.map((c) => `${c.replace("/", "\\/")}/head`).join(
    "|"
  )})::`
);
const HTML_REGEX = new RegExp("```html\n(.*)```", "s");
const DAILY_NOTE_PAGE_REGEX = /(January|February|March|April|May|June|July|August|September|October|November|December) [0-3]?[0-9](st|nd|rd|th), [0-9][0-9][0-9][0-9]/;

const allBlockMapper = (t: TreeNode): TreeNode[] => [
  t,
  ...t.children.flatMap(allBlockMapper),
];

type Filter = { rule: string; values: string[] };

type InputConfig = {
  index?: string;
  filter?: Filter[];
  template?: string;
  referenceTemplate?: string;
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

/**
 * 
<meta name="description" content="$\{PAGE_DESCRIPTION}"/>
<meta property="og:description" content="$\{PAGE_DESCRIPTION}">
 onload="bodyOnLoad();"
 */
export const defaultConfig = {
  index: "Website Index",
  filter: [],
  template: `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>$\{PAGE_NAME}</title>
<meta property="og:title" content="$\{PAGE_NAME}">
<meta property="og:type" content="website">
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
} as Required<InputConfig>;

const DEFAULT_STYLE = `<style>
.rm-highlight {
  background-color: hsl(51, 98%, 81%);
  margin: -2px;
  padding: 2px;
}
.rm-bold {
  font-weight: bold;
}
.document-bullet {
  list-style: none;
}
td {
  font-size: 12px;
  min-width: 100px;
  max-height: 20px;
  padding: 8px 16px;
  border: 1px solid grey;
}
table {
  border-spacing: 0;
  border-collapse: collapse;
}
</style>
`;

/*
const DEFAULT_SCRIPT = `<script src="https://unpkg.com/react@17/umd/react.${
  process.env.NODE_ENV === "production" ? "production.min" : "development"
}.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@17/umd/react-dom.${
  process.env.NODE_ENV === "production" ? "production.min" : "development"
}.js" crossorigin></script>
<script>
${fs
  .readFileSync(path.join(__dirname, "DailyLog.ts"))
  .toString()
  .split("\n")
  .slice(2, -2)
  .join("\n")
  .replace(": React.ReactElemnt", "")}
const componentsToHydrate = [];
const bodyOnLoad = () => {
  componentsToHydrate.forEach(
    ({Component, id, props}) => 
      ReactDOM.hydrate(
        React.createElement(Component, props), 
        document.getElementById(id)
      )
  );
};
</script>`;
*/

const renderComponent = ({
  Component,
  id,
  props = {},
}: {
  Component: React.FC;
  id: string;
  props?: Record<string, unknown>;
}) => {
  return ReactDOMServer.renderToString(
    React.createElement("div", { id }, React.createElement(Component, props))
  );
  /*return `<script>componentsToHydrate.push({
    Component: ${Component.name},
    id: "${id}",
    props: ${JSON.stringify(props)}
  })</script>${ReactDOMServer.renderToString(
    React.createElement("div", { id }, React.createElement(Component, props))
  )}`;*/
};

const getTitleRuleFromNode = ({ rule: text, values: children }: Filter) => {
  if (text.trim().toUpperCase() === "STARTS WITH" && children.length) {
    const tag = extractTag(children[0]);
    return (title: string) => {
      return title.startsWith(tag);
    };
  }
  return undefined;
};

const getContentRuleFromNode = ({ rule: text, values: children }: Filter) => {
  if (text.trim().toUpperCase() === "TAGGED WITH" && children.length) {
    const tag = extractTag(children[0]);
    const findTag = (content: TreeNode) =>
      content.text.includes(`#${tag}`) ||
      content.text.includes(`[[${tag}]]`) ||
      content.text.includes(`${tag}::`) ||
      content.children.some(findTag);
    return (content: TreeNode[]) => content.some(findTag);
  }
  return undefined;
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

const getConfigFromPage = (parsedTree: TreeNode[]) => {
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
  const withIndex: InputConfig = indexNode?.children?.length
    ? { index: extractTag(indexNode.children[0].text.trim()) }
    : {};
  const withFilter: InputConfig = filterNode?.children?.length
    ? {
        filter: filterNode.children.map((t) => ({
          rule: t.text,
          values: t.children.map((c) => c.text),
        })),
      }
    : {};
  const withTemplate: InputConfig = template
    ? {
        template,
      }
    : {};
  const withReferenceTemplate: InputConfig = referenceTemplate
    ? { referenceTemplate }
    : {};
  return {
    ...withIndex,
    ...withFilter,
    ...withTemplate,
    ...withReferenceTemplate,
  };
};

const convertPageNameToPath = ({
  name,
  index,
}: {
  name: string;
  index: string;
}) =>
  name === index
    ? "index.html"
    : `${encodeURIComponent(
        name.replace(/ /g, "_").replace(/[",?#:$;/@&=+']/g, "")
      )}.html`;

const prepareContent = ({
  content,
  index,
  pageNameSet,
}: {
  content: TreeNode[];
  index: string;
  pageNameSet: Set<string>;
}) => {
  const filterIgnore = (t: TreeNode) => {
    if (IGNORE_BLOCKS.some((ib) => t.text.trim().includes(ib))) {
      return false;
    }
    t.children = t.children.filter(filterIgnore);
    return true;
  };
  const filteredContent = content.filter(filterIgnore);

  const convertLinks = (t: TreeNode) => {
    t.text = t.text.replace(new RegExp(`(.*)::`, "g"), (_, name) =>
      pageNameSet.has(name)
        ? `**[${name}:](/${convertPageNameToPath({ name, index }).replace(
            /^index\.html$/,
            ""
          )})**`
        : name
    );
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

const convertContentToHtml = ({
  content,
  viewType,
  level,
  pagesToHrefs,
  components,
}: {
  content: TreeNode[];
  viewType: ViewType;
  level: number;
  pagesToHrefs: (s: string) => string;
  components: (s: string) => string;
}): string => {
  if (content.length === 0) {
    return "";
  }
  const items = content.map((t) => {
    const componentsWithChildren = (s: string): string => {
      const parent = components(s);
      if (parent) {
        return parent;
      }
      if (/table/i.test(s)) {
        const data = t.children;
        t.children = [];
        return `<table><tbody>${data
          .map(
            (row) =>
              `<tr>${[row, ...row.children.flatMap(allBlockMapper)]
                .map(
                  (td) =>
                    `<td>${marked(td.text, {
                      pagesToHrefs,
                      components: componentsWithChildren,
                    })}</td>`
                )
                .join("")}</tr>`
          )
          .join("")}</tbody></table>`;
      }
      return "";
    };
    const inlineMarked = marked(t.text, {
      pagesToHrefs,
      components: componentsWithChildren,
    });
    const children = convertContentToHtml({
      content: t.children,
      viewType: t.viewType,
      level: level + 1,
      pagesToHrefs,
      components,
    });
    const innerHtml = `${inlineMarked}\n${children}`;
    if (level === 0 && viewType === "document") {
      return innerHtml;
    }
    const attrs =
      level > 0 && viewType === "document" ? ` class="document-bullet"` : "";
    return `<li${attrs}>${innerHtml}</li>`;
  });
  const containerTag =
    level > 0 && viewType === "document" ? "ul" : VIEW_CONTAINER[viewType];
  return `<${containerTag}>${items.join("\n")}</${containerTag}>`;
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
    references: { title: string; node: TreeNode }[];
    title: string;
    head: string;
    viewType: ViewType;
  };
  p: string;
  config: Required<InputConfig>;
  pageNames: string[];
}): void => {
  const { content, references, title, head } = pageContent;
  const pageNameSet = new Set(pageNames);
  const preparedContent = prepareContent({
    content,
    index: config.index,
    pageNameSet,
  });
  const pagesToHrefs = (name: string) =>
    pageNameSet.has(name)
      ? `/${convertPageNameToPath({ name, index: config.index }).replace(
          /^index\.html$/,
          ""
        )}`
      : "";
  const markedContent = convertContentToHtml({
    content: preparedContent,
    viewType: pageContent.viewType,
    level: 0,
    pagesToHrefs,
    components: (s) => {
      const staticSiteComponent = /static site:(.*)/i.exec(s)?.[1];
      if (staticSiteComponent) {
        if (/daily log/i.test(staticSiteComponent)) {
          const referenceContent = references
            .filter(({ title }) => DAILY_NOTE_PAGE_REGEX.test(title))
            .sort(
              ({ title: a }, { title: b }) =>
                parseRoamDate(b).valueOf() - parseRoamDate(a).valueOf()
            )
            .map(({ node, title }) => ({
              ...node,
              text: node.text.replace(p, title),
            }));
          const preparedReferenceContent = prepareContent({
            content: referenceContent,
            index: config.index,
            pageNameSet,
          });
          const firstNode = preparedReferenceContent[0];
          const firstDate = parseRoamDate(
            firstNode?.text?.match?.(DAILY_NOTE_PAGE_REGEX)?.[0] || ""
          );
          const allContent = preparedReferenceContent.slice(1).reduce(
            (prev, cur) => {
              const lastNode = prev[prev.length - 1];
              const curDate = parseRoamDate(
                cur.text.match(DAILY_NOTE_PAGE_REGEX)?.[0] || ""
              );
              if (
                lastNode.month === curDate.getMonth() &&
                lastNode.year === curDate.getFullYear()
              ) {
                lastNode.nodes.push(cur);
                return prev;
              } else {
                return [
                  ...prev,
                  {
                    nodes: [cur],
                    month: curDate.getMonth(),
                    year: curDate.getFullYear(),
                  },
                ];
              }
            },
            firstNode
              ? [
                  {
                    nodes: [firstNode],
                    month: firstDate.getMonth(),
                    year: firstDate.getFullYear(),
                  },
                ]
              : []
          );
          return `${renderComponent({
            Component: DailyLog,
            id: `${p}-daily-log`,
            props: {
              allContent: allContent.map(({ nodes, ...p }) => ({
                ...p,
                html: convertContentToHtml({
                  content: nodes,
                  viewType: pageContent.viewType,
                  level: 0,
                  pagesToHrefs,
                  components: () => "",
                }),
              })),
            },
          })}`;
        }
      }
      return "";
    },
  });
  const hydratedHtml = config.template
    .replace("</head>", `${DEFAULT_STYLE}${head}</head>`)
    .replace(/\${PAGE_NAME}/g, title)
    .replace(/\${PAGE_CONTENT}/g, markedContent)
    .replace(
      /\${REFERENCES}/g,
      references
        .filter((r) => pageNameSet.has(r.title))
        .map((r) =>
          config.referenceTemplate.replace(/\${REFERENCE}/g, r.title).replace(
            /\${LINK}/g,
            convertPageNameToPath({
              name: r.title,
              index: config.index,
            })
          )
        )
        .join("\n")
    );
  const htmlFileName = convertPageNameToPath({
    name: p,
    index: config.index,
  });
  fs.writeFileSync(path.join(outputPath, htmlFileName), hydratedHtml);
};

export const processSiteData = ({
  pages,
  outputPath,
  config,
  info,
}: {
  info: (s: string) => void;
  config: Required<InputConfig>;
  outputPath: string;
  pages: {
    [k: string]: {
      content: TreeNode[];
      references: { title: string; node: TreeNode }[];
      title: string;
      head: string;
      viewType: ViewType;
    };
  };
}): InputConfig => {
  info("lets sort");
  const pageNames = Object.keys(pages).sort();
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
  return config;
};

export const run = async ({
  roamUsername,
  roamPassword,
  roamGraph,
  logger = { info: console.log, error: console.error },
  pathRoot = process.cwd(),
  inputConfig = {},
}: {
  roamUsername: string;
  roamPassword: string;
  roamGraph: string;
  logger?: {
    info: (s: string) => void;
    error: (s: string) => void;
  };
  pathRoot?: string;
  inputConfig?: InputConfig;
}): Promise<InputConfig> => {
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
        const outputPath = path.join(pathRoot, "out");
        fs.mkdirSync(outputPath, { recursive: true });

        await page.goto("https://roamresearch.com/#/signin?disablejs=true", {
          waitUntil: "networkidle0",
        });
        // Roam's doing this weird refresh thing. let's just hardcode it
        await page.waitForTimeout(5000);
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
              `[:find (pull ?e [:block/children :children/view-type]) :where [?e :node/title "${name
                .replace(/\\/, "\\\\")
                .replace(/"/g, '\\"')}"]]`
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
        const configPageTree = configPage
          ? await getParsedTree({ page, pageName: configPage })
          : [];
        const userConfig = getConfigFromPage(configPageTree);

        const config = {
          ...defaultConfig,
          ...userConfig,
          ...inputConfig,
        };

        const titleFilters = config.filter.length
          ? config.filter.map(getTitleRuleFromNode).filter((f) => !!f)
          : [() => false];
        const contentFilters = config.filter
          .map(getContentRuleFromNode)
          .filter((f) => !!f);

        const titleFilter = (t: string) =>
          !titleFilters.length || titleFilters.some((r) => r && r(t));
        const contentFilter = (c: TreeNode[]) =>
          !contentFilters.length || contentFilters.some((r) => r && r(c));

        info(`querying data ${new Date().toLocaleTimeString()}`);
        const pageNamesWithContent = await Promise.all(
          allPageNames
            .filter(
              (pageName) => pageName === config.index || titleFilter(pageName)
            )
            .filter((pageName) => !CONFIG_PAGE_NAMES.includes(pageName))
            .map((pageName) =>
              getParsedTree({ page, pageName }).then((content) => ({
                pageName,
                content,
              }))
            )
        );
        info(`title filtered to ${pageNamesWithContent.length} pages`);
        const entries = await Promise.all(
          pageNamesWithContent
            .filter(
              ({ pageName, content }) =>
                pageName === config.index || contentFilter(content)
            )
            .map(({ pageName, content }) => {
              return Promise.all([
                page.evaluate(
                  (pageName: string) =>
                    window.roamAlphaAPI
                      .q(
                        `[:find ?rt ?r :where [?pr :node/title ?rt] [?r :block/page ?pr] [?r :block/refs ?p] [?p :node/title "${pageName
                          .replace(/\\/, "\\\\")
                          .replace(/"/g, '\\"')}"]]`
                      )
                      .map(([title, id]) => ({
                        title,
                        node: window.fixViewType({
                          c: window.getTreeByBlockId(id),
                          v: "bullet",
                        }),
                      })),
                  pageName
                ),
                page.evaluate(
                  (pageName) =>
                    (window.roamAlphaAPI.q(
                      `[:find ?v :where [?e :children/view-type ?v] [?e :node/title "${pageName
                        .replace(/\\/, "\\\\")
                        .replace(/"/g, '\\"')}"]]`
                    )?.[0]?.[0] as ViewType) || "bullet",
                  pageName
                ),
              ])
                .then(([references, viewType]) => ({
                  references,
                  pageName,
                  content,
                  viewType,
                }))
                .catch((e) => {
                  console.error("Failed to find references for page", pageName);
                  throw new Error(e);
                });
            })
        );
        info(`content filtered to ${entries.length} entries`);
        const pages = Object.fromEntries(
          entries.map(({ content, pageName, references, viewType }) => {
            const allBlocks = content.flatMap(allBlockMapper);
            const titleMatch = allBlocks
              .find((s) => TITLE_REGEX.test(s.text))
              ?.text?.match?.(TITLE_REGEX);
            const headMatch = allBlocks
              .find((s) => HEAD_REGEX.test(s.text))
              ?.children?.[0]?.text?.match?.(HTML_REGEX);
            const title = titleMatch ? titleMatch[1].trim() : pageName;
            const head = headMatch ? headMatch[1] : "";
            return [
              pageName,
              {
                content,
                references,
                title,
                head,
                viewType,
              },
            ];
          })
        );
        info("closing browser");
        await page.close();
        info("closing browser");
        browser.close();
        info("returning data");
        return { pages, outputPath, config };
      } catch (e) {
        await page.screenshot({ path: path.join(pathRoot, "error.png") });
        error("took screenshot");
        throw new Error(e);
      }
    })
    .then((d) => processSiteData({ ...d, info }))
    .catch((e) => {
      error(e.message);
      throw new Error(e);
    });
};

export default run;
