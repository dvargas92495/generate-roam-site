import React from "react";

const Header = ({
  links,
}: {
  links: { title: string; href: string }[];
}): React.ReactElement => {
  return (
    <>
      <style>
        {`#roamjs-header {
  margin: -8px;
  margin-bottom: 8px;
}

.roamjs-header-root {
  top: 0;
  left: auto;
  right: 0;
  position: sticky;
  width: 100%;
  display: flex;
  z-index: 1000;
  box-sizing: border-box;
  flex-shrink: 0;
  flex-direction: column;
  box-shadow: 0px 2px 4px -1px rgb(0 0 0 / 20%), 0px 4px 5px 0px rgb(0 0 0 / 14%), 0px 1px 10px 0px rgb(0 0 0 / 12%);
  transition: box-shadow 300ms cubic-bezier(0.4, 0, 0.2, 1) 0ms;
}

.roamjs-nav-root {
  justify-content: space-between;
  min-height: 64px;
  padding-left: 24px;
  padding-right: 24px;
  display: flex;
  position: relative;
  align-items: center;
}

.roamjs-home-header {
  font-size: 1.25rem;
  font-weight: 500;
  line-height: 1.6;
  letter-spacing: 0.0075em;
  margin: 0;
  padding: 0;
}

.roamjs-home-link {
  margin-left: 8px; 
  box-shadow: none;
}

.roamjs-links-container {
  min-height: 64px;
  padding-left: 24px;
  padding-right: 24px;
  display: flex;
  position: relative;
  align-items: center;
}

.roamjs-nav-link {
  margin-left: 8px;
}`}
      </style>
      <header className="roamjs-header-root">
        <div className="roamjs-nav-root">
          <h6 className="roamjs-home-header">
            <a href="/" className="roamjs-home-link">
              Home
            </a>
          </h6>
          <div>
            <div className="roamjs-links-container">
              {links.map((l) => (
                <a href={l.href} className={"roamjs-nav-link"} key={l.title}>
                  {l.title}
                </a>
              ))}
            </div>
          </div>
        </div>
      </header>
    </>
  );
};

export default Header;