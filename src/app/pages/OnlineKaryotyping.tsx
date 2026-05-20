import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import UTIF from "utif";
import { useNavigate } from "react-router-dom";

// ─── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = "https://karyotyping-api-875244011562.asia-south1.run.app";
//const BASE_URL = "http://localhost:8080";

// ─── Types ─────────────────────────────────────────────────────────────────────
type Tool = "select" | "cut" | "erase" | "extend" | "merge";
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

// ─── Chromosome grid layout ────────────────────────────────────────────────────
// FIX #2: Correct row distribution:
//   Row 1 → 5 pairs  (1–5)
//   Row 2 → 7 pairs  (6–12)
//   Row 3 → 6 pairs  (13–18)   ← was missing 18 in original
//   Row 4 → 4 pairs + X + Y    (19–22, X, Y)
const CHROMOSOME_ROWS = [
  ["1", "2", "3", "4", "5"],
  ["6", "7", "8", "9", "10", "11", "12"],
  ["13", "14", "15", "16", "17", "18"],
  ["19", "20", "21", "22", "X", "Y"],
];

// ─── Normalize chromosome image keys from backend ─────────────────────────────
const NORMALIZE_CHR_KEY: Record<string, string> = {
  "23": "X",
  "24": "Y",
  "x": "X",
  "y": "Y",
};

function normalizeChrKey(key: string): string {
  return NORMALIZE_CHR_KEY[key] ?? key;
}

function normalizeChromosomeImages(
  raw: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(raw).forEach(([k, v]) => {
    out[normalizeChrKey(k)] = v;
  });
  return out;
}

// ─── Toolbar / Ribbon items ────────────────────────────────────────────────────
const RIBBON_TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: "select", label: "Select", icon: "⊹" },
  { id: "cut", label: "Cut", icon: "✂" },
  { id: "erase", label: "Erase", icon: "◫" },
  { id: "extend", label: "Extend", icon: "⤢" },
  { id: "merge", label: "Merge", icon: "⊕" },
];

// ─── SVG Icons ─────────────────────────────────────────────────────────────────
const SVG = {
  close: <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.4" /><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.4" /></svg>,
  folder: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 7h4l2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" /></svg>,
  run: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>,
  report: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /><polyline points="14 2 14 8 20 8" /></svg>,
  dna: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 3c0 0 2 2 2 5s-2 5-2 5 2 2 2 5-2 5-2 5" /><path d="M19 3c0 0-2 2-2 5s2 5 2 5-2 2-2 5 2 5 2 5" /><line x1="7" y1="8" x2="17" y2="8" /><line x1="7" y1="16" x2="17" y2="16" /></svg>,
  check: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>,
  upload: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>,
  warn: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  info: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>,
  layout: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>,
  fullscreen: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>,
  undo: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>,
};

// ─── Spinner ────────────────────────────────────────────────────────────────────
function WinSpinner() {
  return (
    <div style={{
      width: 32, height: 32,
      border: "3px solid #d0d0d0",
      borderTopColor: "#0066cc",
      borderRadius: "50%",
      animation: "ws-spin .7s linear infinite",
    }} />
  );
}

// ─── Helper: parse FastAPI error detail ───────────────────────────────────────
async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const txt = await res.text();
    if (!txt) return `Server error (${res.status})`;
    try {
      const json = JSON.parse(txt);
      return json?.detail || txt || `Server error (${res.status})`;
    } catch {
      return txt || `Server error (${res.status})`;
    }
  } catch {
    return `Server error (${res.status})`;
  }
}

// ─── Helper: safely revoke a blob URL ─────────────────────────────────────────
function revokeBlob(url: string | null) {
  if (url && url.startsWith("blob:")) {
    try { URL.revokeObjectURL(url); } catch { }
  }
}

// ─── Polygon manipulation utilities ────────────────────────────────────────────
function polygonToPoints(polygon: Array<[number, number]>): Point[] {
  return polygon.map(p => ({ x: p[0], y: p[1] }));
}

function pointsToPolygon(points: Point[]): Array<[number, number]> {
  return points.map(p => [p.x, p.y]);
}

function pointToLineDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const len2 = C * C + D * D;
  let param = -1;
  if (len2 !== 0) param = dot / len2;

  let xx, yy;
  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

function findClosestPolygonEdge(polygon: Array<[number, number]>, clickPoint: Point): { edgeIndex: number, insertIndex: number } {
  let minDistance = Infinity;
  let closestEdgeIndex = -1;
  let insertPosition = -1;

  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    const p1Point = { x: p1[0], y: p1[1] };
    const p2Point = { x: p2[0], y: p2[1] };
    const distance = pointToLineDistance(clickPoint, p1Point, p2Point);

    if (distance < minDistance) {
      minDistance = distance;
      closestEdgeIndex = i;
      insertPosition = i + 1;
    }
  }

  return { edgeIndex: closestEdgeIndex, insertIndex: insertPosition };
}

function getIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const dx12 = p2.x - p1.x;
  const dy12 = p2.y - p1.y;
  const dx34 = p4.x - p3.x;
  const dy34 = p4.y - p3.y;
  const denominator = dy34 * dx12 - dx34 * dy12;
  if (denominator === 0) return null;
  const ua = (dx34 * (p1.y - p3.y) - dy34 * (p1.x - p3.x)) / denominator;
  const ub = (dx12 * (p1.y - p3.y) - dy12 * (p1.x - p3.x)) / denominator;
  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return { x: p1.x + ua * dx12, y: p1.y + ua * dy12 };
  }
  return null;
}

function splitPolygonWithLine(polygon: Array<[number, number]>, p1: Point, p2: Point): Array<Array<[number, number]>> {
  const intersections: { point: [number, number], index: number }[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const start = { x: polygon[i][0], y: polygon[i][1] };
    const end = { x: polygon[(i + 1) % polygon.length][0], y: polygon[(i + 1) % polygon.length][1] };
    const intersect = getIntersection(p1, p2, start, end);
    if (intersect) {
      const isDuplicate = intersections.some(item => 
        Math.abs(item.point[0] - intersect.x) < 0.01 && Math.abs(item.point[1] - intersect.y) < 0.01
      );
      if (!isDuplicate) {
        intersections.push({ point: [intersect.x, intersect.y], index: i });
      }
    }
  }

  if (intersections.length === 2) {
    // Sort intersections by their original index in the polygon
    intersections.sort((a, b) => a.index - b.index);
    const i1 = intersections[0];
    const i2 = intersections[1];
    
    // Create two new cycles
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

function erasePolygon(polygon: Array<[number, number]>, erasePoint: Point, eraserRadius: number = 20): Array<Array<[number, number]>> {
  if (!isPointInPolygon([erasePoint.x, erasePoint.y], polygon)) {
    return [polygon];
  }
  const filteredPolygon = polygon.filter(point => {
    const dx = point[0] - erasePoint.x;
    const dy = point[1] - erasePoint.y;
    return Math.sqrt(dx * dx + dy * dy) > eraserRadius;
  });
  if (filteredPolygon.length >= 3) {
    return [filteredPolygon];
  }
  return [polygon];
}

function extendPolygon(polygon: Array<[number, number]>, extendPoint: Point): Array<[number, number]> {
  const { insertIndex } = findClosestPolygonEdge(polygon, extendPoint);
  const newPolygon = [...polygon];
  if (insertIndex <= newPolygon.length) {
    newPolygon.splice(insertIndex, 0, [extendPoint.x, extendPoint.y]);
  }
  return newPolygon;
}

function mergePolygons(polygon1: Array<[number, number]>, polygon2: Array<[number, number]>): Array<[number, number]> {
  let minDistance = Infinity;
  let closestPoint1 = -1;
  let closestPoint2 = -1;

  for (let i = 0; i < polygon1.length; i++) {
    for (let j = 0; j < polygon2.length; j++) {
      const dx = polygon1[i][0] - polygon2[j][0];
      const dy = polygon1[i][1] - polygon2[j][1];
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint1 = i;
        closestPoint2 = j;
      }
    }
  }

  if (minDistance < 50) {
    const merged = [
      ...polygon1.slice(0, closestPoint1 + 1),
      ...polygon2.slice(closestPoint2),
      ...polygon2.slice(0, closestPoint2 + 1),
      ...polygon1.slice(closestPoint1)
    ];
    return merged;
  }
  return polygon1;
}

function isPointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function getPolygonArea(polygon: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    area += (x1 * y2 - x2 * y1);
  }
  return Math.abs(area) / 2;
}

