import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import ReactDOMServer from "react-dom/server";
import { Dialog } from "@blueprintjs/core";
import { ensureBlueprint, ensureReact, ensureScript, RenderFunction } from "./util";

const ImagePreview = (): React.ReactElement => {
  const [src, setSrc] = useState("");
  const onDialogClose = useCallback(() => setSrc(""), [setSrc]);
  const onRootClick = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "IMG" &&
        target.classList.contains("roamjs-image-preview-img")
      ) {
        setSrc((target as HTMLImageElement).src);
      }
    },
    [setSrc]
  );
  useEffect(() => {
    document.body.addEventListener("click", onRootClick);
  }, [onRootClick]);
  return (
    <>
      <style>{`.roamjs-image-preview-img {
  cursor: pointer;
}

.roamjs-image-preview-portal {
    z-index: 2100;
}
.roamjs-image-preview-portal .bp3-dialog {
    position: absolute;
    top: 32px;
    bottom: 32px;
    left: 32px;
    right: 32px;
    width: unset;
    background-color: transparent;
}`}</style>
      <Dialog
        isOpen={!!src}
        onClose={onDialogClose}
        portalClassName={"roamjs-image-preview-portal"}
        style={{ paddingBottom: 0 }}
      >
        <img src={src} ref={imgRef}/>
      </Dialog>
    </>
  );
};

export const ID = "roamjs-image-preview";

if (process.env.CLIENT_SIDE) {
  ReactDOM.hydrate(<ImagePreview />, document.getElementById(ID));
}

export const render: RenderFunction = (dom) => {
  const { document } = dom.window;
  const { head, body } = document;
  const imgs = document.querySelectorAll(".roam-block img");
  if (imgs.length) {
    imgs.forEach((img) => img.classList.add("roamjs-image-preview-img"));
    const container = document.createElement("div");
    container.id = ID;
    container.innerHTML = ReactDOMServer.renderToString(<ImagePreview />);
    body.appendChild(container);

    ensureBlueprint(document, head);
    ensureReact(document, head);
    ensureScript("image-preview", {}, document, head);
  }
};

export default ImagePreview;
