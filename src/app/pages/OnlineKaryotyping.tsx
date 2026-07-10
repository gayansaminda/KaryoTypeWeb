import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import UTIF from "utif";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "../components/ui/use-mobile";

// ─── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = "https://karyotyping-api-875244011562.asia-south1.run.app";
//const BASE_URL = "http://localhost:8080"; // for local, doccor 
//const BASE_URL = "http://localhost:8000";  // for local development, run `uvicorn main:app --reload` in the backend repo
// ─── Types ─────────────────────────────────────────────────────────────────────
type Tool = "select" | "cut" | "erase" | "extend" | "merge" | "add";
type LayoutMode = "full-left" | "prioritized-left" | "equal-Portion" | "full-Right" | "prioritized-Right";

// Single source of truth on the frontend, mirrored from the backend Current_State and
// matched by detectedChromosomeId. Drives BOTH the original-image editor (via the
// mainImage fields) and the karyotype-report view (via the karyogram_* fields, which
// stay empty until the report is generated).
interface DetectedChromosome {
  // null until the backend assigns an id (via /get_detectedPoints or /RefreshPolygons)
  detectedChromosomeId: number | null;
  // original-image (editor) view
  polygon: Array<[number, number]>;       // = backend mainImage_polygon
  score: number | null;                   // = backend detection_score (null when user-added/edited)
  bbox: [number, number, number, number]; // = backend mainImage_bbox
  colorHue?: number;
  // karyotype-report view — undefined until classification fills them
  karyogram_polygon?: Array<[number, number]>;
  karyogram_bounds?: { x_min: number; y_min: number; x_max: number; y_max: number; width: number; height: number };
  class_id?: number;
  is_assigned?: boolean;
}

interface ReportData {
  total: number;
  autosomes: number;
  sex: string;
  chromosomeImages: Record<string, string>;
  karyogramImage?: string;
}

interface Point {
  x: number;
  y: number;
}

interface BoundingBox {
  image_index: number;
  array_index: number;
  class_id: string;
  polygon: Array<[number, number]>;
  bounds: {
    x_min: number;
    y_min: number;
    x_max: number;
    y_max: number;
    width: number;
    height: number;
  };
}

// Area occupied by all chromosomes of one class (incl. its label) in the
// karyotype report — used as a drop target for drag-to-reclassify.
interface ClassAreaBox {
  className: string;
  polygon: Array<[number, number]>;
  bounds: { x_min: number; y_min: number; x_max: number; y_max: number; width: number; height: number };
}

const CHROMOSOME_ROWS = [
  ["1", "2", "3", "4", "5"],
  ["6", "7", "8", "9", "10", "11", "12"],
  ["13", "14", "15", "16", "17", "18"],
  ["19", "20", "21", "22", "X", "Y"],
];

const CHR_TYPES = [
  { label: "Not Set", value: 0 },
  ...Array.from({ length: 22 }, (_, i) => ({ label: (i + 1).toString(), value: i + 1 })),
  { label: "X", value: 23 },
  { label: "Y", value: 24 },
];

const NORMALIZE_CHR_KEY: Record<string, string> = {
  "23": "X", "24": "Y", "x": "X", "y": "Y",
};

function normalizeChrKey(key: string): string {
  return NORMALIZE_CHR_KEY[key] ?? key;
}

function normalizeChromosomeImages(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(raw).forEach(([k, v]) => { out[normalizeChrKey(k)] = v; });
  return out;
}

// Converts a class label/name (e.g. "cr1", "crX", "12", "X") to the numeric
// chromosome type used by the setChromosomeType endpoint (1–22, X=23, Y=24).
function classLabelToType(label: string): number | null {
  const m = String(label).match(/(\d+|[XYxy])\s*$/);
  if (!m) return null;
  const token = m[1].toUpperCase();
  if (token === "X") return 23;
  if (token === "Y") return 24;
  const n = parseInt(token, 10);
  return n >= 1 && n <= 22 ? n : null;
}

// Converts a bounding-box class_id (0-indexed: 0–21 autosomes, 22=X, 23=Y,
// -1 unassigned) to the same numeric chromosome type. 0 = unassigned/unknown.
function classIdToType(classId: string | number): number {
  const cls = typeof classId === "number" ? classId : parseInt(classId, 10);
  if (isNaN(cls) || cls < 0) return 0;
  if (cls < 22) return cls + 1;
  if (cls === 22) return 23;
  if (cls === 23) return 24;
  return 0;
}

const pointerDistance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const clampScale = (s: number) => Math.max(0.2, Math.min(10, s));

// Parses the backend's Class_Area_Boxes (list of single-key {class_name: rect}).
function parseClassAreaBoxes(raw: any): ClassAreaBox[] {
  if (!Array.isArray(raw)) return [];
  const out: ClassAreaBox[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const className = Object.keys(item)[0];
    if (!className) continue;
    const v = item[className];
    if (!v) continue;
    const polygon: Array<[number, number]> = Array.isArray(v.polygon) && v.polygon.length
      ? v.polygon
      : [[v.x_min, v.y_min], [v.x_max, v.y_min], [v.x_max, v.y_max], [v.x_min, v.y_max]];
    out.push({
      className,
      polygon,
      bounds: { x_min: v.x_min, y_min: v.y_min, x_max: v.x_max, y_max: v.y_max, width: v.width, height: v.height },
    });
  }
  return out;
}

// Rebuild the detectedChromosomes list from a report response (classify / rotate /
// setType), matched by id. `publicList` is the authoritative Current_State snapshot
// (raw.chromosomes); `boxes` are the karyogram bounding boxes carrying the report
// geometry. Existing colorHue is preserved so editor colors stay stable.
function applyReportResponse(
  prev: DetectedChromosome[],
  publicList: any[],
  boxes: any[],
): DetectedChromosome[] {
  const boxById = new Map<number, any>((boxes || []).map(b => [b.detected_chromosome_id, b]));
  const prevById = new Map<number, DetectedChromosome>(
    prev.filter(c => c.detectedChromosomeId !== null).map(c => [c.detectedChromosomeId as number, c])
  );
  return (publicList || []).map((pub: any) => {
    const id = pub.DetectedChromosomeID;
    const ex = prevById.get(id);
    const box = boxById.get(id);
    return {
      detectedChromosomeId: id,
      polygon: pub.mainImage_polygon,
      bbox: pub.mainImage_bbox,
      score: pub.detection_score ?? null,
      colorHue: ex?.colorHue,
      karyogram_polygon: box ? box.polygon : undefined,
      karyogram_bounds: box ? box.bounds : undefined,
      class_id: box ? box.class_id : pub.class_id,
      is_assigned: pub.is_assigned,
    } as DetectedChromosome;
  });
}

const SVG = {
  close:      <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.4"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.4"/></svg>,
  folder:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 7h4l2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/></svg>,
  run:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  report:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="14 2 14 8 20 8"/></svg>,
  print:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>,
  dna:        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 3c0 0 2 2 2 5s-2 5-2 5 2 2 2 5-2 5-2 5"/><path d="M19 3c0 0-2 2-2 5s2 5 2 5-2 2-2 5 2 5 2 5"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="16" x2="17" y2="16"/></svg>,
  check:      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
  upload:     <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  warn:       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  info:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  layout:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>,
  undo:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>,
  delete:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>,
  eraser:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.9-9.9c1-1 2.5-1 3.4 0l4.3 4.3c1 1 1 2.5 0 3.4l-9.9 9.9c-1 1-2.5 1-3.4 0Z"/><path d="m22 21H8.8"/><path d="M18 11l-4.7 4.7"/></svg>,
  add:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
};

const RIBBON_TOOLS: { id: Tool; label: string; icon: React.ReactNode }[] = [
  { id: "select", label: "Select", icon: "⊹" },
  { id: "cut",    label: "Cut",    icon: "✂" },
  { id: "erase",  label: "Erase",  icon: SVG.eraser },
  { id: "extend", label: "Extend", icon: "⤢" },
  { id: "merge",  label: "Merge",  icon: "⊕" },
  { id: "add",    label: "Add",    icon: SVG.add },
];

function WinSpinner() {
  return (
    <div style={{
      width: 32, height: 32,
      border: "3px solid #d0d0d0", borderTopColor: "#0066cc",
      borderRadius: "50%", animation: "ws-spin .7s linear infinite",
    }}/>
  );
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const txt = await res.text();
    if (!txt) return `Server error (${res.status})`;
    try { const json = JSON.parse(txt); return json?.detail || txt || `Server error (${res.status})`; }
    catch { return txt || `Server error (${res.status})`; }
  } catch { return `Server error (${res.status})`; }
}

function revokeBlob(url: string | null) {
  if (url && url.startsWith("blob:")) { try { URL.revokeObjectURL(url); } catch {} }
}

function pointToLineDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const A = point.x - lineStart.x, B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x, D = lineEnd.y - lineStart.y;
  const dot = A * C + B * D, len2 = C * C + D * D;
  let param = len2 !== 0 ? dot / len2 : -1;
  const xx = param < 0 ? lineStart.x : param > 1 ? lineEnd.x : lineStart.x + param * C;
  const yy = param < 0 ? lineStart.y : param > 1 ? lineEnd.y : lineStart.y + param * D;
  return Math.sqrt((point.x - xx) ** 2 + (point.y - yy) ** 2);
}

function findClosestPolygonEdge(polygon: Array<[number, number]>, clickPoint: Point) {
  let minDistance = Infinity, closestEdgeIndex = -1, insertPosition = -1;
  for (let i = 0; i < polygon.length; i++) {
    const p1 = { x: polygon[i][0], y: polygon[i][1] };
    const p2 = { x: polygon[(i + 1) % polygon.length][0], y: polygon[(i + 1) % polygon.length][1] };
    const distance = pointToLineDistance(clickPoint, p1, p2);
    if (distance < minDistance) { minDistance = distance; closestEdgeIndex = i; insertPosition = i + 1; }
  }
  return { edgeIndex: closestEdgeIndex, insertIndex: insertPosition };
}

function getIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const dx12 = p2.x - p1.x, dy12 = p2.y - p1.y;
  const dx34 = p4.x - p3.x, dy34 = p4.y - p3.y;
  const denom = dy34 * dx12 - dx34 * dy12;
  if (denom === 0) return null;
  const ua = (dx34 * (p1.y - p3.y) - dy34 * (p1.x - p3.x)) / denom;
  const ub = (dx12 * (p1.y - p3.y) - dy12 * (p1.x - p3.x)) / denom;
  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1)
    return { x: p1.x + ua * dx12, y: p1.y + ua * dy12 };
  return null;
}

function splitPolygonWithLine(polygon: Array<[number, number]>, p1: Point, p2: Point): Array<Array<[number, number]>> {
  const intersections: { point: [number, number]; index: number }[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const start = { x: polygon[i][0], y: polygon[i][1] };
    const end = { x: polygon[(i + 1) % polygon.length][0], y: polygon[(i + 1) % polygon.length][1] };
    const intersect = getIntersection(p1, p2, start, end);
    if (intersect) {
      const isDup = intersections.some(item => Math.abs(item.point[0] - intersect.x) < 0.01 && Math.abs(item.point[1] - intersect.y) < 0.01);
      if (!isDup) intersections.push({ point: [intersect.x, intersect.y], index: i });
    }
  }
  if (intersections.length === 2) {
    intersections.sort((a, b) => a.index - b.index);
    const [i1, i2] = intersections;
    const poly1: Array<[number, number]> = [i1.point];
    for (let j = i1.index + 1; j <= i2.index; j++) poly1.push(polygon[j]);
    poly1.push(i2.point);
    const poly2: Array<[number, number]> = [i2.point];
    for (let j = i2.index + 1; j < polygon.length; j++) poly2.push(polygon[j]);
    for (let j = 0; j <= i1.index; j++) poly2.push(polygon[j]);
    poly2.push(i1.point);
    return [poly1, poly2];
  }
  return [polygon];
}

function erasePolygon(polygon: Array<[number, number]>, erasePoint: Point, eraserRadius = 20): Array<Array<[number, number]>> {
  if (!isPointInPolygon([erasePoint.x, erasePoint.y], polygon)) return [polygon];
  const filtered = polygon.filter(p => Math.sqrt((p[0] - erasePoint.x) ** 2 + (p[1] - erasePoint.y) ** 2) > eraserRadius);
  return filtered.length >= 3 ? [filtered] : [polygon];
}

function mergePolygons(polygon1: Array<[number, number]>, polygon2: Array<[number, number]>): Array<[number, number]> {
  let minDist = Infinity, cp1 = -1, cp2 = -1;
  for (let i = 0; i < polygon1.length; i++)
    for (let j = 0; j < polygon2.length; j++) {
      const d = Math.sqrt((polygon1[i][0] - polygon2[j][0]) ** 2 + (polygon1[i][1] - polygon2[j][1]) ** 2);
      if (d < minDist) { minDist = d; cp1 = i; cp2 = j; }
    }
  if (minDist < 50)
    return [...polygon1.slice(0, cp1 + 1), ...polygon2.slice(cp2), ...polygon2.slice(0, cp2 + 1), ...polygon1.slice(cp1)];
  return polygon1;
}

function isPointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function getPolygonArea(polygon: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i], [x2, y2] = polygon[(i + 1) % polygon.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/**
 * Simplifies a polygon using the Ramer-Douglas-Peucker algorithm.
 */
function simplifyPolygon(points: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = pointToLineDistance({ x: points[i][0], y: points[i][1] }, 
                                  { x: points[0][0], y: points[0][1] }, 
                                  { x: points[end][0], y: points[end][1] });
    if (d > maxDist) {
      index = i;
      maxDist = d;
    }
  }

  if (maxDist > epsilon) {
    const res1 = simplifyPolygon(points.slice(0, index + 1), epsilon);
    const res2 = simplifyPolygon(points.slice(index), epsilon);
    return [...res1.slice(0, res1.length - 1), ...res2];
  } else {
    return [points[0], points[end]];
  }
}

// Clockwise heading order: 0=Right, 1=Down, 2=Left, 3=Up
const CONTOUR_DIRS: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const turnClockwise        = (d: number) => (d + 1) % 4;
const turnCounterClockwise = (d: number) => (d + 3) % 4;
const turnBack             = (d: number) => (d + 2) % 4;

