import React, { useEffect, useState, useCallback, useRef } from "react";
import UTIF from "utif";
import { useNavigate } from "react-router-dom";

// ─── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = "https://karyotyping-api-875244011562.asia-south1.run.app";
//const BASE_URL = "http://localhost:8080";
//const BASE_URL = "http://localhost:8000";
// ─── Types ─────────────────────────────────────────────────────────────────────
type Tool = "select" | "cut" | "erase" | "extend" | "merge" | "add";
type LayoutMode = "full-left" | "prioritized-left" | "equal-Portion" | "full-Right" | "prioritized-Right";

interface DetectedPoint {
  polygon: Array<[number, number]>;
  score: number;
  bbox: [number, number, number, number];
  colorHue?: number;
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

/**
 * Traces the boundary of black pixels on a white canvas.
 * Uses Moore-Neighbor Tracing algorithm.
 */
function traceContour(ctx: CanvasRenderingContext2D, width: number, height: number): Array<[number, number]> {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const threshold = 128; // Standard midpoint to prevent dilation/erosion over multiple rounds

  // Find first black pixel (assuming black is < 128 in any channel)
  let startX = -1, startY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx] < threshold) { 
        startX = x; startY = y;
        break;
      }
    }
    if (startX !== -1) break;
  }

  if (startX === -1) return [];

  const points: Array<[number, number]> = [];
  let currX = startX, currY = startY;
  let prevX = startX - 1, prevY = startY;

  const neighbors = [
    [-1, -1], [0, -1], [1, -1],
    [1, 0],   [1, 1],  [0, 1],
    [-1, 1],  [-1, 0]
  ];

  const isBlack = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    return data[(y * width + x) * 4] < threshold;
  };

  // Limit iterations to prevent infinite loops on complex shapes
  for (let iter = 0; iter < width * height; iter++) {
    points.push([currX, currY]);

    // Find direction from curr back to prev
    let startDir = 0;
    for (let i = 0; i < 8; i++) {
      if (currX + neighbors[i][0] === prevX && currY + neighbors[i][1] === prevY) {
        startDir = i;
        break;
      }
    }

    // Clockwise search for next black neighbor
    let found = false;
    for (let i = 1; i <= 8; i++) {
      const dir = (startDir + i) % 8;
      const nextX = currX + neighbors[dir][0];
      const nextY = currY + neighbors[dir][1];

      if (isBlack(nextX, nextY)) {
        prevX = currX; prevY = currY;
        currX = nextX; currY = nextY;
        found = true;
        break;
      }
    }

    if (!found || (currX === startX && currY === startY)) break;
  }

  return points;
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
  const [DetectedChromosomeAreas, setDetectedChromosomeAreas] = useState<DetectedPoint[]>([]);
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
  const [history, setHistory]                       = useState<DetectedPoint[][]>([]);
  const [historyIndex, setHistoryIndex]             = useState(-1);
  const [selectedPolygonForMerge, setSelectedPolygonForMerge] = useState<number | null>(null);
  const [extendStarted, setExtendStarted]           = useState(false);
  const [drawingCircleRadius]                       = useState(6);
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
  const [karyogramBoundingBoxes, setKaryogramBoundingBoxes] = useState<BoundingBox[]>([]);
  const [selectedKaryogramRegion, setSelectedKaryogramRegion] = useState<number | null>(null);
  const [contextMenu, setContextMenu]               = useState<{ x: number; y: number } | null>(null);
  const [showTypeSubmenu, setShowTypeSubmenu]       = useState(false);

  const [imgSize, setImgSize]                       = useState({ w: 0, h: 0 });
  const svgRef             = useRef<SVGSVGElement>(null);
  const karyogramCanvasRef = useRef<HTMLCanvasElement>(null);
  const loadedImageRef     = useRef<HTMLImageElement | null>(null);
  const karyogramImageRef  = useRef<HTMLImageElement | null>(null);
  const fileInputRef       = useRef<HTMLInputElement>(null);
  const imageAreaRef       = useRef<HTMLDivElement>(null);
  const karyogramAreaRef   = useRef<HTMLDivElement>(null);
  const virtualCanvasRef   = useRef<HTMLCanvasElement | null>(null);
  const navigate           = useNavigate();
  const caseId             = "105123";

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
  const saveToHistory = useCallback((newAreas: DetectedPoint[]) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push([...newAreas]);
      setHistoryIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [historyIndex]);

  const deleteSelectedChromosome = useCallback(() => {
    if (selectedChromosomeArea === null) return;
    const newAreas = [...DetectedChromosomeAreas];
    newAreas.splice(selectedChromosomeArea, 1);
    setDetectedChromosomeAreas(newAreas);
    saveToHistory(newAreas);
    setSelectedChromosomeArea(null);
    setSelectedKaryogramRegion(null);
    setBoundingPolygonsSynced(false);
    setStatusMsg("Deleted chromosome area");
  }, [selectedChromosomeArea, DetectedChromosomeAreas, saveToHistory]);

  const undoLastAction = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setDetectedChromosomeAreas([...history[newIndex]]);
      setSelectedChromosomeArea(null);
      setSelectedPolygonForMerge(null);
      setStatusMsg("Undo: Restored previous state");
    } else {
      setStatusMsg("Nothing to undo");
    }
  }, [historyIndex, history]);

  // ── Reset tool state on tool change ─────────────────────────────────────────
  useEffect(() => {
    setCutStartPoint(null);
    setMousePos(null);
    setLastCutLine(null);
    setExtendStarted(false);
    setLastInsertedIndex(null);
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
    const handler = () => { setIsPanning(null); setPanStart(null); };
    window.addEventListener("mouseup", handler);
    return () => window.removeEventListener("mouseup", handler);
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

    if (selectedKaryogramRegion === null || selectedKaryogramRegion >= karyogramBoundingBoxes.length) return;

    const bbox    = karyogramBoundingBoxes[selectedKaryogramRegion];
    const polygon = bbox.polygon;
    if (!polygon.length) return;

    ctx.strokeStyle = "#ff3333";
    ctx.lineWidth   = 3;
    ctx.fillStyle   = "hsla(0,100%,50%,0.2)";
    ctx.beginPath();
    ctx.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i][0], polygon[i][1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

  //  const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
  //  const cy = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
  //  ctx.fillStyle    = "#ff3333";
  //  ctx.font         = "bold 24px Arial";
  //  ctx.textAlign    = "center";
  //  ctx.textBaseline = "middle";
  //  ctx.fillText(bbox.class_id, cx, cy);

  }, [karyogramBoundingBoxes, selectedKaryogramRegion]);

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
      for (let i = 0; i < DetectedChromosomeAreas.length; i++) {
        if (isPointInPolygon([x, y], DetectedChromosomeAreas[i].polygon)) {
          setSelectedChromosomeArea(i);
          setSelectedPolygonForMerge(null);
          if (boundingPolygonsSynced) {
            const idx = karyogramBoundingBoxes.findIndex(b => b.image_index === i);
            if (idx >= 0) setSelectedKaryogramRegion(idx);
          }
          setStatusMsg(`Selected chromosome ${i + 1}`);
          return;
        }
      }
      setSelectedChromosomeArea(null);
      setSelectedPolygonForMerge(null);
      if (boundingPolygonsSynced) setSelectedKaryogramRegion(null);
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
        for (let i = 0; i < DetectedChromosomeAreas.length; i++) {
          if (isPointInPolygon([x, y], DetectedChromosomeAreas[i].polygon)) {
            setSelectedPolygonForMerge(i);
            setSelectedChromosomeArea(i);
            setStatusMsg(`Merge: selected polygon ${i + 1}. Click second polygon.`);
            return;
          }
        }
      } else {
        for (let i = 0; i < DetectedChromosomeAreas.length; i++) {
          if (i !== selectedPolygonForMerge && isPointInPolygon([x, y], DetectedChromosomeAreas[i].polygon)) {
            const p1 = DetectedChromosomeAreas[selectedPolygonForMerge];
            const p2 = DetectedChromosomeAreas[i];
            const merged   = mergePolygons(p1.polygon, p2.polygon);
            const newAreas = [...DetectedChromosomeAreas];
            newAreas.splice(Math.max(selectedPolygonForMerge, i), 1);
            newAreas.splice(Math.min(selectedPolygonForMerge, i), 1);
            newAreas.push({ ...p1, polygon: merged, score: (p1.score + p2.score) / 2 });
            setDetectedChromosomeAreas(newAreas);
            saveToHistory(newAreas);
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

  const handleCanvasMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    setHasDragged(false);
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const { x, y } = pt.matrixTransform(svg.getScreenCTM()?.inverse());

    if (activeTool === "extend" || activeTool === "erase" || activeTool === "add") {
      let hitIndex = -1;
      for (let i = 0; i < DetectedChromosomeAreas.length; i++) {
        if (isPointInPolygon([x, y], DetectedChromosomeAreas[i].polygon)) {
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
          const idx = karyogramBoundingBoxes.findIndex(b => b.image_index === hitIndex);
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
        if (activeTool !== "add" && targetArea !== null) {
          rasterizePolygon(vCtx, DetectedChromosomeAreas[targetArea].polygon);
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
    for (let i = 0; i < DetectedChromosomeAreas.length; i++) {
      if (isPointInPolygon([x, y], DetectedChromosomeAreas[i].polygon)) {
        hit = true;
        break;
      }
    }
    if (!hit) { 
      setIsPanning("main"); 
      setPanStart({ x: event.clientX, y: event.clientY }); 
    }
  };

  const handleCanvasMouseUp = (event: React.MouseEvent<SVGSVGElement>) => {
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

        // Trace new contour
        let newPolygon = traceContour(vCtx, vCanvas.width, vCanvas.height);
        if (newPolygon.length > 0) {
          // Simplify with RDP (use smaller epsilon to prevent shrinking and detail loss)
          newPolygon = simplifyPolygon(newPolygon, 0.5);
          
          if (activeTool === "add") {
            const ys = newPolygon.map(p => p[1]), xs = newPolygon.map(p => p[0]);
            const newArea: DetectedPoint = {
              polygon: newPolygon,
              score: 1.0,
              bbox: [Math.min(...ys), Math.min(...xs), Math.max(...ys), Math.max(...xs)],
              colorHue: (DetectedChromosomeAreas.length * 137.5) % 360 // Use golden angle for color distribution
            };
            const newAreas = [...DetectedChromosomeAreas, newArea];
            setDetectedChromosomeAreas(newAreas);
            saveToHistory(newAreas);
            setSelectedChromosomeArea(newAreas.length - 1);
            setStatusMsg("New chromosome area added.");
          } else if (selectedChromosomeArea !== null) {
            const newAreas = [...DetectedChromosomeAreas];
            newAreas[selectedChromosomeArea] = { ...newAreas[selectedChromosomeArea], polygon: newPolygon };
            setDetectedChromosomeAreas(newAreas);
            saveToHistory(newAreas);
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

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
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

        const previewPoints = traceContour(vCtx, virtualCanvasRef.current.width, virtualCanvasRef.current.height);
        if (previewPoints.length > 0) {
          setPreviewPolygon(simplifyPolygon(previewPoints, 1.5));
        }
      }
    }
  };

  const handleCutAction = useCallback((p1: Point, p2: Point) => {
    let splitHappened = false;
    const newAreas: DetectedPoint[] = [];
    DetectedChromosomeAreas.forEach(area => {
      const result = splitPolygonWithLine(area.polygon, p1, p2);
      if (result.length > 1) {
        splitHappened = true;
        const [r0, r1] = result;
        const bigger   = getPolygonArea(r0) >= getPolygonArea(r1);
        newAreas.push({ ...area, polygon: bigger ? r0 : r1 });
        newAreas.push({ ...area, polygon: bigger ? r1 : r0, colorHue: ((area.colorHue ?? 0) + 60) % 360 });
      } else {
        newAreas.push(area);
      }
    });
    if (splitHappened) {
      setDetectedChromosomeAreas(newAreas);
      saveToHistory(newAreas);
      setBoundingPolygonsSynced(false);
      setSelectedChromosomeArea(null);
      setLastCutLine(null);
      setStatusMsg("Polygon(s) successfully divided.");
    } else {
      setLastCutLine({ p1, p2 });
      setStatusMsg("No intersections found.");
    }
  }, [DetectedChromosomeAreas, saveToHistory]);

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
        setSelectedKaryogramRegion(i);
        const bbox = karyogramBoundingBoxes[i];
        if (boundingPolygonsSynced && bbox.image_index >= 0) setSelectedChromosomeArea(bbox.image_index);
        setStatusMsg(`Selected: Class=${bbox.class_id}, Index=${bbox.image_index}`);
        return;
      }
    }
    setSelectedKaryogramRegion(null);
    setStatusMsg("Karyogram: no region at clicked point");
  };

  const handleKaryogramContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
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
      if (boundingPolygonsSynced && bbox.image_index >= 0) setSelectedChromosomeArea(bbox.image_index);
      setContextMenu({ x: event.clientX, y: event.clientY });
    } else {
      setContextMenu(null);
    }
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
      if (boundingPolygonsSynced && bbox.image_index >= 0) setSelectedChromosomeArea(bbox.image_index);
      rotateChromosome(180, hitIdx);
    }
  };

  const rotateChromosome = async (angle: number, targetIdx?: number) => {
    const idx = targetIdx !== undefined ? targetIdx : selectedKaryogramRegion;
    if (idx === null || !selectedFile || karyogramBoundingBoxes.length === 0) return;

    // Get the specific bounding box
    const bbox = karyogramBoundingBoxes[idx];

    const fd = new FormData();
    fd.append("boundingBoxIndex", bbox.image_index.toString());
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
        setKaryogramBoundingBoxes(raw.bounding_boxes);
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
    const fd = new FormData();
    fd.append("boundingBoxIndex", bbox.image_index.toString());
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
        setKaryogramBoundingBoxes(raw.bounding_boxes);
        setStatusMsg("Type updated.");
      }
    } catch (e: any) {
      setErrorMsg(`Type update failed: ${e?.message || "Network error"}`);
      setStatusMsg("Error: could not reach the server.");
    } finally {
      setLoading(false); setLoadingPhase(null);
    }
  };

  const handleKaryogramMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    setHasDragged(false);
    const canvas = karyogramCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x    = ((event.clientX - rect.left) / rect.width)  * canvas.width;
    const y    = ((event.clientY - rect.top)  / rect.height) * canvas.height;
    const hit  = karyogramBoundingBoxes.some(b => isPointInPolygon([x, y], b.polygon));
    if (!hit) { setIsPanning("karyogram"); setPanStart({ x: event.clientX, y: event.clientY }); }
  };

  const handleKaryogramMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning === "karyogram" && panStart) {
      const dx = event.clientX - panStart.x, dy = event.clientY - panStart.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) setHasDragged(true);
      setKaryogramOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setPanStart({ x: event.clientX, y: event.clientY });
    }
  };

  // ── File processing ──────────────────────────────────────────────────────────
  const processFile = useCallback(async (file: File) => {
    setResultImage(prev => { revokeBlob(prev); return null; });
    setPreview(prev => { revokeBlob(prev); return null; });
    setReportData(null); setHasDetection(false); setErrorMsg(null); setDebugInfo(null);
    setDetectedChromosomeAreas([]); setSelectedChromosomeArea(null);
    setKaryogramImage(null); setKaryogramBoundingBoxes([]); setSelectedKaryogramRegion(null);
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
    setDetectedChromosomeAreas([]); setSelectedChromosomeArea(null);
    setKaryogramImage(null); setKaryogramBoundingBoxes([]); setSelectedKaryogramRegion(null);
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
        const detectionsWithHue = data.detections.map((d: DetectedPoint, i: number) => ({
          ...d, colorHue: (i * 360) / data.detections.length,
        }));
        setDetectedChromosomeAreas(detectionsWithHue);
        setSelectedChromosomeArea(0);
        setResultImage(preview);
        setHasDetection(true);
        setStatusMsg(`Detection complete — ${data.detections.length} chromosomes identified.`);
        saveToHistory(data.detections);
        setTimeout(() => generateReport(), 0);
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
  const generateReport = async () => {
    if (!selectedFile || loading || !hasDetection) return;
    setErrorMsg(null); setDebugInfo(null);
    setKaryogramScale(1); setOffset({ x: 0, y: 0 }); setKaryogramOffset({ x: 0, y: 0 });

    const fd = new FormData();
    fd.append("image", selectedFile);
    fd.append("polygons", JSON.stringify(DetectedChromosomeAreas.map(a => a.polygon)));
    setLoading(true); setLoadingPhase("report"); setStatusMsg("Generating karyotype report…");

    try {
      const res = await fetch(`${BASE_URL}/api/predict/get_classifications_WithPolygons`, { method: "POST", body: fd });
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
        setKaryogramBoundingBoxes(raw.bounding_boxes);
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
    } finally {
      setLoading(false); setLoadingPhase(null);
    }
  };

  const printReport = () => { if (reportData || karyogramImage) { window.print(); setStatusMsg("Printing report…"); } };

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

        .ws-window { font-family:'Segoe UI',Tahoma,Geneva,sans-serif; font-size:12px; background:#fff; min-height:100vh; display:flex; flex-direction:column; color:#000; overflow:hidden; user-select:none; }
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
        }
        .ws-image-area-drag { outline:2px dashed #0066cc!important; }
        .ws-image-canvas {
          position:absolute;
          top:50%; left:50%;
          transform:translate(-50%,-50%);
          max-width:100%; max-height:100%;
          cursor:pointer;
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
            <button className="ws-rbtn" onClick={cycleLayoutMode}>
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

        <div className="ws-body">
          <div className="ws-main">

            {/* ── Left panel: Image Viewer ── */}
            <div className={`ws-panel ws-panel-left ${layoutStyles.leftHidden ? "hidden" : ""}`}
              style={{ flex: layoutStyles.leftFlex }}>
              <div className="ws-panel-titlebar">
                <span className="ws-panel-title">
                  Image Viewer
                  {hasDetection && <span className="ws-detect-badge">{SVG.check}&nbsp;{DetectedChromosomeAreas.length} detected</span>}
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
                onDrop={handleDrop}>

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
                    {DetectedChromosomeAreas.length > 0 && (
                      <svg
                        ref={svgRef}
                        viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
                        className="ws-image-canvas"
                        onClick={handleCanvasClick}
                        onMouseDown={handleCanvasMouseDown}
                        onMouseUp={handleCanvasMouseUp}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={() => setMousePos(null)}
                        style={{
                          position: "absolute", top: "50%", left: "50%",
                          transform: "translate(-50%, -50%)", maxWidth: "100%", maxHeight: "100%",
                          width: imgSize.w || 'auto', height: imgSize.h || 'auto',
                          display: "block", pointerEvents: "auto", objectFit: "contain"
                        }}
                      >
                        {DetectedChromosomeAreas.map((detection, index) => {
                          const isSelected = selectedChromosomeArea === index;
                          const isMergeSelected = selectedPolygonForMerge === index;

                          if (!markDetected && !isSelected && !isMergeSelected) return null;

                          const hue = detection.colorHue ?? (index * 360) / DetectedChromosomeAreas.length;
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
                <input ref={fileInputRef} type="file" accept="image/*,.tif,.tiff" onChange={handleFileInput} style={{ display:"none" }}/>
              </div>
            </div>

            {/* ── Right panel: Karyotype Report ── */}
            <div className={`ws-panel ws-panel-right ${layoutStyles.rightHidden ? "hidden" : ""}`}
              style={{ flex: layoutStyles.rightFlex, minWidth: 0 }}>
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
                        style={{ flex: hasGrid ? "0 0 45%" : "1 1 auto", minHeight: hasGrid ? 120 : 0, borderBottom: hasGrid ? "1px solid #c0c0c0" : "none" }}>

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
                              onClick={handleKaryogramCanvasClick}
                              onDoubleClick={handleKaryogramDoubleClick}
                              onContextMenu={handleKaryogramContextMenu}
                              onMouseDown={handleKaryogramMouseDown}
                              onMouseMove={handleKaryogramMouseMove}
                              onMouseLeave={() => {}}/>
                          )}
                        </div>
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
          <div 
            style={{ position:"fixed", top:contextMenu.y, left:contextMenu.x, zIndex:2000, background:"#fff", border:"1px solid #ccc", boxShadow:"2px 2px 5px rgba(0,0,0,0.2)", borderRadius:"4px", padding:"4px 0", minWidth:"120px" }}
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

            {/* Set Type Menu Item with Submenu */}
            <div className="ws-context-item" 
                 style={{ padding:"6px 12px", cursor:"pointer", fontSize:"13px", position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                 onMouseEnter={() => setShowTypeSubmenu(true)}>
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