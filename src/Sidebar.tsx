import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import ReactDOMServer from "react-dom/server";
import { ensureReact, ensureScript, RenderFunction } from "./util";
import cytoscape from "cytoscape";

type Props = {
  widgets: string[];
  edges: (readonly [string, string])[];
};

const GraphWidget = ({ edges }: Pick<Props, "edges">) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  useEffect(() => {
    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: [
        ...Array.from(new Set(edges.flatMap((a) => a))).map((id) => ({
          data: { id },
        })),
        ...edges.map(([source, target], id) => ({
          data: {
            id: id.toString(),
            source,
            target,
          },
        })),
      ],
      zoomingEnabled: false,
      panningEnabled: false,
      layout: {
        name: "random",
      },
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#888888",
            label: "data(id)",
            shape: "round-octagon",
            color: "#ffffff",
            "text-wrap": "wrap",
            "text-halign": "center",
            "text-valign": "center",
            "text-max-width": "80",
            width: 80,
            height: 80,
          },
        },
        {
          selector: "edge",
          style: {
            width: 10,
            "line-color": "#ccc",
            "curve-style": "bezier",
            label: "data(id)",
          },
        },
      ],
    });
  }, [cyRef, containerRef]);
  return (
    <div style={{ border: "1px solid #eeeeee" }}>
      <h3
        style={{
          background: "#efefef",
          borderBottom: "1px solid #eeeeee",
          padding: 12,
          margin: 0,
        }}
      >
        Map
      </h3>
      <div ref={containerRef} style={{ height: 400 }} />
    </div>
  );
};

const Sidebar = ({ widgets, edges }: Props): React.ReactElement => {
  const widgetSet = new Set(widgets);
  return <>{widgetSet.has("graph") && <GraphWidget edges={edges} />}</>;
};

export const ID = "roamjs-sidebar";

if (process.env.CLIENT_SIDE) {
  ReactDOM.hydrate(
    <Sidebar {...(window.roamjsProps.sidebar as Props)} />,
    document.getElementById(ID)
  );
}

export const render: RenderFunction = (dom, props, context) => {
  const componentProps = {
    widgets: props["widgets"] || [],
    edges: context.references.map((r) => [r.title, r.node.text] as const),
  };
  const innerHtml = ReactDOMServer.renderToString(
    <Sidebar {...componentProps} />
  );

  const { document } = dom.window;
  const { head } = document;
  const content = document.getElementById("content");
  if (content) {
    const container = document.createElement("div");
    container.id = ID;
    container.innerHTML = innerHtml;
    container.style.width = "100%";
    content?.appendChild(container);
    content.style.display = "flex";
  }

  ensureReact(document, head);
  ensureScript("sidebar", componentProps, document, head);
};

export default Sidebar;