// Returns the two pixels (grid cells) that border the crack edge starting at
// corner (cx, cy) and heading in direction `d`.
function contourEdgePixels(cx: number, cy: number, d: number): { right: [number, number]; left: [number, number] } {
  switch (d) {
    case 0: // Right
      return { right: [cx, cy], left: [cx, cy - 1] };
    case 1: // Down
      return { right: [cx - 1, cy], left: [cx, cy] };
    case 2: // Left
      return { right: [cx - 1, cy - 1], left: [cx - 1, cy] };
    default: // Up
      return { right: [cx, cy - 1], left: [cx - 1, cy - 1] };
  }
}

/**
 * Traces the exact boundary of a black region by walking the grid lines
 * ("cracks") between black and white pixels, rather than pixel centers, using
 * the supplied `isBlack` predicate. Unlike Moore-Neighbor tracing (which is
 * inset ~0.5px from the true edge and erodes the shape a little more on every
 * fill→trace round-trip), this produces the pixel-perfect outline of the
 * region, so repeated extend/erase operations no longer shrink the polygon.
 */
function crackTrace(width: number, height: number, isBlack: (x: number, y: number) => boolean): Array<[number, number]> {
  // Find topmost-then-leftmost black pixel to start from.
  let startPx = -1, startPy = -1;
  for (let y = 0; y < height && startPx === -1; y++) {
    for (let x = 0; x < width; x++) {
      if (isBlack(x, y)) { startPx = x; startPy = y; break; }
    }
  }
  if (startPx === -1) return [];

  // The top edge of the starting pixel is guaranteed to be a boundary edge.
  let cx = startPx, cy = startPy;
  let heading = 0; // Right
  const rawPoints: Array<[number, number]> = [[cx, cy]];
  const maxSteps = (width + 1) * (height + 1) * 4 + 8;

  for (let steps = 0; steps < maxSteps; steps++) {
    // Prefer the sharpest right turn, keeping the black region on our right.
    const candidates = [turnClockwise(heading), heading, turnCounterClockwise(heading), turnBack(heading)];
    let moved = false;
    for (const cand of candidates) {
      const { right, left } = contourEdgePixels(cx, cy, cand);
      if (isBlack(right[0], right[1]) && !isBlack(left[0], left[1])) {
        heading = cand;
        cx += CONTOUR_DIRS[cand][0];
        cy += CONTOUR_DIRS[cand][1];
        moved = true;
        break;
      }
    }
    if (!moved) break;
    rawPoints.push([cx, cy]);
    if (cx === startPx && cy === startPy) break;
  }

  // Drop the closing duplicate of the start corner, if present.
  if (rawPoints.length > 1) {
    const first = rawPoints[0], last = rawPoints[rawPoints.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) rawPoints.pop();
  }

  // Collapse collinear points, keeping only the corners where direction changes.
  const n = rawPoints.length;
  if (n < 3) return rawPoints;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const prev = rawPoints[(i - 1 + n) % n];
    const curr = rawPoints[i];
    const next = rawPoints[(i + 1) % n];
    const dx1 = curr[0] - prev[0], dy1 = curr[1] - prev[1];
    const dx2 = next[0] - curr[0], dy2 = next[1] - curr[1];
    if (dx1 * dy2 - dy1 * dx2 !== 0) points.push(curr);
  }

  return points.length >= 3 ? points : rawPoints;
}

/** Traces the outer boundary of all black pixels on the canvas. */
function traceContour(ctx: CanvasRenderingContext2D, width: number, height: number): Array<[number, number]> {
  const data = ctx.getImageData(0, 0, width, height).data;
  const threshold = 128;
  const isBlack = (x: number, y: number) =>
    x >= 0 && x < width && y >= 0 && y < height && data[(y * width + x) * 4] < threshold;
  return crackTrace(width, height, isBlack);
}

/**
 * Traces the black connected component that contains the given seed pixel
 * (4-connectivity). `connected` reports whether that component covers *all*
 * black pixels on the canvas — i.e. every stroke the user drew is joined to
 * the seed's region. If some black is left over, the drawing was disconnected
 * from the seed and the caller can choose to ignore it.
 */
function traceComponentContour(
  ctx: CanvasRenderingContext2D, width: number, height: number, seedX: number, seedY: number,
): { polygon: Array<[number, number]>; connected: boolean } {
  const data = ctx.getImageData(0, 0, width, height).data;
  const threshold = 128;
  const isBlack = (x: number, y: number) =>
    x >= 0 && x < width && y >= 0 && y < height && data[(y * width + x) * 4] < threshold;

  if (!isBlack(seedX, seedY)) return { polygon: [], connected: false };

  const comp = new Uint8Array(width * height);
  const stack = [seedX + seedY * width];
  comp[stack[0]] = 1;
  let compCount = 0;
  while (stack.length) {
    const p = stack.pop()!;
    compCount++;
    const x = p % width, y = (p - x) / width;
    if (x > 0         && !comp[p - 1]     && isBlack(x - 1, y)) { comp[p - 1]     = 1; stack.push(p - 1); }
    if (x < width - 1 && !comp[p + 1]     && isBlack(x + 1, y)) { comp[p + 1]     = 1; stack.push(p + 1); }
    if (y > 0         && !comp[p - width] && isBlack(x, y - 1)) { comp[p - width] = 1; stack.push(p - width); }
    if (y < height - 1 && !comp[p + width] && isBlack(x, y + 1)) { comp[p + width] = 1; stack.push(p + width); }
  }

  let allBlack = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (isBlack(x, y)) allBlack++;
  }

  const isInComp = (x: number, y: number) =>
    x >= 0 && x < width && y >= 0 && y < height && comp[y * width + x] === 1;

  return { polygon: crackTrace(width, height, isInComp), connected: allBlack === compCount };
}

/** Rasterizes a polygon and returns the first black pixel found — a point that
 *  is guaranteed to lie inside/on the polygon, usable as a flood-fill seed. */
function findPolygonSeed(polygon: Array<[number, number]>, width: number, height: number): [number, number] | null {
  if (polygon.length < 3) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  rasterizePolygon(ctx, polygon);
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4] < 128) return [x, y];
    }
  }
  return null;
}

function rasterizePolygon(ctx: CanvasRenderingContext2D, polygon: Array<[number, number]>) {
  if (polygon.length < 3) return;
  ctx.fillStyle = "black";
  ctx.beginPath();
  ctx.moveTo(polygon[0][0], polygon[0][1]);
  for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i][0], polygon[i][1]);
  ctx.closePath();
  ctx.fill();
}