export function OnlineKaryotyping() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [hasDetection, setHasDetection] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<"analysis" | "report" | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [dragOver, setDragOver] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Ready");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [DetectedChromosomeAreas, setDetectedChromosomeAreas] = useState<DetectedPoint[]>([]);
  const [scale, setScale] = useState(1);
  const [karyogramScale, setKaryogramScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [karyogramOffset, setKaryogramOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<"main" | "karyogram" | null>(null);
  const [panStart, setPanStart] = useState<Point | null>(null);
  const [hasDragged, setHasDragged] = useState(false);
  const [selectedChromosomeArea, setSelectedChromosomeArea] = useState<number | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("prioritized-left");
  const [karyogramImage, setKaryogramImage] = useState<string | null>(null);
  const [history, setHistory] = useState<DetectedPoint[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedPolygonForMerge, setSelectedPolygonForMerge] = useState<number | null>(null);
  const [extendStarted, setExtendStarted] = useState(false);
  const [lastInsertedIndex, setLastInsertedIndex] = useState<number | null>(null);
  const [cutStartPoint, setCutStartPoint] = useState<Point | null>(null);
  const [mousePos, setMousePos] = useState<Point | null>(null);
  const [lastCutLine, setLastCutLine] = useState<{ p1: Point, p2: Point } | null>(null);

  // FIX #3: Track whether report view is active to adjust panel sizes
  const [reportViewActive, setReportViewActive] = useState(false);

  // Synchronization flag: true when bounding polygons from main image and karyogram are in sync
  const [boundingPolygonsSynced, setBoundingPolygonsSynced] = useState(false);

  // Karyogram bounding boxes and selection
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
  const [karyogramBoundingBoxes, setKaryogramBoundingBoxes] = useState<BoundingBox[]>([]);
  const [selectedKaryogramRegion, setSelectedKaryogramRegion] = useState<number | null>(null);

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const karyogramCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const karyogramImageRef = useRef<HTMLImageElement | null>(null);
  const karyogramAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageAreaRef = useRef<HTMLDivElement>(null);
  // Store karyogram container dimensions for accurate click coordinate scaling
  const karyogramDisplayDimsRef = useRef<{ width: number; height: number } | null>(null);
  const navigate = useNavigate();
  const caseId = "105123";

  // Save state to history
  const saveToHistory = useCallback((newAreas: DetectedPoint[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push([...newAreas]);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  // Undo last action
  const undoLastAction = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setDetectedChromosomeAreas([...history[newIndex]]);
      setSelectedChromosomeArea(null);
      setSelectedPolygonForMerge(null);
      if (resultImage) {
        const img = new Image();
        img.onload = () => drawPolygons(img);
        img.src = resultImage;
      }
      setStatusMsg(`Undo: Restored previous state`);
    } else {
      setStatusMsg(`Nothing to undo`);
    }
  }, [historyIndex, history, resultImage]);

  // Reset specialized interaction states when changing tools
  useEffect(() => {
    setCutStartPoint(null);
    setMousePos(null);
    setLastCutLine(null);
    setExtendStarted(false);
    setLastInsertedIndex(null);
  }, [activeTool]);

  // Use a native event listener to allow preventDefault() on wheel events,
  // which is often restricted in React's synthetic event system for performance.
  useEffect(() => {
    const el = imageAreaRef.current;
    if (!el) return;

    const handleNativeWheel = (e: WheelEvent) => {
      if (selectedFile) {
        e.preventDefault(); // Stop entire page from scrolling while zooming
        const zoomFactor = 1.1;
        if (e.deltaY < 0) {
          setScale(prev => Math.min(prev * zoomFactor, 10));
        } else {
          setScale(prev => Math.max(prev / zoomFactor, 0.2));
        }
      }
    };

    el.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleNativeWheel);
  }, [selectedFile]);

  // Karyogram zoom wheel effect
  useEffect(() => {
    const el = karyogramAreaRef.current;
    if (!el) return;

    const handleKaryogramWheel = (e: WheelEvent) => {
      if (karyogramImage) {
        e.preventDefault();
        const zoomFactor = 1.1;
        if (e.deltaY < 0) {
          setKaryogramScale(prev => Math.min(prev * zoomFactor, 10));
        } else {
          setKaryogramScale(prev => Math.max(prev / zoomFactor, 0.2));
        }
      }
    };

    el.addEventListener("wheel", handleKaryogramWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleKaryogramWheel);
  }, [karyogramImage]);

  // Global mouse up for panning
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsPanning(null);
      setPanStart(null);
    };
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  // ── Cleanup blob URLs ────────────────────────────────────────────────────────
  useEffect(() => () => { revokeBlob(preview); }, [preview]);
  useEffect(() => () => { revokeBlob(resultImage); }, [resultImage]);
  useEffect(() => () => { revokeBlob(karyogramImage); }, [karyogramImage]);

  // ── Canvas click handler ─────────────────────────────────────────────────────
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (hasDragged) {
      setHasDragged(false);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    const x = (displayX / rect.width) * canvas.width;
    const y = (displayY / rect.height) * canvas.height;
    const clickPoint = { x, y };

    if (activeTool === "cut") {
      if (!cutStartPoint) {
        setCutStartPoint(clickPoint);
        setLastCutLine(null);
        setStatusMsg("Cut Tool: First point set. Move and click again to define cut line.");
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
          
          // If bounding polygons are synchronized, also select the corresponding karyogram region
          if (boundingPolygonsSynced) {
            const correspondingBBox = karyogramBoundingBoxes.findIndex(bbox => bbox.image_index === i);
            if (correspondingBBox >= 0) {
              setSelectedKaryogramRegion(correspondingBBox);
            }
          }
          
          setStatusMsg(`Selected chromosome ${i + 1}`);
          return;
        }
      }
      setSelectedChromosomeArea(null);
      setSelectedPolygonForMerge(null);
      if (boundingPolygonsSynced) {
        setSelectedKaryogramRegion(null);
      }
    } else if (activeTool === "erase" && selectedChromosomeArea !== null) {
      const selectedArea = DetectedChromosomeAreas[selectedChromosomeArea];
      const erasedPolygons = erasePolygon(selectedArea.polygon, clickPoint);
      const newAreas = [...DetectedChromosomeAreas];
      newAreas.splice(selectedChromosomeArea, 1, ...erasedPolygons.map(polygon => ({ ...selectedArea, polygon })));
      setDetectedChromosomeAreas(newAreas);
      saveToHistory(newAreas);
      setSelectedChromosomeArea(null);
      setBoundingPolygonsSynced(false);
      setStatusMsg(`Erased area from polygon`);
    } else if (activeTool === "extend") {
      let hitIndex: number | null = null;
      for (let i = 0; i < DetectedChromosomeAreas.length; i++) {
        if (isPointInPolygon([x, y], DetectedChromosomeAreas[i].polygon)) {
          hitIndex = i;
          break;
        }
      }

      if (!extendStarted) {
        if (hitIndex !== null) {
          // Inside a polygon: select it
          setSelectedChromosomeArea(hitIndex);
          setStatusMsg(`Extend Tool: Selected chromosome ${hitIndex + 1}. Click outside to start extending.`);
        } else if (selectedChromosomeArea !== null) {
          // Outside, and a polygon is selected: Start extending
          const polygon = DetectedChromosomeAreas[selectedChromosomeArea].polygon;
          let minDist = Infinity;
          let closestIdx = -1;

          for (let i = 0; i < polygon.length; i++) {
            const d = Math.sqrt(Math.pow(polygon[i][0] - x, 2) + Math.pow(polygon[i][1] - y, 2));
            if (d < minDist) {
              minDist = d;
              closestIdx = i;
            }
          }

          if (closestIdx !== -1) {
            const newPolygon = [...polygon];
            const insertAt = closestIdx + 1;
            newPolygon.splice(insertAt, 0, [x, y]);

            const newAreas = [...DetectedChromosomeAreas];
            newAreas[selectedChromosomeArea] = { ...newAreas[selectedChromosomeArea], polygon: newPolygon };
            
            setDetectedChromosomeAreas(newAreas);
            saveToHistory(newAreas);
            setBoundingPolygonsSynced(false);
            setExtendStarted(true);
            setLastInsertedIndex(insertAt);
            setStatusMsg(`Extend Tool: Started extending chromosome ${selectedChromosomeArea + 1}.`);
          }
        } else {
          setStatusMsg("Extend Tool: Select a polygon first by clicking inside it.");
        }
      } else {
        if (selectedChromosomeArea !== null && lastInsertedIndex !== null) {
          const polygon = DetectedChromosomeAreas[selectedChromosomeArea].polygon;
          const newPolygon = [...polygon];
          const insertAt = lastInsertedIndex + 1;
          newPolygon.splice(insertAt, 0, [x, y]);

          const newAreas = [...DetectedChromosomeAreas];
          newAreas[selectedChromosomeArea] = { ...newAreas[selectedChromosomeArea], polygon: newPolygon };
          
          setDetectedChromosomeAreas(newAreas);
          saveToHistory(newAreas);
          setBoundingPolygonsSynced(false);
          setLastInsertedIndex(insertAt);
          setStatusMsg(`Extend Tool: Added point to chromosome ${selectedChromosomeArea + 1}.`);
        }
      }
    } else if (activeTool === "merge") {
      if (selectedPolygonForMerge === null) {
        for (let i = 0; i < DetectedChromosomeAreas.length; i++) {
          if (isPointInPolygon([x, y], DetectedChromosomeAreas[i].polygon)) {
            setSelectedPolygonForMerge(i);
            setSelectedChromosomeArea(i);
            setStatusMsg(`Selected first polygon for merge (${i + 1}). Click on second polygon.`);
            return;
          }
        }
        setStatusMsg(`Select a polygon to start merge`);
      } else {
        for (let i = 0; i < DetectedChromosomeAreas.length; i++) {
          if (i !== selectedPolygonForMerge && isPointInPolygon([x, y], DetectedChromosomeAreas[i].polygon)) {
            const p1 = DetectedChromosomeAreas[selectedPolygonForMerge];
            const p2 = DetectedChromosomeAreas[i];
            const mergedPolygon = mergePolygons(p1.polygon, p2.polygon);
            const newAreas = [...DetectedChromosomeAreas];
            newAreas.splice(Math.max(selectedPolygonForMerge, i), 1);
            newAreas.splice(Math.min(selectedPolygonForMerge, i), 1);
            newAreas.push({ ...p1, polygon: mergedPolygon, score: (p1.score + p2.score) / 2 });
            setDetectedChromosomeAreas(newAreas);
            saveToHistory(newAreas);
            setBoundingPolygonsSynced(false);
            setSelectedPolygonForMerge(null);
            setSelectedChromosomeArea(null);
            setStatusMsg(`Merged two polygons`);
            if (resultImage) { const img = new Image(); img.onload = () => drawPolygons(img); img.src = resultImage; }
            return;
          }
        }
        setStatusMsg(`Select a different polygon to merge`);
      }
    }
  };

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    setHasDragged(false);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    const x = (displayX / rect.width) * canvas.width;
    const y = (displayY / rect.height) * canvas.height;

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

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Panning logic
    if (isPanning === "main" && panStart) {
      const dx = event.clientX - panStart.x;
      const dy = event.clientY - panStart.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        setHasDragged(true);
      }
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setPanStart({ x: event.clientX, y: event.clientY });
      return; // Prioritize panning over tool preview
    }

    if (activeTool === "cut" && cutStartPoint) {
      const rect = canvas.getBoundingClientRect();
      const displayX = event.clientX - rect.left;
      const displayY = event.clientY - rect.top;
      const x = (displayX / rect.width) * canvas.width;
      const y = (displayY / rect.height) * canvas.height;
      setMousePos({ x, y });
    }
  };

  const handleCutAction = useCallback((p1: Point, p2: Point) => {
    let splitHappened = false;
    const newAreas: DetectedPoint[] = [];
    
    DetectedChromosomeAreas.forEach(area => {
      const result = splitPolygonWithLine(area.polygon, p1, p2);
      if (result.length > 1) {
        splitHappened = true;
        const a0 = getPolygonArea(result[0]);
        const a1 = getPolygonArea(result[1]);
        
        if (a0 >= a1) {
          // result[0] is bigger, keep original colorHue
          newAreas.push({ ...area, polygon: result[0] });
          // result[1] is smaller, assign new colorHue (shifted by 60 deg)
          newAreas.push({ ...area, polygon: result[1], colorHue: ((area.colorHue ?? 0) + 60) % 360 });
        } else {
          // result[1] is bigger, keep original colorHue
          newAreas.push({ ...area, polygon: result[1] });
          // result[0] is smaller, assign new colorHue
          newAreas.push({ ...area, polygon: result[0], colorHue: ((area.colorHue ?? 0) + 60) % 360 });
        }
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
      setStatusMsg("No intersections found; segment remains as guide.");
    }
  }, [DetectedChromosomeAreas, saveToHistory]);

  const drawPolygons = useCallback((imageElement: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = imageElement.width;
    canvas.height = imageElement.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    DetectedChromosomeAreas.forEach((detection, index) => {
      const polygon = detection.polygon;
      if (polygon.length === 0) return;
      const isSelected = selectedChromosomeArea === index;
      const isMergeSelected = selectedPolygonForMerge === index;
      const hue = detection.colorHue ?? (index * 360) / DetectedChromosomeAreas.length;
      const strokeOpacity = isSelected ? 1.0 : 0.5;
      ctx.strokeStyle = isMergeSelected ? `hsla(0, 100%, 50%, ${strokeOpacity})` : `hsla(${hue}, 100%, 50%, ${strokeOpacity})`;
      ctx.lineWidth = isSelected ? 4 : isMergeSelected ? 4 : 1;
      ctx.fillStyle = `hsla(${hue}, 0%, 50%, 0.05)`;
      ctx.beginPath();
      ctx.moveTo(polygon[0][0], polygon[0][1]);
      for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i][0], polygon[i][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    // Draw cut tool dotted line (preview or last attempted)
    const lineToDraw = (cutStartPoint && mousePos) ? { p1: cutStartPoint, p2: mousePos } : lastCutLine;
    if (lineToDraw && activeTool === "cut") {
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "red";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lineToDraw.p1.x, lineToDraw.p1.y);
      ctx.lineTo(lineToDraw.p2.x, lineToDraw.p2.y);
      ctx.stroke();
      ctx.restore();
    }
  }, [DetectedChromosomeAreas, selectedChromosomeArea, selectedPolygonForMerge, cutStartPoint, mousePos, lastCutLine, activeTool]);

  // ── Draw bounding boxes on karyogram ─────────────────────────────────────────
 const drawKaryogramBounds = useCallback(() => {
  const canvas = karyogramCanvasRef.current;
  if (!canvas) return;

  const container = canvas.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const displayWidth = rect.width;
  const displayHeight = rect.height;

  karyogramDisplayDimsRef.current = { width: displayWidth, height: displayHeight };

  canvas.width = displayWidth;
  canvas.height = displayHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const img = karyogramImageRef.current;
  if (!img) return;

  // Compute rendered image rect inside container, respecting object-fit: contain
  const naturalAspect = img.naturalWidth / img.naturalHeight;
  const containerAspect = displayWidth / displayHeight;

  let renderedWidth: number, renderedHeight: number, offsetX: number, offsetY: number;

  if (naturalAspect > containerAspect) {
    renderedWidth = displayWidth;
    renderedHeight = displayWidth / naturalAspect;
    offsetX = 0;
    offsetY = (displayHeight - renderedHeight) / 2;
  } else {
    renderedHeight = displayHeight;
    renderedWidth = displayHeight * naturalAspect;
    offsetX = (displayWidth - renderedWidth) / 2;
    offsetY = 0;
  }

  const scaleX = renderedWidth / img.naturalWidth;
  const scaleY = renderedHeight / img.naturalHeight;

  if (selectedKaryogramRegion !== null && selectedKaryogramRegion < karyogramBoundingBoxes.length) {
    const bbox = karyogramBoundingBoxes[selectedKaryogramRegion];
    const polygon = bbox.polygon;

    if (polygon.length > 0) {
      // NO ctx transform here — the parent div's CSS transform handles pan/zoom
      ctx.strokeStyle = "#ff3333";
      ctx.lineWidth = 2;
      ctx.fillStyle = "hsla(0, 100%, 50%, 0.2)";

      ctx.beginPath();
      ctx.moveTo(polygon[0][0] * scaleX + offsetX, polygon[0][1] * scaleY + offsetY);
      for (let i = 1; i < polygon.length; i++) {
        ctx.lineTo(polygon[i][0] * scaleX + offsetX, polygon[i][1] * scaleY + offsetY);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Label at centroid
      const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
      const cy = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;

      ctx.fillStyle = "#ff3333";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(bbox.class_id, cx * scaleX + offsetX, cy * scaleY + offsetY);
    }
  }
}, [karyogramBoundingBoxes, selectedKaryogramRegion, karyogramOffset, karyogramScale]);

  // ── Handle karyogram click ───────────────────────────────────────────────────
  const handleKaryogramClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
  if (hasDragged) {
    setHasDragged(false);
    return;
  }

  const canvas = karyogramCanvasRef.current;
  if (!canvas) return;

  const img = karyogramImageRef.current;
  if (!img) return;

  const displayDims = karyogramDisplayDimsRef.current;
  if (!displayDims) return;

  // getBoundingClientRect() gives the canvas rect AFTER CSS transform (zoom+pan).
  // So (clientX - rect.left) is already in "zoomed canvas" space.
  // Dividing by (rect.width / canvas.width) undoes the CSS scale → back to canvas pixel space.
  const rect = canvas.getBoundingClientRect();
  const cssScale = rect.width / canvas.width; // == karyogramScale

  const canvasX = (event.clientX - rect.left) / cssScale;
  const canvasY = (event.clientY - rect.top)  / cssScale;

  // Recompute letterbox offset in canvas-pixel space
  const naturalAspect  = img.naturalWidth  / img.naturalHeight;
  const containerAspect = displayDims.width / displayDims.height;

  let renderedWidth: number, renderedHeight: number, offsetX: number, offsetY: number;
  if (naturalAspect > containerAspect) {
    renderedWidth  = displayDims.width;
    renderedHeight = displayDims.width / naturalAspect;
    offsetX = 0;
    offsetY = (displayDims.height - renderedHeight) / 2;
  } else {
    renderedHeight = displayDims.height;
    renderedWidth  = displayDims.height * naturalAspect;
    offsetX = (displayDims.width  - renderedWidth)  / 2;
    offsetY = 0;
  }

  const scaleX = renderedWidth  / img.naturalWidth;
  const scaleY = renderedHeight / img.naturalHeight;

  // Canvas pixel → image coordinate
  const imageX = (canvasX - offsetX) / scaleX;
  const imageY = (canvasY - offsetY) / scaleY;
  const clickPoint: [number, number] = [imageX, imageY];

  // Clamp check — if outside image bounds, deselect
  if (imageX < 0 || imageY < 0 || imageX > img.naturalWidth || imageY > img.naturalHeight) {
    setSelectedKaryogramRegion(null);
    setStatusMsg("Karyogram: Clicked outside image bounds");
    return;
  }

  for (let i = 0; i < karyogramBoundingBoxes.length; i++) {
    if (isPointInPolygon(clickPoint, karyogramBoundingBoxes[i].polygon)) {
      setSelectedKaryogramRegion(i);
      const bbox = karyogramBoundingBoxes[i];
      if (boundingPolygonsSynced && bbox.image_index >= 0) {
        setSelectedChromosomeArea(bbox.image_index);
      }
      setStatusMsg(
        `Selected region: Class=${bbox.class_id}, Image Index=${bbox.image_index}, Array Index=${bbox.array_index}`
      );
      return;
    }
  }

  setSelectedKaryogramRegion(null);
  setStatusMsg("Karyogram: No region at clicked point");
};

  const handleKaryogramMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    setHasDragged(false);
    const canvas = karyogramCanvasRef.current;
    const img = karyogramImageRef.current;
    if (!canvas || !img) return;

    const rect = canvas.getBoundingClientRect();
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;

    // Use stored container dimensions for consistent coordinate scaling across all layouts
    const displayDims = karyogramDisplayDimsRef.current;
    if (!displayDims) return;

    const scaleX = img.naturalWidth / displayDims.width;
    const scaleY = img.naturalHeight / displayDims.height;
    const x = displayX * scaleX;
    const y = displayY * scaleY;
    const clickPoint: [number, number] = [x, y];

    let hit = false;
    for (let i = 0; i < karyogramBoundingBoxes.length; i++) {
      if (isPointInPolygon(clickPoint, karyogramBoundingBoxes[i].polygon)) {
        hit = true;
        break;
      }
    }

    if (!hit) {
      setIsPanning("karyogram");
      setPanStart({ x: event.clientX, y: event.clientY });
    }
  };

  const handleKaryogramMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning === "karyogram" && panStart) {
      const dx = event.clientX - panStart.x;
      const dy = event.clientY - panStart.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        setHasDragged(true);
      }
      setKaryogramOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setPanStart({ x: event.clientX, y: event.clientY });
    }
  };

  // ── Persist karyogram image in ref and draw bounds ──────────────────────────
  useEffect(() => {
    if (karyogramImage && karyogramBoundingBoxes.length > 0) {
      const img = new Image();
      img.onload = () => {
        karyogramImageRef.current = img;
        // Trigger a draw after image loads and layout is settled
        setTimeout(() => drawKaryogramBounds(), 0);
      };
      img.src = karyogramImage;
    } else {
      karyogramImageRef.current = null;
    }
  }, [karyogramImage, drawKaryogramBounds]);

  useEffect(() => {
    if (karyogramImageRef.current && karyogramBoundingBoxes.length > 0) {
      drawKaryogramBounds();
    }
  }, [selectedKaryogramRegion, karyogramBoundingBoxes, drawKaryogramBounds]);

  // Redraw karyogram bounds when layout mode changes (affects container size)
  useEffect(() => {
    if (karyogramImageRef.current && karyogramBoundingBoxes.length > 0) {
      // Use setTimeout to ensure layout has updated
      setTimeout(() => drawKaryogramBounds(), 100);
    }
  }, [layoutMode, drawKaryogramBounds, karyogramBoundingBoxes]);

  // ── File processing ──────────────────────────────────────────────────────────
  const displayImage = resultImage || preview;

  // Persist image in ref to allow high-frequency redraws (for dotted line preview)
  useEffect(() => {
    if (displayImage) {
      const img = new Image();
      img.onload = () => {
        loadedImageRef.current = img;
        drawPolygons(img);
      };
      img.src = displayImage;
    } else {
      loadedImageRef.current = null;
    }
  }, [displayImage, drawPolygons]);

  useEffect(() => {
    if (loadedImageRef.current) {
      drawPolygons(loadedImageRef.current);
    }
  }, [DetectedChromosomeAreas, selectedChromosomeArea, selectedPolygonForMerge, cutStartPoint, mousePos, lastCutLine, activeTool, drawPolygons]);

  const processFile = useCallback(async (file: File) => {
    setResultImage(prev => { revokeBlob(prev); return null; });
    setPreview(prev => { revokeBlob(prev); return null; });
    setReportData(null);
    setHasDetection(false);
    setErrorMsg(null);
    setDebugInfo(null);
    setDetectedChromosomeAreas([]);
    setSelectedChromosomeArea(null);
    setKaryogramImage(null);
    setKaryogramBoundingBoxes([]);
    setSelectedKaryogramRegion(null);
    setBoundingPolygonsSynced(false);
    setSelectedFile(file);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setKaryogramOffset({ x: 0, y: 0 });
    setKaryogramScale(1);
    setStatusMsg(`Loaded: ${file.name}`);
    setHistory([]);
    setHistoryIndex(-1);
    // FIX #3: reset report view when loading new file
    setReportViewActive(false);

    const isTiff = /\.tiff?$/i.test(file.name);
    if (!isTiff) {
      setPreview(URL.createObjectURL(file));
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const ifds = UTIF.decode(buffer);
      UTIF.decodeImage(buffer, ifds[0]);
      const rgba = UTIF.toRGBA8(ifds[0]);
      const canvas = document.createElement("canvas");
      canvas.width = ifds[0].width;
      canvas.height = ifds[0].height;
      const ctx = canvas.getContext("2d");
      const imgData = ctx?.createImageData(canvas.width, canvas.height);
      if (imgData && ctx) {
        imgData.data.set(rgba);
        ctx.putImageData(imgData, 0, 0);
      }
      setPreview(canvas.toDataURL("image/png"));
    } catch (e) {
      console.error("TIFF decode error:", e);
      setErrorMsg("Could not decode TIFF file. Try PNG or JPG instead.");
      setStatusMsg("Error: TIFF decode failed.");
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) processFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  };

  // ── Run Analysis ─────────────────────────────────────────────────────────────
  const runAnalysis = async () => {
    if (!selectedFile || loading) return;

    setResultImage(prev => { revokeBlob(prev); return null; });
    setReportData(null);
    setHasDetection(false);
    setErrorMsg(null);
    setDebugInfo(null);
    setDetectedChromosomeAreas([]);
    setSelectedChromosomeArea(null);
    setKaryogramImage(null);
    setKaryogramBoundingBoxes([]);
    setSelectedKaryogramRegion(null);
    setBoundingPolygonsSynced(false);
    setKaryogramScale(1);
    setOffset({ x: 0, y: 0 });
    setKaryogramOffset({ x: 0, y: 0 });
    // FIX #3: reset report view on new analysis
    setReportViewActive(false);

    const fd = new FormData();
    fd.append("image", selectedFile);
    setLoading(true);
    setLoadingPhase("analysis");
    setStatusMsg("Running chromosome detection…");

    try {
      const res = await fetch(`${BASE_URL}/api/predict/get_detectedPoints`, { method: "POST", body: fd });
      if (!res.ok) {
        const detail = await parseErrorDetail(res);
        setErrorMsg(`Detection failed: ${detail}`);
        setStatusMsg(`Error: detection failed (${res.status}).`);
        return;
      }

      const data = await res.json();
      if (data.detections && data.detections.length > 0) {
        const detectionsWithHue = data.detections.map((d: DetectedPoint, i: number) => ({
          ...d,
          colorHue: (i * 360) / data.detections.length
        }));
        setDetectedChromosomeAreas(detectionsWithHue);
        setSelectedChromosomeArea(0);
        setResultImage(preview);
        setHasDetection(true);
        setStatusMsg(`Detection complete — ${data.detections.length} chromosomes identified.`);
        saveToHistory(data.detections);
        if (preview) {
          const img = new Image();
          img.onload = () => drawPolygons(img);
          img.src = preview;
        }
        // Automatically generate report after successful analysis
        setTimeout(() => generateReport(), 0);
      } else {
        setErrorMsg("No chromosomes detected");
        setStatusMsg("Detection complete — no chromosomes found.");
      }
    } catch (e: any) {
      setErrorMsg(`Detection failed: ${e?.message || "Network error"}`);
      setStatusMsg("Error: could not reach the server.");
    } finally {
      setLoading(false);
      setLoadingPhase(null);
    }
  };

  // ── Generate Report ───────────────────────────────────────────────────────────
  // FIX #1: Report button is disabled unless hasDetection is true
  const generateReport = async () => {
    // Guard: must have detection first
    if (!selectedFile || loading || !hasDetection) return;

    setErrorMsg(null);
    setDebugInfo(null);
    setKaryogramScale(1);
    setOffset({ x: 0, y: 0 });
    setKaryogramOffset({ x: 0, y: 0 });

    const fd = new FormData();
    fd.append("image", selectedFile);

    // Prepare the list of polygons for the backend endpoint
    const polygonsData = DetectedChromosomeAreas.map(area => area.polygon);
    fd.append("polygons", JSON.stringify(polygonsData));

    setLoading(true);
    setLoadingPhase("report");
    setStatusMsg("Generating karyotype report…");

    try {
      const res = await fetch(`${BASE_URL}/api/predict/get_classifications_WithPolygons`, { 
        method: "POST", 
        body: fd,
        // Note: Do NOT set Content-Type header when using FormData
        // Browser will set it automatically with boundary
      });
      if (!res.ok) {
        const detail = await parseErrorDetail(res);
        setErrorMsg(`Classification failed: ${detail}`);
        setStatusMsg(`Error: classification failed (${res.status}).`);
        return;
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setKaryogramImage(url);
        setKaryogramScale(1);
        setKaryogramOffset({ x: 0, y: 0 });
        // FIX #3: activate report layout
        setReportViewActive(true);
        setLayoutMode("equal-Portion");
        setStatusMsg("Received karyogram image from backend.");
        return;
      }

      let raw: any;
      try {
        raw = await res.json();
      } catch {
        setErrorMsg("Server returned malformed JSON. Check backend logs.");
        setStatusMsg("Error: could not parse report data.");
        return;
      }

      // Check for new format with image and bounding_boxes
      if (raw.image && raw.bounding_boxes) {
        // New format: image + bounding_boxes
        const imageBase64 = raw.image;
        const boundingBoxes: BoundingBox[] = raw.bounding_boxes;

        const imageDataUrl = imageBase64.startsWith("data:") 
          ? imageBase64 
          : `data:image/png;base64,${imageBase64}`;

        setKaryogramImage(imageDataUrl);
        setKaryogramBoundingBoxes(boundingBoxes);
        setSelectedKaryogramRegion(null);
        setBoundingPolygonsSynced(true);
        setKaryogramScale(1);
        setKaryogramOffset({ x: 0, y: 0 });
        setReportViewActive(true);
        setLayoutMode("equal-Portion");

        const bbCount = boundingBoxes.length;
        setStatusMsg(`Report ready — ${bbCount} regions detected with bounding boxes.`);
        return;
      }

      // Legacy format: chromosomeImages
      const rawKeys = Object.keys(raw?.chromosomeImages ?? {});

      if (
        typeof raw.total !== "number" ||
        typeof raw.autosomes !== "number" ||
        typeof raw.sex !== "string" ||
        typeof raw.chromosomeImages !== "object" ||
        raw.chromosomeImages === null
      ) {
        setErrorMsg("Report data is missing expected fields. Check backend.");
        setStatusMsg("Error: invalid report structure.");
        setDebugInfo(
          `Backend sent: total=${raw?.total}, sex=${raw?.sex}, autosomes=${raw?.autosomes}, chromosomeImages keys=[${rawKeys.join(",")}]`
        );
        return;
      }

      const normalizedImages = normalizeChromosomeImages(raw.chromosomeImages);
      const normalizedKeys = Object.keys(normalizedImages);
      const data: ReportData = {
        total: raw.total,
        autosomes: raw.autosomes,
        sex: raw.sex,
        chromosomeImages: normalizedImages,
        karyogramImage: raw.karyogramImage || null,
      };

      setReportData(data);

      if (data.karyogramImage) {
        const src = data.karyogramImage.startsWith("data:") ? data.karyogramImage : `data:image/png;base64,${data.karyogramImage}`;
        setKaryogramImage(src);
      }

      // FIX #3: activate report layout after successful report generation
      setReportViewActive(true);
      setLayoutMode("equal-Portion");

      const imgCount = normalizedKeys.length;
      if (imgCount === 0) {
        setDebugInfo(`Report loaded but no chromosome images returned. Raw keys: [${rawKeys.join(",")}].`);
      } else if (imgCount < 20) {
        setDebugInfo(`Only ${imgCount} of 24 chromosome images received. Keys: [${normalizedKeys.join(",")}].`);
      }

      setStatusMsg(`Report ready — ${data.total} chromosomes (${data.sex}), ${imgCount}/24 images.`);
    } catch (e: any) {
      setErrorMsg(`Classification failed: ${e?.message || "Network error"}`);
      setStatusMsg("Error: could not reach the server.");
    } finally {
      setLoading(false);
      setLoadingPhase(null);
    }
  };

  const exportReport = () => {
    if (reportData || karyogramImage) {
      window.print();
      setStatusMsg("Printing report…");
    }
  };

  const dismissError = () => setErrorMsg(null);
  const dismissDebug = () => setDebugInfo(null);

  const getLayoutStyles = () => {
    switch (layoutMode) {
      case "full-left":
        return { leftFlex: "1 1 auto", rightFlex: "0 0 0px", leftHidden: false, rightHidden: true };
      case "prioritized-left":
        return { leftFlex: "1 1 auto", rightFlex: "0 0 380px", leftHidden: false, rightHidden: false };
      case "equal-Portion":
        return { leftFlex: "1 1 0px", rightFlex: "1 1 0px", leftHidden: false, rightHidden: false };
      case "full-Right":
        return { leftFlex: "0 0 0px", rightFlex: "1 1 auto", leftHidden: true, rightHidden: false };
      case "prioritized-Right":
        return { leftFlex: "0 0 380px", rightFlex: "1 1 auto", leftHidden: false, rightHidden: false };
      default:
        return { leftFlex: "1 1 auto", rightFlex: "0 0 380px", leftHidden: false, rightHidden: false };
    }
  };

  const layoutStyles = getLayoutStyles();

  const cycleLayoutMode = () => {
    const modes: LayoutMode[] = ["full-left", "prioritized-left", "equal-Portion", "prioritized-Right", "full-Right"];
    const currentIndex = modes.indexOf(layoutMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];
    setLayoutMode(nextMode);
    setStatusMsg(`Layout: ${nextMode.replace("-", " ")}`);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Segoe+UI:wght@300;400;600&family=Consolas&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes ws-spin    { to { transform: rotate(360deg) } }
        @keyframes ws-fadein  { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        @keyframes ws-slidein { from { opacity: 0; transform: translateX(8px) } to { opacity: 1; transform: none } }
        @keyframes ws-shimmer {
          0%, 100% { background-position: -400px 0 }
          50%       { background-position:  400px 0 }
        }
        @keyframes ws-dots {
          0%   { content: '' }
          33%  { content: '.' }
          66%  { content: '..' }
          100% { content: '...' }
        }

        .ws-window {
          font-family: 'Segoe UI', Tahoma, Geneva, sans-serif;
          font-size: 12px;
          background: #ffffff;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          color: #000000;
          overflow: hidden;
          user-select: none;
        }

        /* ── Ribbon ── */
        .ws-ribbon {
          background: linear-gradient(180deg, #f8f8f8 0%, #f0f0f0 100%);
          border-bottom: 1px solid #c0c0c0;
          padding: 6px 10px 4px;
          display: flex;
          align-items: flex-end;
          gap: 2px;
          flex-shrink: 0;
          flex-wrap: wrap;
        }
        .ws-ribbon-group {
          display: flex;
          gap: 1px;
          padding: 0 8px 0 0;
          margin-right: 4px;
          border-right: 1px solid #d0d0d0;
        }
        .ws-ribbon-group:last-child { border-right: none; }
        .ws-rbtn {
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          padding: 5px 10px 4px;
          min-width: 52px;
          border: 1px solid transparent; border-radius: 3px;
          background: transparent; cursor: pointer;
          color: #444444; font-size: 11px; font-family: inherit;
          transition: all .12s;
        }
        .ws-rbtn:hover:not(:disabled)        { background: #e0e0e0; border-color: #c0c0c0; color: #000000; }
        .ws-rbtn-active                       { background: #cce4ff !important; border-color: #0066cc !important; color: #0066cc !important; }
        .ws-rbtn:disabled                     { opacity: .45; cursor: not-allowed; }
        .ws-rbtn-primary                      { color: #0066cc; }
        .ws-rbtn-primary:hover:not(:disabled) { background: #cce4ff; border-color: #0066cc; }
        .ws-rbtn-success                      { color: #107c10; }
        .ws-rbtn-success:hover:not(:disabled) { background: #dff6dd; border-color: #107c10; }
        .ws-rbtn span.icon                    { font-size: 18px; line-height: 1; }

        /* ── Banners ── */
        .ws-banner {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 6px 12px;
          font-size: 12px; font-family: 'Consolas', monospace;
          animation: ws-fadein .15s ease;
          flex-shrink: 0;
          line-height: 1.5;
        }
        .ws-banner-error { background: #fef0f0; border-bottom: 1px solid #f5c0c0; color: #a00000; }
        .ws-banner-info  { background: #f0f6ff; border-bottom: 1px solid #b8d4f5; color: #004080; }
        .ws-banner svg   { flex-shrink: 0; margin-top: 1px; }
        .ws-banner-msg   { flex: 1; }
        .ws-banner-close {
          background: none; border: none; cursor: pointer; padding: 0 2px;
          display: flex; align-items: center; opacity: .7; transition: opacity .1s; color: inherit;
        }
        .ws-banner-close:hover { opacity: 1; }

        /* ── Body ── */
        .ws-body { flex: 1; display: flex; min-height: 0; overflow: hidden; }
        .ws-main { flex: 1; display: flex; gap: 0; min-width: 0; overflow: hidden; transition: all 0.3s ease; }

        /* ── Panels ── */
        .ws-panel {
          display: flex; flex-direction: column; overflow: hidden;
          background: #ffffff;
          animation: ws-fadein .25s ease both;
          transition: flex 0.3s ease, width 0.3s ease;
        }
        .ws-panel-left  { border-right: 1px solid #c0c0c0; }
        .ws-panel-right { }

        .ws-panel-titlebar {
          height: 32px;
          background: linear-gradient(180deg, #f0f0f0 0%, #e8e8e8 100%);
          border-bottom: 1px solid #c0c0c0;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 12px;
          flex-shrink: 0;
        }
        .ws-panel-title   { font-size: 12px; font-weight: 600; color: #333333; letter-spacing: .02em; display: flex; align-items: center; gap: 8px; }
        .ws-panel-actions { display: flex; gap: 6px; }
        .ws-panel-act {
          width: 24px; height: 22px;
          background: #ffffff; border: 1px solid #c0c0c0;
          border-radius: 2px; color: #666666; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; transition: background .1s;
        }
        .ws-panel-act:hover    { background: #e0e0e0; color: #000000; }
        .ws-panel-act:disabled { opacity: .4; cursor: not-allowed; }

        /* ── Image area ── */
        .ws-image-area {
          flex: 1; position: relative;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden; cursor: crosshair;
          background: repeating-conic-gradient(#f0f0f0 0% 25%, #ffffff 0% 50%) 50% / 20px 20px;
          min-height: 0;
        }
        .ws-image-area-drag { outline: 2px dashed #0066cc !important; }
        .ws-image-area img {
          max-width: 100%; max-height: 100%;
          object-fit: contain; display: block;
          image-rendering: crisp-edges;
          background: #ffffff;
        }
        .ws-image-canvas {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          max-width: 100%; max-height: 100%;
          cursor: pointer;
        }
        .ws-upload-placeholder {
          display: flex; flex-direction: column; align-items: center;
          gap: 12px; color: #888888; text-align: center; padding: 32px;
        }
        .ws-upload-title { font-size: 13px; color: #333333; }
        .ws-upload-sub   { font-size: 11px; color: #666666; }
        .ws-format-row   { display: flex; gap: 5px; margin-top: 2px; }
        .ws-fmt-badge {
          font-size: 10px; font-weight: 700; letter-spacing: .08em;
          color: #0066cc; background: #f0f0f0; border: 1px solid #c0c0c0;
          padding: 1px 7px; border-radius: 2px; text-transform: uppercase;
          font-family: 'Consolas', monospace;
        }

        /* ── Loading ── */
        .ws-loading-overlay {
          position: absolute; inset: 0;
          background: rgba(255,255,255,.85);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 14px; z-index: 50;
        }
        .ws-loading-overlay-inline {
          position: relative; flex: 1;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 14px;
        }
        .ws-loading-txt { font-size: 12px; color: #0066cc; font-family: 'Consolas', monospace; }
        .ws-loading-dots::after { content: ''; animation: ws-dots 1.2s steps(3,end) infinite; }

        /* ── Detection badge ── */
        .ws-detect-badge {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 10.5px; font-weight: 600; font-family: 'Consolas', monospace;
          color: #107c10; background: #dff6dd;
          border: 1px solid #b8d9b0;
          padding: 1px 7px; border-radius: 2px;
        }

        /* ── Karyogram Image — full panel fill ── */
        .ws-karyogram-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: flex-start;
          padding: 0;
          background: #ffffff;
          overflow: hidden;
          min-height: 0;
        }
        /* When karyogram is the ONLY content (no chromosomeImages grid) */
        .ws-karyogram-container.karyogram-only {
          padding: 12px;
          align-items: center;
          justify-content: center;
        }
        .ws-karyogram-image {
          width: 100%;
          height: 100%;
          object-fit: contain;
          object-position: top center;
          display: block;
          background: #ffffff;
        }
        .ws-karyogram-container.karyogram-only .ws-karyogram-image {
          max-width: 100%;
          max-height: 100%;
          width: auto;
          height: auto;
          border: 1px solid #e0e0e0;
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        /* Karyogram header strip above the image */
        .ws-karyogram-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 12px;
          background: #f5f5f5;
          border-bottom: 1px solid #e0e0e0;
          flex-shrink: 0;
          font-size: 11px;
          color: #555;
          font-family: 'Consolas', monospace;
        }
        /* When BOTH karyogram image + chromosome grid exist, karyogram gets top portion */
        .ws-karyogram-container.karyogram-with-grid {
          flex: 0 0 auto;
          max-height: 32%;
          min-height: 110px;
          padding: 8px 12px 6px;
          border-bottom: 1px solid #e0e0e0;
          background: #fafafa;
          align-items: center;
          justify-content: center;
        }
        .ws-karyogram-container.karyogram-with-grid .ws-karyogram-image {
          max-width: 100%;
          max-height: 100%;
          width: auto;
          height: auto;
          object-fit: contain;
        }

        /* ── Report panel ── */
        .ws-report-scroll {
          flex: 1; overflow-y: auto; padding: 16px 20px 8px;
          background: #ffffff;
        }

        /* ── FIX #2: Karyogram row layout ── */
        /* Each row distributes cells evenly */
        .ws-chr-row {
          display: flex;
          width: 100%;
        }
        .ws-chr-sep { height: 1px; background: #e0e0e0; margin: 8px 0; }
        .ws-chr-cell {
          flex: 1;
          display: flex; flex-direction: column; align-items: center;
          padding: 6px 4px 6px;
          border-right: 1px solid #e8e8e8;
          animation: ws-slidein .2s ease both;
          min-width: 0;
        }
        .ws-chr-cell:last-child { border-right: none; }
        .ws-chr-img {
          height: 72px; display: flex;
          align-items: flex-end; justify-content: center; padding-bottom: 2px;
          width: 100%;
        }
        .ws-chr-img img  { max-height: 100%; max-width: 90%; object-fit: contain; opacity: .95; }
        .ws-chr-skel {
          width: 12px; height: 48px;
          background: linear-gradient(90deg, #e0e0e0 25%, #f0f0f0 50%, #e0e0e0 75%);
          background-size: 400px 100%;
          animation: ws-shimmer 1.4s infinite;
          border-radius: 3px; opacity: .8;
        }
        .ws-chr-label {
          font-size: 11px; font-weight: 600; color: #555555;
          font-family: 'Consolas', monospace; margin-top: 4px;
        }
        /* Row group label */
        .ws-chr-row-group {
          border: 1px solid #ececec;
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 2px;
          background: #fff;
        }
        .ws-chr-row-label {
          font-size: 10px;
          color: #999;
          font-family: 'Consolas', monospace;
          padding: 2px 6px;
          background: #f7f7f7;
          border-bottom: 1px solid #ececec;
          letter-spacing: 0.04em;
        }

        /* ── Stats bar ── */
        .ws-stats {
          display: flex; border-top: 1px solid #c0c0c0;
          background: #f8f8f8; flex-shrink: 0;
        }
        .ws-stat { flex: 1; text-align: center; padding: 8px 4px; }
        .ws-stat + .ws-stat { border-left: 1px solid #c0c0c0; }
        .ws-stat-lbl    { font-size: 10px; color: #666666; text-transform: uppercase; letter-spacing: .07em; }
        .ws-stat-val    { font-size: 20px; font-weight: 700; color: #000000; font-family: 'Consolas', monospace; line-height: 1.2; }
        .ws-stat-val-sm { font-size: 20px; font-weight: 700; color: #0066cc;  font-family: 'Consolas', monospace; line-height: 1.2; }

        /* ── Empty state ── */
        .ws-empty {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 12px; padding: 24px; text-align: center;
        }
        .ws-empty-icon  { color: #999999; }
        .ws-empty-title { font-size: 14px; font-weight: 600; color: #333333; }
        .ws-empty-sub   { font-size: 12px; color: #666666; line-height: 1.55; max-width: 220px; }
        .ws-steps       { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; width: 100%; max-width: 240px; }
        .ws-step {
          display: flex; align-items: center; gap: 10px;
          padding: 7px 12px; border-radius: 4px;
          background: #f8f8f8; border: 1px solid #e0e0e0;
          font-size: 12px; color: #333333; text-align: left;
        }
        .ws-step-n {
          width: 20px; height: 20px; border-radius: 3px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700; font-family: 'Consolas', monospace;
          background: #e0e0e0; color: #666666;
        }
        .ws-step-n-done   { background: #dff6dd; color: #107c10; }
        .ws-step-n-active { background: #cce4ff; color: #0066cc; }

        /* ── Status bar ── */
        .ws-statusbar {
          height: 24px;
          background: #f0f0f0;
          border-top: 1px solid #c0c0c0;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 12px;
          flex-shrink: 0;
        }
        .ws-status-left { display: flex; align-items: center; gap: 12px; }
        .ws-status-item    { font-size: 12px; color: #666666; font-family: 'Consolas', monospace; }
        .ws-status-item-hi { color: #333333; }
        .ws-status-dot      { width: 8px; height: 8px; border-radius: 50%; background: #107c10; }
        .ws-status-dot-busy {
          width: 8px; height: 8px; box-sizing: border-box;
          border-radius: 50%; border: 2px solid #f0883e;
          border-top-color: transparent;
          animation: ws-spin .6s linear infinite;
        }
        .ws-status-dot-error { width: 8px; height: 8px; border-radius: 50%; background: #d32f2f; }
        .ws-status-dot-warn  { width: 8px; height: 8px; border-radius: 50%; background: #f0883e; }

        .hidden { display: none !important; }

        .ws-print-header, .ws-print-footer { display: none; }

        @media print {
          @page { margin: 1.5cm; }
          .ws-ribbon, .ws-statusbar, .ws-banner, .ws-panel-left, .ws-panel-titlebar, 
          .ws-report-scroll, .ws-stats, .ws-panel-actions, .ws-empty, .ws-loading-overlay, 
          .ws-panel-act, canvas { 
            display: none !important; 
          }
          .ws-window, .ws-body, .ws-main, .ws-panel-right { 
            background: white !important; 
            height: auto !important; 
            overflow: visible !important;
            display: block !important;
          }
          .ws-panel-right { 
            width: 100% !important; 
            flex: 1 1 auto !important;
            border: none !important;
          }
          .ws-karyogram-container {
            max-height: none !important;
            height: auto !important;
            padding: 0 !important;
            border: none !important;
            display: flex !important;
            justify-content: center !important;
          }
          .ws-karyogram-image {
            width: 100% !important;
            height: auto !important;
            max-width: none !important;
            box-shadow: none !important;
          }
          .hidden-print { display: none !important; }
          .ws-print-header { display: block !important; text-align: center; margin-bottom: 30px; font-family: 'Segoe UI', sans-serif; }
          .ws-print-header h1 { font-size: 24pt; margin-bottom: 5px; }
          .ws-print-footer { 
            display: block !important; 
            text-align: center; 
            margin-top: 50px; 
            padding-top: 20px; 
            border-top: 1px solid #eee; 
            font-size: 10pt; 
            color: #666; 
            line-height: 1.5;
          }
        }
      `}</style>

      <div className="ws-window">

        {/* ── Ribbon ── */}
        <div className="ws-ribbon">
          <div className="ws-ribbon-group">
            <button className="ws-rbtn" onClick={() => fileInputRef.current?.click()}>
              <span className="icon">{SVG.folder}</span>Open
            </button>
          </div>

          <div className="ws-ribbon-group">
            {RIBBON_TOOLS.map(({ id, label, icon }) => (
              <button
                key={id}
                className={`ws-rbtn ${activeTool === id ? "ws-rbtn-active" : ""}`}
                onClick={() => {
                  setActiveTool(id);
                  if (id !== "merge") setSelectedPolygonForMerge(null);
                  if (id === "extend") {
                    setExtendStarted(false);
                    setLastInsertedIndex(null);
                  }
                  setStatusMsg(`Tool: ${label} - Click on polygon to ${label.toLowerCase()}`);
                }}
                disabled={!selectedFile}
              >
                <span className="icon">{icon}</span>{label}
              </button>
            ))}
          </div>

          <div className="ws-ribbon-group">
            <button
              className="ws-rbtn"
              onClick={undoLastAction}
              disabled={historyIndex <= 0}
              title="Undo last action"
            >
              <span className="icon">{SVG.undo}</span>Undo
            </button>
          </div>

          <div className="ws-ribbon-group">
            <button
              className="ws-rbtn ws-rbtn-primary"
              onClick={runAnalysis}
              disabled={!selectedFile || loading}
              title={!selectedFile ? "Open an image first" : "Detect chromosomes"}
            >
              <span className="icon">{SVG.run}</span>
              {loading && loadingPhase === "analysis" ? "Working…" : "Analyze"}
            </button>

            {/* FIX #1: Report button disabled until analysis (hasDetection) is done */}
            <button
              className="ws-rbtn ws-rbtn-success"
              onClick={generateReport}
              disabled={!hasDetection || loading}
              title={!selectedFile ? "Open an image first" : !hasDetection ? "Run Analyze first" : "Classify and generate report"}
            >
              <span className="icon">{SVG.report}</span>
              {loading && loadingPhase === "report" ? "Working…" : "Report"}
            </button>

            <button
              className="ws-rbtn"
              onClick={cycleLayoutMode}
              title="Change Layout (Split / Focus Image / Focus Report)"
            >
              <span className="icon">{SVG.layout}</span>Layout
            </button>
          </div>
        </div>

        {/* ── Error banner ── */}
        {errorMsg && (
          <div className="ws-banner ws-banner-error">
            {SVG.warn}
            <span className="ws-banner-msg">{errorMsg}</span>
            <button className="ws-banner-close" onClick={dismissError} title="Dismiss">{SVG.close}</button>
          </div>
        )}

        {/* ── Debug / info banner ── */}
        {debugInfo && (
          <div className="ws-banner ws-banner-info">
            {SVG.info}
            <span className="ws-banner-msg">{debugInfo}</span>
            <button className="ws-banner-close" onClick={dismissDebug} title="Dismiss">{SVG.close}</button>
          </div>
        )}

        {/* ── Body ── */}
        <div className="ws-body">
          <div className="ws-main">

            {/* ── Image viewer ── */}
            <div
              className={`ws-panel ws-panel-left ${layoutStyles.leftHidden ? "hidden" : ""}`}
              style={{ flex: layoutStyles.leftFlex }}
            >
              <div className="ws-panel-titlebar">
                <span className="ws-panel-title">
                  Image Viewer
                  {hasDetection && (
                    <span className="ws-detect-badge">
                      {SVG.check}&nbsp;{DetectedChromosomeAreas.length} chromosomes detected
                    </span>
                  )}
                  {selectedChromosomeArea !== null && (
                    <span className="ws-detect-badge" style={{ background: "#cce4ff", color: "#0066cc" }}>
                      Selected: #{selectedChromosomeArea + 1}
                    </span>
                  )}
                  {selectedPolygonForMerge !== null && (
                    <span className="ws-detect-badge" style={{ background: "#ffcc88", color: "#cc6600" }}>
                      Merge mode: select second polygon
                    </span>
                  )}
                </span>
                <div className="ws-panel-actions">
                  <button className="ws-panel-act" title="Open image" onClick={() => fileInputRef.current?.click()}>
                    {SVG.folder}
                  </button>
                </div>
              </div>

              <div
                ref={imageAreaRef}
                className={`ws-image-area ${dragOver ? "ws-image-area-drag" : ""}`}
                style={{ cursor: selectedFile ? "crosshair" : "pointer" }}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {loading && loadingPhase === "analysis" && (
                  <div className="ws-loading-overlay">
                    <WinSpinner />
                    <span className="ws-loading-txt ws-loading-dots">Detecting chromosomes</span>
                  </div>
                )}

                {displayImage ? (
                  <div style={{ 
                    position: "relative", 
                    width: "100%", 
                    height: "100%", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center",
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                    transition: isPanning === "main" ? "none" : "transform 0.1s ease-out"
                  }}>
                    <img src={displayImage} alt="Chromosome spread" draggable={false} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                    {DetectedChromosomeAreas.length > 0 && (
                      <canvas 
                        ref={canvasRef} 
                        onClick={handleCanvasClick} 
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={() => setMousePos(null)}
                        className="ws-image-canvas" 
                      />
                    )}
                  </div>
                ) : (
                  <div className="ws-upload-placeholder">
                    {SVG.upload}
                    <div className="ws-upload-title">Drop image here or click to open</div>
                    <div className="ws-upload-sub">High-resolution metaphase spread</div>
                    <div className="ws-format-row">
                      {["PNG", "JPG", "TIFF"].map(f => (
                        <span key={f} className="ws-fmt-badge">{f}</span>
                      ))}
                    </div>
                  </div>
                )}

                <input ref={fileInputRef} type="file" accept="image/*,.tif,.tiff" onChange={handleFileInput} style={{ display: "none" }} />
              </div>
            </div>

            {/* ── Karyotype report ── */}
            <div
              className={`ws-panel ws-panel-right ${layoutStyles.rightHidden ? "hidden" : ""}`}
              style={{ flex: layoutStyles.rightFlex, minWidth: 0 }}
            >
              <div className="ws-panel-titlebar">
                <span className="ws-panel-title">Karyotype Report</span>
                <div className="ws-panel-actions">
                  <button
                    className="ws-panel-act"
                    title="Export / Print report"
                    disabled={!reportData && !karyogramImage}
                    onClick={exportReport}
                    style={{ opacity: reportData || karyogramImage ? 1 : .4 }}
                  >
                    {SVG.report}
                  </button>
                </div>
              </div>

              <div className="ws-print-header">
                <h1>Karyogram Analysis Report</h1>
                <p>Case ID: {caseId} | Date: {new Date().toLocaleDateString()}</p>
              </div>

              {loading && loadingPhase === "report" ? (
                <div className="ws-loading-overlay-inline">
                  <WinSpinner />
                  <span className="ws-loading-txt ws-loading-dots">Classifying chromosomes</span>
                </div>

              ) : (karyogramImage || reportData) ? (
                <>
                  {/* Karyogram image — fills panel if no individual images, or compact strip if grid also shown */}
                  {(() => {
                    const hasGrid = !!(reportData && reportData.chromosomeImages && Object.keys(reportData.chromosomeImages).length > 0);
                    if (!karyogramImage) return null;
                    const hasBoundingBoxes = karyogramBoundingBoxes.length > 0;
                    
                    if (!hasGrid) {
                      // Only karyogram image returned — fill the entire report panel
                      return (
                        <div 
                          ref={karyogramAreaRef}
                          className="ws-karyogram-container karyogram-only" 
                          style={{ position: "relative", overflow: "hidden" }}
                        >
                          <div style={{
                            position: "relative",
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transform: `translate(${karyogramOffset.x}px, ${karyogramOffset.y}px) scale(${karyogramScale})`,
                            transition: isPanning === "karyogram" ? "none" : "transform 0.1s ease-out"
                          }}>
                            <img src={karyogramImage} alt="Karyogram" className="ws-karyogram-image" />
                            {hasBoundingBoxes && (
                              <canvas
                                ref={karyogramCanvasRef}
                                onClick={handleKaryogramClick}
                                onMouseDown={handleKaryogramMouseDown}
                                onMouseMove={handleKaryogramMouseMove}
                                style={{
                                  position: "absolute",
                                  top: "50%",
                                  left: "50%",
                                  transform: "translate(-50%, -50%)",
                                  cursor: "pointer",
                                  width: "100%",
                                  height: "100%",
                                  display: "block",
                                }}
                              />
                            )}
                          </div>
                        </div>
                      );
                    }
                    // Both karyogram + grid — karyogram gets compact top strip
                    return (
                      <div 
                        ref={karyogramAreaRef}
                        className="ws-karyogram-container karyogram-with-grid" 
                        style={{ position: "relative", overflow: "hidden" }}
                      >
                        <div style={{
                          position: "relative",
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transform: `translate(${karyogramOffset.x}px, ${karyogramOffset.y}px) scale(${karyogramScale})`,
                          transition: isPanning === "karyogram" ? "none" : "transform 0.1s ease-out"
                        }}>
                          <img src={karyogramImage} alt="Karyogram" className="ws-karyogram-image" />
                          {hasBoundingBoxes && (
                            <canvas
                              ref={karyogramCanvasRef}
                              onClick={handleKaryogramClick}
                              onMouseDown={handleKaryogramMouseDown}
                              onMouseMove={handleKaryogramMouseMove}
                              style={{
                                position: "absolute",
                                top: "50%",
                                left: "50%",
                                transform: "translate(-50%, -50%)",
                                cursor: "pointer",
                                width: "100%",
                                height: "100%",
                                display: "block",
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* FIX #2: Chromosome grid with correct row distribution */}
                  {reportData && reportData.chromosomeImages && Object.keys(reportData.chromosomeImages).length > 0 && (
                    <>
                      <div className="ws-report-scroll">
                        {CHROMOSOME_ROWS.map((row, ri) => {
                          // Row group labels: Groups A–G per standard karyotype
                          const GROUP_LABELS = ["Group A (1–5)", "Group B–D (6–12)", "Group E–F (13–18)", "Group G + Sex (19–22, X, Y)"];
                          return (
                            <div key={ri} className="ws-chr-row-group" style={{ animationDelay: `${ri * 60}ms` }}>
                              <div className="ws-chr-row-label">{GROUP_LABELS[ri]}</div>
                              <div className="ws-chr-row">
                                {row.map((id, ci) => {
                                  const raw = reportData.chromosomeImages[id];
                                  const src = raw
                                    ? (raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`)
                                    : null;
                                  return (
                                    <div
                                      key={id}
                                      className="ws-chr-cell"
                                      style={{ animationDelay: `${ri * 40 + ci * 15}ms` }}
                                    >
                                      <div className="ws-chr-img">
                                        {src
                                          ? <img src={src} alt={`Chr ${id}`} />
                                          : <div className="ws-chr-skel" />
                                        }
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
                        <div className="ws-stat">
                          <div className="ws-stat-lbl">Total Chr.</div>
                          <div className="ws-stat-val">{reportData.total}</div>
                        </div>
                        <div className="ws-stat">
                          <div className="ws-stat-lbl">Autosomes</div>
                          <div className="ws-stat-val">{reportData.autosomes}</div>
                        </div>
                        <div className="ws-stat">
                          <div className="ws-stat-lbl">Sex Chr.</div>
                          <div className="ws-stat-val-sm">{reportData.sex}</div>
                        </div>
                        <div className="ws-stat">
                          <div className="ws-stat-lbl">Images</div>
                          <div className="ws-stat-val" style={{ fontSize: 16 }}>
                            {Object.keys(reportData.chromosomeImages).length}/24
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </>

              ) : (
                <div className="ws-empty">
                  <div className="ws-empty-icon">{SVG.dna}</div>
                  <div className="ws-empty-title">No report generated</div>
                  <div className="ws-empty-sub">
                    Complete the steps below to generate a full karyotype classification.
                  </div>
                  <div className="ws-steps">
                    {[
                      { num: 1, done: !!selectedFile,                          active: !selectedFile,                          text: "Open a chromosome image" },
                      { num: 2, done: hasDetection,                            active: !!selectedFile && !hasDetection,         text: "Run Analysis (Click → Analyze)" },
                      { num: 3, done: !!reportData || !!karyogramImage,        active: hasDetection && !reportData && !karyogramImage, text: "Generate Report (Click → Report)" },
                    ].map(({ num, done, active, text }) => (
                      <div key={num} className="ws-step">
                        <span className={`ws-step-n ${done ? "ws-step-n-done" : active ? "ws-step-n-active" : ""}`}>
                          {done ? <>{SVG.check}</> : num}
                        </span>
                        {text}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="ws-print-footer">
                Generated by ChromoTraQ Online: free AI based Karyotyping Software<br />
                (for more information: <span style={{ color: '#0066cc' }}>http://chromotraq.quantinetech.com</span>)
              </div>

            </div>

          </div>
        </div>

        {/* ── Status bar ── */}
        <div className="ws-statusbar">
          <div className="ws-status-left">
            <div className={
              loading ? "ws-status-dot-busy" :
                errorMsg ? "ws-status-dot-error" :
                  debugInfo ? "ws-status-dot-warn" :
                    "ws-status-dot"
            } />
            <span className={`ws-status-item ${loading || errorMsg ? "" : "ws-status-item-hi"}`}>
              {statusMsg}
            </span>
          </div>
          <div className="ws-status-right">
            <span className="ws-status-item">Case #{caseId}</span>
            <span className="ws-status-item" style={{ marginLeft: "12px" }}>
              Tool: {activeTool.charAt(0).toUpperCase() + activeTool.slice(1)}
            </span>
            <span className="ws-status-item" style={{ marginLeft: "12px" }}>
              Layout: {layoutMode.replace("-", " ")}
              {reportViewActive ? " (Report)" : ""}
            </span>
          </div>
        </div>

      </div>
    </>
  );
}