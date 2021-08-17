import { JSDOM } from "jsdom";
import { TreeNode } from "roam-client";

export type HydratedTreeNode = Omit<TreeNode, "children"> & {
  references: { title: string; uid: string }[];
  children: HydratedTreeNode[];
};

export type RenderFunction = (
  dom: JSDOM,
  props: Record<string, string[]>,
  context: {
    convertPageNameToPath: (s: string) => string;
    references: { title: string; node: HydratedTreeNode }[];
    pageName: string;
  }
) => void;

export const ensureReact = (document: Document, head = document.head): void => {
  if (!document.getElementById("roamjs-react")) {
    const react = document.createElement("script");
    react.id = "roamjs-react";
    react.src = "https://unpkg.com/react@17/umd/react.production.min.js";
    const reactdom = document.createElement("script");
    reactdom.id = "roamjs-react-dom";
    reactdom.src =
      "https://unpkg.com/react-dom@17/umd/react-dom.production.min.js";
    head.appendChild(react);
    head.appendChild(reactdom);
  }
};

export const ensureScript = (
  id: string,
  componentProps: Record<string, unknown>,
  document: Document,
  head = document.head
): void => {
  const propScript = document.createElement("script");
  propScript.innerHTML = `window.roamjsProps = {
  ...window.roamjsProps,
  "${id}": ${JSON.stringify(componentProps)}
}`;
  propScript.type = "text/javascript";
  head.appendChild(propScript);
  const componentScript = document.createElement("script");
  componentScript.src = `https://roamjs.com/static-site/${id}.js`;
  componentScript.defer = true;
  head.appendChild(componentScript);
};