export function OnlineKaryotyping() {
  const [selectedFile, setSelectedFile]             = useState<File | null>(null);
  const [preview, setPreview]                       = useState<string | null>(null);
  const [resultImage, setResultImage]               = useState<string | null>(null);
  const [hasDetection, setHasDetection]             = useState(false);
  const [reportData, setReportData]                 = useState<ReportData | null>(null);
  const [loading, setLoading]                       = useState(false);
  const [loadingPhase, setLoadingPhase]             = useState<"analysis" | "report" | null>(null);
  const [activeTool, setActiveTool]                 = useState<Tool>("select");
  const [markDetected, setMarkDetected]             = useState(true);
  const [dragOver, setDragOver]                     = useState(false);
  const [statusMsg, setStatusMsg]                   = useState("Ready");
  const [errorMsg, setErrorMsg]                     = useState<string | null>(null);
  const [debugInfo, setDebugInfo]                   = useState<string | null>(null);
  const [detectedChromosomes, setDetectedChromosomes] = useState<DetectedChromosome[]>([]);
  const [scale, setScale]                           = useState(1);
  const [karyogramScale, setKaryogramScale]         = useState(1);
  const [offset, setOffset]                         = useState({ x: 0, y: 0 });
  const [karyogramOffset, setKaryogramOffset]       = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning]                   = useState<"main" | "karyogram" | null>(null);
  const [panStart, setPanStart]                     = useState<Point | null>(null);
  const [hasDragged, setHasDragged]                 = useState(false);
  const [selectedChromosomeArea, setSelectedChromosomeArea] = useState<number | null>(null);
  const [layoutMode, setLayoutMode]                 = useState<LayoutMode>("prioritized-left");
  const [karyogramImage, setKaryogramImage]         = useState<string | null>(null);
  const [history, setHistory]                       = useState<DetectedChromosome[][]>([]);
  const [historyIndex, setHistoryIndex]             = useState(-1);
  const [selectedPolygonForMerge, setSelectedPolygonForMerge] = useState<number | null>(null);
  const [extendStarted, setExtendStarted]           = useState(false);
  const [drawingCircleRadius, setDrawingCircleRadius] = useState(6);
  const [brushSizePopup, setBrushSizePopup]         = useState<{ x: number; y: number } | null>(null);
  const [isDrawingRaster, setIsDrawingRaster]       = useState(false);
  const [isDrawingExtend, setIsDrawingExtend]       = useState(false);
  const [extendStartPoint, setExtendStartPoint]     = useState<Point | null>(null);
  const [previewPolygon, setPreviewPolygon]         = useState<Array<[number, number]> | null>(null);

  const [lastInsertedIndex, setLastInsertedIndex]   = useState<number | null>(null);
  const [cutStartPoint, setCutStartPoint]           = useState<Point | null>(null);
  const [mousePos, setMousePos]                     = useState<Point | null>(null);
  const [lastCutLine, setLastCutLine]               = useState<{ p1: Point; p2: Point } | null>(null);
  const [reportViewActive, setReportViewActive]     = useState(false);
  const [boundingPolygonsSynced, setBoundingPolygonsSynced] = useState(false);
  const [showHowItWorks, setShowHowItWorks]         = useState(false);
  const [karyogramClassAreas, setKaryogramClassAreas] = useState<ClassAreaBox[]>([]);
  // Karyogram regions are DERIVED from the single detectedChromosomes list — the report
  // boxes for every chromosome that has been classified. Index semantics match the old
  // karyogramBoundingBoxes state so the rest of the report code is unchanged.
  const karyogramBoundingBoxes = useMemo(
    () => detectedChromosomes
      .filter(c => c.karyogram_polygon && c.karyogram_polygon.length > 0)
      .map(c => ({
        detectedChromosomeId: c.detectedChromosomeId,
        polygon: c.karyogram_polygon as Array<[number, number]>,
        bounds: c.karyogram_bounds,
        class_id: c.class_id ?? -1,
      })),
    [detectedChromosomes]
  );
  const [chromDrag, setChromDrag]                   = useState<{ boxIndex: number; type: number } | null>(null);
  const [dragOverClassIdx, setDragOverClassIdx]     = useState<number | null>(null);
  const [selectedKaryogramRegion, setSelectedKaryogramRegion] = useState<number | null>(null);
  const [contextMenu, setContextMenu]               = useState<{ x: number; y: number } | null>(null);
  const [showTypeSubmenu, setShowTypeSubmenu]       = useState(false);

  // ── Mobile / responsive ──────────────────────────────────────────────────────
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab]                   = useState<"editor" | "report">("editor");
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const [imgSize, setImgSize]                       = useState({ w: 0, h: 0 });
  const svgRef             = useRef<SVGSVGElement>(null);
  const karyogramCanvasRef = useRef<HTMLCanvasElement>(null);
  const loadedImageRef     = useRef<HTMLImageElement | null>(null);
  const karyogramImageRef  = useRef<HTMLImageElement | null>(null);
  const fileInputRef       = useRef<HTMLInputElement>(null);
  const imageAreaRef       = useRef<HTMLDivElement>(null);
  const karyogramAreaRef   = useRef<HTMLDivElement>(null);
  const virtualCanvasRef   = useRef<HTMLCanvasElement | null>(null);
  const extendSeedRef      = useRef<[number, number] | null>(null);
  const chromDragRef       = useRef<{ boxIndex: number; imageIndex: number; type: number; startX: number; startY: number; moved: boolean } | null>(null);
  // Live cursor position (in karyogram natural-image coords) while dragging a chromosome
  // to reclassify — drives the drag ghost that follows the pointer.
  const dragCursorRef      = useRef<{ x: number; y: number } | null>(null);
  // Two-finger pinch-zoom tracking (per surface). pinching = true suppresses the
  // single-finger pan/draw handlers so a pinch never drives the pan logic.
  const mainPointersRef    = useRef<Map<number, { x: number; y: number }>>(new Map());
  const mainPinchRef       = useRef<{ startDist: number; startScale: number } | null>(null);
  const mainPinchingRef    = useRef(false);
  const karyoPointersRef   = useRef<Map<number, { x: number; y: number }>>(new Map());
  const karyoPinchRef      = useRef<{ startDist: number; startScale: number } | null>(null);
  const karyoPinchingRef   = useRef(false);
  const navigate           = useNavigate();
  const caseId             = "105123";

  // Live mirrors of the zoom levels so pinch handlers read the current value
  // without stale closures.
  const scaleRef          = useRef(scale);
  const karyogramScaleRef = useRef(karyogramScale);
  scaleRef.current = scale;
  karyogramScaleRef.current = karyogramScale;

  // ── SEO Initialization ───────────────────────────────────────────────────────
  useEffect(() => {
    // Sets the page title seen in Browser Tabs and Search Results
    document.title = "Free Online Karyotyping Software | ChromoTraQ AI Analysis";
    
    // Updates meta description for better Click-Through Rate (CTR) in search results
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute("content", "Professional free karyotyping software with automated AI chromosome detection and classification. Perform online karyotyping and generate reports instantly.");
    } else {
      const meta = document.createElement('meta');
      meta.name = "description";
      meta.content = "Professional free karyotyping software with automated AI chromosome detection and classification. Perform online karyotyping and generate reports instantly.";
      document.getElementsByTagName('head')[0].appendChild(meta);
    }
  }, []);

  // ── History ──────────────────────────────────────────────────────────────────
  const saveToHistory = useCallback((newAreas: DetectedChromosome[]) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push([...newAreas]);
      setHistoryIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [historyIndex]);

  // Push the current area set to the backend so Current_State stays in sync after every
  // edit (merge / extend / erase / delete / add / cut / undo). Sends {id, polygon} per
  // area; the backend reconciles (updates existing ids, mints ids for new areas, drops
  // removed ones), regenerates the report, and returns the full report payload. We adopt
  // the reconciled ids and refresh the karyogram image, bounding boxes and class areas.
  const syncPolygons = useCallback(async (list: DetectedChromosome[]) => {
    if (!hasDetection) return;
    try {
      const fd = new FormData();
      fd.append("polygons", JSON.stringify(list.map(c => ({
        id: c.detectedChromosomeId ?? null,
        polygon: c.polygon,
      }))));
      const res = await fetch(`${BASE_URL}/api/predict/RefreshPolygons`, { method: "POST", body: fd });
      if (!res.ok) return;
      const raw = await res.json();
      if (!Array.isArray(raw?.chromosomes)) return;
      setDetectedChromosomes(prev => applyReportResponse(prev, raw.chromosomes, raw.bounding_boxes || []));
      if (raw.image) {
        const url = raw.image.startsWith("data:") ? raw.image : `data:image/png;base64,${raw.image}`;
        setKaryogramImage(url);
      }
      if (raw.Class_Area_Boxes) setKaryogramClassAreas(parseClassAreaBoxes(raw.Class_Area_Boxes));
      setBoundingPolygonsSynced(true);
    } catch {
      /* best-effort sync; a failed refresh is retried on the next edit */
    }
  }, [hasDetection]);

  // Select a chromosome across BOTH views at once, matched by DetectedChromosomeID.
  // Passing null clears the selection in both views.
  const selectByChromosome = useCallback((dc: DetectedChromosome | null) => {
    if (!dc) { setSelectedChromosomeArea(null); setSelectedKaryogramRegion(null); return; }
    const eIdx = detectedChromosomes.indexOf(dc);
    setSelectedChromosomeArea(eIdx >= 0 ? eIdx : null);
    const rIdx = dc.detectedChromosomeId === null
      ? -1
      : karyogramBoundingBoxes.findIndex(b => b.detectedChromosomeId === dc.detectedChromosomeId);
    setSelectedKaryogramRegion(rIdx >= 0 ? rIdx : null);
  }, [detectedChromosomes, karyogramBoundingBoxes]);

  const deleteSelectedChromosome = useCallback(() => {
    if (selectedChromosomeArea === null) return;
    const newAreas = [...detectedChromosomes];
    newAreas.splice(selectedChromosomeArea, 1);
    setDetectedChromosomes(newAreas);
    saveToHistory(newAreas);
    syncPolygons(newAreas);
    setSelectedChromosomeArea(null);
    setSelectedKaryogramRegion(null);
    setBoundingPolygonsSynced(false);
    setStatusMsg("Deleted chromosome area");
  }, [selectedChromosomeArea, detectedChromosomes, saveToHistory, syncPolygons]);

  const undoLastAction = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const restored = [...history[newIndex]];
      setDetectedChromosomes(restored);
      syncPolygons(restored);
      setSelectedChromosomeArea(null);
      setSelectedPolygonForMerge(null);
      setBoundingPolygonsSynced(false);
      setStatusMsg("Undo: Restored previous state");
    } else {
      setStatusMsg("Nothing to undo");
    }
  }, [historyIndex, history, syncPolygons]);

  // On mobile, surface the report automatically once it becomes available.
  useEffect(() => {
    if (isMobile && reportViewActive) setMobileTab("report");
  }, [isMobile, reportViewActive]);

  // ── Reset tool state on tool change ─────────────────────────────────────────
  useEffect(() => {
    setCutStartPoint(null);
    setMousePos(null);
    setLastCutLine(null);
    setExtendStarted(false);
    setLastInsertedIndex(null);
    setBrushSizePopup(null);
  }, [activeTool]);

  // ── Main image wheel zoom ────────────────────────────────────────────────────
  useEffect(() => {
    const el = imageAreaRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!selectedFile) return;
      e.preventDefault();
      setScale(prev => e.deltaY < 0 ? Math.min(prev * 1.1, 10) : Math.max(prev / 1.1, 0.2));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [selectedFile]);

  // ── Karyogram wheel zoom ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = karyogramAreaRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!karyogramImage) return;
      e.preventDefault();
      setKaryogramScale(prev => e.deltaY < 0 ? Math.min(prev * 1.1, 10) : Math.max(prev / 1.1, 0.2));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [karyogramImage]);

  // ── Global mouse up ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      setIsPanning(null); setPanStart(null);
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      // Cancel a chromosome drag that was released outside the karyogram canvas.
      if (chromDragRef.current) {
        chromDragRef.current = null; dragCursorRef.current = null;
        setChromDrag(null);
        setDragOverClassIdx(null);
      }
    };
    window.addEventListener("pointerup", handler);
    window.addEventListener("pointercancel", handler);
    return () => {
      window.removeEventListener("pointerup", handler);
      window.removeEventListener("pointercancel", handler);
    };
  }, []);

  // ── Blob cleanup ─────────────────────────────────────────────────────────────
  useEffect(() => () => { revokeBlob(preview); },        [preview]);
  useEffect(() => () => { revokeBlob(resultImage); },    [resultImage]);
  useEffect(() => () => { revokeBlob(karyogramImage); }, [karyogramImage]);

  // ── Draw main image polygons ─────────────────────────────────────────────────
  // ── Draw karyogram bounding boxes ────────────────────────────────────────────
  // Mirrors drawPolygons exactly: canvas is sized to the IMAGE's natural dimensions,
  // overlaid on top of the image inside the same transform div.
  const drawKaryogramBounds = useCallback(() => {
    const canvas = karyogramCanvasRef.current;
    const img    = karyogramImageRef.current;
    if (!canvas || !img) return;

    // Size canvas to image natural dimensions — identical to main image approach
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const strokePolygon = (polygon: Array<[number, number]>, stroke: string, fill: string | null, lineWidth: number, dash: number[] = []) => {
      if (!polygon.length) return;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(polygon[0][0], polygon[0][1]);
      for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i][0], polygon[i][1]);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Selected region highlight
    if (selectedKaryogramRegion !== null && selectedKaryogramRegion < karyogramBoundingBoxes.length) {
      strokePolygon(karyogramBoundingBoxes[selectedKaryogramRegion].polygon, "#ff3333", "hsla(0,100%,50%,0.2)", 3);
    }

    // Drag-to-reclassify visuals
    if (chromDrag) {
      if (dragOverClassIdx !== null && dragOverClassIdx < karyogramClassAreas.length) {
        strokePolygon(karyogramClassAreas[dragOverClassIdx].polygon, "#22aa33", "hsla(130,70%,45%,0.25)", 3);
      }
      if (chromDrag.boxIndex < karyogramBoundingBoxes.length) {
        const dragged = karyogramBoundingBoxes[chromDrag.boxIndex];
        // Faint dashed outline at the chromosome's original spot (the "source").
        strokePolygon(dragged.polygon, "#0066cc", null, 2, [6, 4]);

        // Ghost that follows the cursor: the actual chromosome image cropped from the
        // karyogram, drawn semi-transparent and centered on the pointer, with a solid
        // bounding box so it clearly reads as "being dragged".
        const b = dragged.bounds;
        const cur = dragCursorRef.current;
        if (b && cur && b.width > 0 && b.height > 0) {
          const gx = cur.x - b.width / 2;
          const gy = cur.y - b.height / 2;
          ctx.save();
          ctx.globalAlpha = 0.75;
          ctx.drawImage(img, b.x_min, b.y_min, b.width, b.height, gx, gy, b.width, b.height);
          ctx.restore();
          ctx.strokeStyle = "#0066cc";
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.strokeRect(gx, gy, b.width, b.height);
        }
      }
    }
  }, [karyogramBoundingBoxes, selectedKaryogramRegion, karyogramClassAreas, chromDrag, dragOverClassIdx]);

  // ── Persist karyogram image ref and redraw ───────────────────────────────────
  useEffect(() => {
    if (karyogramImage) {
      const img  = new Image();
      img.onload = () => {
        karyogramImageRef.current = img;
        drawKaryogramBounds();
      };
      img.src = karyogramImage;
    } else {
      karyogramImageRef.current = null;
    }
  }, [karyogramImage, drawKaryogramBounds]);

  useEffect(() => {
    if (karyogramImageRef.current) drawKaryogramBounds();
  }, [selectedKaryogramRegion, karyogramBoundingBoxes, drawKaryogramBounds]);

  // ── Persist main image ref and redraw ────────────────────────────────────────
  const displayImage = resultImage || preview;

  useEffect(() => {
    if (displayImage) {
      const img  = new Image();
      img.onload = () => { 
        loadedImageRef.current = img; 
        setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.src    = displayImage;
    } else {
      loadedImageRef.current = null;
      setImgSize({ w: 0, h: 0 });
    }
  }, [displayImage]);

  // ── Main canvas click ────────────────────────────────────────────────────────
  const handleCanvasClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (hasDragged) { setHasDragged(false); return; }
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const { x, y } = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    const clickPoint = { x, y };

    if (activeTool === "cut") {
      if (!cutStartPoint) {
        setCutStartPoint(clickPoint);
        setLastCutLine(null);
        setStatusMsg("Cut: first point set. Click again to cut.");
      } else {
        handleCutAction(cutStartPoint, clickPoint);
        setCutStartPoint(null);
        setMousePos(null);
      }
      return;
    }

    if (activeTool === "select") {
      for (let i = 0; i < detectedChromosomes.length; i++) {
        if (isPointInPolygon([x, y], detectedChromosomes[i].polygon)) {
          selectByChromosome(detectedChromosomes[i]); // selects in both views by id
          setSelectedPolygonForMerge(null);
          setStatusMsg(`Selected chromosome ${i + 1}`);
          return;
        }
      }
      selectByChromosome(null);
      setSelectedPolygonForMerge(null);
      return;
    }

    if (activeTool === "erase") {
      return;
    }

    if (activeTool === "extend") {
      // Original point insertion logic disabled in favor of new raster extension
      return;
    }

    if (activeTool === "merge") {
      if (selectedPolygonForMerge === null) {
        for (let i = 0; i < detectedChromosomes.length; i++) {
          if (isPointInPolygon([x, y], detectedChromosomes[i].polygon)) {
            setSelectedPolygonForMerge(i);
            setSelectedChromosomeArea(i);
            setStatusMsg(`Merge: selected polygon ${i + 1}. Click second polygon.`);
            return;
          }
        }
      } else {
        for (let i = 0; i < detectedChromosomes.length; i++) {
          if (i !== selectedPolygonForMerge && isPointInPolygon([x, y], detectedChromosomes[i].polygon)) {
            const p1 = detectedChromosomes[selectedPolygonForMerge];
            const p2 = detectedChromosomes[i];
            const merged   = mergePolygons(p1.polygon, p2.polygon);
            const newAreas = [...detectedChromosomes];
            newAreas.splice(Math.max(selectedPolygonForMerge, i), 1);
            newAreas.splice(Math.min(selectedPolygonForMerge, i), 1);
            // Merged area keeps p1's identity; its stale report geometry is cleared.
            newAreas.push({
              ...p1, polygon: merged, score: ((p1.score ?? 0) + (p2.score ?? 0)) / 2,
              karyogram_polygon: undefined, karyogram_bounds: undefined, class_id: undefined, is_assigned: undefined,
            });
            setDetectedChromosomes(newAreas);
            saveToHistory(newAreas);
            syncPolygons(newAreas);
            setBoundingPolygonsSynced(false);
            setSelectedPolygonForMerge(null);
            setSelectedChromosomeArea(null);
            setStatusMsg("Merged two polygons");
            return;
          }
        }
      }
    }
  };

  const handleCanvasMouseDown = (event: React.PointerEvent<SVGSVGElement>) => {
    // A second touch means a pinch is starting — abandon any single-finger
    // pan/draw so the pinch can take over cleanly.
    if (event.pointerType === "touch" && mainPointersRef.current.size >= 1) {
      mainPinchingRef.current = true;
      setIsPanning(null); setPanStart(null);
      setIsDrawingRaster(false); setPreviewPolygon(null); setExtendStartPoint(null);
      return;
    }
    setHasDragged(false);
    // Keep receiving move/up events even if the finger/cursor leaves the SVG.
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const { x, y } = pt.matrixTransform(svg.getScreenCTM()?.inverse());

    if (activeTool === "extend" || activeTool === "erase" || activeTool === "add") {
      let hitIndex = -1;
      for (let i = 0; i < detectedChromosomes.length; i++) {
        if (isPointInPolygon([x, y], detectedChromosomes[i].polygon)) {
          hitIndex = i;
          break;
        }
      }

      let targetArea = selectedChromosomeArea;

      // If we hit a DIFFERENT polygon, update selection first
      if (activeTool !== "add" && hitIndex !== -1 && hitIndex !== selectedChromosomeArea) {
        targetArea = hitIndex;
        setSelectedChromosomeArea(hitIndex);
        if (boundingPolygonsSynced) {
          const idx = karyogramBoundingBoxes.findIndex(b => b.detectedChromosomeId === detectedChromosomes[hitIndex].detectedChromosomeId);
          if (idx >= 0) setSelectedKaryogramRegion(idx);
        }
        setStatusMsg(`Selected chromosome ${hitIndex + 1}`);
      }

      if (activeTool === "add" || targetArea !== null) {
        // Initialize Virtual Canvas
        const img = loadedImageRef.current;
        if (!img) return;
        const vCanvas = document.createElement("canvas");
        vCanvas.width = img.width;
        vCanvas.height = img.height;
        const vCtx = vCanvas.getContext("2d");
        if (!vCtx) return;

        // Fill White
        vCtx.fillStyle = "white";
        vCtx.fillRect(0, 0, vCanvas.width, vCanvas.height);

        // Draw Current Polygon Black
        extendSeedRef.current = null;
        if (activeTool !== "add" && targetArea !== null) {
          rasterizePolygon(vCtx, detectedChromosomes[targetArea].polygon);
          // Seed inside the selected polygon — used by extend to keep tracing
          // the component that contains it (computed once per drag).
          if (activeTool === "extend") {
            extendSeedRef.current = findPolygonSeed(
              detectedChromosomes[targetArea].polygon, vCanvas.width, vCanvas.height,
            );
          }
        }

        virtualCanvasRef.current = vCanvas;
        setIsDrawingRaster(true);
        setExtendStartPoint({ x, y });

        // Draw initial circle (black for add/extend, white for erase)
        vCtx.fillStyle = activeTool === "erase" ? "white" : "black";
        vCtx.beginPath();
        vCtx.arc(x, y, drawingCircleRadius, 0, Math.PI * 2);
        vCtx.fill();
        return;
      }
    }

    let hit = false;
    for (let i = 0; i < detectedChromosomes.length; i++) {
      if (isPointInPolygon([x, y], detectedChromosomes[i].polygon)) {
        hit = true;
        break;
      }
    }
    if (!hit) { 
      setIsPanning("main"); 
      setPanStart({ x: event.clientX, y: event.clientY }); 
    }
  };

  const handleCanvasMouseUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if ((activeTool === "extend" || activeTool === "erase" || activeTool === "add") && isDrawingRaster && virtualCanvasRef.current) {
      const svg = svgRef.current;
      if (!svg) return;
      const pt = svg.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const { x, y } = pt.matrixTransform(svg.getScreenCTM()?.inverse());

      const vCanvas = virtualCanvasRef.current;
      const vCtx = vCanvas.getContext("2d");
      if (vCtx && extendStartPoint) {
        // Draw End Circle and connecting line (black for add/extend, white for erase)
        const paintColor = activeTool === "erase" ? "white" : "black";
        vCtx.fillStyle = paintColor;
        vCtx.strokeStyle = paintColor;
        vCtx.lineWidth = drawingCircleRadius * 2;
        vCtx.lineCap = "round";

        vCtx.beginPath();
        vCtx.arc(x, y, drawingCircleRadius, 0, Math.PI * 2);
        vCtx.fill();

        vCtx.beginPath();
        vCtx.moveTo(extendStartPoint.x, extendStartPoint.y);
        vCtx.lineTo(x, y);
        vCtx.stroke();

        // Trace new contour. For "extend" we trace only the connected component
        // that contains the originally selected chromosome, so that a stroke
        // drawn away from it (not touching its polygon) is ignored instead of
        // replacing the selection.
        let newPolygon: Array<[number, number]>;
        if (activeTool === "extend" && selectedChromosomeArea !== null) {
          const seed = extendSeedRef.current;
          const result = seed
            ? traceComponentContour(vCtx, vCanvas.width, vCanvas.height, seed[0], seed[1])
            : { polygon: [] as Array<[number, number]>, connected: false };

          if (!result.connected) {
            // The new drawing did not connect to the selected chromosome — ignore it.
            setStatusMsg("Extend ignored: drawing not connected to the selected chromosome.");
            setIsDrawingRaster(false);
            setPreviewPolygon(null);
            setExtendStartPoint(null);
            setIsPanning(null);
            return;
          }
          newPolygon = result.polygon;
        } else {
          newPolygon = traceContour(vCtx, vCanvas.width, vCanvas.height);
        }

        if (newPolygon.length > 0) {
          // Simplify with RDP (use smaller epsilon to prevent shrinking and detail loss)
          newPolygon = simplifyPolygon(newPolygon, 0.5);

          if (activeTool === "add") {
            const ys = newPolygon.map(p => p[1]), xs = newPolygon.map(p => p[0]);
            const newArea: DetectedChromosome = {
              detectedChromosomeId: null, // minted by the backend on the next RefreshPolygons
              polygon: newPolygon,
              score: null,
              bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
              colorHue: (detectedChromosomes.length * 137.5) % 360 // Use golden angle for color distribution
            };
            const newAreas = [...detectedChromosomes, newArea];
            setDetectedChromosomes(newAreas);
            saveToHistory(newAreas);
            syncPolygons(newAreas);
            setSelectedChromosomeArea(newAreas.length - 1);
            setStatusMsg("New chromosome area added.");
          } else if (selectedChromosomeArea !== null) {
            const newAreas = [...detectedChromosomes];
            // Geometry changed → clear this area's stale report fields.
            newAreas[selectedChromosomeArea] = {
              ...newAreas[selectedChromosomeArea], polygon: newPolygon,
              karyogram_polygon: undefined, karyogram_bounds: undefined, class_id: undefined, is_assigned: undefined,
            };
            setDetectedChromosomes(newAreas);
            saveToHistory(newAreas);
            syncPolygons(newAreas);
            setStatusMsg(activeTool === "extend" ? "Polygon extended." : "Polygon erased.");
          }
          setBoundingPolygonsSynced(false);
        }
      }
    }
    setIsDrawingRaster(false);
    setPreviewPolygon(null);
    setExtendStartPoint(null);
    setIsPanning(null);
  };

  const openBrushPopup = (clientX: number, clientY: number) => {
    setIsDrawingRaster(false);
    setPreviewPolygon(null);
    setExtendStartPoint(null);
    setBrushSizePopup({ x: clientX, y: clientY });
  };

  const handleCanvasContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    if (activeTool === "extend" || activeTool === "erase" || activeTool === "add") {
      event.preventDefault();
      openBrushPopup(event.clientX, event.clientY);
    }
  };

  const handleMouseMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mainPinchingRef.current) return; // a pinch owns the gesture
    const svg = svgRef.current;
    if (!svg) return;

    if (isPanning === "main" && panStart) {
      const dx = event.clientX - panStart.x, dy = event.clientY - panStart.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) setHasDragged(true);
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setPanStart({ x: event.clientX, y: event.clientY });
      return;
    }

    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const { x, y } = pt.matrixTransform(svg.getScreenCTM()?.inverse());

    if (activeTool === "extend" || activeTool === "erase" || activeTool === "add" || (activeTool === "cut" && cutStartPoint)) {
      setMousePos({ x, y });
    }

    if ((activeTool === "extend" || activeTool === "erase" || activeTool === "add") && isDrawingRaster && virtualCanvasRef.current) {
      const vCtx = virtualCanvasRef.current.getContext("2d");
      if (vCtx && extendStartPoint) {
        const paintColor = activeTool === "erase" ? "white" : "black";
        vCtx.fillStyle = paintColor;
        vCtx.strokeStyle = paintColor;
        vCtx.lineWidth = drawingCircleRadius * 2;
        vCtx.lineCap = "round";

        vCtx.beginPath();
        vCtx.moveTo(extendStartPoint.x, extendStartPoint.y);
        vCtx.lineTo(x, y);
        vCtx.stroke();
        
        setExtendStartPoint({ x, y });

        const w = virtualCanvasRef.current.width, h = virtualCanvasRef.current.height;
        // For extend, preview only the component connected to the selected
        // chromosome, so a stroke drawn away from it shows no growth (matching
        // the "ignore disconnected drawing" behaviour applied on mouse-up).
        const previewPoints = (activeTool === "extend" && extendSeedRef.current)
          ? traceComponentContour(vCtx, w, h, extendSeedRef.current[0], extendSeedRef.current[1]).polygon
          : traceContour(vCtx, w, h);
        if (previewPoints.length > 0) {
          setPreviewPolygon(simplifyPolygon(previewPoints, 1.5));
        }
      }
    }
  };

  // ── Pinch-to-zoom on the main image area (touch) ─────────────────────────────
  const handleMainAreaPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    mainPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (mainPointersRef.current.size === 2) {
      const [a, b] = [...mainPointersRef.current.values()];
      mainPinchRef.current = { startDist: pointerDistance(a, b), startScale: scaleRef.current };
      mainPinchingRef.current = true;
    }
  };

  const handleMainAreaPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    if (!mainPointersRef.current.has(event.pointerId)) return;
    mainPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (mainPinchRef.current && mainPointersRef.current.size >= 2) {
      const [a, b] = [...mainPointersRef.current.values()];
      const ratio = pointerDistance(a, b) / (mainPinchRef.current.startDist || 1);
      setScale(clampScale(mainPinchRef.current.startScale * ratio));
    }
  };

  const handleMainAreaPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!mainPointersRef.current.delete(event.pointerId)) return;
    if (mainPointersRef.current.size < 2) mainPinchRef.current = null;
    if (mainPointersRef.current.size === 0) mainPinchingRef.current = false;
  };

  const handleCutAction = useCallback((p1: Point, p2: Point) => {
    let splitHappened = false;
    const newAreas: DetectedChromosome[] = [];
    detectedChromosomes.forEach(area => {
      const result = splitPolygonWithLine(area.polygon, p1, p2);
      if (result.length > 1) {
        splitHappened = true;
        const [r0, r1] = result;
        const bigger   = getPolygonArea(r0) >= getPolygonArea(r1);
        // First piece keeps this area's identity; both pieces lose stale report geometry.
        const cleared = { karyogram_polygon: undefined, karyogram_bounds: undefined, class_id: undefined, is_assigned: undefined };
        newAreas.push({ ...area, ...cleared, polygon: bigger ? r0 : r1 });
        // Second piece is a new chromosome — null id so the backend mints a fresh one.
        newAreas.push({ ...area, ...cleared, detectedChromosomeId: null, polygon: bigger ? r1 : r0, colorHue: ((area.colorHue ?? 0) + 60) % 360 });
      } else {
        newAreas.push(area);
      }
    });
    if (splitHappened) {
      setDetectedChromosomes(newAreas);
      saveToHistory(newAreas);
      syncPolygons(newAreas);
      setBoundingPolygonsSynced(false);
      setSelectedChromosomeArea(null);
      setLastCutLine(null);
      setStatusMsg("Polygon(s) successfully divided.");
    } else {
      setLastCutLine({ p1, p2 });
      setStatusMsg("No intersections found.");
    }
  }, [detectedChromosomes, saveToHistory, syncPolygons]);

  // ── Karyogram canvas click ───────────────────────────────────────────────────
  // Identical coordinate math to main canvas click
  const handleKaryogramCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (hasDragged) { setHasDragged(false); return; }
    const canvas = karyogramCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x    = ((event.clientX - rect.left) / rect.width)  * canvas.width;
    const y    = ((event.clientY - rect.top)  / rect.height) * canvas.height;

    for (let i = 0; i < karyogramBoundingBoxes.length; i++) {
      if (isPointInPolygon([x, y], karyogramBoundingBoxes[i].polygon)) {
        const bbox = karyogramBoundingBoxes[i];
        const dc = detectedChromosomes.find(c => c.detectedChromosomeId === bbox.detectedChromosomeId) ?? null;
        // Select in both views by id (region index resolves back to i).
        setSelectedKaryogramRegion(i);
        setSelectedChromosomeArea(dc ? detectedChromosomes.indexOf(dc) : null);
        setStatusMsg(`Selected: Class=${bbox.class_id}, ID=${bbox.detectedChromosomeId}`);
        return;
      }
    }
    selectByChromosome(null);
    setStatusMsg("Karyogram: no region at clicked point");
  };

  const openKaryogramMenu = (clientX: number, clientY: number) => {
    const canvas = karyogramCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x    = ((clientX - rect.left) / rect.width)  * canvas.width;
    const y    = ((clientY - rect.top)  / rect.height) * canvas.height;

    let hitIdx = -1;
    for (let i = 0; i < karyogramBoundingBoxes.length; i++) {
      if (isPointInPolygon([x, y], karyogramBoundingBoxes[i].polygon)) {
        hitIdx = i;
        break;
      }
    }

    if (hitIdx !== -1) {
      setSelectedKaryogramRegion(hitIdx);
      const bbox = karyogramBoundingBoxes[hitIdx];
      const editorIdx = detectedChromosomes.findIndex(c => c.detectedChromosomeId === bbox.detectedChromosomeId);
      if (boundingPolygonsSynced && editorIdx >= 0) setSelectedChromosomeArea(editorIdx);
      setContextMenu({ x: clientX, y: clientY });
    } else {
      setContextMenu(null);
    }
  };

  const handleKaryogramContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    openKaryogramMenu(event.clientX, event.clientY);
  };

  const handleKaryogramDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = karyogramCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x    = ((event.clientX - rect.left) / rect.width)  * canvas.width;
    const y    = ((event.clientY - rect.top)  / rect.height) * canvas.height;

    let hitIdx = -1;
    for (let i = 0; i < karyogramBoundingBoxes.length; i++) {
      if (isPointInPolygon([x, y], karyogramBoundingBoxes[i].polygon)) {
        hitIdx = i;
        break;
      }
    }

    if (hitIdx !== -1) {
      setSelectedKaryogramRegion(hitIdx);
      const bbox = karyogramBoundingBoxes[hitIdx];
      const editorIdx = detectedChromosomes.findIndex(c => c.detectedChromosomeId === bbox.detectedChromosomeId);
      if (boundingPolygonsSynced && editorIdx >= 0) setSelectedChromosomeArea(editorIdx);
      rotateChromosome(180, hitIdx);
    }
  };

  const rotateChromosome = async (angle: number, targetIdx?: number) => {
    const idx = targetIdx !== undefined ? targetIdx : selectedKaryogramRegion;
    if (idx === null || !selectedFile || karyogramBoundingBoxes.length === 0) return;

    // Get the specific bounding box
    const bbox = karyogramBoundingBoxes[idx];
    if (bbox.detectedChromosomeId === null) return;

    const fd = new FormData();
    fd.append("DetectedChromosomeID", bbox.detectedChromosomeId.toString());
    fd.append("rotationAngle", angle.toString());

    setLoading(true);
    setLoadingPhase("report");
    setStatusMsg("Rotating chromosome...");
    setContextMenu(null);

    try {
      const res = await fetch(`${BASE_URL}/api/predict/rotateChromosome`, { method: "POST", body: fd });
      if (!res.ok) {
        setErrorMsg(`Rotation failed: ${await parseErrorDetail(res)}`);
        setStatusMsg("Error: Rotation failed.");
        return;
      }
      const raw = await res.json();
      if (raw.image && raw.bounding_boxes) {
        const imageDataUrl = raw.image.startsWith("data:") ? raw.image : `data:image/png;base64,${raw.image}`;
        setKaryogramImage(imageDataUrl);
        setDetectedChromosomes(prev => applyReportResponse(prev, raw.chromosomes, raw.bounding_boxes));
        if (raw.Class_Area_Boxes) setKaryogramClassAreas(parseClassAreaBoxes(raw.Class_Area_Boxes));
        setStatusMsg("Rotation complete.");
      }
    } catch (e: any) {
      setErrorMsg(`Rotation failed: ${e?.message || "Network error"}`);
      setStatusMsg("Error: could not reach the server.");
    } finally {
      setLoading(false); setLoadingPhase(null);
    }
  };

  const setChromosomeType = async (type: number, targetIdx?: number) => {
    const idx = targetIdx !== undefined ? targetIdx : selectedKaryogramRegion;
    if (idx === null || !selectedFile || karyogramBoundingBoxes.length === 0) return;

    const bbox = karyogramBoundingBoxes[idx];
    if (bbox.detectedChromosomeId === null) return;
    const fd = new FormData();
    fd.append("DetectedChromosomeID", bbox.detectedChromosomeId.toString());
    fd.append("newType", type.toString());

    setLoading(true);
    setLoadingPhase("report");
    setStatusMsg("Setting chromosome type...");
    setContextMenu(null);
    setShowTypeSubmenu(false);

    try {
      const res = await fetch(`${BASE_URL}/api/predict/setChromosomeType`, { method: "POST", body: fd });
      if (!res.ok) {
        setErrorMsg(`Type update failed: ${await parseErrorDetail(res)}`);
        setStatusMsg("Error: Type update failed.");
        return;
      }
      const raw = await res.json();
      if (raw.image && raw.bounding_boxes) {
        const imageDataUrl = raw.image.startsWith("data:") ? raw.image : `data:image/png;base64,${raw.image}`;
        setKaryogramImage(imageDataUrl);
        setDetectedChromosomes(prev => applyReportResponse(prev, raw.chromosomes, raw.bounding_boxes));
        if (raw.Class_Area_Boxes) setKaryogramClassAreas(parseClassAreaBoxes(raw.Class_Area_Boxes));
        setStatusMsg("Type updated.");
      }
    } catch (e: any) {
      setErrorMsg(`Type update failed: ${e?.message || "Network error"}`);
      setStatusMsg("Error: could not reach the server.");
    } finally {
      setLoading(false); setLoadingPhase(null);
    }
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleKaryogramMouseDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Second touch → pinch; abandon any in-progress single-finger drag/pan.
    if (event.pointerType === "touch" && karyoPointersRef.current.size >= 1) {
      karyoPinchingRef.current = true;
      clearLongPress();
      chromDragRef.current = null; dragCursorRef.current = null; setChromDrag(null); setDragOverClassIdx(null);
      setIsPanning(null); setPanStart(null);
      return;
    }
    setHasDragged(false);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    const canvas = karyogramCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x    = ((event.clientX - rect.left) / rect.width)  * canvas.width;
    const y    = ((event.clientY - rect.top)  / rect.height) * canvas.height;

    // Pressing on a chromosome starts a drag (for drag-to-reclassify); it only
    // becomes an actual drag once the pointer moves past a small threshold, so
    // a plain press still behaves as a click (selection).
    let hitIdx = -1;
    for (let i = 0; i < karyogramBoundingBoxes.length; i++) {
      if (isPointInPolygon([x, y], karyogramBoundingBoxes[i].polygon)) { hitIdx = i; break; }
    }
    if (hitIdx !== -1) {
      const b = karyogramBoundingBoxes[hitIdx];
      chromDragRef.current = {
        boxIndex: hitIdx, imageIndex: b.detectedChromosomeId ?? -1, type: classIdToType(b.class_id),
        startX: event.clientX, startY: event.clientY, moved: false,
      };
      // Touch: a long press opens the context menu (replacing right-click).
      if (event.pointerType === "touch") {
        const cx = event.clientX, cy = event.clientY;
        longPressFiredRef.current = false;
        clearLongPress();
        longPressTimerRef.current = window.setTimeout(() => {
          longPressFiredRef.current = true;
          chromDragRef.current = null; dragCursorRef.current = null;
          setChromDrag(null);
          setDragOverClassIdx(null);
          setHasDragged(true);
          openKaryogramMenu(cx, cy);
        }, 500);
      }
      return;
    }
    setIsPanning("karyogram"); setPanStart({ x: event.clientX, y: event.clientY });
  };

  const handleKaryogramMouseMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (karyoPinchingRef.current) return; // a pinch owns the gesture
    const drag = chromDragRef.current;
    if (drag) {
      if (!drag.moved) {
        if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) {
          drag.moved = true;
          clearLongPress();
          setHasDragged(true);
          setChromDrag({ boxIndex: drag.boxIndex, type: drag.type });
          setStatusMsg("Drop onto a chromosome class to reclassify…");
        }
      }
      if (drag.moved) {
        const canvas = karyogramCanvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width)  * canvas.width;
          const y = ((event.clientY - rect.top)  / rect.height) * canvas.height;
          let overIdx: number | null = null;
          for (let i = 0; i < karyogramClassAreas.length; i++) {
            if (isPointInPolygon([x, y], karyogramClassAreas[i].polygon)) { overIdx = i; break; }
          }
          // Track the cursor and redraw so the drag ghost follows smoothly even when
          // dragOverClassIdx (which would otherwise trigger a re-render) doesn't change.
          dragCursorRef.current = { x, y };
          drawKaryogramBounds();
          setDragOverClassIdx(overIdx);
        }
      }
      return;
    }

    if (isPanning === "karyogram" && panStart) {
      const dx = event.clientX - panStart.x, dy = event.clientY - panStart.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) setHasDragged(true);
      setKaryogramOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setPanStart({ x: event.clientX, y: event.clientY });
    }
  };

  const handleKaryogramMouseUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    clearLongPress();
    const drag = chromDragRef.current;
    if (!drag) return;
    chromDragRef.current = null; dragCursorRef.current = null;
    setChromDrag(null);
    setDragOverClassIdx(null);
    if (!drag.moved) return; // plain click — let onClick handle selection

    const canvas = karyogramCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width)  * canvas.width;
    const y = ((event.clientY - rect.top)  / rect.height) * canvas.height;

    let target: ClassAreaBox | null = null;
    for (const area of karyogramClassAreas) {
      if (isPointInPolygon([x, y], area.polygon)) { target = area; break; }
    }
    if (!target) { setStatusMsg("Reclassify cancelled — not dropped on a chromosome class."); return; }

    const newType = classLabelToType(target.className);
    if (newType === null) { setStatusMsg(`Unknown target class "${target.className}".`); return; }
    if (newType === drag.type) { setStatusMsg(`Chromosome is already class ${target.className}.`); return; }

    setChromosomeType(newType, drag.boxIndex);
  };

  // ── Pinch-to-zoom on the karyogram area (touch) ──────────────────────────────
  const handleKaryoAreaPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    karyoPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (karyoPointersRef.current.size === 2) {
      const [a, b] = [...karyoPointersRef.current.values()];
      karyoPinchRef.current = { startDist: pointerDistance(a, b), startScale: karyogramScaleRef.current };
      karyoPinchingRef.current = true;
    }
  };

  const handleKaryoAreaPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    if (!karyoPointersRef.current.has(event.pointerId)) return;
    karyoPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (karyoPinchRef.current && karyoPointersRef.current.size >= 2) {
      const [a, b] = [...karyoPointersRef.current.values()];
      const ratio = pointerDistance(a, b) / (karyoPinchRef.current.startDist || 1);
      setKaryogramScale(clampScale(karyoPinchRef.current.startScale * ratio));
    }
  };

  const handleKaryoAreaPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!karyoPointersRef.current.delete(event.pointerId)) return;
    if (karyoPointersRef.current.size < 2) karyoPinchRef.current = null;
    if (karyoPointersRef.current.size === 0) karyoPinchingRef.current = false;
  };

  // ── File processing ──────────────────────────────────────────────────────────
  const processFile = useCallback(async (file: File) => {
    setResultImage(prev => { revokeBlob(prev); return null; });
    setPreview(prev => { revokeBlob(prev); return null; });
    setReportData(null); setHasDetection(false); setErrorMsg(null); setDebugInfo(null);
    setDetectedChromosomes([]); setSelectedChromosomeArea(null);
    setKaryogramImage(null); setKaryogramClassAreas([]); setSelectedKaryogramRegion(null);
    setBoundingPolygonsSynced(false); setSelectedFile(file);
    setScale(1); setOffset({ x: 0, y: 0 }); setKaryogramOffset({ x: 0, y: 0 }); setKaryogramScale(1);
    setStatusMsg(`Loaded: ${file.name}`); setHistory([]); setHistoryIndex(-1); setReportViewActive(false);

    const isTiff = /\.tiff?$/i.test(file.name);
    if (!isTiff) { setPreview(URL.createObjectURL(file)); return; }

    try {
      const buffer = await file.arrayBuffer();
      const ifds   = UTIF.decode(buffer);
      UTIF.decodeImage(buffer, ifds[0]);
      const rgba   = UTIF.toRGBA8(ifds[0]);
      const c      = document.createElement("canvas");
      c.width = ifds[0].width; c.height = ifds[0].height;
      const ctx = c.getContext("2d");
      const imgData = ctx?.createImageData(c.width, c.height);
      if (imgData && ctx) { imgData.data.set(rgba); ctx.putImageData(imgData, 0, 0); }
      setPreview(c.toDataURL("image/png"));
    } catch (e) {
      setErrorMsg("Could not decode TIFF. Try PNG or JPG.");
      setStatusMsg("Error: TIFF decode failed.");
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (f) processFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0]; if (f) processFile(f);
  };

  // ── Run Analysis ─────────────────────────────────────────────────────────────
  const runAnalysis = async () => {
    if (!selectedFile || loading) return;
    setResultImage(prev => { revokeBlob(prev); return null; });
    setReportData(null); setHasDetection(false); setErrorMsg(null); setDebugInfo(null);
    setDetectedChromosomes([]); setSelectedChromosomeArea(null);
    setKaryogramImage(null); setKaryogramClassAreas([]); setSelectedKaryogramRegion(null);
    setBoundingPolygonsSynced(false); setKaryogramScale(1);
    setOffset({ x: 0, y: 0 }); setKaryogramOffset({ x: 0, y: 0 }); setReportViewActive(false);

    const fd = new FormData(); fd.append("image", selectedFile);
    setLoading(true); setLoadingPhase("analysis"); setStatusMsg("Running chromosome detection…");

    try {
      const res = await fetch(`${BASE_URL}/api/predict/get_detectedPoints`, { method: "POST", body: fd });
      if (!res.ok) {
        setErrorMsg(`Detection failed: ${await parseErrorDetail(res)}`);
        setStatusMsg(`Error: detection failed (${res.status}).`);
        return;
      }
      const data = await res.json();
      if (data.detections?.length > 0) {
        // Map the backend public dicts into the single detectedChromosomes list.
        const chroms: DetectedChromosome[] = data.detections.map((d: any, i: number) => ({
          detectedChromosomeId: d.DetectedChromosomeID,
          polygon: d.mainImage_polygon,
          bbox: d.mainImage_bbox,
          score: d.detection_score ?? null,
          colorHue: (i * 360) / data.detections.length,
        }));
        setDetectedChromosomes(chroms);
        setSelectedChromosomeArea(0);
        setResultImage(preview);
        setHasDetection(true);
        setStatusMsg(`Detection complete — ${chroms.length} chromosomes identified.`);
        saveToHistory(chroms);
        // Generate the karyotype report automatically — no separate Report click needed.
        setKaryogramScale(1); setKaryogramOffset({ x: 0, y: 0 });
        setLoadingPhase("report"); setStatusMsg("Generating karyotype report…");
        await generateReportCore();
      } else {
        setErrorMsg("No chromosomes detected");
        setStatusMsg("Detection complete — no chromosomes found.");
      }
    } catch (e: any) {
      setErrorMsg(`Detection failed: ${e?.message || "Network error"}`);
      setStatusMsg("Error: could not reach the server.");
    } finally {
      setLoading(false); setLoadingPhase(null);
    }
  };

  // ── Generate Report ───────────────────────────────────────────────────────────
  // Core report fetch + state update. Runs classification against the polygons already
  // synced into the backend Current_State. Does NOT guard or manage loading — callers
  // (runAnalysis for the automatic first report, generateReport for the Report button)
  // own that so the report can be generated both automatically and on demand.
  const generateReportCore = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/predict/get_classifications`, { method: "POST" });
      if (!res.ok) {
        setErrorMsg(`Classification failed: ${await parseErrorDetail(res)}`);
        setStatusMsg(`Error: classification failed (${res.status}).`);
        return;
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const url = URL.createObjectURL(await res.blob());
        setKaryogramImage(url); setKaryogramScale(1); setKaryogramOffset({ x: 0, y: 0 });
        setReportViewActive(true); setLayoutMode("equal-Portion");
        setStatusMsg("Received karyogram image from backend.");
        return;
      }

      let raw: any;
      try { raw = await res.json(); }
      catch { setErrorMsg("Server returned malformed JSON."); setStatusMsg("Error: could not parse report data."); return; }

      if (raw.image && raw.bounding_boxes) {
        const imageDataUrl = raw.image.startsWith("data:") ? raw.image : `data:image/png;base64,${raw.image}`;
        setKaryogramImage(imageDataUrl);
        setDetectedChromosomes(prev => applyReportResponse(prev, raw.chromosomes, raw.bounding_boxes));
        setKaryogramClassAreas(parseClassAreaBoxes(raw.Class_Area_Boxes));
        setSelectedKaryogramRegion(null); setBoundingPolygonsSynced(true);
        setKaryogramScale(1); setKaryogramOffset({ x: 0, y: 0 });
        setReportViewActive(true); setLayoutMode("equal-Portion");
        setStatusMsg(`Report ready — ${raw.bounding_boxes.length} regions detected.`);
        return;
      }

      const rawKeys = Object.keys(raw?.chromosomeImages ?? {});
      if (typeof raw.total !== "number" || typeof raw.autosomes !== "number" ||
          typeof raw.sex !== "string" || typeof raw.chromosomeImages !== "object" || !raw.chromosomeImages) {
        setErrorMsg("Report data missing expected fields.");
        setDebugInfo(`Backend sent: total=${raw?.total}, sex=${raw?.sex}, keys=[${rawKeys.join(",")}]`);
        return;
      }

      const normalizedImages = normalizeChromosomeImages(raw.chromosomeImages);
      const data: ReportData = {
        total: raw.total, autosomes: raw.autosomes, sex: raw.sex,
        chromosomeImages: normalizedImages, karyogramImage: raw.karyogramImage || null,
      };
      setReportData(data);
      if (data.karyogramImage) {
        const src = data.karyogramImage.startsWith("data:") ? data.karyogramImage : `data:image/png;base64,${data.karyogramImage}`;
        setKaryogramImage(src);
      }
      setReportViewActive(true); setLayoutMode("equal-Portion");
      const imgCount = Object.keys(normalizedImages).length;
      if (imgCount < 20) setDebugInfo(`Only ${imgCount}/24 chromosome images received. Keys: [${Object.keys(normalizedImages).join(",")}]`);
      setStatusMsg(`Report ready — ${data.total} chromosomes (${data.sex}), ${imgCount}/24 images.`);
    } catch (e: any) {
      setErrorMsg(`Classification failed: ${e?.message || "Network error"}`);
      setStatusMsg("Error: could not reach the server.");
    }
  };

  // Report button: re-generate the report on demand (e.g. after editing chromosomes).
  const generateReport = async () => {
    if (!selectedFile || loading || !hasDetection) return;
    setErrorMsg(null); setDebugInfo(null);
    setKaryogramScale(1); setOffset({ x: 0, y: 0 }); setKaryogramOffset({ x: 0, y: 0 });
    setLoading(true); setLoadingPhase("report"); setStatusMsg("Generating karyotype report…");
    try {
      await generateReportCore();
    } finally {
      setLoading(false); setLoadingPhase(null);
    }
  };

  const printReport = () => { if (reportData || karyogramImage) { window.print(); setStatusMsg("Printing report…"); } };

  // On-screen zoom controls (primarily for touch devices without a mouse wheel).
  const zoomMain    = (dir: 1 | -1) => setScale(prev => dir > 0 ? Math.min(prev * 1.2, 10) : Math.max(prev / 1.2, 0.2));
  const resetMain   = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
  const zoomKaryo   = (dir: 1 | -1) => setKaryogramScale(prev => dir > 0 ? Math.min(prev * 1.2, 10) : Math.max(prev / 1.2, 0.2));
  const resetKaryo  = () => { setKaryogramScale(1); setKaryogramOffset({ x: 0, y: 0 }); };

  const getLayoutStyles = () => {
    switch (layoutMode) {
      case "full-left":        return { leftFlex: "1 1 auto",  rightFlex: "0 0 0px",   leftHidden: false, rightHidden: true  };
      case "prioritized-left": return { leftFlex: "1 1 auto",  rightFlex: "0 0 380px", leftHidden: false, rightHidden: false };
      case "equal-Portion":    return { leftFlex: "1 1 0px",   rightFlex: "1 1 0px",   leftHidden: false, rightHidden: false };
      case "full-Right":       return { leftFlex: "0 0 0px",   rightFlex: "1 1 auto",  leftHidden: true,  rightHidden: false };
      case "prioritized-Right":return { leftFlex: "0 0 380px", rightFlex: "1 1 auto",  leftHidden: false, rightHidden: false };
      default:                 return { leftFlex: "1 1 auto",  rightFlex: "0 0 380px", leftHidden: false, rightHidden: false };
    }
  };

  const layoutStyles = getLayoutStyles();

  // On mobile the two panels don't sit side-by-side; only the panel matching the
  // active tab is shown, and it fills the available space.
  const leftHidden  = isMobile ? mobileTab !== "editor" : layoutStyles.leftHidden;
  const rightHidden = isMobile ? mobileTab !== "report" : layoutStyles.rightHidden;
  const leftFlex    = isMobile ? "1 1 auto" : layoutStyles.leftFlex;
  const rightFlex   = isMobile ? "1 1 auto" : layoutStyles.rightFlex;

  const cycleLayoutMode = () => {
    const modes: LayoutMode[] = ["full-left", "prioritized-left", "equal-Portion", "prioritized-Right", "full-Right"];
    const next = modes[(modes.indexOf(layoutMode) + 1) % modes.length];
    setLayoutMode(next);
    setStatusMsg(`Layout: ${next.replace("-", " ")}`);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Segoe+UI:wght@300;400;600&family=Consolas&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes ws-spin    { to { transform: rotate(360deg) } }
        @keyframes ws-fadein  { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        @keyframes ws-slidein { from { opacity: 0; transform: translateX(8px) } to { opacity: 1; transform: none } }
        @keyframes ws-shimmer { 0%,100%{background-position:-400px 0} 50%{background-position:400px 0} }
        @keyframes ws-dots { 0%{content:''} 33%{content:'.'} 66%{content:'..'} 100%{content:'...'} }

        .ws-window { font-family:'Segoe UI',Tahoma,Geneva,sans-serif; font-size:12px; background:#fff; min-height:100vh; min-height:100dvh; display:flex; flex-direction:column; color:#000; overflow:hidden; user-select:none; }
        .ws-ribbon { background:linear-gradient(180deg,#f8f8f8 0%,#f0f0f0 100%); border-bottom:1px solid #c0c0c0; padding:6px 10px 4px; display:flex; align-items:flex-end; gap:2px; flex-shrink:0; flex-wrap:wrap; }
        .ws-ribbon-group { display:flex; gap:1px; padding:0 8px 0 0; margin-right:4px; border-right:1px solid #d0d0d0; }
        .ws-ribbon-group:last-child { border-right:none; }
        .ws-rbtn { display:flex; flex-direction:column; align-items:center; gap:2px; padding:5px 10px 4px; min-width:52px; border:1px solid transparent; border-radius:3px; background:transparent; cursor:pointer; color:#444; font-size:11px; font-family:inherit; transition:all .12s; }
        .ws-rbtn:hover:not(:disabled) { background:#e0e0e0; border-color:#c0c0c0; color:#000; }
        .ws-rbtn-active { background:#cce4ff!important; border-color:#0066cc!important; color:#0066cc!important; }
        .ws-rbtn:disabled { opacity:.45; cursor:not-allowed; }
        .ws-rbtn-primary { color:#0066cc; }
        .ws-rbtn-primary:hover:not(:disabled) { background:#cce4ff; border-color:#0066cc; }
        .ws-rbtn-success { color:#107c10; }
        .ws-rbtn-success:hover:not(:disabled) { background:#dff6dd; border-color:#107c10; }
        .ws-rbtn span.icon { font-size:18px; line-height:1; }
        .ws-banner { display:flex; align-items:flex-start; gap:8px; padding:6px 12px; font-size:12px; font-family:'Consolas',monospace; animation:ws-fadein .15s ease; flex-shrink:0; line-height:1.5; }
        .ws-banner-error { background:#fef0f0; border-bottom:1px solid #f5c0c0; color:#a00000; }
        .ws-banner-info  { background:#f0f6ff; border-bottom:1px solid #b8d4f5; color:#004080; }
        .ws-banner svg { flex-shrink:0; margin-top:1px; }
        .ws-banner-msg { flex:1; }
        .ws-banner-close { background:none; border:none; cursor:pointer; padding:0 2px; display:flex; align-items:center; opacity:.7; transition:opacity .1s; color:inherit; }
        .ws-banner-close:hover { opacity:1; }
        .ws-body { flex:1; display:flex; min-height:0; overflow:hidden; }
        .ws-main { flex:1; display:flex; gap:0; min-width:0; overflow:hidden; transition:all 0.3s ease; }
        .ws-panel { display:flex; flex-direction:column; overflow:hidden; background:#fff; animation:ws-fadein .25s ease both; transition:flex 0.3s ease; }
        .ws-panel-left { border-right:1px solid #c0c0c0; }
        .ws-panel-titlebar { height:32px; background:linear-gradient(180deg,#f0f0f0 0%,#e8e8e8 100%); border-bottom:1px solid #c0c0c0; display:flex; align-items:center; justify-content:space-between; padding:0 12px; flex-shrink:0; }
        .ws-panel-title { font-size:12px; font-weight:600; color:#333; letter-spacing:.02em; display:flex; align-items:center; gap:8px; }
        .ws-panel-actions { display:flex; gap:6px; }
        .ws-panel-act { width:24px; height:22px; background:#fff; border:1px solid #c0c0c0; border-radius:2px; color:#666; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:10px; transition:background .1s; }
        .ws-panel-act:hover { background:#e0e0e0; color:#000; }

        /* ── Image area — identical for both panels ── */
        .ws-image-area {
          flex:1; position:relative;
          display:flex; align-items:center; justify-content:center;
          overflow:hidden; cursor:crosshair;
          background:repeating-conic-gradient(#f0f0f0 0% 25%,#fff 0% 50%) 50%/20px 20px;
          min-height:0;
          touch-action:none; /* pointer handlers own pan/zoom gestures here */
        }
        .ws-image-area-drag { outline:2px dashed #0066cc!important; }
        .ws-image-canvas {
          position:absolute;
          top:50%; left:50%;
          transform:translate(-50%,-50%);
          max-width:100%; max-height:100%;
          cursor:pointer;
          touch-action:none; /* let pointer handlers own pan/draw gestures on touch */
        }
        .ws-upload-placeholder { display:flex; flex-direction:column; align-items:center; gap:12px; color:#888; text-align:center; padding:32px; }
        .ws-upload-title { font-size:13px; color:#333; }
        .ws-upload-sub   { font-size:11px; color:#666; }
        .ws-format-row   { display:flex; gap:5px; margin-top:2px; }
        .ws-fmt-badge { font-size:10px; font-weight:700; letter-spacing:.08em; color:#0066cc; background:#f0f0f0; border:1px solid #c0c0c0; padding:1px 7px; border-radius:2px; text-transform:uppercase; font-family:'Consolas',monospace; }
        .ws-loading-overlay { position:absolute; inset:0; background:rgba(255,255,255,.85); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; z-index:50; }
        .ws-loading-overlay-inline { position:relative; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; }
        .ws-loading-txt { font-size:12px; color:#0066cc; font-family:'Consolas',monospace; }
        .ws-loading-dots::after { content:''; animation:ws-dots 1.2s steps(3,end) infinite; }
        .ws-detect-badge { display:inline-flex; align-items:center; gap:4px; font-size:10.5px; font-weight:600; font-family:'Consolas',monospace; color:#107c10; background:#dff6dd; border:1px solid #b8d9b0; padding:1px 7px; border-radius:2px; }

        /* ── Report panel ── */
        .ws-report-scroll { flex:1; overflow-y:auto; padding:16px 20px 8px; background:#fff; }
        .ws-chr-row { display:flex; width:100%; }
        .ws-chr-sep { height:1px; background:#e0e0e0; margin:8px 0; }
        .ws-chr-cell { flex:1; display:flex; flex-direction:column; align-items:center; padding:6px 4px; border-right:1px solid #e8e8e8; animation:ws-slidein .2s ease both; min-width:0; }
        .ws-chr-cell:last-child { border-right:none; }
        .ws-chr-img { height:72px; display:flex; align-items:flex-end; justify-content:center; padding-bottom:2px; width:100%; }
        .ws-chr-img img { max-height:100%; max-width:90%; object-fit:contain; opacity:.95; }
        .ws-chr-skel { width:12px; height:48px; background:linear-gradient(90deg,#e0e0e0 25%,#f0f0f0 50%,#e0e0e0 75%); background-size:400px 100%; animation:ws-shimmer 1.4s infinite; border-radius:3px; opacity:.8; }
        .ws-chr-label { font-size:11px; font-weight:600; color:#555; font-family:'Consolas',monospace; margin-top:4px; }
        .ws-chr-row-group { border:1px solid #ececec; border-radius:4px; overflow:hidden; margin-bottom:2px; background:#fff; }
        .ws-chr-row-label { font-size:10px; color:#999; font-family:'Consolas',monospace; padding:2px 6px; background:#f7f7f7; border-bottom:1px solid #ececec; letter-spacing:.04em; }
        .ws-stats { display:flex; border-top:1px solid #c0c0c0; background:#f8f8f8; flex-shrink:0; }
        .ws-stat { flex:1; text-align:center; padding:8px 4px; }
        .ws-stat+.ws-stat { border-left:1px solid #c0c0c0; }
        .ws-stat-lbl    { font-size:10px; color:#666; text-transform:uppercase; letter-spacing:.07em; }
        .ws-stat-val    { font-size:20px; font-weight:700; color:#000; font-family:'Consolas',monospace; line-height:1.2; }
        .ws-stat-val-sm { font-size:20px; font-weight:700; color:#0066cc; font-family:'Consolas',monospace; line-height:1.2; }
        .ws-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:24px; text-align:center; }
        .ws-empty-icon  { color:#999; }
        .ws-empty-title { font-size:14px; font-weight:600; color:#333; }
        .ws-empty-sub   { font-size:12px; color:#666; line-height:1.55; max-width:220px; }
        .ws-steps { display:flex; flex-direction:column; gap:6px; margin-top:10px; width:100%; max-width:240px; }
        .ws-step { display:flex; align-items:center; gap:10px; padding:7px 12px; border-radius:4px; background:#f8f8f8; border:1px solid #e0e0e0; font-size:12px; color:#333; text-align:left; }
        .ws-step-n { width:20px; height:20px; border-radius:3px; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; font-family:'Consolas',monospace; background:#e0e0e0; color:#666; }
        .ws-step-n-done   { background:#dff6dd; color:#107c10; }
        .ws-step-n-active { background:#cce4ff; color:#0066cc; }
        .ws-statusbar { height:24px; background:#f0f0f0; border-top:1px solid #c0c0c0; display:flex; align-items:center; justify-content:space-between; padding:0 12px; flex-shrink:0; }
        .ws-status-left { display:flex; align-items:center; gap:12px; }
        .ws-status-item    { font-size:12px; color:#666; font-family:'Consolas',monospace; }
        .ws-status-item-hi { color:#333; }
        .ws-status-dot      { width:8px; height:8px; border-radius:50%; background:#107c10; }
        .ws-status-dot-busy { width:8px; height:8px; box-sizing:border-box; border-radius:50%; border:2px solid #f0883e; border-top-color:transparent; animation:ws-spin .6s linear infinite; }
        .ws-status-dot-error { width:8px; height:8px; border-radius:50%; background:#d32f2f; }
        .ws-status-dot-warn  { width:8px; height:8px; border-radius:50%; background:#f0883e; }
        .hidden { display:none!important; }
        .ws-context-item:hover { background:#f0f0f0; }
        .ws-print-header, .ws-print-footer { display:none; }

        /* ── Mobile tab switch (Editor ⇄ Report) ── */
        .ws-mobile-tabs { display:flex; flex-shrink:0; border-bottom:1px solid #c0c0c0; background:#f0f0f0; }
        .ws-mtab { flex:1; padding:11px 8px; font-size:13px; font-weight:600; font-family:inherit; color:#555; background:transparent; border:none; border-bottom:3px solid transparent; cursor:pointer; }
        .ws-mtab-active { color:#0066cc; border-bottom-color:#0066cc; background:#fff; }

        /* ── On-screen zoom controls (touch) ── */
        .ws-zoom-ctrl { position:absolute; right:10px; bottom:10px; z-index:40; display:flex; flex-direction:column; gap:6px; }
        .ws-zoom-ctrl button {
          width:42px; height:42px; border-radius:8px; border:1px solid #c0c0c0;
          background:rgba(255,255,255,0.95); color:#333; font-size:22px; line-height:1;
          display:flex; align-items:center; justify-content:center; cursor:pointer;
          box-shadow:0 1px 3px rgba(0,0,0,0.2); touch-action:manipulation;
        }
        .ws-zoom-ctrl button:active { background:#e0e0e0; }

        /* ── Floating brush-size button (touch, when a paint tool is active) ── */
        .ws-brush-btn {
          position:absolute; left:10px; bottom:10px; z-index:40;
          padding:10px 16px; border-radius:8px; border:1px solid #0066cc;
          background:rgba(255,255,255,0.95); color:#0066cc; font-size:13px; font-weight:600;
          font-family:inherit; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,0.2); touch-action:manipulation;
        }

        /* ── Phone layout: stack to a single tabbed panel, roomier touch targets ── */
        @media (max-width: 767px) {
          /* Lock the page to the *visible* viewport so the ribbon can't scroll
             up under the browser's address bar / notch. */
          html, body, #root { height:100%; overflow:hidden; overscroll-behavior:none; }
          .ws-window { height:100vh; height:100dvh; user-select:none; -webkit-tap-highlight-color:transparent; }
          .ws-ribbon { flex-wrap:nowrap; overflow-x:auto; -webkit-overflow-scrolling:touch; justify-content:flex-start!important; padding:calc(6px + env(safe-area-inset-top)) 6px 4px; }
          .ws-ribbon > div { flex-wrap:nowrap!important; }
          .ws-ribbon-group { padding-right:6px; margin-right:3px; }
          .ws-rbtn { min-width:56px; padding:8px 10px 6px; font-size:11px; }
          .ws-rbtn span.icon { font-size:20px; }
          .ws-hide-mobile { display:none!important; }
          .ws-body { flex-direction:column; }
          .ws-panel { min-width:0!important; width:100%; }
          .ws-panel-right { border-left:none; }
          .ws-report-scroll { padding:12px 12px 8px; }
          .ws-chr-img { height:60px; }
          .ws-stat-val, .ws-stat-val-sm { font-size:17px; }
          .ws-context-popup .ws-context-item { padding:11px 16px!important; font-size:15px!important; }
        }
        @media print {
          @page { margin:1.5cm; }
          .ws-ribbon,.ws-statusbar,.ws-banner,.ws-panel-left,.ws-panel-titlebar,.ws-report-scroll,.ws-stats,.ws-panel-actions,.ws-empty,.ws-loading-overlay,.ws-panel-act,canvas { display:none!important; }
          .ws-window,.ws-body,.ws-main,.ws-panel-right { background:white!important; height:auto!important; overflow:visible!important; display:block!important; }
          .ws-panel-right { width:100%!important; flex:1 1 auto!important; border:none!important; }
          .ws-print-header { display:block!important; text-align:center; margin-bottom:30px; font-family:'Segoe UI',sans-serif; }
          .ws-print-header h1 { font-size:24pt; margin-bottom:5px; }
          .ws-print-footer { display:block!important; text-align:center; margin-top:50px; padding-top:20px; border-top:1px solid #eee; font-size:10pt; color:#666; line-height:1.5; }
        }

        /* ── Visually Hidden SEO Content ── */
        .ws-seo-content {
          position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
        }

        /* ── Help Panel / Modal ── */
        .ws-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.4);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000; animation: ws-fadein 0.2s ease;
        }
        .ws-modal-panel {
          background: #fff; width: 90%; max-width: 600px; max-height: 80vh;
          border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);
          display: flex; flex-direction: column; overflow: hidden;
        }
        .ws-modal-header {
          padding: 12px 16px; background: #f8f8f8; border-bottom: 1px solid #e0e0e0;
          display: flex; align-items: center; justify-content: space-between;
        }
        .ws-modal-body { padding: 20px; overflow-y: auto; color: #444; line-height: 1.6; }
        .ws-modal-body h2 { font-size: 18px; color: #0066cc; margin-bottom: 12px; }
        .ws-modal-body h3 { font-size: 14px; color: #333; margin: 16px 0 8px; font-weight: 600; }
        .ws-modal-body p { margin-bottom: 12px; font-size: 13px; }
        .ws-modal-body ul { padding-left: 20px; margin-bottom: 16px; font-size: 13px; }
        .ws-modal-close-btn {
          background: #0066cc; color: #fff; border: none; padding: 8px 20px;
          border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600;
          align-self: flex-end; margin-top: 10px; transition: background 0.2s;
        }
        .ws-modal-close-btn:hover { background: #0052a3; }
      `}</style>

      <div className="ws-window">

        {/* ── Ribbon ── */}
        <div className="ws-ribbon" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px" }}>
          <div className="ws-ribbon-group">
            <button className="ws-rbtn" onClick={() => fileInputRef.current?.click()}>
              <span className="icon">{SVG.folder}</span>Open
            </button>
          </div>
          <div className="ws-ribbon-group">
            {RIBBON_TOOLS.map(({ id, label, icon }) => (
              <button key={id}
                className={`ws-rbtn ${activeTool === id ? "ws-rbtn-active" : ""}`}
                disabled={!selectedFile}
                onClick={() => {
                  setActiveTool(id);
                  if (id !== "merge") setSelectedPolygonForMerge(null);
                  if (id === "extend") { setExtendStarted(false); setLastInsertedIndex(null); }
                  if (isMobile) setMobileTab("editor");
                  setStatusMsg(`Tool: ${label}`);
                }}>
                <span className="icon">{icon}</span>{label}
              </button>
            ))}
            <button
              className="ws-rbtn"
              disabled={!selectedFile || selectedChromosomeArea === null}
              onClick={deleteSelectedChromosome}
              title="Delete selected chromosome area"
            >
              <span className="icon">{SVG.delete}</span>Delete
            </button>
          </div>
          <div className="ws-ribbon-group">
            <button className="ws-rbtn" onClick={undoLastAction} disabled={historyIndex <= 0}>
              <span className="icon">{SVG.undo}</span>Undo
            </button>
          </div>
          <div className="ws-ribbon-group">
            <button className="ws-rbtn ws-rbtn-primary" onClick={runAnalysis} disabled={!selectedFile || loading}>
              <span className="icon">{SVG.run}</span>{loading && loadingPhase === "analysis" ? "Working…" : "Analyze"}
            </button>
            <button className="ws-rbtn ws-rbtn-success" onClick={generateReport} disabled={!hasDetection || loading}>
              <span className="icon">{SVG.report}</span>{loading && loadingPhase === "report" ? "Working…" : "Report"}
            </button>
            <button className="ws-rbtn ws-hide-mobile" onClick={cycleLayoutMode}>
              <span className="icon">{SVG.layout}</span>Layout
            </button>
          </div>
          </div>

          <div className="ws-ribbon-group" style={{ borderRight: "none", marginRight: 0 }}>
            <button
              className="ws-rbtn"
              onClick={() => setShowHowItWorks(true)}
              title="How to use this software"
            >
              <span className="icon">{SVG.info}</span>How It Works
            </button>
            <button
              className="ws-rbtn ws-rbtn-success"
              onClick={printReport}
              disabled={!reportData && !karyogramImage}
              title="Print report"
            >
              <span className="icon">{SVG.print}</span>Print Report
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="ws-banner ws-banner-error">
            {SVG.warn}<span className="ws-banner-msg">{errorMsg}</span>
            <button className="ws-banner-close" onClick={() => setErrorMsg(null)}>{SVG.close}</button>
          </div>
        )}
        {debugInfo && (
          <div className="ws-banner ws-banner-info">
            {SVG.info}<span className="ws-banner-msg">{debugInfo}</span>
            <button className="ws-banner-close" onClick={() => setDebugInfo(null)}>{SVG.close}</button>
          </div>
        )}

        {isMobile && (
          <div className="ws-mobile-tabs">
            <button
              className={`ws-mtab ${mobileTab === "editor" ? "ws-mtab-active" : ""}`}
              onClick={() => setMobileTab("editor")}
            >Image Editor</button>
            <button
              className={`ws-mtab ${mobileTab === "report" ? "ws-mtab-active" : ""}`}
              onClick={() => setMobileTab("report")}
            >Karyotype Report</button>
          </div>
        )}

        <div className="ws-body">
          <div className="ws-main">

            {/* ── Left panel: Image Viewer ── */}
            <div className={`ws-panel ws-panel-left ${leftHidden ? "hidden" : ""}`}
              style={{ flex: leftFlex }}>
              <div className="ws-panel-titlebar">
                <span className="ws-panel-title">
                  Image Viewer
                  {hasDetection && <span className="ws-detect-badge">{SVG.check}&nbsp;{detectedChromosomes.length} detected</span>}
                  {selectedChromosomeArea !== null && <span className="ws-detect-badge" style={{ background:"#cce4ff", color:"#0066cc" }}>Selected: #{selectedChromosomeArea + 1}</span>}
                  <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: "normal", cursor: "pointer", marginLeft: "12px", color: "#666" }}>
                    <input type="checkbox" checked={markDetected} onChange={e => setMarkDetected(e.target.checked)} />
                    Mark Detected Chromosomes
                  </label>
                </span>
                <div className="ws-panel-actions">
                  <button className="ws-panel-act" onClick={() => fileInputRef.current?.click()}>{SVG.folder}</button>
                </div>
              </div>

              <div ref={imageAreaRef}
                className={`ws-image-area ${dragOver ? "ws-image-area-drag" : ""}`}
                style={{ cursor: selectedFile ? "crosshair" : "pointer" }}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onPointerDown={handleMainAreaPointerDown}
                onPointerMove={handleMainAreaPointerMove}
                onPointerUp={handleMainAreaPointerUp}
                onPointerCancel={handleMainAreaPointerUp}>

                {loading && loadingPhase === "analysis" && (
                  <div className="ws-loading-overlay">
                    <WinSpinner/><span className="ws-loading-txt ws-loading-dots">Detecting chromosomes</span>
                  </div>
                )}

                {displayImage ? (
                  <div style={{
                    position:"relative", width:"100%", height:"100%",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    transform:`translate(${offset.x}px,${offset.y}px) scale(${scale})`,
                    transition: isPanning === "main" ? "none" : "transform 0.1s ease-out",
                  }}>
                    <img src={displayImage} alt="Chromosome spread" draggable={false}
                      style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain" }}/>
                    {detectedChromosomes.length > 0 && (
                      <svg
                        ref={svgRef}
                        viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
                        className="ws-image-canvas"
                        onClick={handleCanvasClick}
                        onPointerDown={handleCanvasMouseDown}
                        onPointerUp={handleCanvasMouseUp}
                        onPointerMove={handleMouseMove}
                        onMouseLeave={() => setMousePos(null)}
                        onContextMenu={handleCanvasContextMenu}
                        style={{
                          position: "absolute", top: "50%", left: "50%",
                          transform: "translate(-50%, -50%)", maxWidth: "100%", maxHeight: "100%",
                          width: imgSize.w || 'auto', height: imgSize.h || 'auto',
                          display: "block", pointerEvents: "auto", objectFit: "contain"
                        }}
                      >
                        {detectedChromosomes.map((detection, index) => {
                          const isSelected = selectedChromosomeArea === index;
                          const isMergeSelected = selectedPolygonForMerge === index;

                          if (!markDetected && !isSelected && !isMergeSelected) return null;

                          const hue = detection.colorHue ?? (index * 360) / detectedChromosomes.length;
                          return (
                            <polygon
                              key={index}
                              points={detection.polygon.map(p => `${p[0]},${p[1]}`).join(" ")}
                            fill={isSelected ? "rgba(0, 102, 204, 0.15)" : `hsla(${hue}, 0%, 50%, 0.05)`}
                            stroke={isSelected ? "#0066cc" : (isMergeSelected ? `hsla(0,100%,50%,0.5)` : `hsla(${hue},100%,50%,0.5)`)}
                              strokeWidth={isSelected || isMergeSelected ? 2 : 1}
                              style={{ cursor: "pointer" }}
                            />
                          );
                        })}
                        {previewPolygon && (
                          <polygon
                            points={previewPolygon.map(p => `${p[0]},${p[1]}`).join(" ")}
                            fill="hsla(210, 100%, 50%, 0.2)"
                            stroke="#0066cc"
                            strokeWidth="2"
                            strokeDasharray="4,2"
                            style={{ pointerEvents: "none" }}
                          />
                        )}
                        {(activeTool === "extend" || activeTool === "erase" || activeTool === "add") && mousePos && (activeTool === "add" || selectedChromosomeArea !== null) && (
                          <circle cx={mousePos.x} cy={mousePos.y} r={drawingCircleRadius} fill="rgba(0, 102, 204, 0.1)" stroke="rgba(0, 102, 204, 0.8)" strokeWidth="2" style={{ pointerEvents: "none" }} />
                        )}
                        {(() => {
                          const lineToDraw = cutStartPoint && mousePos ? { p1: cutStartPoint, p2: mousePos } : lastCutLine;
                          if (lineToDraw && activeTool === "cut") {
                            return (
                              <line x1={lineToDraw.p1.x} y1={lineToDraw.p1.y} x2={lineToDraw.p2.x} y2={lineToDraw.p2.y} stroke="red" strokeWidth="2" strokeDasharray="5,5" style={{ pointerEvents: "none" }} />
                            );
                          }
                          return null;
                        })()}
                      </svg>
                    )}
                  </div>
                ) : (
                  <div className="ws-upload-placeholder">
                    {SVG.upload}
                    <div className="ws-upload-title">Drop image here or click to open</div>
                    <div className="ws-upload-sub">High-resolution metaphase spread</div>
                    <div className="ws-format-row">
                      {["PNG","JPG","TIFF"].map(f => <span key={f} className="ws-fmt-badge">{f}</span>)}
                    </div>
                  </div>
                )}

                {isMobile && displayImage && (
                  <div className="ws-zoom-ctrl">
                    <button aria-label="Zoom in"  onClick={() => zoomMain(1)}>+</button>
                    <button aria-label="Zoom out" onClick={() => zoomMain(-1)}>−</button>
                    <button aria-label="Reset zoom" onClick={resetMain}>⟲</button>
                  </div>
                )}
                {isMobile && displayImage && detectedChromosomes.length > 0 &&
                 (activeTool === "extend" || activeTool === "erase" || activeTool === "add") && (
                  <button
                    className="ws-brush-btn"
                    onClick={() => openBrushPopup(Math.max(10, window.innerWidth / 2 - 95), Math.max(60, window.innerHeight / 2 - 110))}
                  >Brush size</button>
                )}
                <input ref={fileInputRef} type="file" accept="image/*,.tif,.tiff" onChange={handleFileInput} style={{ display:"none" }}/>
              </div>
            </div>

            {/* ── Right panel: Karyotype Report ── */}
            <div className={`ws-panel ws-panel-right ${rightHidden ? "hidden" : ""}`}
              style={{ flex: rightFlex, minWidth: 0 }}>
              <div className="ws-panel-titlebar">
                <span className="ws-panel-title">Karyotype Report
                  {selectedKaryogramRegion !== null && karyogramBoundingBoxes[selectedKaryogramRegion] && (
                    <span className="ws-detect-badge" style={{ background:"#cce4ff", color:"#0066cc" }}>
                      Selected: {karyogramBoundingBoxes[selectedKaryogramRegion].class_id}
                    </span>
                  )}
                </span>
              </div>

              <div className="ws-print-header">
                <h1>Karyogram Analysis Report</h1>
                <p>Case ID: {caseId} | Date: {new Date().toLocaleDateString()}</p>
              </div>

              {loading && loadingPhase === "report" ? (
                <div className="ws-loading-overlay-inline">
                  <WinSpinner/><span className="ws-loading-txt ws-loading-dots">Classifying chromosomes</span>
                </div>

              ) : (karyogramImage || reportData) ? (
                <>
                  {/* ── Karyogram image viewer — identical structure to main image viewer ── */}
                  {karyogramImage && (() => {
                    const hasGrid = !!(reportData?.chromosomeImages && Object.keys(reportData.chromosomeImages).length > 0);
                    const hasBoundingBoxes = karyogramBoundingBoxes.length > 0;
                    return (
                      <div ref={karyogramAreaRef}
                        className="ws-image-area"
                        style={{ flex: hasGrid ? "0 0 45%" : "1 1 auto", minHeight: hasGrid ? 120 : 0, borderBottom: hasGrid ? "1px solid #c0c0c0" : "none" }}
                        onPointerDown={handleKaryoAreaPointerDown}
                        onPointerMove={handleKaryoAreaPointerMove}
                        onPointerUp={handleKaryoAreaPointerUp}
                        onPointerCancel={handleKaryoAreaPointerUp}>

                        <div style={{
                          position:"relative", width:"100%", height:"100%",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          transform:`translate(${karyogramOffset.x}px,${karyogramOffset.y}px) scale(${karyogramScale})`,
                          transition: isPanning === "karyogram" ? "none" : "transform 0.1s ease-out",
                        }}>
                          <img src={karyogramImage} alt="Karyogram" draggable={false}
                            style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain" }}/>
                          {hasBoundingBoxes && (
                            <canvas ref={karyogramCanvasRef} className="ws-image-canvas"
                              style={chromDrag ? { cursor: "grabbing" } : undefined}
                              onClick={handleKaryogramCanvasClick}
                              onDoubleClick={handleKaryogramDoubleClick}
                              onContextMenu={handleKaryogramContextMenu}
                              onPointerDown={handleKaryogramMouseDown}
                              onPointerMove={handleKaryogramMouseMove}
                              onPointerUp={handleKaryogramMouseUp}
                              onMouseLeave={() => {}}/>
                          )}
                        </div>

                        {isMobile && (
                          <div className="ws-zoom-ctrl">
                            <button aria-label="Zoom in"  onClick={() => zoomKaryo(1)}>+</button>
                            <button aria-label="Zoom out" onClick={() => zoomKaryo(-1)}>−</button>
                            <button aria-label="Reset zoom" onClick={resetKaryo}>⟲</button>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Chromosome grid ── */}
                  {reportData?.chromosomeImages && Object.keys(reportData.chromosomeImages).length > 0 && (
                    <>
                      <div className="ws-report-scroll">
                        {CHROMOSOME_ROWS.map((row, ri) => {
                          const GROUP_LABELS = ["Group A (1–5)","Group B–D (6–12)","Group E–F (13–18)","Group G + Sex (19–22, X, Y)"];
                          return (
                            <div key={ri} className="ws-chr-row-group" style={{ animationDelay:`${ri*60}ms` }}>
                              <div className="ws-chr-row-label">{GROUP_LABELS[ri]}</div>
                              <div className="ws-chr-row">
                                {row.map((id, ci) => {
                                  const raw = reportData.chromosomeImages[id];
                                  const src = raw ? (raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`) : null;
                                  return (
                                    <div key={id} className="ws-chr-cell" style={{ animationDelay:`${ri*40+ci*15}ms` }}>
                                      <div className="ws-chr-img">
                                        {src ? <img src={src} alt={`Chr ${id}`}/> : <div className="ws-chr-skel"/>}
                                      </div>
                                      <span className="ws-chr-label">{id}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="ws-stats">
                        <div className="ws-stat"><div className="ws-stat-lbl">Total Chr.</div><div className="ws-stat-val">{reportData.total}</div></div>
                        <div className="ws-stat"><div className="ws-stat-lbl">Autosomes</div><div className="ws-stat-val">{reportData.autosomes}</div></div>
                        <div className="ws-stat"><div className="ws-stat-lbl">Sex Chr.</div><div className="ws-stat-val-sm">{reportData.sex}</div></div>
                        <div className="ws-stat"><div className="ws-stat-lbl">Images</div><div className="ws-stat-val" style={{fontSize:16}}>{Object.keys(reportData.chromosomeImages).length}/24</div></div>
                      </div>
                    </>
                  )}
                </>

              ) : (
                <div className="ws-empty">
                  <div className="ws-empty-icon">{SVG.dna}</div>
                  <h1 className="ws-empty-title">Free Online Karyotyping Software</h1>
                  <div className="ws-empty-sub">
                    Welcome to ChromoTraQ, your professional tool for <strong>online karyotyping</strong>. 
                    Follow the steps below to perform automated chromosome detection and generate your free karyotype report.
                  </div>
                  <div className="ws-steps">
                    {[
                      { num:1, done:!!selectedFile,                   active:!selectedFile,                          text:"Open a chromosome image" },
                      { num:2, done:hasDetection,                     active:!!selectedFile && !hasDetection,         text:"Run Analysis (Analyze)" },
                      { num:3, done:!!reportData || !!karyogramImage, active:hasDetection && !reportData && !karyogramImage, text:"Generate Report (Report)" },
                    ].map(({ num, done, active, text }) => (
                      <div key={num} className="ws-step">
                        <span className={`ws-step-n ${done?"ws-step-n-done":active?"ws-step-n-active":""}`}>
                          {done ? SVG.check : num}
                        </span>
                        {text}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="ws-print-footer">
                Generated by ChromoTraQ Online: Free AI based Karyotyping Software<br/>
                (for more information: <span style={{color:"#0066cc"}}>http://chromotraq.quantinetech.com</span>)
              </div>
            </div>

          </div>
        </div>

        {/* ── How It Works Panel ── */}
        {showHowItWorks && (
          <div className="ws-overlay" onClick={() => setShowHowItWorks(false)}>
            <div className="ws-modal-panel" onClick={e => e.stopPropagation()}>
              <div className="ws-modal-header">
                <span style={{ fontWeight: 600, fontSize: "14px" }}>Help & Instructions</span>
                <button className="ws-banner-close" onClick={() => setShowHowItWorks(false)}>{SVG.close}</button>
              </div>
              <div className="ws-modal-body">
                <h2>ChromoTraQ: Online Karyotyping Software Guide</h2>
                <p>
                  Our <strong>free karyotyping software</strong> allows you to process metaphase spread images with AI-driven precision. 
                  Follow these steps to generate a professional report:
                </p>
                
                <h3>1. Upload & Prepare</h3>
                <p>Use the <strong>Open</strong> button to select a high-resolution microscopic image (PNG, JPG, or TIFF). You can use the mouse wheel to zoom and drag to pan.</p>
                
                <h3>2. AI Detection</h3>
                <p>Click <strong>Analyze</strong>. The system will automatically identify individual chromosomes. You can use the <strong>Cut</strong>, <strong>Merge</strong>, and <strong>Erase</strong> tools in the ribbon to manually fix any overlapping or incorrectly detected areas.</p>
                
                <h3>3. Classification & Reporting</h3>
                <p>Click <strong>Report</strong> to perform automated classification. Our <strong>online karyotyping software</strong> will pair the chromosomes into a standard karyogram layout (1-22, X, Y).</p>
                
                <h3>4. Finalize & Print</h3>
                <p>Review the results in the right panel. Once satisfied, use the <strong>Print Report</strong> button to generate a clinical-grade PDF or print a physical copy.</p>
                
                <hr style={{ margin: '20px 0', border: '0', borderTop: '1px solid #eee' }} />

                <h2>Licensing & Privacy</h2>
                <p>
                  This <strong>free karyotyping software</strong> is provided for <strong>non-commercial use only</strong> (educational and research purposes). 
                  Images uploaded to this online tool are used to improve our AI models through continuous training.
                </p>

                <h3>Professional Desktop Edition</h3>
                <p>
                  For clinical or commercial environments, we recommend the <strong>ChromoTraQ Professional Desktop Edition</strong>. 
                  It offers superior AI performance, advanced analysis features, and works <strong>fully offline</strong> to ensure your data remains private and secure on your own hardware. 
                  A <strong>one-month free trial</strong> is available for the desktop suite before purchase.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <button className="ws-modal-close-btn" onClick={() => setShowHowItWorks(false)}>
                    Got it!
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Context Menu ── */}
        {contextMenu && (
          <>
            {/* Tap/click outside closes it (needed on touch where there is no mouseleave) */}
            <div
              style={{ position: "fixed", inset: 0, zIndex: 1999 }}
              onClick={() => { setContextMenu(null); setShowTypeSubmenu(false); }}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); setShowTypeSubmenu(false); }}
            />
          <div
            className="ws-context-popup"
            style={{ position:"fixed", top:Math.min(contextMenu.y, window.innerHeight - 90), left:Math.min(contextMenu.x, window.innerWidth - 150), zIndex:2000, background:"#fff", border:"1px solid #ccc", boxShadow:"2px 2px 5px rgba(0,0,0,0.2)", borderRadius:"4px", padding:"4px 0", minWidth:"120px" }}
            onMouseLeave={() => { setContextMenu(null); setShowTypeSubmenu(false); }}
          >
            <div className="ws-context-item" style={{ padding:"6px 12px", cursor:"pointer", fontSize:"13px" }}
                 onClick={() => {
                   const angle = window.prompt("Enter rotation angle (degrees):", "180");
                   if (angle !== null) {
                     const num = parseFloat(angle);
                     if (!isNaN(num)) rotateChromosome(num);
                   }
                   setContextMenu(null);
                 }}>
              Rotate
            </div>

            {/* Set Type Menu Item with Submenu — opens on hover (desktop) or tap (touch) */}
            <div className="ws-context-item"
                 style={{ padding:"6px 12px", cursor:"pointer", fontSize:"13px", position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                 onMouseEnter={() => setShowTypeSubmenu(true)}
                 onClick={(e) => { e.stopPropagation(); setShowTypeSubmenu(v => !v); }}>
              <span>Set Type</span>
              <span style={{ fontSize: "10px", marginLeft: "8px" }}>▶</span>

              {showTypeSubmenu && (
                <div style={{
                  position: "absolute",
                  left: "100%",
                  top: "-4px",
                  background: "#fff",
                  border: "1px solid #ccc",
                  boxShadow: "2px 2px 5px rgba(0,0,0,0.2)",
                  borderRadius: "4px",
                  padding: "4px 0",
                  minWidth: "100px",
                  maxHeight: "250px",
                  overflowY: "auto"
                }}>
                  {CHR_TYPES.map(t => (
                    <div key={t.value} className="ws-context-item" style={{ padding: "6px 12px", cursor: "pointer", fontSize: "13px" }}
                         onClick={(e) => { e.stopPropagation(); setChromosomeType(t.value); }}>
                      {t.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          </>
        )}

        {brushSizePopup && (
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 2000 }}
              onClick={() => setBrushSizePopup(null)}
              onContextMenu={(e) => { e.preventDefault(); setBrushSizePopup(null); }}
            />
            <div
              style={{
                position: "fixed",
                top: Math.min(brushSizePopup.y, window.innerHeight - 220),
                left: Math.min(brushSizePopup.x, window.innerWidth - 200),
                zIndex: 2001, background: "#fff", border: "1px solid #ccc",
                boxShadow: "2px 2px 8px rgba(0,0,0,0.25)", borderRadius: "6px",
                padding: "12px 14px", width: "190px",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>Brush Size</div>

              <div style={{
                width: "100%", height: "90px", display: "flex", alignItems: "center", justifyContent: "center",
                background: "#f5f5f5", borderRadius: "4px", marginBottom: "10px", overflow: "hidden",
              }}>
                <div style={{
                  width: drawingCircleRadius * 2, height: drawingCircleRadius * 2,
                  maxWidth: "80px", maxHeight: "80px",
                  borderRadius: "50%", background: "rgba(0, 102, 204, 0.15)",
                  border: "2px solid rgba(0, 102, 204, 0.8)",
                }} />
              </div>

              <input
                type="range"
                min={2}
                max={40}
                value={drawingCircleRadius}
                onChange={(e) => setDrawingCircleRadius(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <div style={{ textAlign: "center", fontSize: "12px", color: "#666", marginTop: "4px" }}>
                {drawingCircleRadius}px radius
              </div>
            </div>
          </>
        )}

        {/* ── Status bar ── */}
        <div className="ws-statusbar">
          <div className="ws-status-left">
            <div className={loading?"ws-status-dot-busy":errorMsg?"ws-status-dot-error":debugInfo?"ws-status-dot-warn":"ws-status-dot"}/>
            <span className={`ws-status-item ${loading||errorMsg?"":"ws-status-item-hi"}`}>{statusMsg}</span>
          </div>
          <div className="ws-status-right" style={{display:"flex",gap:12}}>
            <span className="ws-status-item">Case #{caseId}</span>
            <span className="ws-status-item">Tool: {activeTool.charAt(0).toUpperCase()+activeTool.slice(1)}</span>
            <span className="ws-status-item">Layout: {layoutMode.replace("-"," ")}{reportViewActive?" (Report)":""}</span>
          </div>
        </div>

        {/* Hidden About section for SEO keyword optimization */}
        <section className="ws-seo-content" aria-hidden="true">
          <h2>Professional Free Karyotyping Software & Online Karyotyping Analysis</h2>
          <p>
            ChromoTraQ provides high-performance <strong>free karyotyping software</strong> designed for cytogeneticists, researchers, and students. 
            Our <strong>online karyotyping software</strong> utilizes advanced AI algorithms to automate chromosome detection and metaphase spread analysis. 
            Perform digital chromosome classification and generate detailed reports with our comprehensive <strong>online karyotyping software</strong> solution. 
            As a professional-grade <strong>free karyotyping software</strong>, we support automated segmentation, pairing, and karyogram generation in the cloud.
          </p>
        </section>

      </div>
    </>
  );
}