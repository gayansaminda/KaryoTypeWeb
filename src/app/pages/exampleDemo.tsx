import React, { useEffect, useMemo, useState, useCallback } from "react";
import UTIF from "utif";
import { useNavigate } from "react-router-dom";

// ─── Config ────────────────────────────────────────────────────────────────────
//const BASE_URL = "http://127.0.0.1:8000";
const BASE_URL = "https://karyotyping-api-875244011562.asia-south1.run.app";



// ─── Types ─────────────────────────────────────────────────────────────────────
type Tool = "select" | "cut" | "erase" | "extend" | "merge";
type LayoutMode = "split" | "focused-left" | "focused-right";

interface DetectedPoint {
  polygon: Array<[number, number]>;
  score: number;
  bbox: [number, number, number, number];
}

interface ReportData {
  total: number;
  autosomes: number;
  sex: string;
  chromosomeImages: Record<string, string>;
  karyogramImage?: string;
}

// ─── Chromosome grid layout ────────────────────────────────────────────────────
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
  back: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>,
  layout: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>,
  fullscreen: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>,
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

export function ExampleDemo() {
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
  const [selectedChromosomeArea, setSelectedChromosomeArea] = useState<number | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("split");
  const [karyogramImage, setKaryogramImage] = useState<string | null>(null);
  const [cutFirstPoint, setCutFirstPoint] = useState<[number, number] | null>(null);
  const [cutPreviewPoint, setCutPreviewPoint] = useState<[number, number] | null>(null);
  
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const caseId = "105123";

  // ── Cleanup blob URLs ────────────────────────────────────────────────────────
  useEffect(() => () => { revokeBlob(preview); }, [preview]);
  useEffect(() => () => { revokeBlob(resultImage); }, [resultImage]);
  useEffect(() => () => { revokeBlob(karyogramImage); }, [karyogramImage]);

  // Redraw canvas when cut preview changes
  useEffect(() => {
    if (resultImage && DetectedChromosomeAreas.length > 0) {
      const img = new Image();
      img.onload = () => {
        drawPolygons(img);
      };
      img.src = resultImage;
    }
  }, [cutPreviewPoint, resultImage, DetectedChromosomeAreas]);

  // ── Polygon helper functions ─────────────────────────────────────────────────
  const isPointInPolygon = (point: [number, number], polygon: Array<[number, number]>): boolean => {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  // Line-line intersection detection
  const lineIntersection = (
    p1: [number, number], p2: [number, number],
    p3: [number, number], p4: [number, number]
  ): [number, number] | null => {
    const [x1, y1] = p1, [x2, y2] = p2;
    const [x3, y3] = p3, [x4, y4] = p4;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null; // Parallel or collinear

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    }
    return null;
  };

  // Split polygon by line
  const splitPolygonByLine = (
    polygon: Array<[number, number]>,
    p1: [number, number],
    p2: [number, number]
  ): [Array<[number, number]>, Array<[number, number]>] | null => {
    const intersections: { point: [number, number]; edgeIndex: number; t: number }[] = [];

    // Find all intersections with polygon edges
    for (let i = 0; i < polygon.length; i++) {
      const edge1 = polygon[i];
      const edge2 = polygon[(i + 1) % polygon.length];
      const intersection = lineIntersection(p1, p2, edge1, edge2);

      if (intersection) {
        const t = Math.hypot(intersection[0] - edge1[0], intersection[1] - edge1[1]);
        intersections.push({ point: intersection, edgeIndex: i, t });
      }
    }

    if (intersections.length < 2) return null; // Need at least 2 intersections

    // Sort intersections along the edge
    intersections.sort((a, b) => a.edgeIndex - b.edgeIndex || a.t - b.t);

    const int1 = intersections[0];
    const int2 = intersections[1];

    // Build two sub-polygons
    const poly1: Array<[number, number]> = [];
    const poly2: Array<[number, number]> = [];

    // Add points from start intersection to end intersection for poly1
    poly1.push(int1.point);
    for (let i = int1.edgeIndex + 1; i <= int2.edgeIndex; i++) {
      poly1.push(polygon[i % polygon.length]);
    }
    poly1.push(int2.point);

    // Add points from end intersection to start intersection for poly2
    poly2.push(int2.point);
    for (let i = int2.edgeIndex + 1; i <= int1.edgeIndex + polygon.length; i++) {
      poly2.push(polygon[i % polygon.length]);
    }
    poly2.push(int1.point);

    return [poly1, poly2];
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const displayWidth = rect.width;
    const displayHeight = rect.height;
    const internalWidth = canvas.width;
    const internalHeight = canvas.height;
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    const x = (displayX / displayWidth) * internalWidth;
    const y = (displayY / displayHeight) * internalHeight;

    // SELECT TOOL
    if (activeTool === "select") {
      for (let i = 0; i < DetectedChromosomeAreas.length; i++) {
        const polygon = DetectedChromosomeAreas[i].polygon;
        if (isPointInPolygon([x, y], polygon)) {
          setSelectedChromosomeArea(i);
          console.log(`Selected chromosome area ${i}`);
          return;
        }
      }
      setSelectedChromosomeArea(null);
      return;
    }

    // CUT TOOL
    if (activeTool === "cut") {
      if (selectedChromosomeArea === null) {
        console.log("No chromosome selected for cutting");
        return;
      }

      if (cutFirstPoint === null) {
        // First click - record the point
        setCutFirstPoint([x, y]);
        console.log("Cut: first point marked", [x, y]);
      } else {
        // Second click - perform the cut
        const secondPoint: [number, number] = [x, y];
        const polygon = DetectedChromosomeAreas[selectedChromosomeArea].polygon;
        const detection = DetectedChromosomeAreas[selectedChromosomeArea];

        const result = splitPolygonByLine(polygon, cutFirstPoint, secondPoint);

        if (result) {
          const [poly1, poly2] = result;
          
          // Calculate areas to determine which is bigger
          const area1 = Math.abs(
            poly1.reduce((sum, [x, y], i, arr) => {
              const [nextX, nextY] = arr[(i + 1) % arr.length];
              return sum + (x * nextY - nextX * y);
            }, 0) / 2
          );
          
          const area2 = Math.abs(
            poly2.reduce((sum, [x, y], i, arr) => {
              const [nextX, nextY] = arr[(i + 1) % arr.length];
              return sum + (x * nextY - nextX * y);
            }, 0) / 2
          );

          // Create new detections for both sub-polygons
          const newDetection1: DetectedPoint = {
            polygon: poly1,
            score: detection.score * 0.9,
            bbox: detection.bbox,
          };

          const newDetection2: DetectedPoint = {
            polygon: poly2,
            score: detection.score * 0.9,
            bbox: detection.bbox,
          };

          // Remove original and add both new ones
          const newAreas = DetectedChromosomeAreas.filter((_, i) => i !== selectedChromosomeArea);
          newAreas.push(newDetection1, newDetection2);
          setDetectedChromosomeAreas(newAreas);

          // Select the bigger polygon
          const biggerPoly = area1 > area2 ? newDetection1 : newDetection2;
          const biggerIndex = newAreas.indexOf(biggerPoly);
          setSelectedChromosomeArea(biggerIndex);

          console.log("Cut successful: split into 2 polygons");
        } else {
          console.log("Cut: line does not intersect polygon properly");
        }

        // Reset cut state
        setCutFirstPoint(null);
        setCutPreviewPoint(null);
      }
      return;
    }
  };

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool !== "cut" || cutFirstPoint === null) {
      setCutPreviewPoint(null);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const displayWidth = rect.width;
    const displayHeight = rect.height;
    const internalWidth = canvas.width;
    const internalHeight = canvas.height;
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    const x = (displayX / displayWidth) * internalWidth;
    const y = (displayY / displayHeight) * internalHeight;

    setCutPreviewPoint([x, y]);
  };

  const drawPolygons = useCallback((imageElement: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = imageElement.width;
    canvas.height = imageElement.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    DetectedChromosomeAreas.forEach((detection, index) => {
      const polygon = detection.polygon;
      if (polygon.length === 0) return;

      const isSelected = selectedChromosomeArea === index;
      const lineWidth = isSelected ? 8 : 2;

      ctx.strokeStyle = `hsl(${(index * 360) / DetectedChromosomeAreas.length}, 100%, 50%)`;
      ctx.lineWidth = lineWidth;
      ctx.fillStyle = `hsla(${(index * 360) / DetectedChromosomeAreas.length}, 100%, 50%, 0.1)`;

      ctx.beginPath();
      ctx.moveTo(polygon[0][0], polygon[0][1]);
      for (let i = 1; i < polygon.length; i++) {
        ctx.lineTo(polygon[i][0], polygon[i][1]);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    // Draw cut tool preview
    if (activeTool === "cut" && cutFirstPoint && cutPreviewPoint) {
      ctx.strokeStyle = "#FF4444";
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(cutFirstPoint[0], cutFirstPoint[1]);
      ctx.lineTo(cutPreviewPoint[0], cutPreviewPoint[1]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw points
      ctx.fillStyle = "#FF4444";
      ctx.beginPath();
      ctx.arc(cutFirstPoint[0], cutFirstPoint[1], 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cutPreviewPoint[0], cutPreviewPoint[1], 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [DetectedChromosomeAreas, selectedChromosomeArea, activeTool, cutFirstPoint, cutPreviewPoint]);

  // ── File processing ──────────────────────────────────────────────────────────
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
    setCutFirstPoint(null);
    setCutPreviewPoint(null);
    setSelectedFile(file);
    setStatusMsg(`Loaded: ${file.name}`);

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

    const fd = new FormData();
    fd.append("image", selectedFile);
    setLoading(true);
    setLoadingPhase("analysis");
    setStatusMsg("Running chromosome detection…");

    try {
      const res = await fetch(`${BASE_URL}/api/predict/get_detectedPoints`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const detail = await parseErrorDetail(res);
        console.error("Detection error:", res.status, detail);
        setErrorMsg(`Detection failed: ${detail}`);
        setStatusMsg(`Error: detection failed (${res.status}).`);
        return;
      }

      const data = await res.json();
      console.log("Detected points:", data);

      if (data.detections && data.detections.length > 0) {
        setDetectedChromosomeAreas(data.detections);
        setSelectedChromosomeArea(1);
        setResultImage(preview);
        setHasDetection(true);
        setStatusMsg("Detection complete — chromosomes identified.");

        if (preview) {
          const img = new Image();
          img.onload = () => {
            drawPolygons(img);
          };
          img.src = preview;
        }
      } else {
        setErrorMsg("No chromosomes detected");
        setStatusMsg("Detection complete — no chromosomes found.");
      }
    } catch (e: any) {
      console.error("Detection fetch error:", e);
      setErrorMsg(`Detection failed: ${e?.message || "Network error"}`);
      setStatusMsg("Error: could not reach the server.");
    } finally {
      setLoading(false);
      setLoadingPhase(null);
    }
  };

  // ── Generate Report ───────────────────────────────────────────────────────────
  const generateReport = async () => {
    if (!selectedFile || loading) return;

    setErrorMsg(null);
    setDebugInfo(null);

    const fd = new FormData();
    fd.append("image", selectedFile);
    setLoading(true);
    setLoadingPhase("report");
    setStatusMsg("Generating karyotype report…");

    try {
      const res = await fetch(`${BASE_URL}/api/predict/get_classifications`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const detail = await parseErrorDetail(res);
        console.error("Classification error:", res.status, detail);
        setErrorMsg(`Classification failed: ${detail}`);
        setStatusMsg(`Error: classification failed (${res.status}).`);
        return;
      }

      const contentType = res.headers.get("content-type") || "";

      if (!contentType.includes("application/json")) {
        console.warn("Unexpected content-type:", contentType);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setKaryogramImage(url);
        setStatusMsg("Received karyogram image from backend.");
        return;
      }

      let raw: any;
      try {
        raw = await res.json();
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr);
        setErrorMsg("Server returned malformed JSON. Check backend logs.");
        setStatusMsg("Error: could not parse report data.");
        return;
      }

      const rawKeys = Object.keys(raw?.chromosomeImages ?? {});
      const rawTotal = raw?.total;
      const rawSex = raw?.sex;
      const rawAutos = raw?.autosomes;
      console.log("─── Report response ───────────────────────────────");
      console.log("total:", rawTotal);
      console.log("autosomes:", rawAutos);
      console.log("sex:", rawSex);
      console.log("chromosomeImages keys (raw):", rawKeys);
      console.log("───────────────────────────────────────────────────");

      if (
        typeof raw.total !== "number" ||
        typeof raw.autosomes !== "number" ||
        typeof raw.sex !== "string" ||
        typeof raw.chromosomeImages !== "object" ||
        raw.chromosomeImages === null
      ) {
        console.error("Unexpected report shape:", raw);
        setErrorMsg("Report data is missing expected fields. Check backend.");
        setStatusMsg("Error: invalid report structure.");
        setDebugInfo(
          `Backend sent: total=${rawTotal}, sex=${rawSex}, ` +
          `autosomes=${rawAutos}, ` +
          `chromosomeImages keys=[${rawKeys.join(",")}]`
        );
        return;
      }

      const normalizedImages = normalizeChromosomeImages(raw.chromosomeImages);
      const normalizedKeys = Object.keys(normalizedImages);

      console.log("chromosomeImages keys (normalized):", normalizedKeys);

      const data: ReportData = {
        total: raw.total,
        autosomes: raw.autosomes,
        sex: raw.sex,
        chromosomeImages: normalizedImages,
        karyogramImage: raw.karyogramImage || null,
      };

      setReportData(data);

      if (data.karyogramImage) {
        const karyogramSrc = data.karyogramImage.startsWith("data:") 
          ? data.karyogramImage 
          : `data:image/png;base64,${data.karyogramImage}`;
        setKaryogramImage(karyogramSrc);
      }

      const imgCount = normalizedKeys.length;

      if (imgCount === 0) {
        setDebugInfo(
          `Report loaded but no chromosome images were returned. ` +
          `Raw keys from backend: [${rawKeys.join(",")}]. ` +
          `Check that straightened_images are populated in the backend.`
        );
      } else if (imgCount < 20) {
        setDebugInfo(
          `Only ${imgCount} of 24 chromosome images received. ` +
          `Keys: [${normalizedKeys.join(",")}]. ` +
          `Missing chromosomes will show as placeholders.`
        );
      }

      setStatusMsg(
        `Report ready — ${data.total} chromosomes (${data.sex}), ${imgCount}/24 images.`
      );

    } catch (e: any) {
      console.error("Classification fetch error:", e);
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

  const displayImage = resultImage || preview;

  // Get layout classes based on mode
  const getLayoutClasses = () => {
    switch (layoutMode) {
      case "focused-left":
        return { leftPanel: "flex-1", rightPanel: "hidden" };
      case "focused-right":
        return { leftPanel: "hidden", rightPanel: "flex-1" };
      default:
        return { leftPanel: "flex-1", rightPanel: "w-[480px] flex-shrink-0" };
    }
  };

  const layoutClasses = getLayoutClasses();

  useEffect(() => {
    if (resultImage && DetectedChromosomeAreas.length > 0) {
      const img = new Image();
      img.onload = () => {
        drawPolygons(img);
      };
      img.src = resultImage;
    }
  }, [selectedChromosomeArea, drawPolygons, resultImage, DetectedChromosomeAreas]);

  // Cycle through layout modes
  const cycleLayoutMode = () => {
    const modes: LayoutMode[] = ["split", "focused-left", "focused-right"];
    const currentIndex = modes.indexOf(layoutMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setLayoutMode(modes[nextIndex]);
    setStatusMsg(`Layout: ${modes[nextIndex] === "split" ? "Split View" : modes[nextIndex] === "focused-left" ? "Focus on Image" : "Focus on Report"}`);
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
        .ws-banner-error {
          background: #fef0f0; border-bottom: 1px solid #f5c0c0; color: #a00000;
        }
        .ws-banner-info {
          background: #f0f6ff; border-bottom: 1px solid #b8d4f5; color: #004080;
        }
        .ws-banner svg  { flex-shrink: 0; margin-top: 1px; }
        .ws-banner-msg  { flex: 1; }
        .ws-banner-close {
          background: none; border: none; cursor: pointer; padding: 0 2px;
          display: flex; align-items: center; opacity: .7; transition: opacity .1s;
          color: inherit;
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
          transition: all 0.3s ease;
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
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          max-width: 100%;
          max-height: 100%;
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
        .ws-loading-dots::after {
          content: ''; animation: ws-dots 1.2s steps(3,end) infinite;
        }

        /* ── Detection badge ── */
        .ws-detect-badge {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 10.5px; font-weight: 600; font-family: 'Consolas', monospace;
          color: #107c10; background: #dff6dd;
          border: 1px solid #b8d9b0;
          padding: 1px 7px; border-radius: 2px;
        }

        /* ── Karyogram Image ── */
        .ws-karyogram-container {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          background: #fafafa;
          overflow: auto;
        }
        .ws-karyogram-image {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          border: 1px solid #e0e0e0;
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        /* ── Report panel ── */
        .ws-report-scroll {
          flex: 1; overflow-y: auto; padding: 12px 16px;
          background: #ffffff;
        }
        .ws-chr-row { display: flex; }
        .ws-chr-sep { height: 1px; background: #e0e0e0; margin: 8px 0; }
        .ws-chr-cell {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          padding: 6px 2px 4px;
          border-right: 1px solid #e0e0e0;
          animation: ws-slidein .2s ease both;
        }
        .ws-chr-cell:last-child { border-right: none; }
        .ws-chr-img {
          height: 64px; display: flex;
          align-items: flex-end; justify-content: center; padding-bottom: 2px;
        }
        .ws-chr-img img  { max-height: 100%; max-width: 100%; object-fit: contain; opacity: .95; }
        .ws-chr-skel {
          width: 14px; height: 46px;
          background: linear-gradient(90deg, #e0e0e0 25%, #f0f0f0 50%, #e0e0e0 75%);
          background-size: 400px 100%;
          animation: ws-shimmer 1.4s infinite;
          border-radius: 3px; opacity: .8;
        }
        .ws-chr-label {
          font-size: 10px; color: #666666;
          font-family: 'Consolas', monospace; margin-top: 3px;
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

        .ws-back-btn {
          background: none;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          border-radius: 4px;
          color: #666666;
          margin-right: 8px;
        }
        .ws-back-btn:hover {
          background: #e0e0e0;
          color: #000000;
        }

        .hidden { display: none !important; }

        @media print {
          .ws-ribbon, .ws-statusbar,
          .ws-banner-error, .ws-banner-info { display: none !important; }
          .ws-panel-right { width: 100% !important; }
          .hidden-print { display: none !important; }
        }
      `}</style>

      <div className="ws-window">

        {/* ── Ribbon ── */}
        <div className="ws-ribbon">
          <div className="ws-ribbon-group">
            <button className="ws-rbtn" onClick={() => navigate("/")}>
              <span className="icon">{SVG.back}</span>Back
            </button>
            <button className="ws-rbtn" onClick={() => fileInputRef.current?.click()}>
              <span className="icon">{SVG.folder}</span>Open
            </button>
          </div>

          <div className="ws-ribbon-group">
            {RIBBON_TOOLS.map(({ id, label, icon }) => (
              <button
                key={id}
                className={`ws-rbtn ${activeTool === id ? "ws-rbtn-active" : ""}`}
                onClick={() => setActiveTool(id)}
                disabled={!selectedFile}
              >
                <span className="icon">{icon}</span>{label}
              </button>
            ))}
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
            <button
              className="ws-rbtn ws-rbtn-success"
              onClick={generateReport}
              disabled={!selectedFile || loading}
              title={!selectedFile ? "Open an image first" : "Classify and generate report"}
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
            <button className="ws-banner-close" onClick={dismissError} title="Dismiss">
              {SVG.close}
            </button>
          </div>
        )}

        {/* ── Debug / info banner ── */}
        {debugInfo && (
          <div className="ws-banner ws-banner-info">
            {SVG.info}
            <span className="ws-banner-msg">{debugInfo}</span>
            <button className="ws-banner-close" onClick={dismissDebug} title="Dismiss">
              {SVG.close}
            </button>
          </div>
        )}

        {/* ── Body ── */}
        <div className="ws-body">
          <div className="ws-main">

            {/* ── Image viewer ── */}
            <div className={`ws-panel ws-panel-left ${layoutClasses.leftPanel === "hidden" ? "hidden" : ""}`} style={{ flex: layoutClasses.leftPanel !== "hidden" ? (layoutClasses.leftPanel === "flex-1" ? 1 : undefined) : undefined }}>
              <div className="ws-panel-titlebar">
                <span className="ws-panel-title">
                  Image Viewer
                  {hasDetection && (
                    <span className="ws-detect-badge">
                      {SVG.check}&nbsp;Detections overlaid
                    </span>
                  )}
                </span>
                <div className="ws-panel-actions">
                  <button
                    className="ws-panel-act"
                    title="Open image"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {SVG.folder}
                  </button>
                </div>
              </div>

              <div
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
                  <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <img src={displayImage} alt="Chromosome spread" draggable={false} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                    {DetectedChromosomeAreas.length > 0 && (
                      <canvas
                        ref={canvasRef}
                        onClick={handleCanvasClick}
                        onMouseMove={handleCanvasMouseMove}
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

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.tif,.tiff"
                  onChange={handleFileInput}
                  style={{ display: "none" }}
                />
              </div>
            </div>

            {/* ── Karyotype report ── */}
            <div className={`ws-panel ws-panel-right ${layoutClasses.rightPanel === "hidden" ? "hidden" : ""}`} style={{ width: layoutClasses.rightPanel === "w-[480px] flex-shrink-0" ? "480px" : "100%", flexShrink: layoutClasses.rightPanel === "w-[480px] flex-shrink-0" ? 0 : 1 }}>
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

              {loading && loadingPhase === "report" ? (
                <div className="ws-loading-overlay-inline">
                  <WinSpinner />
                  <span className="ws-loading-txt ws-loading-dots">Classifying chromosomes</span>
                </div>

              ) : (karyogramImage || reportData) ? (
                <>
                  {/* Karyogram Image Section */}
                  {karyogramImage && (
                    <div className="ws-karyogram-container">
                      <img src={karyogramImage} alt="Karyogram" className="ws-karyogram-image" />
                    </div>
                  )}
                  
                  {/* Chromosome Grid Section */}
                  {reportData && reportData.chromosomeImages && Object.keys(reportData.chromosomeImages).length > 0 && (
                    <>
                      <div className="ws-report-scroll">
                        {CHROMOSOME_ROWS.map((row, ri) => (
                          <React.Fragment key={ri}>
                            {ri > 0 && <div className="ws-chr-sep" />}
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
                          </React.Fragment>
                        ))}
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
                      {
                        num: 1,
                        done: !!selectedFile,
                        active: !selectedFile,
                        text: "Open a chromosome image",
                      },
                      {
                        num: 2,
                        done: hasDetection,
                        active: !!selectedFile && !hasDetection,
                        text: "Run Analysis (Ribbon → Analyze)",
                      },
                      {
                        num: 3,
                        done: !!reportData || !!karyogramImage,
                        active: hasDetection && !reportData && !karyogramImage,
                        text: "Generate Report (Ribbon → Report)",
                      },
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
              Layout: {layoutMode === "split" ? "Split" : layoutMode === "focused-left" ? "Image" : "Report"}
            </span>
          </div>
        </div>

      </div>
    </>
  );
}