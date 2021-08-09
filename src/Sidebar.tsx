import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import ReactDOMServer from "react-dom/server";
import { ensureReact, ensureScript, RenderFunction } from "./util";
import cytoscape from "cytoscape";

type Props = {
  widgets: string[];
  references: { title: string; uid: string }[];
  pageName: string;
  toPath: (s: string) => string;
};

const GraphWidget = ({
  references,
  pageName,
  toPath,
}: Omit<Props, "widgets">) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  useEffect(() => {
    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: [
        ...[
          pageName,
          ...Array.from(new Set(references.map((a) => a.title))),
        ].map((id) => ({
          data: { id },
        })),
        ...references.map(({ title: target, uid: id }) => ({
          data: {
            id,
            source: pageName,
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
            "text-max-width": "60",
            "font-size": "12px",
            width: 60,
            height: 60,
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
    cyRef.current.nodes().forEach((n) => {
      n.on("click", () => {
        window.location.assign(toPath(n.id()));
      });
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

const Sidebar = ({ widgets, ...rest }: Props): React.ReactElement => {
  const widgetSet = new Set(widgets);
  return <>{widgetSet.has("graph") && <GraphWidget {...rest} />}</>;
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
    references: context.references.map((r) => ({
      title: r.title,
      uid: r.node.uid,
    })),
    pageName: context.pageName,
    toPath: context.convertPageNameToPath,
  };
  const innerHtml = ReactDOMServer.renderToString(
    <Sidebar {...componentProps} />
  );

  const { document } = dom.window;
  const { head } = document;
  const content = document.getElementById("content");
  if (content) {
    content.style.display = "flex";
    const container = document.createElement("div");
    const newContentContainer = document.createElement("div");
    newContentContainer.style.flexGrow = "1";
    container.id = ID;
    container.innerHTML = innerHtml;
    container.style.width = "33%";
    container.style.minWidth = "200px";
    Array.from(content.children).forEach((c) =>
      newContentContainer.appendChild(c)
    );
    content.appendChild(newContentContainer);
    content.appendChild(container);
  }
  if (componentProps.widgets.includes("graph")) {
    document.getElementById("references")?.remove();
  }

  ensureReact(document, head);
  ensureScript("sidebar", componentProps, document, head);
};

export default Sidebar;
