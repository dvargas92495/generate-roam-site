import React from "react";

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const MonthLog = ({ month, year, html }) => {
  const [show, setShow] = React.useState(true);
  return React.createElement(
    "div",
    {},
    React.createElement(
      "h3",
      {
        style: { cursor: "pointer", userSelect: "none" },
        onClick: () => setShow(!show),
      },
      `${show ? "▿" : "▹"} ${months[month]} ${year}`
    ),
    React.createElement("hr"),
    React.createElement("div", {
      dangerouslySetInnerHTML: { __html: html },
      style: { display: show ? "block" : "none" },
    })
  );
};

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
const DailyLog = (props) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const children = props.allContent.map(({ html, month, year }) =>
    React.createElement(MonthLog, { month, year, html })
  );
  return React.createElement("div", {}, ...children);
};

export default DailyLog;
