import { JSDOM } from "jsdom";

export type RenderFunction = (
  dom: JSDOM,
  props: Record<string, string[]>,
  context: { convertPageNameToPath: (s: string) => string }
) => void;

export const ensureReact = (document: Document): void => {
  if (!document.getElementById("roamjs-react")) {
    const { head } = document;
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
