import { clamp } from "../spans";
import type { ImageArea } from "../types";
import { numberArg, type Args, type Parsed } from "./toolArgs";

export const AREA_SCALE = 1000;
const PADDING_SHARE = 0.05;
const MIN_SIDE_PX = 64;
const READABLE_PX = 1024;
const MAX_UPSCALE = 4;
// Mapping between scales leaves float noise, which must not push an edge out a whole step.
const EDGE_TOLERANCE = 1e-6;
const SCALE_TEXT = `thousandths of the picture's width and height from its top left, 0 to ${AREA_SCALE}`;

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

interface Extent {
  from: number;
  to: number;
}

export function areaArg(args: Args): Parsed<ImageArea> {
  const area: ImageArea = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const name of ["left", "top", "right", "bottom"] as const) {
    const side = numberArg(args, name);
    if ("problem" in side || side.value < 0 || side.value > AREA_SCALE) {
      return { problem: `${name} must be a number in ${SCALE_TEXT}.` };
    }
    area[name] = side.value;
  }
  if (area.left >= area.right) {
    return { problem: `left must be less than right, both in ${SCALE_TEXT}.` };
  }
  if (area.top >= area.bottom) {
    return { problem: `top must be less than bottom, both in ${SCALE_TEXT}.` };
  }
  return { value: area };
}

function wholeExtent({ from, to }: Extent): Extent {
  return {
    from: clamp(Math.floor(from + EDGE_TOLERANCE), 0, AREA_SCALE),
    to: clamp(Math.ceil(to - EDGE_TOLERANCE), 0, AREA_SCALE),
  };
}

function paddedExtent({ from, to }: Extent): Extent {
  const padding = (to - from) * PADDING_SHARE;
  return { from: Math.max(0, from - padding), to: Math.min(AREA_SCALE, to + padding) };
}

// Slides back inside rather than being cut, so an area in a corner keeps the minimum side.
function atLeast({ from, to }: Extent, side: number): Extent {
  if (to - from >= side) return { from, to };
  if (side >= AREA_SCALE) return { from: 0, to: AREA_SCALE };
  const start = clamp((from + to - side) / 2, 0, AREA_SCALE - side);
  return { from: start, to: start + side };
}

function shownExtent(extent: Extent, sourcePx: number): Extent {
  const minimum = (MIN_SIDE_PX / sourcePx) * AREA_SCALE;
  return wholeExtent(atLeast(paddedExtent(extent), minimum));
}

function eachAxis(
  area: ImageArea,
  across: (extent: Extent) => Extent,
  down: (extent: Extent) => Extent,
): ImageArea {
  const horizontal = across({ from: area.left, to: area.right });
  const vertical = down({ from: area.top, to: area.bottom });
  return {
    left: horizontal.from,
    top: vertical.from,
    right: horizontal.to,
    bottom: vertical.to,
  };
}

export function wholeArea(area: ImageArea): ImageArea {
  return eachAxis(area, wholeExtent, wholeExtent);
}

export function shownArea(wanted: ImageArea, picture: Size): ImageArea {
  return eachAxis(
    wanted,
    (extent) => shownExtent(extent, picture.width),
    (extent) => shownExtent(extent, picture.height),
  );
}

function within({ from, to }: Extent, outer: Extent): Extent {
  const scale = (outer.to - outer.from) / AREA_SCALE;
  return { from: outer.from + from * scale, to: outer.from + to * scale };
}

// An area of a picture that itself shows only outer, as an area of what outer is part of.
export function areaWithin(area: ImageArea, outer: ImageArea): ImageArea {
  return eachAxis(
    area,
    (extent) => within(extent, { from: outer.left, to: outer.right }),
    (extent) => within(extent, { from: outer.top, to: outer.bottom }),
  );
}

export function areaRect(area: ImageArea, picture: Size): Rect {
  const x = Math.round((area.left / AREA_SCALE) * picture.width);
  const y = Math.round((area.top / AREA_SCALE) * picture.height);
  return {
    x,
    y,
    width: Math.max(1, Math.round((area.right / AREA_SCALE) * picture.width) - x),
    height: Math.max(1, Math.round((area.bottom / AREA_SCALE) * picture.height) - y),
  };
}

// Small crops are enlarged so the model spends more image tokens on them.
export function outputSize(crop: Size, resolution: number): Size {
  const longest = Math.max(crop.width, crop.height);
  const readable = Math.min(resolution, READABLE_PX);
  const scale =
    longest > resolution
      ? resolution / longest
      : Math.max(1, Math.min(MAX_UPSCALE, readable / longest));
  return {
    width: Math.max(1, Math.round(crop.width * scale)),
    height: Math.max(1, Math.round(crop.height * scale)),
  };
}
