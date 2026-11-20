const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
  pencil: ["M4 20h4L19 9l-4-4L4 16v4Z", "m13.5 6.5 4 4"],
  replay: ["M4 12a8 8 0 1 0 2.4-5.7", "M4 4v4.5h4.5"],
  pin: ["M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z", "M12 14v7"],
  branch: ["M6 3v12", "M18 9a3 3 0 1 0 0-.01", "M6 21a3 3 0 1 0 0-.01", "M18 12a9 9 0 0 1-9 6"],
  search: ["M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z", "m15.5 15.5 4.5 4.5"],
  star: ["m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"],
  filter: ["M4 5h16l-6 7.5V19l-4-2v-4.5L4 5Z"],
  sort: ["M7 4v16", "m3 8 4-4 4 4", "M17 20V4", "m13 16 4 4 4-4"],
  chevron: ["m6 9 6 6 6-6"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"],
  copy: ["M9 9h11v11H9Z", "M5 15H4V4h11v1"],
  compare: ["M4 5h16v14H4Z", "M12 5v14"],
  verify: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m8 12 3 3 5-6"],
  previous: ["m15 6-6 6 6 6"],
  next: ["m9 6 6 6-6 6"],
  video: ["M3 7h12v10H3Z", "m15 10.5 6-3.5v10l-6-3.5"],
  download: ["M12 4v11", "m7 10 5 5 5-5", "M5 20h14"],
  check: ["m5 12.5 4.5 4.5L19 7"],
  sliders: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4"],
  play: ["M8 5v14l11-7Z"],
  pause: ["M9 6v12", "M15 6v12"],
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon", `icon-${name}`);
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}
