"use client";

import { useT } from "@/lib/use-i18n";

import {
  AlertTriangle,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  CopyPlus,
  Eraser,
  FileText,
  GitBranch,
  Hand,
  History,
  Image as ImageIcon,
  Lock,
  Map,
  Minus,
  MousePointer2,
  PenTool,
  Pencil,
  Play,
  Plus,
  Scan,
  Search,
  ShieldAlert,
  Sparkles,
  StickyNote,
  Trash2,
  Type,
  Unlock,
  X,
  Layers,
  CalendarClock,
  MousePointerClick,
  Webhook,
  MessageSquare,
  RefreshCw,
  Zap,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  type Agent,
  type Engine,
  type Workflow,
  type WorkflowRun,
  type WorkflowStep,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { Select } from "@/components/ui/Select";

export interface WorkflowCanvasProps {
  workflow: Workflow;
  workflows: Workflow[];
  agents: Agent[];
  engines: Engine[];
  runs: WorkflowRun[];
  onSelectWorkflow: (id: number) => void;
  onCreateWorkflow: () => void;
  onUpdateWorkflow: (updated: Partial<Workflow>) => Promise<void>;
  onRunWorkflow: () => Promise<void>;
  onClose: () => void;
  onRefreshRuns: () => Promise<void>;
}

type ToolMode = "select" | "pan" | "draw" | "note" | "shape" | "text" | "search";
export type ShapeKind = "rectangle" | "circle" | "diamond" | "triangle" | "inverted" | "oval" | "star";

export interface NodeSizeLimits {
  defaultWidth: number;
  defaultHeight?: number;
  minWidth: number;
  maxWidth: number;
  minHeight?: number;
  maxHeight?: number;
  resizable: boolean;
}

export const NODE_SIZE_CONFIG: Record<string, NodeSizeLimits> = {
  trigger: {
    defaultWidth: 320,
    minWidth: 280,
    maxWidth: 480,
    resizable: false,
  },
  llm: {
    defaultWidth: 440,
    defaultHeight: 380,
    minWidth: 340,
    maxWidth: 720,
    minHeight: 260,
    maxHeight: 850,
    resizable: true,
  },
  agent: {
    defaultWidth: 440,
    defaultHeight: 380,
    minWidth: 340,
    maxWidth: 720,
    minHeight: 260,
    maxHeight: 850,
    resizable: true,
  },
  action: {
    defaultWidth: 380,
    defaultHeight: 280,
    minWidth: 320,
    maxWidth: 640,
    minHeight: 200,
    maxHeight: 650,
    resizable: true,
  },
  condition: {
    defaultWidth: 360,
    defaultHeight: 240,
    minWidth: 300,
    maxWidth: 540,
    minHeight: 180,
    maxHeight: 500,
    resizable: true,
  },
  approval: {
    defaultWidth: 360,
    defaultHeight: 240,
    minWidth: 300,
    maxWidth: 540,
    minHeight: 180,
    maxHeight: 500,
    resizable: true,
  },
  note: {
    defaultWidth: 240,
    defaultHeight: 240,
    minWidth: 160,
    maxWidth: 640,
    minHeight: 140,
    maxHeight: 640,
    resizable: true,
  },
  shape: {
    defaultWidth: 208,
    defaultHeight: 128,
    minWidth: 48,
    maxWidth: 960,
    minHeight: 48,
    maxHeight: 960,
    resizable: true,
  },
  section: {
    defaultWidth: 500,
    defaultHeight: 340,
    minWidth: 260,
    maxWidth: 1600,
    minHeight: 180,
    maxHeight: 1200,
    resizable: true,
  },
  text: {
    defaultWidth: 280,
    defaultHeight: 70,
    minWidth: 160,
    maxWidth: 800,
    minHeight: 40,
    maxHeight: 400,
    resizable: true,
  },
  end: {
    defaultWidth: 280,
    minWidth: 240,
    maxWidth: 360,
    resizable: false,
  },
};

interface ResizingNodeState {
  stepId: string;
  startPointerX: number;
  startPointerY: number;
  startWidth: number;
  startHeight: number;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

interface DraggingConnection {
  fromStepId: string;
  fromPort: "out" | "true" | "false" | "approve" | "reject";
  fromDirection?: "output" | "input";
  targetInputPort?: "text" | "image" | "file";
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  snappedTargetId: string | null;
  snappedInputPort?: "text" | "image" | "file";
  snappedOutputPort?: "out" | "true" | "false" | "approve" | "reject";
  validationResult?: ConnectionValidationResult;
}

export type WorkflowPortType = "text" | "image" | "file";

export interface ConnectionValidationResult {
  valid: boolean;
  error?: string;
  sourceType: WorkflowPortType;
  targetType: WorkflowPortType;
}

export function hasPathInWorkflow(
  startId: string,
  endId: string,
  steps: WorkflowStep[]
): boolean {
  if (startId === endId) return true;
  const visited = new Set<string>();
  const queue = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (currentId === endId) return true;

    const step = steps.find((s) => s.id === currentId);
    if (!step) continue;

    const neighbors: string[] = [];
    if (step.next_step_id) neighbors.push(step.next_step_id);
    if (step.if_true) neighbors.push(step.if_true);
    if (step.if_false) neighbors.push(step.if_false);
    if (step.on_approve) neighbors.push(step.on_approve);
    if (step.on_reject) neighbors.push(step.on_reject);

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return false;
}

export function getOutputPortDataType(
  _step: WorkflowStep,
  _port: "out" | "true" | "false" | "approve" | "reject"
): WorkflowPortType {
  // Trigger, LLM, Agent, Action, Condition, and Approval output text data
  return "text";
}

export function getInputPortDataType(
  _step: WorkflowStep,
  port: "text" | "image" | "file"
): WorkflowPortType {
  return port;
}

export function getOutputPortLabel(
  port: "out" | "true" | "false" | "approve" | "reject"
): string {
  if (port === "true") return "True";
  if (port === "false") return "False";
  if (port === "approve") return "Approve";
  if (port === "reject") return "Reject";
  return "Text";
}

export function validateConnection(
  sourceId: string,
  sourcePort: "out" | "true" | "false" | "approve" | "reject",
  targetId: string,
  targetInputPort: "text" | "image" | "file",
  steps: WorkflowStep[]
): ConnectionValidationResult {
  const sourceStep = steps.find((s) => s.id === sourceId);
  const targetStep = steps.find((s) => s.id === targetId);

  const sourceType = sourceStep ? getOutputPortDataType(sourceStep, sourcePort) : "text";
  const targetType = targetStep ? getInputPortDataType(targetStep, targetInputPort) : targetInputPort;

  // 1. Self connection limitation
  if (sourceId === targetId) {
    return {
      valid: false,
      error: "Cannot connect node to itself",
      sourceType,
      targetType,
    };
  }

  // 2. Already connected
  if (sourceStep) {
    let existingTarget: string | null | undefined = null;
    let existingTargetPort: string | undefined = "text";
    if (sourcePort === "out") {
      existingTarget = sourceStep.next_step_id;
      existingTargetPort = sourceStep.target_port || "text";
    } else if (sourcePort === "true") {
      existingTarget = sourceStep.if_true;
      existingTargetPort = sourceStep.if_true_target_port || "text";
    } else if (sourcePort === "false") {
      existingTarget = sourceStep.if_false;
      existingTargetPort = sourceStep.if_false_target_port || "text";
    } else if (sourcePort === "approve") {
      existingTarget = sourceStep.on_approve;
      existingTargetPort = sourceStep.on_approve_target_port || "text";
    } else if (sourcePort === "reject") {
      existingTarget = sourceStep.on_reject;
      existingTargetPort = sourceStep.on_reject_target_port || "text";
    }

    if (existingTarget === targetId && existingTargetPort === targetInputPort) {
      return {
        valid: false,
        error: "Already connected",
        sourceType,
        targetType,
      };
    }
  }

  // 3. Cyclical connection limitation
  if (hasPathInWorkflow(targetId, sourceId, steps)) {
    return {
      valid: false,
      error: "Cannot create cyclical loop",
      sourceType,
      targetType,
    };
  }

  // 4. Data type compatibility limitation ("Gives text, not image", etc.)
  if (sourceType !== targetType) {
    return {
      valid: false,
      error: `Gives ${sourceType}, not ${targetType}`,
      sourceType,
      targetType,
    };
  }

  return {
    valid: true,
    sourceType,
    targetType,
  };
}

interface FreehandStroke {
  id: string;
  points: Array<{ x: number; y: number }>;
  color: string;
}

interface SelectedWire {
  fromStepId: string;
  toStepId: string;
  port: "out" | "true" | "false" | "approve" | "reject";
}

export const SHAPE_DEFAULT_SIZES: Record<ShapeKind, { width: number; height: number }> = {
  rectangle: { width: 208, height: 128 },
  circle: { width: 144, height: 144 },
  diamond: { width: 160, height: 160 },
  triangle: { width: 160, height: 144 },
  inverted: { width: 160, height: 144 },
  oval: { width: 208, height: 128 },
  star: { width: 160, height: 152 },
};

export const NOTE_TONE_CONFIG: Record<
  string,
  { paper: string; edge: string; ink: string; label: string; preview: string }
> = {
  yellow: {
    paper: "color-mix(in srgb, var(--identity-1) 12%, var(--bg-surface))",
    edge: "var(--accent)",
    ink: "var(--ink)",
    label: "Yellow",
    preview: "var(--accent)",
  },
  orange: {
    paper: "color-mix(in srgb, var(--identity-2) 12%, var(--bg-surface))",
    edge: "var(--identity-7)",
    ink: "var(--ink)",
    label: "Orange",
    preview: "var(--identity-7)",
  },
  red: {
    paper: "color-mix(in srgb, var(--identity-3) 12%, var(--bg-surface))",
    edge: "var(--danger)",
    ink: "var(--ink)",
    label: "Red",
    preview: "var(--danger)",
  },
  pink: {
    paper: "color-mix(in srgb, var(--identity-4) 12%, var(--bg-surface))",
    edge: "var(--identity-5)",
    ink: "var(--ink)",
    label: "Pink",
    preview: "var(--identity-5)",
  },
  blue: {
    paper: "color-mix(in srgb, var(--identity-5) 12%, var(--bg-surface))",
    edge: "var(--accent)",
    ink: "var(--ink)",
    label: "Blue",
    preview: "var(--accent)",
  },
  teal: {
    paper: "color-mix(in srgb, var(--identity-6) 12%, var(--bg-surface))",
    edge: "var(--identity-2)",
    ink: "var(--ink)",
    label: "Teal",
    preview: "var(--identity-2)",
  },
  green: {
    paper: "color-mix(in srgb, var(--identity-7) 12%, var(--bg-surface))",
    edge: "var(--success)",
    ink: "var(--ink)",
    label: "Green",
    preview: "var(--success)",
  },
  neutral: {
    paper: "color-mix(in srgb, var(--identity-8) 12%, var(--bg-surface))",
    edge: "var(--identity-8)",
    ink: "var(--ink)",
    label: "White",
    preview: "var(--identity-3)",
  },
};

export const INK_COLOR_LIST: { name: string; hex: string; label: string }[] = [
  { name: "ink", hex: "var(--ink)", label: "Dark" },
  { name: "orange", hex: "var(--identity-4)", label: "Orange" },
  { name: "yellow", hex: "var(--identity-9)", label: "Yellow" },
  { name: "red", hex: "var(--identity-2)", label: "Red" },
  { name: "pink", hex: "var(--identity-1)", label: "Pink" },
  { name: "blue", hex: "var(--identity-4)", label: "Blue" },
  { name: "teal", hex: "var(--identity-1)", label: "Teal" },
  { name: "green", hex: "var(--identity-3)", label: "Green" },
];

export const CANVAS_COLOR_PALETTE: { name: string; hex: string; label: string }[] = [
  { name: "ink", hex: "var(--ink)", label: "White" },
  { name: "orange", hex: "var(--identity-9)", label: "Orange" },
  { name: "peach", hex: "var(--identity-6)", label: "Peach" },
  { name: "red", hex: "var(--identity-8)", label: "Red" },
  { name: "pink", hex: "var(--identity-10)", label: "Pink" },
  { name: "blue", hex: "var(--identity-7)", label: "Blue" },
  { name: "teal", hex: "var(--identity-6)", label: "Teal" },
  { name: "green", hex: "var(--identity-5)", label: "Green" },
];

const STAR_POINTS = Array.from({ length: 10 }, (_, index) => {
  const reach = index % 2 === 0 ? 1 : 0.4;
  const angle = -Math.PI / 2 + (index * Math.PI) / 5;
  return `${(50 + 50 * reach * Math.cos(angle)).toFixed(1)},${(55 + 55 * reach * Math.sin(angle)).toFixed(1)}`;
}).join(" ");

const SHAPE_POLYGONS: Partial<Record<ShapeKind, string>> = {
  diamond: "50,0 100,50 50,100 0,50",
  triangle: "50,0 100,100 0,100",
  inverted: "0,0 100,0 50,100",
  star: STAR_POINTS,
};

function ShapeSurfaceSvg({
  shape,
  color = "var(--ink)",
  width,
  height,
  dashed,
}: {
  shape: ShapeKind;
  color?: string;
  width: number;
  height: number;
  dashed?: boolean;
}) {
  const poly = SHAPE_POLYGONS[shape];
  const strokeColor = color === "ink" ? "var(--ink)" : color;

  if (poly) {
    return (
      <svg
        width={width}
        height={height}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none overflow-visible drop-shadow-md"
      >
        <polygon
          points={poly}
          fill="rgba(255,255,255,0.06)"
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeDasharray={dashed ? "6 6" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  if (shape === "circle") {
    return (
      <div
        className={cn(
          "absolute inset-0 rounded-full border-2 transition-all drop-shadow-md",
          dashed && "border-dashed"
        )}
        style={{
          borderColor: strokeColor,
          backgroundColor: "rgba(255,255,255,0.06)",
        }}
      />
    );
  }

  if (shape === "oval") {
    return (
      <div
        className={cn(
          "absolute inset-0 rounded-full border-2 transition-all drop-shadow-md",
          dashed && "border-dashed"
        )}
        style={{
          borderColor: strokeColor,
          backgroundColor: "rgba(255,255,255,0.06)",
        }}
      />
    );
  }

  return (
    <div
      className={cn(
        "absolute inset-0 rounded-2xl border-2 transition-all drop-shadow-md",
        dashed && "border-dashed"
      )}
      style={{
        borderColor: strokeColor,
        backgroundColor: "rgba(255,255,255,0.06)",
      }}
    />
  );
}

function DrawArt({ color = "var(--ink)", eraser = false }: { color?: string; eraser?: boolean }) {
  if (eraser) {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="transition-transform group-hover:scale-110"
        aria-hidden="true"
      >
        <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
        <path d="M22 21H7" />
        <path d="m5 11 9 9" />
      </svg>
    );
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="transition-transform group-hover:scale-110"
      aria-hidden="true"
    >
      <polygon points="12,2 15.5,8 8.5,8" fill="var(--accent)" />
      <polygon points="12,2 13.5,4.5 10.5,4.5" fill="var(--ink)" />
      <rect x="8.5" y="8" width="7" height="14" rx="0.5" fill={color || "var(--ink)"} />
      <rect x="10.8" y="8" width="2.4" height="14" fill="rgba(0,0,0,0.15)" />
    </svg>
  );
}

function StickyArt({ tone = "var(--identity-9)" }: { tone?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 48 48"
      className="transition-transform group-hover:scale-110"
      aria-hidden="true"
    >
      <rect fill={tone} opacity="0.35" x="8" y="10" width="30" height="30" rx="3" />
      <rect fill={tone} opacity="0.65" x="9" y="9" width="30" height="30" rx="3" />
      <path
        d="M 10 8 L 32 8 L 40 16 L 40 37 A 3 3 0 0 1 37 40 L 13 40 A 3 3 0 0 1 10 37 Z"
        fill={tone}
      />
      <path
        d="M 32 8 L 32 15 A 1 1 0 0 0 33 16 L 40 16 Z"
        fill="color-mix(in srgb, var(--identity-2) 12%, var(--bg-surface))"
      />
    </svg>
  );
}

function ShapesArt({
  shape = "rectangle",
  color = "var(--ink)",
}: {
  shape?: string;
  color?: string;
}) {
  void shape;
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 48 48"
      className="transition-transform group-hover:scale-110"
      aria-hidden="true"
    >
      <rect fill="var(--ink-muted)" x="6" y="14" width="22" height="22" rx="4" />
      <circle fill="var(--ink-muted)" cx="34" cy="28" r="10" />
      <rect
        fill={color}
        x="16"
        y="8"
        width="22"
        height="22"
        rx="4"
        stroke="var(--ink)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function WorkflowCanvas({
  workflow,
  workflows,
  agents,
  engines,
  runs,
  onSelectWorkflow,
  onCreateWorkflow,
  onUpdateWorkflow,
  onRunWorkflow,
  onClose,
  onRefreshRuns,
}: WorkflowCanvasProps) {
  const t = useT();
  // Canvas viewport navigation
  const [pan, setPan] = useState({ x: 140, y: 80 });
  const [zoom, setZoom] = useState(0.85);
  const [tool, setTool] = useState<ToolMode>("select");
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 140, panY: 80 });

  // High-performance local node positions map
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const nodePositionsRef = useRef<Record<string, { x: number; y: number }>>({});

  // High-performance dynamic node sizes map
  const [nodeSizes, setNodeSizes] = useState<Record<string, { width: number; height?: number }>>({});
  const nodeSizesRef = useRef<Record<string, { width: number; height?: number }>>({});
  const [resizingNode, setResizingNode] = useState<ResizingNodeState | null>(null);
  const hasResizedNodeRef = useRef(false);

  // Trigger node popover menus
  const [activeTriggerMenuStepId, setActiveTriggerMenuStepId] = useState<string | null>(null);
  const [activeChipMenu, setActiveChipMenu] = useState<{ stepId: string; type: "kind" | "days" | "time" | "hours" } | null>(null);

  // Canvas steps directly from workflow model (no auto-resurrection on delete, with wire sanitization)
  const effectiveSteps = useMemo(() => {
    const rawSteps = workflow.steps || [];
    const nonTargetIds = new Set(
      rawSteps
        .filter((s) => s.type === "note" || s.type === "shape" || s.type === "section" || s.type === "text")
        .map((s) => s.id)
    );
    if (nonTargetIds.size === 0) return rawSteps;
    return rawSteps.map((s) => {
      let modified = false;
      const next = { ...s };
      if (next.next_step_id && nonTargetIds.has(next.next_step_id)) {
        next.next_step_id = null;
        next.target_port = undefined;
        modified = true;
      }
      if (next.if_true && nonTargetIds.has(next.if_true)) {
        next.if_true = undefined;
        next.if_true_target_port = undefined;
        modified = true;
      }
      if (next.if_false && nonTargetIds.has(next.if_false)) {
        next.if_false = undefined;
        next.if_false_target_port = undefined;
        modified = true;
      }
      if (next.on_approve && nonTargetIds.has(next.on_approve)) {
        next.on_approve = undefined;
        next.on_approve_target_port = undefined;
        modified = true;
      }
      if (next.on_reject && nonTargetIds.has(next.on_reject)) {
        next.on_reject = undefined;
        next.on_reject_target_port = undefined;
        modified = true;
      }
      return modified ? next : s;
    });
  }, [workflow.steps]);

  // Exact port Y offset matching each trigger card height
  const getTriggerPortOffsetY = useCallback((step: WorkflowStep): number => {
    const t = step.trigger_type || "schedule";
    if (t === "manual") return 54;
    if (t === "webhook") return 110;
    if (t === "message") return 72;
    if (t === "schedule") {
      if (step.schedule_kind === "cron") return 72;
      return 92;
    }
    return 75;
  }, []);

  // Exact port Y offset for target input ports (matching benchmark stacked ports)
  const getInputPortOffsetY = useCallback(
    (step: WorkflowStep, portType: "text" | "image" | "file" = "text"): number => {
      if (step.type === "llm" || step.type === "agent" || step.type === "action") {
        if (portType === "image") return 82;
        if (portType === "file") return 116;
        return 48; // text
      }
      return 48;
    },
    []
  );

  // Exact port Y offset for source output ports (matching benchmark right ports)
  const getOutputPortOffsetY = useCallback(
    (step: WorkflowStep, port: "out" | "true" | "false" | "approve" | "reject" = "out"): number => {
      if (step.type === "trigger") {
        return getTriggerPortOffsetY(step);
      }
      if (step.type === "condition" || step.type === "approval") {
        return port === "false" || port === "reject" ? 74 : 46;
      }
      return 48;
    },
    [getTriggerPortOffsetY]
  );

  // Helper to find any active wire plugged into a specific input port
  const getIncomingWire = useCallback(
    (targetStepId: string, targetPort: "text" | "image" | "file" = "text") => {
      for (const s of effectiveSteps) {
        if (s.type === "condition") {
          if (s.if_true === targetStepId && (s.if_true_target_port || "text") === targetPort) {
            return { fromStep: s, port: "true" as const };
          }
          if (s.if_false === targetStepId && (s.if_false_target_port || "text") === targetPort) {
            return { fromStep: s, port: "false" as const };
          }
        } else if (s.type === "approval") {
          if (s.on_approve === targetStepId && (s.on_approve_target_port || "text") === targetPort) {
            return { fromStep: s, port: "approve" as const };
          }
          if (s.on_reject === targetStepId && (s.on_reject_target_port || "text") === targetPort) {
            return { fromStep: s, port: "reject" as const };
          }
        } else if (s.type !== "end" && s.type !== "note" && s.type !== "section" && s.type !== "text") {
          if (s.next_step_id === targetStepId && (s.target_port || "text") === targetPort) {
            return { fromStep: s, port: "out" as const };
          }
        }
      }
      return null;
    },
    [effectiveSteps]
  );

  const computeNextRun = useCallback((step: WorkflowStep): string => {
    const now = new Date();
    const kind = step.schedule_kind || "daily";
    const days = step.schedule_days || "every_day";
    const time = step.schedule_time || "09:00";
    const hours = step.schedule_hours || 1;

    if (kind === "hourly") {
      const nextH = new Date(now.getTime() + hours * 3600 * 1000);
      return (
        nextH.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
        ", " +
        nextH.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      );
    }

    const [hStr, mStr] = time.split(":");
    const targetH = parseInt(hStr || "9", 10);
    const targetM = parseInt(mStr || "0", 10);

    const next = new Date(now);
    next.setHours(targetH, targetM, 0, 0);

    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    if (kind === "weekly") {
      const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
      };
      const targetDay = dayMap[days.toLowerCase()] ?? 1;
      while (next.getDay() !== targetDay) {
        next.setDate(next.getDate() + 1);
      }
    } else if (kind === "monthly") {
      if (days === "15th") next.setDate(15);
      else if (days === "last") next.setMonth(next.getMonth() + 1, 0);
      else next.setDate(1);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
      }
    } else {
      if (days === "weekdays") {
        while (next.getDay() === 0 || next.getDay() === 6) {
          next.setDate(next.getDate() + 1);
        }
      } else if (days === "weekends") {
        while (next.getDay() !== 0 && next.getDay() !== 6) {
          next.setDate(next.getDate() + 1);
        }
      }
    }

    return (
      next.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
      ", " +
      next.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    );
  }, []);

  // Sync positions from effective steps (including trigger node)
  useEffect(() => {
    const next: Record<string, { x: number; y: number }> = {};
    effectiveSteps.forEach((step, idx) => {
      const existing = nodePositionsRef.current[step.id];
      if (existing) {
        next[step.id] = existing;
      } else {
        const defX = step.x !== undefined ? step.x : step.type === "trigger" ? 60 : 440 + (idx % 3) * 380;
        const defY = step.y !== undefined ? step.y : step.type === "trigger" ? 140 : 140 + Math.floor(idx / 3) * 360;
        next[step.id] = { x: defX, y: defY };
      }
    });
    setNodePositions(next);
    nodePositionsRef.current = next;
  }, [workflow.id, effectiveSteps]);

  // Sync sizes from effective steps or fallback to standard benchmark sizes
  useEffect(() => {
    const next: Record<string, { width: number; height?: number }> = {};
    effectiveSteps.forEach((step) => {
      const existing = nodeSizesRef.current[step.id];
      if (existing) {
        next[step.id] = existing;
      } else {
        const cfg = NODE_SIZE_CONFIG[step.type] || NODE_SIZE_CONFIG.llm;
        next[step.id] = {
          width: step.width ?? cfg.defaultWidth,
          ...(step.height || cfg.defaultHeight ? { height: step.height ?? cfg.defaultHeight } : {}),
        };
      }
    });
    setNodeSizes(next);
    nodeSizesRef.current = next;
  }, [workflow.id, effectiveSteps]);

  // Helper to obtain current size & config for a node
  const getNodeSize = useCallback(
    (step: WorkflowStep) => {
      const local = nodeSizes[step.id];
      const cfg = NODE_SIZE_CONFIG[step.type] || NODE_SIZE_CONFIG.llm;
      const width = local?.width ?? step.width ?? cfg.defaultWidth;
      const height = local?.height ?? step.height ?? cfg.defaultHeight;
      return { width, height, cfg };
    },
    [nodeSizes]
  );

  // Initiate bottom-right corner resize gesture
  const handleResizePointerDown = (
    e: React.PointerEvent,
    stepId: string,
    cfg: NodeSizeLimits,
    currentWidth: number,
    currentHeight: number | undefined
  ) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const cardEl = (e.currentTarget as HTMLElement).closest(".workflow-node") as HTMLElement | null;
    const startH = currentHeight ?? (cardEl ? cardEl.offsetHeight : cfg.defaultHeight ?? 300);

    setResizingNode({
      stepId,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startWidth: currentWidth,
      startHeight: startH,
      minWidth: cfg.minWidth,
      maxWidth: cfg.maxWidth,
      minHeight: cfg.minHeight ?? 140,
      maxHeight: cfg.maxHeight ?? 900,
    });
    hasResizedNodeRef.current = false;
  };

  // Node selection & dragging
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragNodeOffsetRef = useRef({ x: 0, y: 0 });
  const hasMovedNodeRef = useRef(false);
  const [lockedNodes, setLockedNodes] = useState<Set<string>>(new Set());

  // Connection wire dragging & selection
  const [draggingWire, setDraggingWire] = useState<DraggingConnection | null>(null);
  const [hoveredWire, setHoveredWire] = useState<SelectedWire | null>(null);
  const [selectedWire, setSelectedWire] = useState<SelectedWire | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleWirePointerEnter = useCallback((wire: SelectedWire) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredWire(wire);
  }, []);

  const handleWirePointerLeave = useCallback((e: React.PointerEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && related.closest && related.closest(".wire-interactive")) return;
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredWire(null);
    }, 150);
  }, []);

  // Freehand drawing state
  const [strokes, setStrokes] = useState<FreehandStroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<FreehandStroke | null>(null);

  // UI Panels & menus
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showWorkflowMenu, setShowWorkflowMenu] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(workflow.name);
  const [expandedSystemPromptStepIds, setExpandedSystemPromptStepIds] = useState<Set<string>>(new Set());
  const [nodeSearch, setNodeSearch] = useState("");
  const [executionNotice, setExecutionNotice] = useState<string | null>(null);

  // Dock & Canvas Tools States
  const [showMinimap, setShowMinimap] = useState(false);
  const [showSearchPalette, setShowSearchPalette] = useState(false);
  const [canvasSearchQuery, setCanvasSearchQuery] = useState("");
  const [pulsingNodeId, setPulsingNodeId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<"pen" | "eraser">("pen");
  const [drawColor, setDrawColor] = useState<string>("var(--ink)");
  const [activeShapeKind, setActiveShapeKind] = useState<ShapeKind>("rectangle");
  const [activeShapeColor, setActiveShapeColor] = useState<string>("var(--ink)");
  const [showShapeColorMenu, setShowShapeColorMenu] = useState(false);
  const [activeNoteTone, setActiveNoteTone] = useState<string>("orange");
  const [openNoteMenu, setOpenNoteMenu] = useState<{ id: string; type: "tone" | "ink" | "font" | "size" | "align" } | null>(null);
  const [openShapeMenu, setOpenShapeMenu] = useState<{ id: string; type: "kind" | "color" } | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  // Execution states
  const [runningStepId, setRunningStepId] = useState<string | null>(null);
  const [stepOutputs, setStepOutputs] = useState<Record<string, string>>({});
  const [copiedStepId, setCopiedStepId] = useState<string | null>(null);
  const [liveRun, setLiveRun] = useState<WorkflowRun | null>(null);
  const [isExecutingWorkflow, setIsExecutingWorkflow] = useState(false);

  // Approval notes
  const [approvalNotes, setApprovalNotes] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Reset zoom to 100%
  const handleResetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  // Fit all nodes onto the visible screen with padding
  const handleFitToScreen = useCallback(() => {
    if (effectiveSteps.length === 0) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
      return;
    }

    const clientW = containerRef.current?.clientWidth || 1000;
    const clientH = containerRef.current?.clientHeight || 700;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    effectiveSteps.forEach((st) => {
      const pos = nodePositions[st.id] || { x: 420, y: 140 };
      const { width: w, height: h } = getNodeSize(st);
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x + w > maxX) maxX = pos.x + w;
      if (pos.y + (h || 200) > maxY) maxY = pos.y + (h || 200);
    });

    const boxW = Math.max(100, maxX - minX);
    const boxH = Math.max(100, maxY - minY);
    const padding = 120;

    const scaleX = (clientW - padding * 2) / boxW;
    const scaleY = (clientH - padding * 2) / boxH;
    const targetZoom = Math.min(1.2, Math.max(0.35, Math.min(scaleX, scaleY)));

    const centerX = minX + boxW / 2;
    const centerY = minY + boxH / 2;

    const targetPanX = Math.round(clientW / 2 - centerX * targetZoom);
    const targetPanY = Math.round(clientH / 2 - centerY * targetZoom);

    setZoom(Math.round(targetZoom * 100) / 100);
    setPan({ x: targetPanX, y: targetPanY });
  }, [effectiveSteps, nodePositions, getNodeSize]);

  // Jump to specific node from search palette & trigger pulsing highlight
  const handleJumpToNode = useCallback(
    (stepId: string) => {
      const pos = nodePositions[stepId];
      const targetStep = effectiveSteps.find((s) => s.id === stepId);
      if (pos && targetStep && containerRef.current) {
        const clientW = containerRef.current.clientWidth;
        const clientH = containerRef.current.clientHeight;
        const { width: w, height: h } = getNodeSize(targetStep);
        const targetPanX = Math.round(clientW / 2 - (pos.x + w / 2) * zoom);
        const targetPanY = Math.round(clientH / 2 - (pos.y + (h || 200) / 2) * zoom);
        setPan({ x: targetPanX, y: targetPanY });
        setSelectedNodeId(stepId);
        setPulsingNodeId(stepId);
        setTimeout(() => setPulsingNodeId(null), 2200);
      }
      setShowSearchPalette(false);
    },
    [nodePositions, effectiveSteps, zoom, getNodeSize]
  );

  // Global Keyboard shortcuts matching benchmark design
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") {
          (e.target as HTMLElement)?.blur();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowSearchPalette(true);
        return;
      }

      if (e.key === "Escape") {
        setShowSearchPalette(false);
        setTool("select");
        setOpenNoteMenu(null);
        setOpenShapeMenu(null);
        setShowShapeColorMenu(false);
        setGhostPos(null);
        return;
      }

      const key = e.key.toLowerCase();
      if (key === "v") {
        setTool("select");
        setGhostPos(null);
      } else if (key === "h") {
        setTool("pan");
        setGhostPos(null);
      } else if (key === "p") {
        setTool("draw");
        setDrawMode("pen");
        setGhostPos(null);
      } else if (key === "e") {
        if (tool === "draw") {
          setDrawMode("eraser");
        }
      } else if (key === "n") {
        setTool("note");
      } else if (key === "r") {
        setTool("shape");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tool]);



  // Sync title
  useEffect(() => {
    setTitleInput(workflow.name);
  }, [workflow.name]);

  // Close note & shape popover menus on outside pointerdown
  useEffect(() => {
    const handleGlobalPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        !target.closest(".popover-dropdown") &&
        !target.closest("[data-popover-trigger='true']")
      ) {
        setOpenNoteMenu(null);
        setOpenShapeMenu(null);
        setShowShapeColorMenu(false);
      }
    };
    window.addEventListener("pointerdown", handleGlobalPointerDown);
    return () => window.removeEventListener("pointerdown", handleGlobalPointerDown);
  }, []);

  // Extract available models from engines
  const availableModels = useMemo(() => {
    const list: Array<{ id: string; label: string; provider: string }> = [];
    engines.forEach((eng) => {
      if (eng.models && eng.models.length > 0) {
        eng.models.forEach((m) => {
          list.push({ id: m.id, label: m.label || m.id, provider: eng.label });
        });
      } else {
        list.push({ id: eng.id, label: eng.label, provider: eng.label });
      }
    });
    if (list.length === 0) {
      list.push(
        { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "Google" },
        { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet", provider: "Anthropic" },
        { id: "gpt-4o", label: "GPT-4o", provider: "OpenAI" }
      );
    }
    return list;
  }, [engines]);

  // Live run polling & completion handling
  useEffect(() => {
    if (!liveRun || liveRun.status === "completed" || liveRun.status === "failed" || liveRun.status === "cancelled") {
      if (liveRun && isExecutingWorkflow) {
        setIsExecutingWorkflow(false);
        setExecutionNotice(
          liveRun.status === "completed"
            ? "Workflow completed successfully!"
            : `Workflow ended with status: ${liveRun.status}`
        );
        setTimeout(() => setExecutionNotice(null), 4000);
        void onRefreshRuns();
      }
      return;
    }

    const timer = setInterval(async () => {
      try {
        const fresh = await api.getWorkflowRun(liveRun.id);
        setLiveRun(fresh);
        if (fresh.step_states) {
          const newOutputs: Record<string, string> = {};
          Object.entries(fresh.step_states).forEach(([sId, state]) => {
            if (state.output) newOutputs[sId] = state.output;
          });
          setStepOutputs((prev) => ({ ...prev, ...newOutputs }));
        }
      } catch {
        // ignore
      }
    }, 600);

    return () => clearInterval(timer);
  }, [liveRun, isExecutingWorkflow, onRefreshRuns]);

  // Keyboard navigation & deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).tagName === "INPUT" ||
        (e.target as HTMLElement).tagName === "TEXTAREA"
      ) {
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeId && !lockedNodes.has(selectedNodeId)) {
          e.preventDefault();
          handleDeleteStep(selectedNodeId);
        } else if (selectedWire) {
          e.preventDefault();
          handleDisconnectWire(selectedWire.fromStepId, selectedWire.port);
        }
      } else if (e.key === "Escape") {
        setSelectedNodeId(null);
        setSelectedWire(null);
        setShowAddMenu(false);
        setShowWorkflowMenu(false);
      } else if (e.key === " ") {
        setTool("pan");
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        setTool("select");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [selectedNodeId, selectedWire, lockedNodes]);

  // Smooth cursor-anchored zoom
  const handleZoom = useCallback((delta: number, clientX?: number, clientY?: number) => {
    setZoom((prevZoom) => {
      const nextZoom = Math.min(2.0, Math.max(0.25, Math.round((prevZoom + delta) * 100) / 100));
      if (clientX !== undefined && clientY !== undefined && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        setPan((prevPan) => ({
          x: mouseX - (mouseX - prevPan.x) * (nextZoom / prevZoom),
          y: mouseY - (mouseY - prevPan.y) * (nextZoom / prevZoom),
        }));
      }
      return nextZoom;
    });
  }, []);


  // Wheel zoom anchored to pointer
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        handleZoom(delta, e.clientX, e.clientY);
      } else {
        setPan((p) => ({
          x: p.x - e.deltaX,
          y: p.y - e.deltaY,
        }));
      }
    },
    [handleZoom]
  );

  // Background pointer down (Pan / Draw / Deselect)
  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (
      (e.target as HTMLElement).closest(".workflow-node") ||
      (e.target as HTMLElement).closest(".ui-dock") ||
      (e.target as HTMLElement).closest(".wire-interactive")
    ) {
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ptX = (e.clientX - rect.left - pan.x) / zoom;
    const ptY = (e.clientY - rect.top - pan.y) / zoom;

    if (tool === "draw") {
      if (drawMode === "pen") {
        setCurrentStroke({
          id: `stroke_${Date.now()}`,
          points: [{ x: ptX, y: ptY }],
          color: drawColor || "var(--ink)",
        });
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } else {
        // Eraser: delete strokes intersecting pointer
        setStrokes((prev) =>
          prev.filter(
            (st) =>
              !st.points.some(
                (p) => Math.hypot(p.x - ptX, p.y - ptY) < 22
              )
          )
        );
      }
      return;
    }

    if (tool === "shape") {
      const shapeDef = SHAPE_DEFAULT_SIZES[activeShapeKind] || { width: 208, height: 128 };
      const newId = `step_${Date.now().toString(36)}`;
      const posX = Math.round(ptX - shapeDef.width / 2);
      const posY = Math.round(ptY - shapeDef.height / 2);

      const newStep: WorkflowStep = {
        id: newId,
        name: "Shape",
        type: "shape",
        shape: activeShapeKind,
        color: activeShapeColor || "var(--ink)",
        text: "",
        x: posX,
        y: posY,
        width: shapeDef.width,
        height: shapeDef.height,
      };

      setNodePositions((prev) => ({ ...prev, [newId]: { x: posX, y: posY } }));
      setNodeSizes((prev) => ({ ...prev, [newId]: { width: shapeDef.width, height: shapeDef.height } }));
      void onUpdateWorkflow({ steps: [...effectiveSteps, newStep] });
      setSelectedNodeId(newId);
      setTool("select");
      setGhostPos(null);
      return;
    }

    if (tool === "note") {
      const newId = `step_${Date.now().toString(36)}`;
      const posX = Math.round(ptX - 120);
      const posY = Math.round(ptY - 120);
      const tone = activeNoteTone || "orange";

      const newStep: WorkflowStep = {
        id: newId,
        name: "Note",
        type: "note",
        tone: tone,
        color: tone,
        ink: NOTE_TONE_CONFIG[tone]?.ink || "var(--ink)",
        font: "sans",
        size: 18,
        align: "left",
        bold: false,
        text: "",
        x: posX,
        y: posY,
        width: 240,
        height: 240,
      };

      setNodePositions((prev) => ({ ...prev, [newId]: { x: posX, y: posY } }));
      setNodeSizes((prev) => ({ ...prev, [newId]: { width: 240, height: 240 } }));
      void onUpdateWorkflow({ steps: [...effectiveSteps, newStep] });
      setSelectedNodeId(newId);
      setTool("select");
      setGhostPos(null);
      return;
    }

    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setSelectedNodeId(null);
    setSelectedWire(null);
    setActiveTriggerMenuStepId(null);
    setActiveChipMenu(null);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  // High-performance pointer move (60fps local update)
  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const ptX = rect ? (e.clientX - rect.left - pan.x) / zoom : 0;
    const ptY = rect ? (e.clientY - rect.top - pan.y) / zoom : 0;

    if (tool === "shape" || tool === "note") {
      setGhostPos({ x: ptX, y: ptY });
    }

    if (tool === "draw" && drawMode === "eraser") {
      setGhostPos({ x: ptX, y: ptY });
      if (e.buttons === 1) {
        setStrokes((prev) =>
          prev.filter(
            (st) =>
              !st.points.some(
                (p) => Math.hypot(p.x - ptX, p.y - ptY) < 22
              )
          )
        );
      }
      return;
    }
    if (resizingNode) {
      const dx = (e.clientX - resizingNode.startPointerX) / zoom;
      const dy = (e.clientY - resizingNode.startPointerY) / zoom;

      const newWidth = Math.round(
        Math.min(resizingNode.maxWidth, Math.max(resizingNode.minWidth, resizingNode.startWidth + dx))
      );
      const newHeight = Math.round(
        Math.min(resizingNode.maxHeight, Math.max(resizingNode.minHeight, resizingNode.startHeight + dy))
      );

      hasResizedNodeRef.current = true;

      setNodeSizes((prev) => {
        const next = {
          ...prev,
          [resizingNode.stepId]: { width: newWidth, height: newHeight },
        };
        nodeSizesRef.current = next;
        return next;
      });
      return;
    }

    if (currentStroke) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ptX = (e.clientX - rect.left - pan.x) / zoom;
      const ptY = (e.clientY - rect.top - pan.y) / zoom;
      setCurrentStroke((prev) =>
        prev ? { ...prev, points: [...prev.points, { x: ptX, y: ptY }] } : null
      );
    } else if (isPanning) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
    } else if (draggingNodeId) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const rawX = (e.clientX - rect.left - pan.x) / zoom;
      const rawY = (e.clientY - rect.top - pan.y) / zoom;

      const newX = Math.round(rawX - dragNodeOffsetRef.current.x);
      const newY = Math.round(rawY - dragNodeOffsetRef.current.y);

      hasMovedNodeRef.current = true;

      setNodePositions((prev) => {
        const next = { ...prev, [draggingNodeId]: { x: newX, y: newY } };
        nodePositionsRef.current = next;
        return next;
      });
    } else if (draggingWire) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const curX = (e.clientX - rect.left - pan.x) / zoom;
      const curY = (e.clientY - rect.top - pan.y) / zoom;

      if (draggingWire.fromDirection === "input") {
        // Dragging FROM an input port, snapping TO an output port on candidate source nodes
        let snappedSource: string | null = null;
        let snappedOutput: "out" | "true" | "false" | "approve" | "reject" = "out";
        let snapX = curX;
        let snapY = curY;
        let minDistance = 38;

        effectiveSteps.forEach((st) => {
          if (st.id === draggingWire.fromStepId) return;
          if (st.type === "end" || st.type === "note" || st.type === "shape" || st.type === "section" || st.type === "text") return; // Non-output steps
          const pos = nodePositions[st.id] || { x: 420, y: 140 };
          const { width: nodeW } = getNodeSize(st);
          const portX = pos.x + nodeW;

          const candidateOutputs: Array<"out" | "true" | "false" | "approve" | "reject"> =
            st.type === "condition"
              ? ["true", "false"]
              : st.type === "approval"
              ? ["approve", "reject"]
              : ["out"];

          for (const p of candidateOutputs) {
            const portY = pos.y + getOutputPortOffsetY(st, p);
            const dist = Math.hypot(curX - portX, curY - portY);
            if (dist < minDistance) {
              minDistance = dist;
              snappedSource = st.id;
              snappedOutput = p;
              snapX = portX;
              snapY = portY;
            }
          }
        });

        const validation = snappedSource
          ? validateConnection(
              snappedSource,
              snappedOutput,
              draggingWire.fromStepId,
              draggingWire.targetInputPort || "text",
              effectiveSteps
            )
          : undefined;

        setDraggingWire((prev) =>
          prev
            ? {
                ...prev,
                currentX: snapX,
                currentY: snapY,
                snappedTargetId: snappedSource,
                snappedOutputPort: snappedSource ? snappedOutput : undefined,
                validationResult: validation,
              }
            : null
        );
      } else {
        // Dragging FROM an output port, snapping TO an input port on candidate target nodes
        let snappedTarget: string | null = null;
        let snappedPort: "text" | "image" | "file" = "text";
        let snapX = curX;
        let snapY = curY;
        let minDistance = 38;

        effectiveSteps.forEach((st) => {
          if (st.id === draggingWire.fromStepId) return;
          if (st.type === "trigger" || st.type === "note" || st.type === "shape" || st.type === "section" || st.type === "text") return; // Non-input steps
          const pos = nodePositions[st.id] || { x: 420, y: 140 };
          const portX = pos.x;

          const candidatePorts: Array<"text" | "image" | "file"> =
            st.type === "llm" || st.type === "agent" || st.type === "action"
              ? ["text", "image", "file"]
              : ["text"];

          for (const p of candidatePorts) {
            const portY = pos.y + getInputPortOffsetY(st, p);
            const dist = Math.hypot(curX - portX, curY - portY);
            if (dist < minDistance) {
              minDistance = dist;
              snappedTarget = st.id;
              snappedPort = p;
              snapX = portX;
              snapY = portY;
            }
          }
        });

        const validation = snappedTarget
          ? validateConnection(
              draggingWire.fromStepId,
              draggingWire.fromPort,
              snappedTarget,
              snappedPort,
              effectiveSteps
            )
          : undefined;

        setDraggingWire((prev) =>
          prev
            ? {
                ...prev,
                currentX: snapX,
                currentY: snapY,
                snappedTargetId: snappedTarget,
                snappedInputPort: snappedTarget ? snappedPort : undefined,
                validationResult: validation,
              }
            : null
        );
      }
    }
  };

  // Drag finish
  const handleCanvasPointerUp = () => {
    if (resizingNode) {
      if (hasResizedNodeRef.current) {
        const finalSize = nodeSizesRef.current[resizingNode.stepId];
        if (finalSize) {
          const updatedSteps = effectiveSteps.map((s) =>
            s.id === resizingNode.stepId
              ? { ...s, width: finalSize.width, height: finalSize.height }
              : s
          );
          void onUpdateWorkflow({ steps: updatedSteps });
        }
      }
      setResizingNode(null);
      hasResizedNodeRef.current = false;
    }

    if (currentStroke) {
      setStrokes((prev) => [...prev, currentStroke]);
      setCurrentStroke(null);
    }
    if (isPanning) setIsPanning(false);

    if (draggingNodeId) {
      if (hasMovedNodeRef.current) {
        const updatedSteps = effectiveSteps.map((s) => {
          const pos = nodePositionsRef.current[s.id];
          return pos ? { ...s, x: pos.x, y: pos.y } : s;
        });
        void onUpdateWorkflow({ steps: updatedSteps });
      }
      setDraggingNodeId(null);
      hasMovedNodeRef.current = false;
    }

    if (draggingWire) {
      if (draggingWire.snappedTargetId) {
        const sourceId =
          draggingWire.fromDirection === "input"
            ? draggingWire.snappedTargetId
            : draggingWire.fromStepId;
        const targetId =
          draggingWire.fromDirection === "input"
            ? draggingWire.fromStepId
            : draggingWire.snappedTargetId;
        const outPort =
          draggingWire.fromDirection === "input"
            ? draggingWire.snappedOutputPort || "out"
            : draggingWire.fromPort;
        const inPort =
          draggingWire.fromDirection === "input"
            ? draggingWire.targetInputPort || "text"
            : draggingWire.snappedInputPort || "text";

        const val = validateConnection(sourceId, outPort, targetId, inPort, effectiveSteps);
        if (val.valid) {
          handleConnect(sourceId, outPort, targetId, inPort);
        }
      }
      setDraggingWire(null);
    }
  };

  // Node pointer down (Supports selection of locked nodes so Unlock action is accessible)
  const handleNodePointerDown = (e: React.PointerEvent, stepId: string) => {
    e.stopPropagation();
    if (tool === "pan") return;

    // Always select the node on click, even if locked
    setSelectedNodeId(stepId);
    setSelectedWire(null);

    // If locked, prevent canvas dragging but keep node selected so toolbar with Unlock is visible
    if (lockedNodes.has(stepId)) return;

    // Allow dragging unless the target is a text input, textarea, or clicking a popover dropdown item
    if (
      (e.target as HTMLElement).tagName === "INPUT" ||
      (e.target as HTMLElement).tagName === "TEXTAREA" ||
      (e.target as HTMLElement).closest(".popover-dropdown")
    ) {
      return;
    }

    setDraggingNodeId(stepId);
    hasMovedNodeRef.current = false;

    const pos = nodePositions[stepId] || { x: 420, y: 140 };
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const rawX = (e.clientX - rect.left - pan.x) / zoom;
    const rawY = (e.clientY - rect.top - pan.y) / zoom;

    dragNodeOffsetRef.current = {
      x: rawX - pos.x,
      y: rawY - pos.y,
    };

    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  // Update a single step property
  const handleUpdateStep = useCallback(
    (stepId: string, partial: Partial<WorkflowStep>) => {
      const base = effectiveSteps;
      const updated = base.map((s) =>
        s.id === stepId ? { ...s, ...partial } : s
      );
      void onUpdateWorkflow({ steps: updated });
    },
    [effectiveSteps, onUpdateWorkflow]
  );

  // Delete a step (supports deleting any node including trigger)
  const handleDeleteStep = useCallback(
    (stepId: string) => {
      const base = effectiveSteps;
      const updated = base.filter((s) => s.id !== stepId);
      const cleaned = updated.map((s) => {
        const next = { ...s };
        if (next.next_step_id === stepId) {
          next.next_step_id = null;
          next.target_port = undefined;
        }
        if (next.if_true === stepId) {
          next.if_true = undefined;
          next.if_true_target_port = undefined;
        }
        if (next.if_false === stepId) {
          next.if_false = undefined;
          next.if_false_target_port = undefined;
        }
        if (next.on_approve === stepId) {
          next.on_approve = undefined;
          next.on_approve_target_port = undefined;
        }
        if (next.on_reject === stepId) {
          next.on_reject = null;
          next.on_reject_target_port = undefined;
        }
        return next;
      });
      setSelectedNodeId(null);
      void onUpdateWorkflow({ steps: cleaned });
    },
    [effectiveSteps, onUpdateWorkflow]
  );

  // Duplicate a step (supports multiple triggers or steps)
  const handleDuplicateStep = useCallback(
    (stepId: string) => {
      const base = effectiveSteps;
      const step = base.find((s) => s.id === stepId);
      if (!step) return;
      const currentPos = nodePositions[stepId] || { x: 420, y: 140 };
      const currentSize = nodeSizesRef.current[stepId] || {
        width: step.width,
        height: step.height,
      };
      const newId = `${step.type === "trigger" ? "trigger" : "step"}_${Date.now().toString(36)}`;
      const newX = currentPos.x + 40;
      const newY = currentPos.y + 40;

      const duplicated: WorkflowStep = {
        ...step,
        id: newId,
        name: `${step.name} (Copy)`,
        x: newX,
        y: newY,
        width: currentSize.width,
        height: currentSize.height,
        next_step_id: null,
      };

      setNodePositions((prev) => {
        const next = { ...prev, [newId]: { x: newX, y: newY } };
        nodePositionsRef.current = next;
        return next;
      });

      if (currentSize.width) {
        setNodeSizes((prev) => {
          const next = {
            ...prev,
            [newId]: { width: currentSize.width, height: currentSize.height },
          };
          nodeSizesRef.current = next;
          return next;
        });
      }

      void onUpdateWorkflow({ steps: [...base, duplicated] });
      setSelectedNodeId(newId);
    },
    [effectiveSteps, nodePositions, onUpdateWorkflow]
  );

  // Toggle lock
  const handleToggleLock = (stepId: string) => {
    setLockedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  // Add node from palette
  const handleAddNode = useCallback(
    (type: WorkflowStep["type"], noteColor: string = "amber") => {
      const newId = `step_${Date.now().toString(36)}`;
      const count = (workflow.steps || []).length + 1;
      const clientW = containerRef.current?.clientWidth || 800;
      const clientH = containerRef.current?.clientHeight || 600;
      const centerX = Math.round((-pan.x + clientW / 2) / zoom - 180);
      const centerY = Math.round((-pan.y + clientH / 2) / zoom - 120);

      let newStep: WorkflowStep;
      if (type === "trigger") {
        newStep = {
          id: newId,
          name: `Trigger ${count}`,
          type: "trigger",
          trigger_type: "schedule",
          schedule_kind: "daily",
          schedule_days: "every_day",
          schedule_time: "09:00",
          next_step_id: null,
          x: centerX,
          y: centerY,
        };
      } else if (type === "llm") {
        newStep = {
          id: newId,
          name: `LLM Step ${count}`,
          type: "llm",
          prompt: "Draft a helpful analysis: {{input.message}}",
          model: availableModels[0]?.id || "gemini-2.0-flash",
          effort: "medium",
          x: centerX,
          y: centerY,
        };
      } else if (type === "agent" || type === "action") {
        newStep = {
          id: newId,
          name: `Bot Action ${count}`,
          type: "agent",
          agent_id: agents[0]?.id || 1,
          prompt: "Execute task with instructions: {{input.message}}",
          approval_mode: "ask",
          x: centerX,
          y: centerY,
        };
      } else if (type === "condition") {
        newStep = {
          id: newId,
          name: `Condition ${count}`,
          type: "condition",
          target: "steps.step_1.output",
          operator: "contains",
          value: "approved",
          if_true: "",
          if_false: "",
          x: centerX,
          y: centerY,
        };
      } else if (type === "approval") {
        newStep = {
          id: newId,
          name: `Human Approval ${count}`,
          type: "approval",
          prompt: "Please review and approve this action before proceeding.",
          timeout_minutes: 60,
          on_approve: "",
          on_reject: null,
          x: centerX,
          y: centerY,
        };
      } else if (type === "note") {
        const tone = noteColor || activeNoteTone || "orange";
        newStep = {
          id: newId,
          name: "Note",
          type: "note",
          tone: tone,
          color: tone,
          ink: NOTE_TONE_CONFIG[tone]?.ink || "var(--ink)",
          font: "sans",
          size: 18,
          align: "left",
          bold: false,
          text: "",
          x: centerX,
          y: centerY,
          width: 240,
          height: 240,
        };
      } else if (type === "shape") {
        const shapeDef = SHAPE_DEFAULT_SIZES[activeShapeKind] || { width: 208, height: 128 };
        newStep = {
          id: newId,
          name: "Shape",
          type: "shape",
          shape: activeShapeKind,
          color: activeShapeColor || "var(--ink)",
          text: "",
          x: centerX,
          y: centerY,
          width: shapeDef.width,
          height: shapeDef.height,
        };
      } else if (type === "section") {
        newStep = {
          id: newId,
          name: `Section ${count}`,
          type: "section",
          color: "zinc",
          prompt: "Pipeline Group",
          x: centerX - 60,
          y: centerY - 60,
          width: 500,
          height: 340,
        };
      } else if (type === "text") {
        newStep = {
          id: newId,
          name: "Text Label",
          type: "text",
          text: "Text Annotation",
          font_size: "medium",
          color: "zinc",
          x: centerX,
          y: centerY,
          width: 280,
          height: 70,
        };
      } else {
        newStep = {
          id: newId,
          name: `End Step ${count}`,
          type: "end",
          status: "completed",
          message: "Workflow finished successfully.",
          x: centerX,
          y: centerY,
        };
      }

      const cfg = NODE_SIZE_CONFIG[type] || NODE_SIZE_CONFIG.llm;
      newStep.width = cfg.defaultWidth;
      if (cfg.defaultHeight) {
        newStep.height = cfg.defaultHeight;
      }

      setNodePositions((prev) => {
        const next = { ...prev, [newId]: { x: centerX, y: centerY } };
        nodePositionsRef.current = next;
        return next;
      });

      setNodeSizes((prev) => {
        const next = {
          ...prev,
          [newId]: { width: cfg.defaultWidth, height: cfg.defaultHeight },
        };
        nodeSizesRef.current = next;
        return next;
      });

      void onUpdateWorkflow({ steps: [...effectiveSteps, newStep] });
      setSelectedNodeId(newId);
      setShowAddMenu(false);
    },
    [workflow.steps, pan, zoom, agents, availableModels, onUpdateWorkflow]
  );

  // Wire connect logic
  const handleConnect = (
    fromStepId: string,
    fromPort: "out" | "true" | "false" | "approve" | "reject",
    targetStepId: string,
    targetInputPort: "text" | "image" | "file" = "text"
  ) => {
    if (fromStepId === targetStepId) return;

    const val = validateConnection(
      fromStepId,
      fromPort,
      targetStepId,
      targetInputPort,
      effectiveSteps
    );
    if (!val.valid) return;

    const base = effectiveSteps;
    const updated = base.map((s) => {
      if (s.id !== fromStepId) return s;
      const copy = { ...s };
      if (fromPort === "out") {
        copy.next_step_id = targetStepId;
        copy.target_port = targetInputPort;
      } else if (fromPort === "true") {
        copy.if_true = targetStepId;
        copy.if_true_target_port = targetInputPort;
      } else if (fromPort === "false") {
        copy.if_false = targetStepId;
        copy.if_false_target_port = targetInputPort;
      } else if (fromPort === "approve") {
        copy.on_approve = targetStepId;
        copy.on_approve_target_port = targetInputPort;
      } else if (fromPort === "reject") {
        copy.on_reject = targetStepId;
        copy.on_reject_target_port = targetInputPort;
      }
      return copy;
    });
    void onUpdateWorkflow({ steps: updated });
  };

  // Disconnect wire
  const handleDisconnectWire = (fromId: string, port: string) => {
    const updated = effectiveSteps.map((s) => {
      if (s.id !== fromId) return s;
      const copy = { ...s };
      if (port === "out") {
        copy.next_step_id = null;
        copy.target_port = undefined;
      } else if (port === "true") {
        copy.if_true = undefined;
        copy.if_true_target_port = undefined;
      } else if (port === "false") {
        copy.if_false = undefined;
        copy.if_false_target_port = undefined;
      } else if (port === "approve") {
        copy.on_approve = undefined;
        copy.on_approve_target_port = undefined;
      } else if (port === "reject") {
        copy.on_reject = null;
        copy.on_reject_target_port = undefined;
      }
      return copy;
    });
    void onUpdateWorkflow({ steps: updated });
    setSelectedWire(null);
    setHoveredWire(null);
  };

  // Start wire drag from Output port (Right edge)
  const handlePortPointerDown = (
    e: React.PointerEvent,
    stepId: string,
    port: "out" | "true" | "false" | "approve" | "reject",
    portX: number,
    portY: number
  ) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    setDraggingWire({
      fromStepId: stepId,
      fromPort: port,
      fromDirection: "output",
      startX: portX,
      startY: portY,
      currentX: portX,
      currentY: portY,
      snappedTargetId: null,
    });
  };

  // Start wire drag / detaching from Input port (Left edge)
  const handleInputPortPointerDown = (
    e: React.PointerEvent,
    stepId: string,
    port: "text" | "image" | "file",
    portX: number,
    portY: number
  ) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    // 1. Check if an incoming wire is already plugged into this input port
    const existingIncoming = getIncomingWire(stepId, port);

    if (existingIncoming) {
      const fromStep = existingIncoming.fromStep;
      const fromPort = existingIncoming.port;

      // Select this wire immediately
      setSelectedWire({
        fromStepId: fromStep.id,
        toStepId: stepId,
        port: fromPort,
      });

      // Detach the connection from this port and begin dragging from source output
      const srcPos = nodePositions[fromStep.id] || { x: 420, y: 140 };
      const { width: srcW } = getNodeSize(fromStep);
      const srcX = srcPos.x + srcW;
      const srcY = srcPos.y + getOutputPortOffsetY(fromStep, fromPort);

      handleDisconnectWire(fromStep.id, fromPort);

      setDraggingWire({
        fromStepId: fromStep.id,
        fromPort: fromPort,
        fromDirection: "output",
        startX: srcX,
        startY: srcY,
        currentX: portX,
        currentY: portY,
        snappedTargetId: null,
      });
      return;
    }

    // 2. Otherwise start reverse drag from this input port to an output port
    setDraggingWire({
      fromStepId: stepId,
      fromPort: "out",
      fromDirection: "input",
      targetInputPort: port,
      startX: portX,
      startY: portY,
      currentX: portX,
      currentY: portY,
      snappedTargetId: null,
    });
  };

  // Control points calculation for cubic Bezier curve with forward & backward loop handling
  const getCurveControlPoints = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    let cx1: number, cy1: number, cx2: number, cy2: number;
    if (dx >= 0) {
      const cx = Math.max(40, dx * 0.5);
      cx1 = x1 + cx;
      cy1 = y1;
      cx2 = x2 - cx;
      cy2 = y2;
    } else {
      // Smooth backward loop when target is behind source
      const cx = Math.max(50, Math.min(180, Math.abs(dx) * 0.6));
      const cy = Math.abs(dy) < 40 ? 40 : Math.min(100, Math.abs(dy) * 0.4);
      const signY = dy >= 0 ? 1 : -1;
      cx1 = x1 + cx;
      cy1 = y1 + cy * signY;
      cx2 = x2 - cx;
      cy2 = y2 - cy * signY;
    }
    return { cx1, cy1, cx2, cy2 };
  };

  const getCurvePath = (x1: number, y1: number, x2: number, y2: number) => {
    const { cx1, cy1, cx2, cy2 } = getCurveControlPoints(x1, y1, x2, y2);
    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
  };

  const getCurveMidpoint = (x1: number, y1: number, x2: number, y2: number) => {
    const { cx1, cy1, cx2, cy2 } = getCurveControlPoints(x1, y1, x2, y2);
    const midX = 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2;
    const midY = 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2;
    return { midX, midY };
  };

  // Execute workflow live across canvas
  const handleTriggerFullRun = async () => {
    try {
      setIsExecutingWorkflow(true);
      await onRunWorkflow();
      const run = await api.startWorkflowRun(
        workflow.id,
        { message: "Triggered from visual canvas" },
        true
      );
      setLiveRun(run);
      setSelectedRunId(run.id);
      await onRefreshRuns();
    } catch (err) {
      setIsExecutingWorkflow(false);
      alert(`Run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Run isolated step
  const handleRunStep = async (stepId: string) => {
    try {
      setRunningStepId(stepId);
      const res = await api.runWorkflowStep(workflow.id, stepId, {
        ...stepOutputs,
        message: "Step test from canvas",
      });
      setStepOutputs((prev) => ({
        ...prev,
        [stepId]: res.output || "Step completed.",
      }));
    } catch (err) {
      setStepOutputs((prev) => ({
        ...prev,
        [stepId]: `Error: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setRunningStepId(null);
    }
  };

  // Resolve human approval
  const handleResolveApproval = async (decision: "approve" | "reject") => {
    if (!liveRun) return;
    try {
      setActionBusy(true);
      await api.approveWorkflowRun(liveRun.id, decision, approvalNotes.trim() || undefined);
      setApprovalNotes("");
      const fresh = await api.getWorkflowRun(liveRun.id);
      setLiveRun(fresh);
      await onRefreshRuns();
    } catch (err) {
      alert(`Approval error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const activeRun = useMemo(() => {
    if (selectedRunId) return runs.find((r) => r.id === selectedRunId) || liveRun || runs[0] || null;
    return liveRun || runs[0] || null;
  }, [runs, selectedRunId, liveRun]);

  return (
    <div className="workflow-canvas fixed inset-0 z-40 flex flex-col bg-surface text-ink select-none overflow-hidden font-sans">
      {/* Top Floating Completion Notice */}
      {executionNotice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-success border border-success text-success px-4 py-2 rounded-xl text-xs font-semibold shadow-2xl z-50 animate-in fade-in slide-in-from-top duration-200">
          <CheckCircle2 size={15} />
          <span>{executionNotice}</span>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-line bg-surface px-4 flex items-center justify-between shrink-0 z-50">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-ink hover:bg-hover transition-colors"
            title={t("Return to conversation")}
          >
            <ArrowLeft size={16} />
            <span>{t("Chat")}</span>
          </button>

          <div className="h-4 w-px bg-hover" />

          {/* Workflow Title Switcher */}
          <div className="relative">
            {editingTitle ? (
              <input
                type="text"
                value={titleInput}
                autoFocus
                onChange={(e) => setTitleInput(e.target.value)}
                onBlur={() => {
                  setEditingTitle(false);
                  if (titleInput.trim() && titleInput !== workflow.name) {
                    void onUpdateWorkflow({ name: titleInput.trim() });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setEditingTitle(false);
                    if (titleInput.trim() && titleInput !== workflow.name) {
                      void onUpdateWorkflow({ name: titleInput.trim() });
                    }
                  } else if (e.key === "Escape") {
                    setTitleInput(workflow.name);
                    setEditingTitle(false);
                  }
                }}
                className="bg-inset border border-line rounded-md px-2 py-0.5 text-sm font-semibold text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowWorkflowMenu(!showWorkflowMenu)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-semibold text-ink hover:bg-hover transition-colors"
              >
                <span>{workflow.name}</span>
                <ChevronDown size={14} className="text-muted" />
              </button>
            )}

            {/* Switcher Dropdown */}
            {showWorkflowMenu && (
              <div className="absolute top-full left-0 mt-1 w-64 rounded-xl border border-line bg-inset shadow-2xl p-1.5 z-50">
                <div className="px-2 py-1 text-[10px] font-bold text-muted uppercase tracking-wider">
                  {t("Workflows")}</div>
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {workflows.map((wf) => (
                    <button
                      key={wf.id}
                      type="button"
                      onClick={() => {
                        onSelectWorkflow(wf.id);
                        setShowWorkflowMenu(false);
                      }}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between",
                        wf.id === workflow.id
                          ? "bg-hover text-ink font-medium"
                          : "text-muted hover:bg-hover"
                      )}
                    >
                      <span className="truncate">{wf.name}</span>
                      {wf.id === workflow.id && <Check size={12} className="text-accent" />}
                    </button>
                  ))}
                </div>
                <div className="h-px bg-hover my-1" />
                <button
                  type="button"
                  onClick={() => {
                    setShowWorkflowMenu(false);
                    onCreateWorkflow();
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-accent hover:bg-hover flex items-center gap-1.5"
                >
                  <Plus size={14} />
                  <span>{t("New workflow")}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Top Right Controls */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setHistoryDrawerOpen(!historyDrawerOpen)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
              historyDrawerOpen
                ? "bg-hover text-ink border-line"
                : "text-muted border-line hover:bg-hover hover:text-ink"
            )}
          >
            <History size={14} />
            <span>{t("History")}</span>
            <span className="px-1.5 py-0.2 rounded-full bg-hover text-[10px] text-muted font-bold border border-line">
              {runs.length}
            </span>
          </button>

          <button
            type="button"
            disabled={isExecutingWorkflow}
            onClick={handleTriggerFullRun}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold bg-accent text-accent-fg hover:bg-hover shadow-md transition-all active:scale-95 disabled:opacity-50"
          >
            {isExecutingWorkflow ? (
              <span className="w-3.5 h-3.5 border-2 border-line border-t-transparent rounded-full animate-spin" />
            ) : (
              <Play size={13} className="fill-ink" />
            )}
            <span>{isExecutingWorkflow ? t("Running...") : t("Run workflow")}</span>
          </button>
        </div>
      </header>

      {/* Main 2D Canvas Workspace */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        className={cn(
          "relative flex-1 w-full h-full overflow-hidden select-none",
          resizingNode
            ? "cursor-nwse-resize"
            : tool === "pan" || isPanning
            ? "cursor-grab active:cursor-grabbing"
            : tool === "draw"
            ? "cursor-crosshair"
            : "cursor-default"
        )}
        style={{
          backgroundColor: "var(--bg-app)",
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        {/* Left Section Pill Badge (Benchmark style) */}
        <div className="absolute top-4 left-4 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-line text-xs font-semibold text-muted shadow-xl">
          <GitBranch size={13} className="text-muted" />
          <span>{t("Workflows")}</span>
        </div>

        {/* Transformable Canvas Root Layer */}
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
          }}
        >
          {/* Freehand Strokes Layer */}
          <svg className="absolute inset-0 w-[10000px] h-[10000px] pointer-events-none -z-10">
            {strokes.map((st) => (
              <path
                key={st.id}
                d={st.points.reduce((acc, p, i) => `${acc} ${i === 0 ? "M" : "L"} ${p.x} ${p.y}`, "")}
                fill="none"
                stroke={st.color}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {currentStroke && (
              <path
                d={currentStroke.points.reduce((acc, p, i) => `${acc} ${i === 0 ? "M" : "L"} ${p.x} ${p.y}`, "")}
                fill="none"
                stroke={currentStroke.color}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>

          {/* SVG Connection Wires Layer */}
          <svg className="absolute inset-0 w-[10000px] h-[10000px] overflow-visible pointer-events-none z-[1]">
            <style>{`
              @keyframes wireFlow {
                to { stroke-dashoffset: -24; }
              }
              .wire-animating {
                animation: wireFlow 1s linear infinite;
              }
            `}</style>

            {/* Node-to-Node Connections */}
            {effectiveSteps.map((step) => {
              const srcPos = nodePositions[step.id] || { x: 420, y: 140 };
              const { width: nodeW } = getNodeSize(step);
              const srcX = srcPos.x + nodeW;

              const renderWire = (
                targetId: string,
                port: "out" | "true" | "false" | "approve" | "reject",
                targetPort: "text" | "image" | "file" = "text",
                color: string = "rgba(255, 255, 255, 0.35)"
              ) => {
                const targetStep = effectiveSteps.find((s) => s.id === targetId);
                if (
                  !targetStep ||
                  targetStep.type === "note" ||
                  targetStep.type === "shape" ||
                  targetStep.type === "section" ||
                  targetStep.type === "text"
                ) {
                  return null;
                }
                const targetPos = nodePositions[targetId] || { x: 420, y: 140 };
                const srcY = srcPos.y + getOutputPortOffsetY(step, port);
                const tgtX = targetPos.x;
                const tgtY = targetPos.y + (targetStep ? getInputPortOffsetY(targetStep, targetPort) : 48);
                const isCurrentActive =
                  isExecutingWorkflow && liveRun?.current_step_id === targetId;
                const isSelected =
                  selectedWire?.fromStepId === step.id && selectedWire?.toStepId === targetId;
                const isHovered =
                  hoveredWire?.fromStepId === step.id && hoveredWire?.toStepId === targetId;
                const isSelectedOrHovered = isSelected || isHovered;

                const pathData = getCurvePath(srcX, srcY, tgtX, tgtY);
                const { midX, midY } = getCurveMidpoint(srcX, srcY, tgtX, tgtY);

                return (
                  <g
                    key={`${step.id}-${port}-${targetId}`}
                    className="wire-interactive pointer-events-auto cursor-pointer group"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedWire({ fromStepId: step.id, toStepId: targetId, port });
                    }}
                    onPointerEnter={() =>
                      handleWirePointerEnter({ fromStepId: step.id, toStepId: targetId, port })
                    }
                    onPointerLeave={handleWirePointerLeave}
                  >
                    {/* Transparent fat hit-test path for easy hovering/clicking */}
                    <path d={pathData} fill="none" stroke="transparent" strokeWidth={28} />

                    {/* Visible Wire */}
                    <path
                      d={pathData}
                      fill="none"
                      stroke={
                        isSelectedOrHovered
                          ? "var(--danger)"
                          : isCurrentActive
                          ? "var(--accent)"
                          : color
                      }
                      strokeWidth={isSelectedOrHovered ? 2.5 : isCurrentActive ? 3 : 2}
                      strokeDasharray="4 4"
                      className={isCurrentActive ? "wire-animating" : ""}
                    />

                    {/* Midpoint Disconnect Button (Matching Benchmark Red Circular 'X') */}
                    {isSelectedOrHovered && (
                      <g
                        transform={`translate(${midX}, ${midY})`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleDisconnectWire(step.id, port);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleDisconnectWire(step.id, port);
                        }}
                        className="cursor-pointer group/btn"
                      >
                        {/* Generous invisible hit-circle for effortless clicking */}
                        <circle r={20} fill="transparent" />
                        <circle
                          r={12}
                          fill="var(--danger)"
                          stroke="var(--danger)"
                          strokeWidth={1.5}
                          className="group-hover/btn:scale-125 transition-transform duration-150 drop-shadow-md"
                        />
                        <line x1={-4} y1={-4} x2={4} y2={4} stroke="var(--ink)" strokeWidth={2.5} strokeLinecap="round" />
                        <line x1={4} y1={-4} x2={-4} y2={4} stroke="var(--ink)" strokeWidth={2.5} strokeLinecap="round" />
                      </g>
                    )}
                  </g>
                );
              };

              const elements: React.ReactNode[] = [];

              if (
                step.type !== "condition" &&
                step.type !== "approval" &&
                step.type !== "section" &&
                step.type !== "text" &&
                step.type !== "note" &&
                step.type !== "shape" &&
                step.next_step_id
              ) {
                elements.push(
                  renderWire(step.next_step_id, "out", step.target_port || "text", "rgba(255, 255, 255, 0.35)")
                );
              }
              if (step.type === "condition") {
                if (step.if_true) elements.push(renderWire(step.if_true, "true", step.if_true_target_port || "text", "var(--success)"));
                if (step.if_false) elements.push(renderWire(step.if_false, "false", step.if_false_target_port || "text", "var(--accent)"));
              }
              if (step.type === "approval") {
                if (step.on_approve)
                  elements.push(renderWire(step.on_approve, "approve", step.on_approve_target_port || "text", "var(--success)"));
                if (step.on_reject)
                  elements.push(renderWire(step.on_reject, "reject", step.on_reject_target_port || "text", "var(--danger)"));
              }

              return <g key={`wires-${step.id}`}>{elements}</g>;
            })}

            {/* Currently Dragged Elastic Wire */}
            {draggingWire && (() => {
              const x1 =
                draggingWire.fromDirection === "input"
                  ? draggingWire.currentX
                  : draggingWire.startX;
              const y1 =
                draggingWire.fromDirection === "input"
                  ? draggingWire.currentY
                  : draggingWire.startY;
              const x2 =
                draggingWire.fromDirection === "input"
                  ? draggingWire.startX
                  : draggingWire.currentX;
              const y2 =
                draggingWire.fromDirection === "input"
                  ? draggingWire.startY
                  : draggingWire.currentY;

              const pathData = getCurvePath(x1, y1, x2, y2);
              const isSnapped = !!draggingWire.snappedTargetId;
              const isInvalid =
                isSnapped &&
                draggingWire.validationResult &&
                !draggingWire.validationResult.valid;
              const isValid =
                isSnapped &&
                (!draggingWire.validationResult ||
                  draggingWire.validationResult.valid);

              const strokeColor = isInvalid
                ? "var(--danger)"
                : isValid
                ? "var(--success)"
                : "rgba(255, 255, 255, 0.4)";

              return (
                <path
                  d={pathData}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={2.5}
                  strokeDasharray="5 4"
                  className={isValid ? "wire-animating" : ""}
                />
              );
            })()}

            {/* Freehand Pencil Drawing Layer */}
            {strokes.map((st) => (
              <path
                key={st.id}
                d={st.points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")}
                fill="none"
                stroke={st.color || "var(--accent)"}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {currentStroke && currentStroke.points.length > 0 && (
              <path
                d={currentStroke.points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")}
                fill="none"
                stroke={currentStroke.color || "var(--accent)"}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>

          {/* Connection Limitation Badge on Dragged Wire ("Gives text, not image", etc.) */}
          {draggingWire &&
            draggingWire.snappedTargetId &&
            draggingWire.validationResult &&
            !draggingWire.validationResult.valid && (() => {
              const x1 =
                draggingWire.fromDirection === "input"
                  ? draggingWire.currentX
                  : draggingWire.startX;
              const y1 =
                draggingWire.fromDirection === "input"
                  ? draggingWire.currentY
                  : draggingWire.startY;
              const x2 =
                draggingWire.fromDirection === "input"
                  ? draggingWire.startX
                  : draggingWire.currentX;
              const y2 =
                draggingWire.fromDirection === "input"
                  ? draggingWire.startY
                  : draggingWire.currentY;
              const { midX, midY } = getCurveMidpoint(x1, y1, x2, y2);

              return (
                <div
                  style={{
                    left: `${midX}px`,
                    top: `${midY}px`,
                  }}
                  className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 px-3 py-1 rounded-full bg-surface border border-danger shadow-xl shadow-black/80 text-danger text-xs font-medium whitespace-nowrap z-50 select-none animate-in fade-in zoom-in-95 duration-100 flex items-center justify-center"
                >
                  {draggingWire.validationResult.error}
                </div>
              );
            })()}

          {/* Ghost Preview Layer (for shapes & notes placement & eraser cursor) */}
          {ghostPos && tool === "shape" && (() => {
            const shapeDef = SHAPE_DEFAULT_SIZES[activeShapeKind] || { width: 208, height: 128 };
            return (
              <div
                style={{
                  transform: `translate(${ghostPos.x - shapeDef.width / 2}px, ${ghostPos.y - shapeDef.height / 2}px)`,
                  width: `${shapeDef.width}px`,
                  height: `${shapeDef.height}px`,
                  position: "absolute",
                  pointerEvents: "none",
                  opacity: 0.65,
                  zIndex: 35,
                }}
              >
                <ShapeSurfaceSvg
                  shape={activeShapeKind}
                  color={activeShapeColor}
                  width={shapeDef.width}
                  height={shapeDef.height}
                  dashed
                />
              </div>
            );
          })()}

          {ghostPos && tool === "note" && (
            <div
              style={{
                transform: `translate(${ghostPos.x - 120}px, ${ghostPos.y - 120}px)`,
                width: "240px",
                height: "240px",
                position: "absolute",
                pointerEvents: "none",
                opacity: 0.65,
                zIndex: 35,
                backgroundColor: NOTE_TONE_CONFIG[activeNoteTone]?.paper || "color-mix(in srgb, var(--identity-2) 12%, var(--bg-surface))",
                borderColor: NOTE_TONE_CONFIG[activeNoteTone]?.edge || "var(--identity-7)",
              }}
              className="rounded-2xl border-2 border-dashed shadow-xl p-4 flex items-center justify-center text-sm font-medium"
            >
              <span style={{ color: NOTE_TONE_CONFIG[activeNoteTone]?.ink || "var(--ink)" }}>
                {t("Click to place note")}</span>
            </div>
          )}

          {tool === "draw" && drawMode === "eraser" && ghostPos && (
            <div
              style={{
                transform: `translate(${ghostPos.x}px, ${ghostPos.y}px)`,
                position: "absolute",
                pointerEvents: "none",
                zIndex: 35,
              }}
              className="-translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 border-dashed border-danger bg-danger"
            />
          )}

          {/* Workflow Canvas Nodes (including draggable Trigger nodes) */}
          {effectiveSteps.map((step) => {
            const pos = nodePositions[step.id] || { x: 420, y: 140 };
            const isSelected = selectedNodeId === step.id;
            const isLocked = lockedNodes.has(step.id);
            const isRunningThis =
              runningStepId === step.id || (isExecutingWorkflow && liveRun?.current_step_id === step.id);
            const stepRunState = liveRun?.step_states?.[step.id];
            const isCompleted = stepRunState?.status === "completed";
            const outputText = stepOutputs[step.id] || stepRunState?.output;
            const isTargetSnapped = draggingWire?.snappedTargetId === step.id;
            const { width: nodeW, height: nodeH, cfg } = getNodeSize(step);
            const isResizingThis = resizingNode?.stepId === step.id;
            const isDraggingThis = draggingNodeId === step.id;

            return (
              <div
                key={step.id}
                onPointerDownCapture={() => {
                  setSelectedNodeId(step.id);
                  setSelectedWire(null);
                }}
                onPointerDown={(e) => handleNodePointerDown(e, step.id)}
                className={cn(
                  "workflow-node transition-shadow",
                  step.type === "note"
                    ? "rounded-2xl border-2 shadow-2xl p-0 flex flex-col select-none"
                    : step.type === "shape"
                    ? "rounded-none border-0 shadow-none p-0 bg-transparent flex items-center justify-center select-none"
                    : step.type === "section"
                    ? (step.color === "amber"
                        ? "rounded-2xl border shadow-2xl p-4 flex flex-col gap-3 bg-accent border-accent border-dashed text-accent z-0"
                        : step.color === "emerald"
                        ? "rounded-2xl border shadow-2xl p-4 flex flex-col gap-3 bg-success border-success border-dashed text-success z-0"
                        : step.color === "blue"
                        ? "rounded-2xl border shadow-2xl p-4 flex flex-col gap-3 bg-accent border-accent border-dashed text-accent z-0"
                        : step.color === "purple"
                        ? "rounded-2xl border shadow-2xl p-4 flex flex-col gap-3 bg-accent border-accent border-dashed text-accent z-0"
                        : "rounded-2xl border shadow-2xl p-4 flex flex-col gap-3 bg-inset border-line border-dashed text-ink z-0")
                    : step.type === "text"
                    ? "rounded-2xl border border-transparent hover:border-line p-2 shadow-none z-10 flex flex-col gap-3"
                    : "rounded-2xl border shadow-2xl p-4 flex flex-col gap-3 bg-surface z-10",
                  isSelected
                    ? step.type === "note"
                      ? "ring-2 ring-black/30"
                      : "border-line ring-2 ring-focus"
                    : isRunningThis
                    ? "border-accent shadow-purple-500/20 ring-2 ring-accent animate-pulse"
                    : isTargetSnapped
                    ? "border-success ring-2 ring-success"
                    : step.type === "note" || step.type === "shape" || step.type === "section" || step.type === "text"
                    ? ""
                    : "border-line hover:border-line",
                  pulsingNodeId === step.id && "ring-4 ring-accent shadow-xl shadow-purple-500/50 scale-[1.03]"
                )}
                style={{
                  transform: `translate(${pos.x}px, ${pos.y}px)`,
                  position: "absolute",
                  touchAction: "none",
                  width: `${nodeW}px`,
                  height: nodeH ? `${nodeH}px` : undefined,
                  minWidth: `${cfg.minWidth}px`,
                  maxWidth: `${cfg.maxWidth}px`,
                  minHeight: cfg.minHeight ? `${cfg.minHeight}px` : undefined,
                  maxHeight: cfg.maxHeight ? `${cfg.maxHeight}px` : undefined,
                  backgroundColor:
                    step.type === "note"
                      ? NOTE_TONE_CONFIG[step.tone || "orange"]?.paper || "color-mix(in srgb, var(--identity-2) 12%, var(--bg-surface))"
                      : undefined,
                  borderColor:
                    step.type === "note"
                      ? NOTE_TONE_CONFIG[step.tone || "orange"]?.edge || "var(--identity-7)"
                      : undefined,
                  color:
                    step.type === "note"
                      ? step.ink || NOTE_TONE_CONFIG[step.tone || "orange"]?.ink || "var(--ink)"
                      : undefined,
                  zIndex:
                    isSelected
                      ? 40
                      : step.type === "section"
                      ? 0
                      : step.type === "shape"
                      ? 2
                      : step.type === "note"
                      ? 5
                      : 10,
                  transition:
                    isResizingThis || isDraggingThis
                      ? "none"
                      : "width 0.18s cubic-bezier(0.16, 1, 0.3, 1), height 0.18s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.15s ease, box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                {/* Node Category Indicator above the card for standard flow nodes */}
                {step.type !== "note" && step.type !== "shape" && step.type !== "section" && step.type !== "text" && (
                  <div className="absolute -top-5 left-1 flex items-center gap-1.5 text-muted font-medium text-[11px] select-none pointer-events-none">
                    {step.type === "trigger" ? (
                      <>
                        <Zap size={11} className="text-accent fill-accent" />
                        <span>{t("Trigger")}</span>
                      </>
                    ) : step.type === "llm" ? (
                      <>
                        <Sparkles size={11} className="text-accent" />
                        <span>{t("LLM")}</span>
                      </>
                    ) : step.type === "agent" || step.type === "action" ? (
                      <>
                        <Bot size={11} className="text-accent" />
                        <span>{t("Bot")}</span>
                      </>
                    ) : step.type === "condition" ? (
                      <>
                        <GitBranch size={11} className="text-accent" />
                        <span>{t("Condition")}</span>
                      </>
                    ) : step.type === "approval" ? (
                      <>
                        <ShieldAlert size={11} className="text-danger" />
                        <span>{t("Approval")}</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={11} className="text-success" />
                        <span>{t("End")}</span>
                      </>
                    )}
                  </div>
                )}

                {/* Floating Action Bar above selected Note Node (Matching benchmark Note toolbar) */}
                {isSelected && step.type === "note" && (
                  <div
                    className="absolute -top-12 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-surface border border-line shadow-2xl px-2.5 py-1.5 rounded-2xl z-50 text-xs animate-in fade-in slide-in-from-bottom-2 duration-150 select-none"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {/* Tone Dropdown */}
                    <div className="relative">
                      <button
                        type="button"
                        data-popover-trigger="true"
                        onClick={() =>
                          setOpenNoteMenu(
                            openNoteMenu?.id === step.id && openNoteMenu.type === "tone"
                              ? null
                              : { id: step.id, type: "tone" }
                          )
                        }
                        className="flex items-center gap-1 p-1 rounded-lg hover:bg-hover text-muted transition-colors"
                        title={t("Pick note paper tone")}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-black/20"
                          style={{
                            backgroundColor:
                              NOTE_TONE_CONFIG[step.tone || "orange"]?.preview || "var(--identity-7)",
                          }}
                        />
                        <ChevronDown size={11} className="text-muted" />
                      </button>
                      {openNoteMenu?.id === step.id && openNoteMenu.type === "tone" && (
                        <div className="popover-dropdown absolute top-full mt-2 left-0 p-1.5 rounded-xl bg-surface border border-line shadow-2xl z-50 flex items-center gap-1.5 animate-in fade-in duration-100">
                          {Object.entries(NOTE_TONE_CONFIG).map(([toneKey, cfg]) => (
                            <button
                              key={toneKey}
                              type="button"
                              onClick={() => {
                                handleUpdateStep(step.id, {
                                  tone: toneKey,
                                  color: toneKey,
                                  ink: cfg.ink,
                                });
                                setOpenNoteMenu(null);
                              }}
                              className={cn(
                                "w-5 h-5 rounded-full transition-transform hover:scale-115",
                                (step.tone || "orange") === toneKey
                                  ? "ring-2 ring-focus ring-offset-2 ring-offset-surface scale-110"
                                  : ""
                              )}
                              style={{ backgroundColor: cfg.preview }}
                              title={cfg.label}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Ink Dropdown */}
                    <div className="relative">
                      <button
                        type="button"
                        data-popover-trigger="true"
                        onClick={() =>
                          setOpenNoteMenu(
                            openNoteMenu?.id === step.id && openNoteMenu.type === "ink"
                              ? null
                              : { id: step.id, type: "ink" }
                          )
                        }
                        className="flex items-center gap-1 p-1 rounded-lg hover:bg-hover text-muted transition-colors"
                        title={t("Pick ink color")}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-black/20"
                          style={{
                            backgroundColor:
                              step.ink || NOTE_TONE_CONFIG[step.tone || "orange"]?.ink || "var(--ink)",
                          }}
                        />
                        <ChevronDown size={11} className="text-muted" />
                      </button>
                      {openNoteMenu?.id === step.id && openNoteMenu.type === "ink" && (
                        <div className="popover-dropdown absolute top-full mt-2 left-0 p-1.5 rounded-xl bg-surface border border-line shadow-2xl z-50 flex items-center gap-1.5 animate-in fade-in duration-100">
                          {INK_COLOR_LIST.map((c) => (
                            <button
                              key={c.name}
                              type="button"
                              onClick={() => {
                                handleUpdateStep(step.id, { ink: c.hex });
                                setOpenNoteMenu(null);
                              }}
                              className={cn(
                                "w-5 h-5 rounded-full transition-transform hover:scale-115",
                                (step.ink || NOTE_TONE_CONFIG[step.tone || "orange"]?.ink) === c.hex
                                  ? "ring-2 ring-focus ring-offset-2 ring-offset-surface scale-110"
                                  : ""
                              )}
                              style={{ backgroundColor: c.hex }}
                              title={c.label}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="w-[1px] h-3.5 bg-hover mx-0.5" />

                    {/* Font Dropdown */}
                    <div className="relative">
                      <button
                        type="button"
                        data-popover-trigger="true"
                        onClick={() =>
                          setOpenNoteMenu(
                            openNoteMenu?.id === step.id && openNoteMenu.type === "font"
                              ? null
                              : { id: step.id, type: "font" }
                          )
                        }
                        className="flex items-center gap-1 px-1.5 py-1 rounded-lg hover:bg-hover text-muted font-medium text-xs transition-colors"
                        title={t("Font family")}
                      >
                        <span>
                          {step.font === "mono" ? t("Mono") : step.font === "serif" ? t("Serif") : t("Aa")}
                        </span>
                        <ChevronDown size={11} className="text-muted" />
                      </button>
                      {openNoteMenu?.id === step.id && openNoteMenu.type === "font" && (
                        <div className="popover-dropdown absolute top-full mt-2 left-0 p-1 rounded-xl bg-surface border border-line shadow-2xl z-50 flex flex-col gap-0.5 min-w-[90px] animate-in fade-in duration-100">
                          <button
                            type="button"
                            onClick={() => {
                              handleUpdateStep(step.id, { font: "sans" });
                              setOpenNoteMenu(null);
                            }}
                            className={cn(
                              "px-2 py-1 text-left rounded-lg text-xs font-sans hover:bg-hover text-ink",
                              (!step.font || step.font === "sans") && "bg-hover font-bold"
                            )}
                          >
                            {t("Sans (Aa)")}</button>
                          <button
                            type="button"
                            onClick={() => {
                              handleUpdateStep(step.id, { font: "mono" });
                              setOpenNoteMenu(null);
                            }}
                            className={cn(
                              "px-2 py-1 text-left rounded-lg text-xs font-mono hover:bg-hover text-ink",
                              step.font === "mono" && "bg-hover font-bold"
                            )}
                          >
                            {t("Mono")}</button>
                          <button
                            type="button"
                            onClick={() => {
                              handleUpdateStep(step.id, { font: "serif" });
                              setOpenNoteMenu(null);
                            }}
                            className={cn(
                              "px-2 py-1 text-left rounded-lg text-xs font-serif hover:bg-hover text-ink",
                              step.font === "serif" && "bg-hover font-bold"
                            )}
                          >
                            {t("Serif")}</button>
                        </div>
                      )}
                    </div>

                    {/* Font Size Dropdown */}
                    <div className="relative">
                      <button
                        type="button"
                        data-popover-trigger="true"
                        onClick={() =>
                          setOpenNoteMenu(
                            openNoteMenu?.id === step.id && openNoteMenu.type === "size"
                              ? null
                              : { id: step.id, type: "size" }
                          )
                        }
                        className="flex items-center gap-1 px-1.5 py-1 rounded-lg hover:bg-hover text-muted font-medium text-xs transition-colors"
                        title={t("Font size")}
                      >
                        <span>{step.size || 18}{t("px")}</span>
                        <ChevronDown size={11} className="text-muted" />
                      </button>
                      {openNoteMenu?.id === step.id && openNoteMenu.type === "size" && (
                        <div className="popover-dropdown absolute top-full mt-2 left-0 p-1 rounded-xl bg-surface border border-line shadow-2xl z-50 flex flex-col gap-0.5 min-w-[80px] animate-in fade-in duration-100">
                          {[14, 18, 24, 32].map((sz) => (
                            <button
                              key={sz}
                              type="button"
                              onClick={() => {
                                handleUpdateStep(step.id, { size: sz });
                                setOpenNoteMenu(null);
                              }}
                              className={cn(
                                "px-2 py-1 text-left rounded-lg text-xs hover:bg-hover text-ink",
                                (step.size || 18) === sz && "bg-hover font-bold"
                              )}
                            >
                              {sz}{t("px")}</button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Text Alignment Dropdown */}
                    <div className="relative">
                      <button
                        type="button"
                        data-popover-trigger="true"
                        onClick={() =>
                          setOpenNoteMenu(
                            openNoteMenu?.id === step.id && openNoteMenu.type === "align"
                              ? null
                              : { id: step.id, type: "align" }
                          )
                        }
                        className="flex items-center gap-1 p-1 rounded-lg hover:bg-hover text-muted transition-colors"
                        title={t("Text alignment")}
                      >
                        {step.align === "center" ? (
                          <AlignCenter size={13} />
                        ) : step.align === "right" ? (
                          <AlignRight size={13} />
                        ) : step.align === "justify" ? (
                          <AlignJustify size={13} />
                        ) : (
                          <AlignLeft size={13} />
                        )}
                        <ChevronDown size={11} className="text-muted" />
                      </button>
                      {openNoteMenu?.id === step.id && openNoteMenu.type === "align" && (
                        <div className="popover-dropdown absolute top-full mt-2 left-0 p-1 rounded-xl bg-surface border border-line shadow-2xl z-50 flex items-center gap-1 animate-in fade-in duration-100">
                          <button
                            type="button"
                            onClick={() => {
                              handleUpdateStep(step.id, { align: "left" });
                              setOpenNoteMenu(null);
                            }}
                            className={cn(
                              "p-1.5 rounded-lg hover:bg-hover text-ink",
                              (!step.align || step.align === "left") && "bg-hover"
                            )}
                            title={t("Left")}
                          >
                            <AlignLeft size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleUpdateStep(step.id, { align: "center" });
                              setOpenNoteMenu(null);
                            }}
                            className={cn(
                              "p-1.5 rounded-lg hover:bg-hover text-ink",
                              step.align === "center" && "bg-hover"
                            )}
                            title={t("Center")}
                          >
                            <AlignCenter size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleUpdateStep(step.id, { align: "right" });
                              setOpenNoteMenu(null);
                            }}
                            className={cn(
                              "p-1.5 rounded-lg hover:bg-hover text-ink",
                              step.align === "right" && "bg-hover"
                            )}
                            title={t("Right")}
                          >
                            <AlignRight size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleUpdateStep(step.id, { align: "justify" });
                              setOpenNoteMenu(null);
                            }}
                            className={cn(
                              "p-1.5 rounded-lg hover:bg-hover text-ink",
                              step.align === "justify" && "bg-hover"
                            )}
                            title={t("Justify")}
                          >
                            <AlignJustify size={13} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Bold Toggle Button */}
                    <button
                      type="button"
                      onClick={() => handleUpdateStep(step.id, { bold: !step.bold })}
                      className={cn(
                        "px-2 py-1 rounded-lg font-bold text-xs transition-colors",
                        step.bold
                          ? "bg-hover text-ink"
                          : "text-muted hover:text-ink hover:bg-hover"
                      )}
                      title={t("Bold")}
                    >
                      {t("B")}</button>

                    <div className="w-[1px] h-3.5 bg-hover mx-0.5" />

                    {/* Duplicate */}
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleDuplicateStep(step.id)}
                      className="p-1.5 text-muted hover:text-ink rounded-lg hover:bg-hover transition-colors disabled:opacity-30"
                      title={t("Duplicate note")}
                    >
                      <CopyPlus size={14} />
                    </button>

                    {/* Lock */}
                    <button
                      type="button"
                      onClick={() => handleToggleLock(step.id)}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        isLocked
                          ? "text-accent bg-accent hover:bg-accent"
                          : "text-muted hover:text-ink hover:bg-hover"
                      )}
                      title={isLocked ? "Unlock note" : "Lock note"}
                    >
                      {isLocked ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => handleDeleteStep(step.id)}
                      className="p-1.5 text-danger hover:text-danger rounded-lg hover:bg-hover transition-colors"
                      title={t("Delete note")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}

                {/* Floating Action Bar above selected Shape Node */}
                {isSelected && step.type === "shape" && (
                  <div
                    className="absolute -top-12 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-surface border border-line shadow-2xl px-2.5 py-1.5 rounded-2xl z-50 text-xs animate-in fade-in slide-in-from-bottom-2 duration-150 select-none"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {/* Shape Kind Dropdown */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenShapeMenu(
                            openShapeMenu?.id === step.id && openShapeMenu.type === "kind"
                              ? null
                              : { id: step.id, type: "kind" }
                          )
                        }
                        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-hover text-muted transition-colors capitalize font-medium"
                        title={t("Pick shape geometry")}
                      >
                        <span>{step.shape || t("rectangle")}</span>
                        <ChevronDown size={11} className="text-muted" />
                      </button>
                      {openShapeMenu?.id === step.id && openShapeMenu.type === "kind" && (
                        <div className="absolute top-full mt-2 left-0 p-1.5 rounded-xl bg-surface border border-line shadow-2xl z-50 flex items-center gap-1 animate-in fade-in duration-100">
                          {(
                            [
                              "rectangle",
                              "circle",
                              "diamond",
                              "triangle",
                              "inverted",
                              "oval",
                              "star",
                            ] as ShapeKind[]
                          ).map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => {
                                handleUpdateStep(step.id, { shape: k });
                                setOpenShapeMenu(null);
                              }}
                              className={cn(
                                "p-2 rounded-lg hover:bg-hover text-muted transition-all",
                                (step.shape || "rectangle") === k && "bg-hover text-ink"
                              )}
                              title={k}
                            >
                              {k === "rectangle" && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3" /></svg>
                              )}
                              {k === "circle" && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /></svg>
                              )}
                              {k === "diamond" && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 22,12 12,22 2,12" /></svg>
                              )}
                              {k === "triangle" && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,3 22,21 2,21" /></svg>
                              )}
                              {k === "inverted" && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="2,3 22,3 12,21" /></svg>
                              )}
                              {k === "oval" && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="6" /></svg>
                              )}
                              {k === "star" && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9" /></svg>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Color Dropdown */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenShapeMenu(
                            openShapeMenu?.id === step.id && openShapeMenu.type === "color"
                              ? null
                              : { id: step.id, type: "color" }
                          )
                        }
                        className="flex items-center gap-1 p-1 rounded-lg hover:bg-hover text-muted transition-colors"
                        title={t("Pick shape outline color")}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-line/20"
                          style={{ backgroundColor: step.color || "var(--ink)" }}
                        />
                        <ChevronDown size={11} className="text-muted" />
                      </button>
                      {openShapeMenu?.id === step.id && openShapeMenu.type === "color" && (
                        <div className="absolute top-full mt-2 left-0 p-1.5 rounded-xl bg-surface border border-line shadow-2xl z-50 flex items-center gap-1.5 animate-in fade-in duration-100">
                          {CANVAS_COLOR_PALETTE.map((c) => (
                            <button
                              key={c.name}
                              type="button"
                              onClick={() => {
                                handleUpdateStep(step.id, { color: c.hex });
                                setOpenShapeMenu(null);
                              }}
                              className={cn(
                                "w-5 h-5 rounded-full transition-transform hover:scale-115",
                                (step.color || "var(--ink)") === c.hex
                                  ? "ring-2 ring-focus ring-offset-2 ring-offset-surface scale-110"
                                  : ""
                              )}
                              style={{ backgroundColor: c.hex }}
                              title={c.label}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="w-[1px] h-3.5 bg-hover mx-0.5" />

                    {/* Duplicate */}
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleDuplicateStep(step.id)}
                      className="p-1.5 text-muted hover:text-ink rounded-lg hover:bg-hover transition-colors disabled:opacity-30"
                      title={t("Duplicate shape")}
                    >
                      <CopyPlus size={14} />
                    </button>

                    {/* Lock */}
                    <button
                      type="button"
                      onClick={() => handleToggleLock(step.id)}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        isLocked
                          ? "text-accent bg-accent hover:bg-accent"
                          : "text-muted hover:text-ink hover:bg-hover"
                      )}
                      title={isLocked ? "Unlock shape" : "Lock shape"}
                    >
                      {isLocked ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => handleDeleteStep(step.id)}
                      className="p-1.5 text-danger hover:text-danger rounded-lg hover:bg-hover transition-colors"
                      title={t("Delete shape")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}

                {/* Floating Action Bar above selected standard flow node */}
                {isSelected && step.type !== "note" && step.type !== "shape" && (
                  <div
                    className="absolute -top-11 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-surface border border-line rounded-xl px-2 py-1 shadow-2xl z-30 select-none animate-in fade-in slide-in-from-bottom-2 duration-150"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleDuplicateStep(step.id)}
                      className="p-1.5 text-muted hover:text-ink rounded-lg hover:bg-hover transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                      title={t("Duplicate node")}
                    >
                      <CopyPlus size={14} />
                    </button>
                    <div className="w-[1px] h-3 bg-hover mx-0.5" />
                    <button
                      type="button"
                      onClick={() => handleToggleLock(step.id)}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        isLocked
                          ? "text-accent bg-accent hover:bg-accent"
                          : "text-muted hover:text-ink hover:bg-hover"
                      )}
                      title={isLocked ? "Unlock node" : "Lock node"}
                    >
                      {isLocked ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteStep(step.id)}
                      className="p-1.5 text-danger hover:text-danger rounded-lg hover:bg-hover transition-colors"
                      title={t("Delete node")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}

                {/* Interactive Curved Corner Resize Handle */}
                {isSelected && !isLocked && cfg.resizable && (
                  <div
                    onPointerDown={(e) =>
                      handleResizePointerDown(e, step.id, cfg, nodeW, nodeH)
                    }
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={handleCanvasPointerUp}
                    className="absolute -bottom-1 -right-1 w-7 h-7 flex items-end justify-end p-1.5 cursor-nwse-resize z-30 group/resize select-none"
                    title={t("Drag to resize")}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 15 15"
                      fill="none"
                      className="text-ink drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)] transition-transform group-hover/resize:scale-110"
                    >
                      <path
                        d="M 2 13 C 7 13 13 7 13 2"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                )}

                {/* Left Input Ports (Triggers, Notes, Shapes, Sections, and Text labels have no left input ports) */}
                {step.type !== "note" && step.type !== "shape" && step.type !== "trigger" && step.type !== "section" && step.type !== "text" && (
                  <>
                    {step.type === "llm" || step.type === "agent" || step.type === "action" ? (
                      <>
                        {/* 1. Text Input Port (T) */}
                        {(() => {
                          const incoming = getIncomingWire(step.id, "text");
                          const isSnapped =
                            (draggingWire?.fromDirection !== "input" &&
                              isTargetSnapped &&
                              (draggingWire?.snappedInputPort === "text" || !draggingWire?.snappedInputPort)) ||
                            (draggingWire?.fromDirection === "input" &&
                              draggingWire?.fromStepId === step.id &&
                              (draggingWire?.targetInputPort === "text" || !draggingWire?.targetInputPort));
                          const isInvalid =
                            isSnapped &&
                            draggingWire?.snappedTargetId &&
                            draggingWire?.validationResult &&
                            !draggingWire.validationResult.valid;
                          const isValid =
                            isSnapped &&
                            draggingWire?.snappedTargetId &&
                            (!draggingWire?.validationResult || draggingWire.validationResult.valid);
                          const isReverseDraggingThis =
                            draggingWire?.fromDirection === "input" &&
                            draggingWire?.fromStepId === step.id &&
                            (draggingWire?.targetInputPort === "text" || !draggingWire?.targetInputPort);

                          return (
                            <div
                              style={{ top: "48px" }}
                              onPointerDown={(e) =>
                                handleInputPortPointerDown(e, step.id, "text", pos.x, pos.y + 48)
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                if (incoming) {
                                  setSelectedWire({
                                    fromStepId: incoming.fromStep.id,
                                    toStepId: step.id,
                                    port: incoming.port,
                                  });
                                }
                              }}
                              className={cn(
                                "absolute -left-[11px] -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-surface border transition-all cursor-crosshair flex items-center justify-center z-20 text-[10px] font-mono font-bold select-none shadow-md",
                                isInvalid
                                  ? "border-danger bg-danger text-ink scale-125 ring-4 ring-danger shadow-lg"
                                  : isValid
                                  ? "border-success bg-success text-success scale-125 ring-4 ring-success shadow-lg"
                                  : isReverseDraggingThis
                                  ? "border-line bg-hover text-ink scale-115"
                                  : incoming
                                  ? "border-line text-ink bg-hover hover:border-line hover:scale-115"
                                  : "border-line text-muted hover:border-line hover:text-ink hover:scale-115 hover:bg-hover"
                              )}
                              title={
                                incoming
                                  ? `Connected from ${incoming.fromStep.name} (${incoming.port}). Click to select, or drag to re-route`
                                  : "Text input (variables & prompt template). Drag to connect"
                              }
                            >
                              {t("T")}{" "}{isReverseDraggingThis && (
                                <div className="absolute right-[calc(100%+8px)] top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-surface border border-line text-ink text-[11px] font-medium whitespace-nowrap shadow-md pointer-events-none select-none z-30">
                                  {t("Text")}</div>
                              )}
                            </div>
                          );
                        })()}

                        {/* 2. Image Input Port (ImageIcon) */}
                        {(() => {
                          const incoming = getIncomingWire(step.id, "image");
                          const isSnapped =
                            (draggingWire?.fromDirection !== "input" &&
                              isTargetSnapped &&
                              draggingWire?.snappedInputPort === "image") ||
                            (draggingWire?.fromDirection === "input" &&
                              draggingWire?.fromStepId === step.id &&
                              draggingWire?.targetInputPort === "image");
                          const isInvalid =
                            isSnapped &&
                            draggingWire?.snappedTargetId &&
                            draggingWire?.validationResult &&
                            !draggingWire.validationResult.valid;
                          const isValid =
                            isSnapped &&
                            draggingWire?.snappedTargetId &&
                            (!draggingWire?.validationResult || draggingWire.validationResult.valid);
                          const isReverseDraggingThis =
                            draggingWire?.fromDirection === "input" &&
                            draggingWire?.fromStepId === step.id &&
                            draggingWire?.targetInputPort === "image";

                          return (
                            <div
                              style={{ top: "82px" }}
                              onPointerDown={(e) =>
                                handleInputPortPointerDown(e, step.id, "image", pos.x, pos.y + 82)
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                if (incoming) {
                                  setSelectedWire({
                                    fromStepId: incoming.fromStep.id,
                                    toStepId: step.id,
                                    port: incoming.port,
                                  });
                                }
                              }}
                              className={cn(
                                "absolute -left-[11px] -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-surface border transition-all cursor-crosshair flex items-center justify-center z-20 select-none shadow-md",
                                isInvalid
                                  ? "border-danger bg-danger text-ink scale-125 ring-4 ring-danger shadow-lg"
                                  : isValid
                                  ? "border-success bg-success text-success scale-125 ring-4 ring-success shadow-lg"
                                  : isReverseDraggingThis
                                  ? "border-line bg-hover text-ink scale-115"
                                  : incoming
                                  ? "border-line text-ink bg-hover hover:border-line hover:scale-115"
                                  : "border-line text-muted hover:border-line hover:text-ink hover:scale-115 hover:bg-hover"
                              )}
                              title={
                                incoming
                                  ? `Connected from ${incoming.fromStep.name} (${incoming.port}). Click to select, or drag to re-route`
                                  : "Image input (vision context). Drag to connect"
                              }
                            >
                              <ImageIcon size={11} strokeWidth={2} />
                              {isReverseDraggingThis && (
                                <div className="absolute right-[calc(100%+8px)] top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-surface border border-line text-ink text-[11px] font-medium whitespace-nowrap shadow-md pointer-events-none select-none z-30">
                                  {t("Image")}</div>
                              )}
                            </div>
                          );
                        })()}

                        {/* 3. File Input Port (FileText) */}
                        {(() => {
                          const incoming = getIncomingWire(step.id, "file");
                          const isSnapped =
                            (draggingWire?.fromDirection !== "input" &&
                              isTargetSnapped &&
                              draggingWire?.snappedInputPort === "file") ||
                            (draggingWire?.fromDirection === "input" &&
                              draggingWire?.fromStepId === step.id &&
                              draggingWire?.targetInputPort === "file");
                          const isInvalid =
                            isSnapped &&
                            draggingWire?.snappedTargetId &&
                            draggingWire?.validationResult &&
                            !draggingWire.validationResult.valid;
                          const isValid =
                            isSnapped &&
                            draggingWire?.snappedTargetId &&
                            (!draggingWire?.validationResult || draggingWire.validationResult.valid);
                          const isReverseDraggingThis =
                            draggingWire?.fromDirection === "input" &&
                            draggingWire?.fromStepId === step.id &&
                            draggingWire?.targetInputPort === "file";

                          return (
                            <div
                              style={{ top: "116px" }}
                              onPointerDown={(e) =>
                                handleInputPortPointerDown(e, step.id, "file", pos.x, pos.y + 116)
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                if (incoming) {
                                  setSelectedWire({
                                    fromStepId: incoming.fromStep.id,
                                    toStepId: step.id,
                                    port: incoming.port,
                                  });
                                }
                              }}
                              className={cn(
                                "absolute -left-[11px] -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-surface border transition-all cursor-crosshair flex items-center justify-center z-20 select-none shadow-md",
                                isInvalid
                                  ? "border-danger bg-danger text-ink scale-125 ring-4 ring-danger shadow-lg"
                                  : isValid
                                  ? "border-success bg-success text-success scale-125 ring-4 ring-success shadow-lg"
                                  : isReverseDraggingThis
                                  ? "border-line bg-hover text-ink scale-115"
                                  : incoming
                                  ? "border-line text-ink bg-hover hover:border-line hover:scale-115"
                                  : "border-line text-muted hover:border-line hover:text-ink hover:scale-115 hover:bg-hover"
                              )}
                              title={
                                incoming
                                  ? `Connected from ${incoming.fromStep.name} (${incoming.port}). Click to select, or drag to re-route`
                                  : "File input (document & code context). Drag to connect"
                              }
                            >
                              <FileText size={11} strokeWidth={2} />
                              {isReverseDraggingThis && (
                                <div className="absolute right-[calc(100%+8px)] top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-surface border border-line text-ink text-[11px] font-medium whitespace-nowrap shadow-md pointer-events-none select-none z-30">
                                  {t("File")}</div>
                              )}
                            </div>
                          );
                        })()}
                      </>
                    ) : (
                      /* Single Input Port for Condition, Approval, End */
                      (() => {
                        const incoming = getIncomingWire(step.id, "text");
                        const isSnapped =
                          (draggingWire?.fromDirection !== "input" && isTargetSnapped) ||
                          (draggingWire?.fromDirection === "input" &&
                            draggingWire?.fromStepId === step.id &&
                            (draggingWire?.targetInputPort === "text" || !draggingWire?.targetInputPort));
                        const isInvalid =
                          isSnapped &&
                          draggingWire?.snappedTargetId &&
                          draggingWire?.validationResult &&
                          !draggingWire.validationResult.valid;
                        const isValid =
                          isSnapped &&
                          draggingWire?.snappedTargetId &&
                          (!draggingWire?.validationResult || draggingWire.validationResult.valid);
                        const isReverseDraggingThis =
                          draggingWire?.fromDirection === "input" &&
                          draggingWire?.fromStepId === step.id &&
                          (draggingWire?.targetInputPort === "text" || !draggingWire?.targetInputPort);

                        return (
                          <div
                            style={{ top: "48px" }}
                            onPointerDown={(e) =>
                              handleInputPortPointerDown(e, step.id, "text", pos.x, pos.y + 48)
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              if (incoming) {
                                setSelectedWire({
                                  fromStepId: incoming.fromStep.id,
                                  toStepId: step.id,
                                  port: incoming.port,
                                });
                              }
                            }}
                            className={cn(
                              "absolute -left-[11px] -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-surface border transition-all cursor-crosshair flex items-center justify-center z-20 text-[10px] font-mono font-bold select-none shadow-md",
                              isInvalid
                                ? "border-danger bg-danger text-ink scale-125 ring-4 ring-danger shadow-lg"
                                : isValid
                                ? "border-success bg-success text-success scale-125 ring-4 ring-success shadow-lg"
                                : isReverseDraggingThis
                                ? "border-line bg-hover text-ink scale-115"
                                : incoming
                                ? "border-line text-ink bg-hover hover:border-line hover:scale-115"
                                : "border-line text-muted hover:border-line hover:text-ink hover:scale-115 hover:bg-hover"
                            )}
                            title={
                              incoming
                                ? `Connected from ${incoming.fromStep.name} (${incoming.port}). Click to select, or drag to re-route`
                                : step.type === "end"
                                ? "Flow completion input. Drag to connect"
                                : "Input data. Drag to connect"
                            }
                          >
                            {step.type === "end" ? (
                              <CheckCircle2 size={11} className="text-success" />
                            ) : (
                              t("T")
                            )}
                            {isReverseDraggingThis && (
                              <div className="absolute right-[calc(100%+8px)] top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-surface border border-line text-ink text-[11px] font-medium whitespace-nowrap shadow-md pointer-events-none select-none z-30">
                                {t("Text")}</div>
                            )}
                          </div>
                        );
                      })()
                    )}
                  </>
                )}

                {/* Node Title & Status Header for standard nodes */}
                {step.type !== "trigger" && step.type !== "section" && step.type !== "text" && step.type !== "note" && step.type !== "shape" && (
                  <div className="flex items-center justify-between text-xs cursor-grab active:cursor-grabbing select-none" data-drag-handle="true">
                    <div className="flex items-center gap-2">
                      {step.type === "llm" && <Sparkles size={15} className="text-accent" />}
                      {(step.type === "agent" || step.type === "action") && (
                        <Bot size={15} className="text-accent" />
                      )}
                      {step.type === "condition" && <GitBranch size={15} className="text-accent" />}
                      {step.type === "approval" && <ShieldAlert size={15} className="text-danger" />}
                      {step.type === "end" && <CheckCircle2 size={15} className="text-success" />}

                      <span className="font-semibold text-ink text-xs">
                        {step.type === "llm"
                          ? t("LLM")
                          : step.type === "agent" || step.type === "action"
                          ? t("Agent")
                          : step.type === "condition"
                          ? t("Condition")
                          : step.type === "approval"
                          ? t("Approval")
                          : t("End")}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {isLocked && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleLock(step.id);
                          }}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent text-accent border border-accent text-[10px] font-medium hover:bg-accent transition-colors"
                          title={t("Click to unlock")}
                        >
                          <Lock size={10} />
                          <span>{t("Unlock")}</span>
                        </button>
                      )}
                      {step.type === "llm" && (
                        <span className="text-[11px] font-mono text-muted">{step.id}</span>
                      )}
                      {isRunningThis ? (
                        <span className="flex items-center gap-1 text-[11px] text-accent font-medium">
                          <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
                          {t("Running...")}</span>
                      ) : isCompleted ? (
                        <span className="flex items-center gap-1 text-[11px] text-success font-medium">
                          <CheckCircle2 size={12} />
                          {t("Done")}</span>
                      ) : null}
                    </div>
                  </div>
                )}

                {/* Trigger Node Form (Matches workflow WorkflowTriggerNode options) */}
                {step.type === "trigger" && (
                  <div className="flex flex-col gap-3">
                    {/* Trigger Top Header Row with Trigger Type & Status */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="relative flex-1">
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveTriggerMenuStepId(activeTriggerMenuStepId === step.id ? null : step.id);
                          }}
                          className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl bg-inset border border-line text-xs font-semibold text-ink hover:bg-hover transition-colors shadow-sm disabled:opacity-50"
                        >
                          <div className="flex items-center gap-2">
                            {step.trigger_type === "manual" ? (
                              <div className="w-5 h-5 rounded-md bg-accent text-accent flex items-center justify-center">
                                <MousePointerClick size={13} />
                              </div>
                            ) : step.trigger_type === "webhook" ? (
                              <div className="w-5 h-5 rounded-md bg-success text-success flex items-center justify-center">
                                <Webhook size={13} />
                              </div>
                            ) : step.trigger_type === "message" ? (
                              <div className="w-5 h-5 rounded-md bg-accent text-accent flex items-center justify-center">
                                <MessageSquare size={13} />
                              </div>
                            ) : (
                              <div className="w-5 h-5 rounded-md bg-accent text-accent flex items-center justify-center">
                                <CalendarClock size={13} />
                              </div>
                            )}
                            <span className="capitalize">{step.trigger_type || t("Schedule")}</span>
                          </div>
                          <ChevronDown size={13} className="text-muted" />
                        </button>

                        {/* Dropdown Menu for Trigger Type */}
                        {activeTriggerMenuStepId === step.id && !isLocked && (
                          <div className="popover-dropdown absolute top-full left-0 mt-1 w-full rounded-xl border border-line bg-inset shadow-2xl p-1.5 z-50 flex flex-col gap-0.5">
                            {[
                              { id: "schedule", label: "Schedule", icon: CalendarClock, color: "text-accent" },
                              { id: "manual", label: "Manual", icon: MousePointerClick, color: "text-accent" },
                              { id: "webhook", label: "Webhook", icon: Webhook, color: "text-success" },
                              { id: "message", label: "Chat Message", icon: MessageSquare, color: "text-accent" },
                            ].map((tItem) => {
                              const TIcon = tItem.icon;
                              return (
                                <button
                                  key={tItem.id}
                                  type="button"
                                  onClick={() => {
                                    handleUpdateStep(step.id, { trigger_type: tItem.id as "manual" | "schedule" | "webhook" | "message" });
                                    setActiveTriggerMenuStepId(null);
                                  }}
                                  className={cn(
                                    "w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors",
                                    (step.trigger_type || "schedule") === tItem.id
                                      ? "bg-hover text-ink font-medium"
                                      : "text-muted hover:bg-hover"
                                  )}
                                >
                                  <div className="flex items-center gap-2">
                                    <TIcon size={14} className={tItem.color} />
                                    <span>{tItem.label}</span>
                                  </div>
                                  {(step.trigger_type || "schedule") === tItem.id && (
                                    <Check size={12} className="text-accent" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isLocked && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleLock(step.id);
                            }}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent text-accent border border-accent text-[10px] font-medium hover:bg-accent transition-colors"
                            title={t("Click to unlock")}
                          >
                            <Lock size={10} />
                            <span>{t("Unlock")}</span>
                          </button>
                        )}
                        {isRunningThis ? (
                          <span className="flex items-center gap-1 text-[11px] text-accent font-medium">
                            <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
                            {t("Running...")}</span>
                        ) : isCompleted ? (
                          <span className="flex items-center gap-1 text-[11px] text-success font-medium">
                            <CheckCircle2 size={12} />
                            {t("Done")}</span>
                        ) : null}
                      </div>
                    </div>

                    {/* Schedule Configuration (Matching workflow RoutineSchedulePicker Sentence Chips) */}
                    {(step.trigger_type || "schedule") === "schedule" && (
                      <div className="flex flex-col gap-2.5 pt-0.5">
                        <div className="flex items-center flex-wrap gap-1.5 text-xs text-muted">
                          {/* Frequency Chip */}
                          <div className="relative">
                            <button
                              type="button"
                              disabled={isLocked}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveChipMenu(
                                  activeChipMenu?.stepId === step.id && activeChipMenu?.type === "kind"
                                    ? null
                                    : { stepId: step.id, type: "kind" }
                                );
                              }}
                              className="px-2.5 py-1 rounded-lg bg-hover hover:bg-hover text-ink font-medium text-xs flex items-center gap-1 border border-line transition-colors disabled:opacity-50"
                            >
                              <span className="capitalize">{step.schedule_kind || t("Daily")}</span>
                              <ChevronDown size={11} className="text-muted" />
                            </button>
                            {activeChipMenu?.stepId === step.id && activeChipMenu?.type === "kind" && !isLocked && (
                              <div className="popover-dropdown absolute top-full left-0 mt-1 w-28 rounded-xl border border-line bg-inset shadow-2xl p-1 z-50 flex flex-col gap-0.5">
                                {["daily", "hourly", "weekly", "monthly", "cron"].map((k) => (
                                  <button
                                    key={k}
                                    type="button"
                                    onClick={() => {
                                      handleUpdateStep(step.id, { schedule_kind: k as "daily" | "hourly" | "weekly" | "monthly" | "cron" });
                                      setActiveChipMenu(null);
                                    }}
                                    className="w-full text-left px-2 py-1 rounded-lg text-xs capitalize hover:bg-hover text-ink"
                                  >
                                    {k}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Daily settings */}
                          {(step.schedule_kind || "daily") === "daily" && (
                            <>
                              <span className="text-muted font-normal">{t("on")}</span>
                              <div className="relative">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveChipMenu(
                                      activeChipMenu?.stepId === step.id && activeChipMenu?.type === "days"
                                        ? null
                                        : { stepId: step.id, type: "days" }
                                    );
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-hover hover:bg-hover text-ink font-medium text-xs flex items-center gap-1 border border-line transition-colors disabled:opacity-50"
                                >
                                  <span>
                                    {step.schedule_days === "weekdays"
                                      ? t("Weekdays")
                                      : step.schedule_days === "weekends"
                                      ? t("Weekends")
                                      : t("Every day")}
                                  </span>
                                  <ChevronDown size={11} className="text-muted" />
                                </button>
                                {activeChipMenu?.stepId === step.id && activeChipMenu?.type === "days" && !isLocked && (
                                  <div className="popover-dropdown absolute top-full left-0 mt-1 w-32 rounded-xl border border-line bg-inset shadow-2xl p-1 z-50 flex flex-col gap-0.5">
                                    {[
                                      { id: "every_day", label: "Every day" },
                                      { id: "weekdays", label: "Weekdays" },
                                      { id: "weekends", label: "Weekends" },
                                    ].map((d) => (
                                      <button
                                        key={d.id}
                                        type="button"
                                        onClick={() => {
                                          handleUpdateStep(step.id, { schedule_days: d.id });
                                          setActiveChipMenu(null);
                                        }}
                                        className="w-full text-left px-2 py-1 rounded-lg text-xs hover:bg-hover text-ink"
                                      >
                                        {d.label}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <span className="text-muted font-normal">{t("at")}</span>
                              <div className="relative">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveChipMenu(
                                      activeChipMenu?.stepId === step.id && activeChipMenu?.type === "time"
                                        ? null
                                        : { stepId: step.id, type: "time" }
                                    );
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-hover hover:bg-hover text-ink font-medium text-xs flex items-center gap-1 border border-line transition-colors disabled:opacity-50"
                                >
                                  <span>
                                    {step.schedule_time === "09:00"
                                      ? t("9 AM")
                                      : step.schedule_time || t("9 AM")}
                                  </span>
                                  <ChevronDown size={11} className="text-muted" />
                                </button>
                                {activeChipMenu?.stepId === step.id && activeChipMenu?.type === "time" && !isLocked && (
                                  <div className="absolute top-full left-0 mt-1 w-28 max-h-48 overflow-y-auto rounded-xl border border-line bg-inset shadow-2xl p-1 z-50 flex flex-col gap-0.5">
                                    {[
                                      "06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
                                      "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
                                      "18:00", "19:00", "20:00", "21:00"
                                    ].map((tVal) => {
                                      const h = parseInt(tVal.split(":")[0], 10);
                                      const ampm = h >= 12 ? "PM" : "AM";
                                      const h12 = h % 12 || 12;
                                      const label = `${h12} ${ampm}`;
                                      return (
                                        <button
                                          key={tVal}
                                          type="button"
                                          onClick={() => {
                                            handleUpdateStep(step.id, { schedule_time: tVal });
                                            setActiveChipMenu(null);
                                          }}
                                          className="w-full text-left px-2 py-1 rounded-lg text-xs hover:bg-hover text-ink"
                                        >
                                          {label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </>
                          )}

                          {/* Hourly settings */}
                          {step.schedule_kind === "hourly" && (
                            <>
                              <span className="text-muted font-normal">{t("every")}</span>
                              <div className="relative">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveChipMenu(
                                      activeChipMenu?.stepId === step.id && activeChipMenu?.type === "hours"
                                        ? null
                                        : { stepId: step.id, type: "hours" }
                                    );
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-hover hover:bg-hover text-ink font-medium text-xs flex items-center gap-1 border border-line transition-colors disabled:opacity-50"
                                >
                                  <span>{step.schedule_hours || 1} {t("hour")}{(step.schedule_hours || 1) > 1 ? t("s") : ""}</span>
                                  <ChevronDown size={11} className="text-muted" />
                                </button>
                                {activeChipMenu?.stepId === step.id && activeChipMenu?.type === "hours" && !isLocked && (
                                  <div className="absolute top-full left-0 mt-1 w-28 rounded-xl border border-line bg-inset shadow-2xl p-1 z-50 flex flex-col gap-0.5">
                                    {[1, 2, 4, 6, 12].map((hr) => (
                                      <button
                                        key={hr}
                                        type="button"
                                        onClick={() => {
                                          handleUpdateStep(step.id, { schedule_hours: hr });
                                          setActiveChipMenu(null);
                                        }}
                                        className="w-full text-left px-2 py-1 rounded-lg text-xs hover:bg-hover text-ink"
                                      >
                                        {hr} {t("hour")}{" "}{hr > 1 ? t("s") : ""}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </>
                          )}

                          {/* Weekly settings */}
                          {step.schedule_kind === "weekly" && (
                            <>
                              <span className="text-muted font-normal">{t("on")}</span>
                              <div className="relative">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveChipMenu(
                                      activeChipMenu?.stepId === step.id && activeChipMenu?.type === "days"
                                        ? null
                                        : { stepId: step.id, type: "days" }
                                    );
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-hover hover:bg-hover text-ink font-medium text-xs flex items-center gap-1 border border-line transition-colors disabled:opacity-50"
                                >
                                  <span className="capitalize">{step.schedule_days || t("Monday")}</span>
                                  <ChevronDown size={11} className="text-muted" />
                                </button>
                                {activeChipMenu?.stepId === step.id && activeChipMenu?.type === "days" && !isLocked && (
                                  <div className="popover-dropdown absolute top-full left-0 mt-1 w-32 rounded-xl border border-line bg-inset shadow-2xl p-1 z-50 flex flex-col gap-0.5">
                                    {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((wDay) => (
                                      <button
                                        key={wDay}
                                        type="button"
                                        onClick={() => {
                                          handleUpdateStep(step.id, { schedule_days: wDay.toLowerCase() });
                                          setActiveChipMenu(null);
                                        }}
                                        className="w-full text-left px-2 py-1 rounded-lg text-xs hover:bg-hover text-ink"
                                      >
                                        {wDay}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <span className="text-muted font-normal">{t("at")}</span>
                              <div className="relative">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveChipMenu(
                                      activeChipMenu?.stepId === step.id && activeChipMenu?.type === "time"
                                        ? null
                                        : { stepId: step.id, type: "time" }
                                    );
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-hover hover:bg-hover text-ink font-medium text-xs flex items-center gap-1 border border-line transition-colors disabled:opacity-50"
                                >
                                  <span>{step.schedule_time || t("9 AM")}</span>
                                  <ChevronDown size={11} className="text-muted" />
                                </button>
                              </div>
                            </>
                          )}

                          {/* Monthly settings */}
                          {step.schedule_kind === "monthly" && (
                            <>
                              <span className="text-muted font-normal">{t("on day")}</span>
                              <div className="relative">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveChipMenu(
                                      activeChipMenu?.stepId === step.id && activeChipMenu?.type === "days"
                                        ? null
                                        : { stepId: step.id, type: "days" }
                                    );
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-hover hover:bg-hover text-ink font-medium text-xs flex items-center gap-1 border border-line transition-colors disabled:opacity-50"
                                >
                                  <span>{step.schedule_days === "15th" ? t("15th") : step.schedule_days === "last" ? t("Last day") : t("1st")}</span>
                                  <ChevronDown size={11} className="text-muted" />
                                </button>
                                {activeChipMenu?.stepId === step.id && activeChipMenu?.type === "days" && !isLocked && (
                                  <div className="absolute top-full left-0 mt-1 w-28 rounded-xl border border-line bg-inset shadow-2xl p-1 z-50 flex flex-col gap-0.5">
                                    {[
                                      { id: "1st", label: "1st" },
                                      { id: "15th", label: "15th" },
                                      { id: "last", label: "Last day" },
                                    ].map((mDay) => (
                                      <button
                                        key={mDay.id}
                                        type="button"
                                        onClick={() => {
                                          handleUpdateStep(step.id, { schedule_days: mDay.id });
                                          setActiveChipMenu(null);
                                        }}
                                        className="w-full text-left px-2 py-1 rounded-lg text-xs hover:bg-hover text-ink"
                                      >
                                        {mDay.label}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <span className="text-muted font-normal">{t("at")}</span>
                              <div className="relative">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  className="px-2.5 py-1 rounded-lg bg-hover text-ink font-medium text-xs flex items-center gap-1 border border-line"
                                >
                                  <span>{step.schedule_time || t("9 AM")}</span>
                                </button>
                              </div>
                            </>
                          )}

                          {/* Cron settings */}
                          {step.schedule_kind === "cron" && (
                            <input
                              type="text"
                              disabled={isLocked}
                              value={step.schedule_cron || "0 9 * * 1-5"}
                              placeholder="0 9 * * 1-5"
                              onChange={(e) => handleUpdateStep(step.id, { schedule_cron: e.target.value })}
                              className="bg-inset border border-line rounded-lg px-2 py-1 text-xs text-ink font-mono w-32 focus:outline-none disabled:opacity-50"
                            />
                          )}
                        </div>

                        {/* Next Run Row (Matching workflow nextRun view) */}
                        <div className="flex items-center justify-between text-xs pt-1 px-1 border-t border-line">
                          <span className="text-muted text-[11px] font-normal">{t("Next run")}</span>
                          <span className="text-muted text-[11px] font-medium font-sans">
                            {computeNextRun(step)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Manual Info */}
                    {step.trigger_type === "manual" && (
                      <div className="text-[11px] text-muted bg-inset rounded-xl p-2 border border-line leading-relaxed">
                        {t("Starts manually when you click Run workflow or trigger via API.")}</div>
                    )}

                    {/* Webhook Info (Matching workflow RoutineWebhookEndpoint) */}
                    {step.trigger_type === "webhook" && (
                      <div className="flex flex-col gap-2 pt-0.5 text-xs">
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">{t("Webhook Address")}</span>
                          <div className="flex items-center gap-1.5 bg-inset rounded-lg p-1.5 border border-line">
                            <span className="truncate font-mono text-[11px] text-muted flex-1" title={`http://localhost:8000/api/v1/workflows/${workflow.id}/trigger`}>
                              {`http://localhost:8000/api/v1/workflows/${workflow.id}/trigger`}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(`http://localhost:8000/api/v1/workflows/${workflow.id}/trigger`);
                                setExecutionNotice("Webhook URL copied to clipboard!");
                                setTimeout(() => setExecutionNotice(null), 3000);
                              }}
                              className="p-1 rounded text-muted hover:text-ink hover:bg-hover transition-colors"
                              title={t("Copy Webhook Address")}
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">{t("Signing Secret")}</span>
                            <button
                              type="button"
                              disabled={isLocked}
                              onClick={() => {
                                const newSecret = `whsec_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
                                handleUpdateStep(step.id, { webhook_secret: newSecret });
                                setExecutionNotice("Signing secret regenerated!");
                                setTimeout(() => setExecutionNotice(null), 3000);
                              }}
                              className="text-[10px] text-muted hover:text-ink flex items-center gap-1 transition-colors disabled:opacity-40"
                              title={t("Rotate secret")}
                            >
                              <RefreshCw size={10} /> {t("Rotate")}</button>
                          </div>
                          <div className="flex items-center gap-1.5 bg-inset rounded-lg p-1.5 border border-line">
                            <span className="truncate font-mono text-[11px] text-muted flex-1">
                              {step.webhook_secret || t("No signing secret yet. Press Rotate to create one.")}
                            </span>
                            <button
                              type="button"
                              disabled={!step.webhook_secret}
                              onClick={() => {
                                if (!step.webhook_secret) return;
                                navigator.clipboard.writeText(step.webhook_secret);
                                setExecutionNotice("Secret copied to clipboard!");
                                setTimeout(() => setExecutionNotice(null), 3000);
                              }}
                              className="p-1 rounded text-muted hover:text-ink hover:bg-hover transition-colors disabled:opacity-40"
                              title={t("Copy Secret")}
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Chat Message Info */}
                    {step.trigger_type === "message" && (
                      <div className="flex flex-col gap-1 pt-0.5 text-xs">
                        <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">{t("Chat Keyword")}</span>
                        <input
                          type="text"
                          disabled={isLocked}
                          value={step.message_keyword || ""}
                          placeholder={t("e.g. #workflow or /run")}
                          onChange={(e) => handleUpdateStep(step.id, { message_keyword: e.target.value })}
                          className="bg-inset border border-line rounded-lg p-2 text-xs text-ink focus:outline-none disabled:opacity-50"
                        />
                        <span className="text-[10px] text-muted">{t("Runs automatically when chat message starts with this keyword.")}</span>
                      </div>
                    )}

                    {/* Primary Trigger Button: Run now / Run workflow / Send test webhook */}
                    <button
                      type="button"
                      disabled={isLocked || isExecutingWorkflow}
                      onClick={() => handleTriggerFullRun()}
                      className="w-full py-1.5 px-3 rounded-xl bg-accent text-accent-fg font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-hover transition-colors shadow-sm disabled:opacity-50 active:scale-98"
                    >
                      {isExecutingWorkflow ? (
                        <span className="w-3 h-3 border-2 border-line border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Play size={12} className="fill-ink" />
                      )}
                      <span>
                        {isExecutingWorkflow
                          ? t("Running...")
                          : step.trigger_type === "manual"
                          ? t("Run workflow")
                          : step.trigger_type === "webhook"
                          ? t("Send test webhook")
                          : t("Run now")}
                      </span>
                    </button>
                  </div>
                )}

                {/* LLM & Agent Form */}
                {(step.type === "llm" || step.type === "agent" || step.type === "action") && (
                  <div className="flex-1 min-h-0 flex flex-col justify-between gap-3">
                    <div className="flex-1 min-h-0 flex flex-col gap-3">
                      <textarea
                        value={step.prompt || ""}
                        placeholder={step.type === "llm" ? "Type your prompt here" : "Tell the bot what to do"}
                        onChange={(e) => handleUpdateStep(step.id, { prompt: e.target.value })}
                        className="w-full flex-1 min-h-[70px] bg-transparent border-none text-xs text-ink placeholder-zinc-500 focus:outline-none resize-none font-sans leading-relaxed"
                      />

                      {/* Bottom Controls Row */}
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line text-xs shrink-0">
                        {step.type === "llm" ? (
                          <Select
                            value={step.model || availableModels[0]?.id || "gemini-2.0-flash"}
                            onChange={(e) => handleUpdateStep(step.id, { model: e.target.value })}
                            containerClassName="w-auto max-w-[200px]"
                            triggerClassName="h-7 !py-1 !px-2.5 text-xs rounded-lg bg-hover border-line hover:bg-hover text-ink"
                            menuClassName="bg-inset border-line text-ink z-50 max-h-56"
                            options={availableModels.map((m) => ({
                              value: m.id,
                              label: (
                                <div className="flex items-center justify-between gap-3 w-full">
                                  <span className="truncate">{m.label}</span>
                                  <span className="text-[10px] text-muted shrink-0">{m.provider}</span>
                                </div>
                              ),
                            }))}
                          />
                        ) : (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Agent Select */}
                            <Select
                              value={String(step.agent_id || agents[0]?.id || 1)}
                              onChange={(e) => handleUpdateStep(step.id, { agent_id: Number(e.target.value) })}
                              containerClassName="w-auto max-w-[150px]"
                              triggerClassName="h-7 !py-1 !px-2.5 text-xs rounded-lg bg-hover border-line hover:bg-hover text-ink"
                              menuClassName="bg-inset border-line text-ink z-50 max-h-56"
                              leadingIcon={<span className="w-2 h-2 rounded-full bg-success shrink-0" />}
                              options={agents.map((ag) => ({
                                value: String(ag.id),
                                label: (
                                  <div className="flex items-center gap-2 truncate">
                                    <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                                    <span className="truncate">{ag.name}</span>
                                  </div>
                                ),
                              }))}
                            />

                            {/* Agent Model Select */}
                            <Select
                              value={step.model || availableModels[0]?.id || "gemini-2.0-flash"}
                              onChange={(e) => handleUpdateStep(step.id, { model: e.target.value })}
                              containerClassName="w-auto max-w-[160px]"
                              triggerClassName="h-7 !py-1 !px-2.5 text-xs rounded-lg bg-hover border-line hover:bg-hover text-muted"
                              menuClassName="bg-inset border-line text-ink z-50 max-h-56"
                              leadingIcon={<Sparkles size={11} className="text-accent shrink-0" />}
                              options={availableModels.map((m) => ({
                                value: m.id,
                                label: (
                                  <div className="flex items-center justify-between gap-3 w-full">
                                    <span className="truncate">{m.label}</span>
                                    <span className="text-[10px] text-muted shrink-0">{m.provider}</span>
                                  </div>
                                ),
                              }))}
                            />
                          </div>
                        )}

                        {step.type === "llm" && (
                          <Select
                            value={step.effort || "medium"}
                            onChange={(e) => handleUpdateStep(step.id, { effort: e.target.value })}
                            containerClassName="w-auto min-w-[105px]"
                            triggerClassName="h-7 !py-1 !px-2.5 text-xs rounded-lg bg-hover border-line hover:bg-hover text-ink capitalize"
                            menuClassName="bg-inset border-line text-ink z-50"
                            leadingIcon={
                              <div className="flex items-end gap-0.5 h-3">
                                <span className={cn("w-0.5 rounded-full bg-hover", step.effort === "high" || step.effort === "medium" || !step.effort ? "h-2" : "h-1.5")} />
                                <span className={cn("w-0.5 rounded-full", step.effort === "high" || step.effort === "medium" || !step.effort ? "h-2.5 bg-hover" : "h-1 bg-hover")} />
                                <span className={cn("w-0.5 rounded-full", step.effort === "high" ? "h-3 bg-hover" : "h-1 bg-hover")} />
                              </div>
                            }
                            options={[
                              { value: "low", label: "Low" },
                              { value: "medium", label: "Medium" },
                              { value: "high", label: "High" },
                            ]}
                          />
                        )}
                      </div>

                      {/* Optional System Prompt Expander */}
                      {step.type === "llm" && (
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedSystemPromptStepIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(step.id)) next.delete(step.id);
                                else next.add(step.id);
                                return next;
                              });
                            }}
                            className="text-left text-[11px] text-muted hover:text-muted transition-colors flex items-center gap-1"
                          >
                            <ChevronRight
                              size={11}
                              className={cn(
                                "transition-transform",
                                expandedSystemPromptStepIds.has(step.id) ? "rotate-90" : ""
                              )}
                            />
                            <span>{t("System prompt (optional)")}</span>
                          </button>
                          {expandedSystemPromptStepIds.has(step.id) && (
                            <textarea
                              rows={2}
                              value={step.system_prompt || ""}
                              placeholder={t("Enter custom persona or system instructions...")}
                              onChange={(e) => handleUpdateStep(step.id, { system_prompt: e.target.value })}
                              className="w-full bg-inset border border-line rounded-lg p-2 text-xs text-muted placeholder-zinc-600 focus:outline-none resize-none font-sans"
                            />
                          )}
                        </div>
                      )}

                      {/* Benchmark-matching Result Box */}
                      {outputText && (
                        <div className="rounded-xl bg-inset border border-line p-2.5 flex flex-col gap-1.5 shrink-0 shadow-inner">
                          <div className="flex items-center justify-between text-[11px] font-medium text-muted">
                            <span className="flex items-center gap-1.5 font-semibold text-ink">
                              <CheckCircle2 size={12} className="text-success" />
                              <span>{t("Result")}</span>
                            </span>

                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(outputText);
                                  setCopiedStepId(step.id);
                                  setTimeout(() => setCopiedStepId(null), 2000);
                                } catch {
                                  // fallback
                                }
                              }}
                              className="text-muted hover:text-ink flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded hover:bg-hover transition-colors"
                              title={t("Copy result to clipboard")}
                            >
                              {copiedStepId === step.id ? (
                                <>
                                  <Check size={11} className="text-success" />
                                  <span className="text-success">{t("Copied!")}</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={11} />
                                  <span>{t("Copy")}</span>
                                </>
                              )}
                            </button>
                          </div>

                          <div className="text-xs text-muted bg-inset rounded-lg p-2.5 whitespace-pre-wrap font-sans max-h-44 overflow-y-auto leading-relaxed border border-line">
                            {outputText}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Inline Full-width "Run" Button */}
                    <button
                      type="button"
                      disabled={isRunningThis}
                      onClick={() => handleRunStep(step.id)}
                      className="w-full py-2 rounded-xl bg-hover hover:bg-hover text-ink text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-98 disabled:opacity-50 shrink-0"
                    >
                      {isRunningThis ? (
                        <span className="w-3 h-3 border-2 border-line border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Play size={11} className="fill-ink" />
                      )}
                      <span>{t("Run")}</span>
                    </button>
                  </div>
                )}

                {/* Condition Form */}
                {step.type === "condition" && (
                  <div className="flex flex-col gap-2.5 text-xs">
                    <input
                      type="text"
                      value={step.target || ""}
                      placeholder={t("Context field (e.g. steps.step_1.output)")}
                      onChange={(e) => handleUpdateStep(step.id, { target: e.target.value })}
                      className="bg-inset border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink font-mono"
                    />
                    <div className="flex items-center gap-2">
                      <Select
                        value={step.operator || "contains"}
                        onChange={(e) =>
                          handleUpdateStep(step.id, {
                            operator: e.target.value as WorkflowStep["operator"],
                          })
                        }
                        containerClassName="w-auto min-w-[130px]"
                        triggerClassName="h-7 !py-1 !px-2.5 text-xs rounded-lg bg-hover border-line hover:bg-hover text-ink"
                        menuClassName="bg-inset border-line text-ink z-50"
                        options={[
                          { value: "contains", label: "contains" },
                          { value: "equals", label: "equals" },
                          { value: "not_equals", label: "not equals" },
                          { value: "matches_regex", label: "matches regex" },
                          { value: "is_empty", label: "is empty" },
                          { value: "is_not_empty", label: "is not empty" },
                        ]}
                      />

                      <input
                        type="text"
                        value={step.value || ""}
                        placeholder={t("Value to check")}
                        onChange={(e) => handleUpdateStep(step.id, { value: e.target.value })}
                        className="flex-1 bg-inset border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink"
                      />
                    </div>
                  </div>
                )}

                {/* Human Approval Form */}
                {step.type === "approval" && (
                  <div className="flex flex-col gap-2.5 text-xs">
                    <textarea
                      rows={2}
                      value={step.prompt || ""}
                      placeholder={t("Instructions for human reviewer...")}
                      onChange={(e) => handleUpdateStep(step.id, { prompt: e.target.value })}
                      className="bg-inset border border-line rounded-lg p-2 text-xs text-ink resize-none font-sans"
                    />

                    {liveRun?.status === "waiting_approval" && (
                      <div className="rounded-xl bg-accent border border-accent p-2.5 flex flex-col gap-2">
                        <span className="text-[11px] font-semibold text-accent">
                          {t("Waiting for your approval:")}</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleResolveApproval("approve")}
                            className="flex-1 py-1 rounded-lg bg-success hover:bg-success text-ink font-semibold text-xs"
                          >
                            {t("Approve")}</button>
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleResolveApproval("reject")}
                            className="flex-1 py-1 rounded-lg bg-danger hover:bg-danger text-ink font-semibold text-xs"
                          >
                            {t("Reject")}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Note Node Body (Pastel Paper matching reference design) */}
                {step.type === "note" && (
                  <div className="relative w-full h-full flex flex-col rounded-2xl overflow-hidden">
                    <textarea
                      value={
                        step.text !== undefined && step.text !== null
                          ? step.text
                          : step.prompt && step.prompt !== "Workflow notes and documentation..."
                          ? step.prompt
                          : ""
                      }
                      onChange={(e) =>
                        handleUpdateStep(step.id, { text: e.target.value, prompt: e.target.value })
                      }
                      onFocus={() => {
                        setSelectedNodeId(step.id);
                        setSelectedWire(null);
                      }}
                      placeholder={t("Write a note")}
                      style={{
                        color: step.ink || NOTE_TONE_CONFIG[step.tone || "orange"]?.ink || "var(--ink)",
                        fontSize: step.size ? `${step.size}px` : "18px",
                        fontFamily:
                          step.font === "mono"
                            ? "ui-monospace, monospace"
                            : step.font === "serif"
                            ? "Georgia, serif"
                            : "inherit",
                        textAlign: (step.align as "left" | "center" | "right" | "justify") || "left",
                        fontWeight: step.bold ? "bold" : "normal",
                      }}
                      className="w-full h-full bg-transparent border-none outline-none resize-none p-4 placeholder-black/35 font-sans leading-relaxed select-text"
                    />
                  </div>
                )}

                {/* Shape Node Body */}
                {step.type === "shape" && (
                  <div className="relative w-full h-full flex items-center justify-center p-3 select-none">
                    <ShapeSurfaceSvg
                      shape={step.shape || "rectangle"}
                      color={step.color || "var(--ink)"}
                      width={nodeW}
                      height={nodeH || 128}
                    />
                    <textarea
                      value={step.text || ""}
                      onChange={(e) => handleUpdateStep(step.id, { text: e.target.value })}
                      placeholder={t("Add text...")}
                      className="relative z-10 w-full h-full bg-transparent border-none outline-none resize-none flex items-center justify-center text-center font-medium text-ink placeholder-zinc-500 leading-normal p-2 select-text"
                    />
                  </div>
                )}

                {/* End Step Form */}
                {step.type === "end" && (
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted text-[11px]">{t("Completion status")}</span>
                      <Select
                        value={step.status || "completed"}
                        onChange={(e) =>
                          handleUpdateStep(step.id, {
                            status: e.target.value as "completed" | "failed",
                          })
                        }
                        containerClassName="w-auto min-w-[125px]"
                        triggerClassName="h-7 !py-1 !px-2.5 text-xs rounded-lg bg-hover border-line hover:bg-hover text-ink capitalize"
                        menuClassName="bg-inset border-line text-ink z-50"
                        leadingIcon={
                          <span
                            className={cn(
                              "w-2 h-2 rounded-full",
                              step.status === "failed" ? "bg-danger" : "bg-success"
                            )}
                          />
                        }
                        options={[
                          {
                            value: "completed",
                            label: (
                              <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                                <span>{t("Completed")}</span>
                              </div>
                            ),
                          },
                          {
                            value: "failed",
                            label: (
                              <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                                <span>{t("Failed")}</span>
                              </div>
                            ),
                          },
                        ]}
                      />
                    </div>
                    <input
                      type="text"
                      value={step.message || ""}
                      placeholder={t("Workflow completion message...")}
                      onChange={(e) => handleUpdateStep(step.id, { message: e.target.value })}
                      className="bg-inset border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder-zinc-600 focus:outline-none"
                    />
                  </div>
                )}

                {/* Section Group Frame Form */}
                {step.type === "section" && (
                  <div className="flex-1 min-h-0 flex flex-col justify-between">
                    <div className="flex items-center justify-between pb-2 border-b border-line shrink-0">
                      <div className="flex items-center gap-2">
                        <Layers size={13} className="text-muted" />
                        <input
                          type="text"
                          value={step.name || ""}
                          placeholder={t("Section Title...")}
                          onChange={(e) => handleUpdateStep(step.id, { name: e.target.value })}
                          className="bg-transparent border-none text-xs font-semibold text-ink placeholder-zinc-500 focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        {(["zinc", "amber", "emerald", "blue", "purple"] as const).map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => handleUpdateStep(step.id, { color: c })}
                            className={cn(
                              "w-3 h-3 rounded-full transition-transform hover:scale-125",
                              c === "zinc" && "bg-hover",
                              c === "amber" && "bg-accent",
                              c === "emerald" && "bg-success",
                              c === "blue" && "bg-accent",
                              c === "purple" && "bg-accent",
                              (step.color || "zinc") === c ? "ring-2 ring-focus scale-110" : "opacity-40"
                            )}
                            title={`Color ${c}`}
                          />
                        ))}
                      </div>
                    </div>
                    <textarea
                      value={step.prompt || ""}
                      placeholder={t("Optional section description or pipeline note...")}
                      onChange={(e) => handleUpdateStep(step.id, { prompt: e.target.value })}
                      className="mt-2 flex-1 w-full bg-transparent border-none text-[11px] text-muted leading-relaxed focus:outline-none resize-none font-sans"
                    />
                  </div>
                )}

                {/* Text Label Form */}
                {step.type === "text" && (
                  <div className="flex flex-col gap-1 w-full h-full">
                    {isSelected && (
                      <div className="flex items-center justify-between pb-1 border-b border-line text-[10px] text-muted">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleUpdateStep(step.id, { font_size: "small" })}
                            className={cn(
                              "px-1.5 py-0.5 rounded font-mono",
                              (step.font_size || "medium") === "small" ? "bg-hover text-ink" : "hover:text-ink"
                            )}
                          >
                            {t("S")}</button>
                          <button
                            type="button"
                            onClick={() => handleUpdateStep(step.id, { font_size: "medium" })}
                            className={cn(
                              "px-1.5 py-0.5 rounded font-mono",
                              (step.font_size || "medium") === "medium" ? "bg-hover text-ink" : "hover:text-ink"
                            )}
                          >
                            {t("M")}</button>
                          <button
                            type="button"
                            onClick={() => handleUpdateStep(step.id, { font_size: "large" })}
                            className={cn(
                              "px-1.5 py-0.5 rounded font-mono",
                              step.font_size === "large" ? "bg-hover text-ink" : "hover:text-ink"
                            )}
                          >
                            {t("L")}</button>
                          <button
                            type="button"
                            onClick={() => handleUpdateStep(step.id, { font_size: "h1" })}
                            className={cn(
                              "px-1.5 py-0.5 rounded font-bold font-mono",
                              step.font_size === "h1" ? "bg-hover text-ink" : "hover:text-ink"
                            )}
                          >
                            {t("H1")}</button>
                        </div>
                        <div className="flex items-center gap-1">
                          {(["zinc", "amber", "emerald", "blue", "rose"] as const).map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => handleUpdateStep(step.id, { color: c })}
                              className={cn(
                                "w-2.5 h-2.5 rounded-full transition-transform hover:scale-125",
                                c === "zinc" && "bg-hover",
                                c === "amber" && "bg-accent",
                                c === "emerald" && "bg-success",
                                c === "blue" && "bg-accent",
                                c === "rose" && "bg-danger",
                                (step.color || "zinc") === c ? "ring-1 ring-focus scale-125" : "opacity-40"
                              )}
                              title={`Color ${c}`}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    <textarea
                      value={step.text ?? step.prompt ?? ""}
                      placeholder={t("Type text annotation...")}
                      onChange={(e) => handleUpdateStep(step.id, { text: e.target.value, prompt: e.target.value })}
                      className={cn(
                        "w-full bg-transparent border-none focus:outline-none resize-none font-sans leading-normal",
                        step.font_size === "small" && "text-xs",
                        (!step.font_size || step.font_size === "medium") && "text-sm",
                        step.font_size === "large" && "text-lg font-semibold",
                        step.font_size === "h1" && "text-2xl font-bold tracking-tight",
                        step.color === "amber"
                          ? "text-accent"
                          : step.color === "emerald"
                          ? "text-success"
                          : step.color === "blue"
                          ? "text-accent"
                          : step.color === "rose"
                          ? "text-danger"
                          : "text-ink"
                      )}
                    />
                  </div>
                )}

                {/* Right Output Ports */}
                {step.type === "condition" ? (
                  <>
                    {(() => {
                      const isTrueActive =
                        (draggingWire?.fromDirection !== "input" &&
                          draggingWire?.fromStepId === step.id &&
                          draggingWire?.fromPort === "true") ||
                        (draggingWire?.fromDirection === "input" &&
                          draggingWire?.snappedTargetId === step.id &&
                          draggingWire?.snappedOutputPort === "true");
                      const isTrueInvalid =
                        isTrueActive &&
                        draggingWire?.snappedTargetId &&
                        draggingWire?.validationResult &&
                        !draggingWire.validationResult.valid;
                      const isTrueValid =
                        isTrueActive &&
                        draggingWire?.snappedTargetId &&
                        (!draggingWire?.validationResult || draggingWire.validationResult.valid);

                      return (
                        <div
                          onPointerDown={(e) =>
                            handlePortPointerDown(e, step.id, "true", pos.x + nodeW, pos.y + 46)
                          }
                          style={{ top: "46px" }}
                          className={cn(
                            "absolute -right-[11px] -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-success border border-success text-success hover:bg-success hover:scale-115 hover:border-success cursor-crosshair flex items-center justify-center z-20 shadow-md transition-all select-none",
                            isTrueInvalid
                              ? "border-danger bg-danger text-ink scale-125 ring-4 ring-danger shadow-lg"
                              : isTrueValid
                              ? "scale-125 ring-4 ring-success shadow-lg border-success"
                              : isTrueActive
                              ? "border-line bg-success text-ink scale-115"
                              : ""
                          )}
                          title={t("True branch port")}
                        >
                          <Check size={11} strokeWidth={2.5} />
                          {isTrueActive && (
                            <div
                              className={cn(
                                "absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-surface border text-[11px] font-medium whitespace-nowrap shadow-md pointer-events-none select-none z-30 transition-all",
                                isTrueInvalid ? "border-danger text-danger" : "border-line text-ink"
                              )}
                            >
                              {t("True")}</div>
                          )}
                        </div>
                      );
                    })()}
                    {(() => {
                      const isFalseActive =
                        (draggingWire?.fromDirection !== "input" &&
                          draggingWire?.fromStepId === step.id &&
                          draggingWire?.fromPort === "false") ||
                        (draggingWire?.fromDirection === "input" &&
                          draggingWire?.snappedTargetId === step.id &&
                          draggingWire?.snappedOutputPort === "false");
                      const isFalseInvalid =
                        isFalseActive &&
                        draggingWire?.snappedTargetId &&
                        draggingWire?.validationResult &&
                        !draggingWire.validationResult.valid;
                      const isFalseValid =
                        isFalseActive &&
                        draggingWire?.snappedTargetId &&
                        (!draggingWire?.validationResult || draggingWire.validationResult.valid);

                      return (
                        <div
                          onPointerDown={(e) =>
                            handlePortPointerDown(e, step.id, "false", pos.x + nodeW, pos.y + 74)
                          }
                          style={{ top: "74px" }}
                          className={cn(
                            "absolute -right-[11px] -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-accent border border-accent text-accent hover:bg-accent hover:scale-115 hover:border-accent cursor-crosshair flex items-center justify-center z-20 shadow-md transition-all select-none",
                            isFalseInvalid
                              ? "border-danger bg-danger text-ink scale-125 ring-4 ring-danger shadow-lg"
                              : isFalseValid
                              ? "scale-125 ring-4 ring-accent shadow-lg border-accent"
                              : isFalseActive
                              ? "border-line bg-accent text-accent-fg scale-115"
                              : ""
                          )}
                          title={t("False branch port")}
                        >
                          <X size={11} strokeWidth={2.5} />
                          {isFalseActive && (
                            <div
                              className={cn(
                                "absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-surface border text-[11px] font-medium whitespace-nowrap shadow-md pointer-events-none select-none z-30 transition-all",
                                isFalseInvalid ? "border-danger text-danger" : "border-line text-ink"
                              )}
                            >
                              {t("False")}</div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                ) : step.type === "approval" ? (
                  <>
                    {(() => {
                      const isApproveActive =
                        (draggingWire?.fromDirection !== "input" &&
                          draggingWire?.fromStepId === step.id &&
                          draggingWire?.fromPort === "approve") ||
                        (draggingWire?.fromDirection === "input" &&
                          draggingWire?.snappedTargetId === step.id &&
                          draggingWire?.snappedOutputPort === "approve");
                      const isApproveInvalid =
                        isApproveActive &&
                        draggingWire?.snappedTargetId &&
                        draggingWire?.validationResult &&
                        !draggingWire.validationResult.valid;
                      const isApproveValid =
                        isApproveActive &&
                        draggingWire?.snappedTargetId &&
                        (!draggingWire?.validationResult || draggingWire.validationResult.valid);

                      return (
                        <div
                          onPointerDown={(e) =>
                            handlePortPointerDown(e, step.id, "approve", pos.x + nodeW, pos.y + 46)
                          }
                          style={{ top: "46px" }}
                          className={cn(
                            "absolute -right-[11px] -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-success border border-success text-success hover:bg-success hover:scale-115 hover:border-success cursor-crosshair flex items-center justify-center z-20 shadow-md transition-all select-none",
                            isApproveInvalid
                              ? "border-danger bg-danger text-ink scale-125 ring-4 ring-danger shadow-lg"
                              : isApproveValid
                              ? "scale-125 ring-4 ring-success shadow-lg border-success"
                              : isApproveActive
                              ? "border-line bg-success text-ink scale-115"
                              : ""
                          )}
                          title={t("Approve branch port")}
                        >
                          <Check size={11} strokeWidth={2.5} />
                          {isApproveActive && (
                            <div
                              className={cn(
                                "absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-surface border text-[11px] font-medium whitespace-nowrap shadow-md pointer-events-none select-none z-30 transition-all",
                                isApproveInvalid ? "border-danger text-danger" : "border-line text-ink"
                              )}
                            >
                              {t("Approve")}</div>
                          )}
                        </div>
                      );
                    })()}
                    {(() => {
                      const isRejectActive =
                        (draggingWire?.fromDirection !== "input" &&
                          draggingWire?.fromStepId === step.id &&
                          draggingWire?.fromPort === "reject") ||
                        (draggingWire?.fromDirection === "input" &&
                          draggingWire?.snappedTargetId === step.id &&
                          draggingWire?.snappedOutputPort === "reject");
                      const isRejectInvalid =
                        isRejectActive &&
                        draggingWire?.snappedTargetId &&
                        draggingWire?.validationResult &&
                        !draggingWire.validationResult.valid;
                      const isRejectValid =
                        isRejectActive &&
                        draggingWire?.snappedTargetId &&
                        (!draggingWire?.validationResult || draggingWire.validationResult.valid);

                      return (
                        <div
                          onPointerDown={(e) =>
                            handlePortPointerDown(e, step.id, "reject", pos.x + nodeW, pos.y + 74)
                          }
                          style={{ top: "74px" }}
                          className={cn(
                            "absolute -right-[11px] -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-danger border border-danger text-danger hover:bg-danger hover:scale-115 hover:border-danger cursor-crosshair flex items-center justify-center z-20 shadow-md transition-all select-none",
                            isRejectInvalid
                              ? "border-danger bg-danger text-ink scale-125 ring-4 ring-danger shadow-lg"
                              : isRejectValid
                              ? "scale-125 ring-4 ring-danger shadow-lg border-danger"
                              : isRejectActive
                              ? "border-line bg-danger text-ink scale-115"
                              : ""
                          )}
                          title={t("Reject branch port")}
                        >
                          <X size={11} strokeWidth={2.5} />
                          {isRejectActive && (
                            <div
                              className={cn(
                                "absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-surface border text-[11px] font-medium whitespace-nowrap shadow-md pointer-events-none select-none z-30 transition-all",
                                isRejectInvalid ? "border-danger text-danger" : "border-line text-ink"
                              )}
                            >
                              {t("Reject")}</div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                ) : step.type !== "end" && step.type !== "note" && step.type !== "shape" && step.type !== "section" && step.type !== "text" ? (
                  (() => {
                    const isOutActive =
                      (draggingWire?.fromDirection !== "input" &&
                        draggingWire?.fromStepId === step.id &&
                        draggingWire?.fromPort === "out") ||
                      (draggingWire?.fromDirection === "input" &&
                        draggingWire?.snappedTargetId === step.id &&
                        draggingWire?.snappedOutputPort === "out");
                    const isOutInvalid =
                      isOutActive &&
                      draggingWire?.snappedTargetId &&
                      draggingWire?.validationResult &&
                      !draggingWire.validationResult.valid;
                    const isOutValid =
                      isOutActive &&
                      draggingWire?.snappedTargetId &&
                      (!draggingWire?.validationResult || draggingWire.validationResult.valid);

                    return (
                      <div
                        onPointerDown={(e) =>
                          handlePortPointerDown(
                            e,
                            step.id,
                            "out",
                            pos.x + nodeW,
                            pos.y + (step.type === "trigger" ? getTriggerPortOffsetY(step) : 48)
                          )
                        }
                        style={{
                          top: `${step.type === "trigger" ? getTriggerPortOffsetY(step) : 48}px`,
                        }}
                        className={cn(
                          "absolute -right-[11px] -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-surface border transition-all cursor-crosshair flex items-center justify-center z-20 text-[10px] font-mono font-bold select-none shadow-md",
                          isOutInvalid
                            ? "border-danger bg-danger text-ink scale-125 ring-4 ring-danger shadow-lg"
                            : isOutValid
                            ? "border-success bg-success text-success scale-125 ring-4 ring-success shadow-lg"
                            : isOutActive
                            ? "border-line bg-hover text-ink scale-115"
                            : "border-line text-muted hover:border-line hover:text-ink hover:scale-115 hover:bg-hover"
                        )}
                        title={step.type === "trigger" ? "Trigger output (drag to connect)" : "Output text (drag to connect)"}
                      >
                        {t("T")}{" "}{isOutActive && (
                          <div
                            className={cn(
                              "absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md bg-surface border text-[11px] font-medium whitespace-nowrap shadow-md pointer-events-none select-none z-30 transition-all",
                              isOutInvalid ? "border-danger text-danger" : "border-line text-ink"
                            )}
                          >
                            {t("Text")}</div>
                        )}
                      </div>
                    );
                  })()
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Interactive Canvas Minimap Panel */}
        {showMinimap && (
          <div
            className="fixed bottom-20 left-6 w-64 bg-surface border border-line rounded-2xl shadow-2xl p-3 z-40 flex flex-col gap-2 select-none animate-in fade-in zoom-in-95 duration-150"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between text-xs font-semibold text-muted">
              <span className="flex items-center gap-1.5">
                <Map size={13} className="text-muted" />
                <span>{t("Canvas Minimap")}</span>
              </span>
              <button
                type="button"
                onClick={() => setShowMinimap(false)}
                className="p-1 rounded-md text-muted hover:text-ink hover:bg-hover transition-colors"
                title={t("Close minimap")}
              >
                <X size={13} />
              </button>
            </div>

            {/* Minimap Viewport */}
            {(() => {
              const miniW = 232;
              const miniH = 120;
              const clientW = containerRef.current?.clientWidth || 1000;
              const clientH = containerRef.current?.clientHeight || 700;

              let minX = 0;
              let minY = 0;
              let maxX = 1800;
              let maxY = 1200;

              effectiveSteps.forEach((s) => {
                const pos = nodePositions[s.id] || { x: 420, y: 140 };
                const sz = getNodeSize(s);
                minX = Math.min(minX, pos.x - 100);
                minY = Math.min(minY, pos.y - 100);
                maxX = Math.max(maxX, pos.x + sz.width + 100);
                maxY = Math.max(maxY, pos.y + (sz.height || 200) + 100);
              });

              const worldW = Math.max(1200, maxX - minX);
              const worldH = Math.max(800, maxY - minY);
              const scale = Math.min(miniW / worldW, miniH / worldH);

              const vpX = -pan.x / zoom;
              const vpY = -pan.y / zoom;
              const vpW = clientW / zoom;
              const vpH = clientH / zoom;

              const handleMinimapClick = (e: React.MouseEvent<SVGSVGElement>) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;
                const targetWorldX = minX + clickX / scale;
                const targetWorldY = minY + clickY / scale;
                setPan({
                  x: Math.round(clientW / 2 - targetWorldX * zoom),
                  y: Math.round(clientH / 2 - targetWorldY * zoom),
                });
              };

              return (
                <div className="relative rounded-xl overflow-hidden bg-inset border border-line cursor-crosshair">
                  <svg
                    width={miniW}
                    height={miniH}
                    className="w-full h-full block"
                    onClick={handleMinimapClick}
                  >
                    {/* Miniature nodes */}
                    {effectiveSteps.map((s) => {
                      const pos = nodePositions[s.id] || { x: 420, y: 140 };
                      const sz = getNodeSize(s);
                      const nx = (pos.x - minX) * scale;
                      const ny = (pos.y - minY) * scale;
                      const nw = Math.max(4, sz.width * scale);
                      const nh = Math.max(3, (sz.height || 180) * scale);
                      const fill =
                        s.type === "trigger"
                          ? "var(--accent)"
                          : s.type === "llm"
                          ? "var(--accent)"
                          : s.type === "agent" || s.type === "action"
                          ? "var(--accent)"
                          : s.type === "condition"
                          ? "var(--accent)"
                          : s.type === "approval"
                          ? "var(--danger)"
                          : s.type === "note"
                          ? s.color === "neutral"
                            ? "var(--identity-3)"
                            : "var(--identity-7)"
                          : s.type === "section"
                          ? "var(--line)"
                          : "var(--success)";

                      return (
                        <rect
                          key={s.id}
                          x={nx}
                          y={ny}
                          width={nw}
                          height={nh}
                          rx={1.5}
                          fill={fill}
                          opacity={s.type === "section" ? 0.35 : 0.85}
                          stroke={s.id === selectedNodeId ? "var(--ink)" : "none"}
                          strokeWidth={s.id === selectedNodeId ? 1.5 : 0}
                        />
                      );
                    })}

                    {/* Viewport indicator */}
                    <rect
                      x={(vpX - minX) * scale}
                      y={(vpY - minY) * scale}
                      width={Math.max(8, vpW * scale)}
                      height={Math.max(6, vpH * scale)}
                      rx={2}
                      fill="rgba(255, 255, 255, 0.08)"
                      stroke="var(--ink)"
                      strokeWidth={1.2}
                      className="pointer-events-none"
                    />
                  </svg>
                </div>
              );
            })()}
          </div>
        )}

        {/* Search & Navigation Command Palette */}
        {showSearchPalette && (
          <div
            className="fixed top-20 left-1/2 -translate-x-1/2 w-[460px] max-w-[92vw] bg-surface border border-line rounded-2xl shadow-2xl p-3 z-50 flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-150 select-none"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-inset border border-line rounded-xl">
              <Search size={14} className="text-muted shrink-0" />
              <input
                autoFocus
                type="text"
                placeholder={t("Find any node in canvas by name, prompt or type...")}
                value={canvasSearchQuery}
                onChange={(e) => setCanvasSearchQuery(e.target.value)}
                className="bg-transparent border-none text-xs text-ink placeholder-zinc-500 focus:outline-none w-full"
              />
              {canvasSearchQuery && (
                <button
                  type="button"
                  onClick={() => setCanvasSearchQuery("")}
                  className="text-muted hover:text-ink p-0.5"
                >
                  <X size={12} />
                </button>
              )}
              <kbd className="px-1.5 py-0.5 rounded bg-hover text-[10px] text-muted font-mono">
                {t("ESC")}</kbd>
            </div>

            <div className="max-h-60 overflow-y-auto flex flex-col gap-1 pr-0.5">
              {(() => {
                const query = canvasSearchQuery.trim().toLowerCase();
                const matched = effectiveSteps.filter((st) => {
                  if (!query) return true;
                  return (
                    st.name.toLowerCase().includes(query) ||
                    st.type.toLowerCase().includes(query) ||
                    (st.prompt && st.prompt.toLowerCase().includes(query)) ||
                    (st.model && st.model.toLowerCase().includes(query)) ||
                    (st.text && st.text.toLowerCase().includes(query))
                  );
                });

                if (matched.length === 0) {
                  return (
                    <div className="py-6 text-center text-xs text-muted">
                      {t("No nodes matching \"")}{canvasSearchQuery}{t("\"")}</div>
                  );
                }

                return matched.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => handleJumpToNode(st.id)}
                    className="w-full px-2.5 py-2 rounded-xl text-left hover:bg-hover transition-colors flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="p-1 rounded-lg bg-hover text-muted group-hover:text-ink shrink-0">
                        {st.type === "trigger" && <Zap size={13} className="text-accent" />}
                        {st.type === "llm" && <Sparkles size={13} className="text-accent" />}
                        {(st.type === "agent" || st.type === "action") && (
                          <Bot size={13} className="text-accent" />
                        )}
                        {st.type === "condition" && <GitBranch size={13} className="text-accent" />}
                        {st.type === "approval" && <ShieldAlert size={13} className="text-danger" />}
                        {st.type === "note" && <StickyNote size={13} className="text-accent" />}
                        {st.type === "section" && <Layers size={13} className="text-muted" />}
                        {st.type === "text" && <Type size={13} className="text-muted" />}
                        {st.type === "end" && <CheckCircle2 size={13} className="text-success" />}
                      </span>
                      <div className="min-w-0 flex flex-col">
                        <span className="text-xs font-semibold text-ink truncate group-hover:text-ink">
                          {st.name || st.id}
                        </span>
                        <span className="text-[10px] text-muted truncate">
                          {st.prompt || st.text || st.type}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-inset border border-line text-muted shrink-0">
                      {st.type}
                    </span>
                  </button>
                ));
              })()}
            </div>
          </div>
        )}



        {/* Left Floating Dock: Zoom Controls, Fit Screen, Minimap */}
        <div className="ui-dock-left fixed bottom-6 left-6 flex items-center gap-1.5 bg-surface border border-line shadow-2xl px-2.5 py-1.5 rounded-2xl z-40 text-xs">
          <button
            type="button"
            onClick={() => handleZoom(-0.1)}
            className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-hover transition-colors"
            title={t("Zoom out")}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            onClick={handleResetZoom}
            className="w-11 text-center font-mono font-medium text-muted hover:text-ink transition-colors"
            title={t("Click to reset zoom (100%)")}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => handleZoom(0.1)}
            className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-hover transition-colors"
            title={t("Zoom in")}
          >
            <Plus size={14} />
          </button>

          <div className="w-[1px] h-3.5 bg-hover mx-0.5" />

          <button
            type="button"
            onClick={handleFitToScreen}
            className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-hover transition-colors"
            title={t("Fit view (Scan all nodes)")}
          >
            <Scan size={14} />
          </button>
          <button
            type="button"
            onClick={() => setShowMinimap(!showMinimap)}
            className={cn(
              "p-1.5 rounded-lg transition-colors",
              showMinimap ? "bg-hover text-ink" : "text-muted hover:text-ink hover:bg-hover"
            )}
            title={t("Toggle Minimap")}
          >
            <Map size={14} />
          </button>
        </div>

        {/* Draw Tool Sub-Bar (Matching benchmark pencil toolbar) */}
        {tool === "draw" && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-surface border border-line shadow-2xl px-2.5 py-1.5 rounded-2xl z-40 text-xs animate-in fade-in slide-in-from-bottom-2 duration-150 select-none">
            <button
              type="button"
              onClick={() => setDrawMode("pen")}
              className={cn(
                "w-8 h-8 rounded-xl transition-all flex items-center justify-center",
                drawMode === "pen"
                  ? "bg-hover text-ink ring-1 ring-focus"
                  : "text-muted hover:text-ink hover:bg-hover"
              )}
              title={t("Draw (P)")}
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              onClick={() => setDrawMode("pen")}
              className={cn(
                "w-8 h-8 rounded-xl transition-all flex items-center justify-center",
                drawMode === "pen"
                  ? "text-muted hover:text-ink hover:bg-hover"
                  : "text-muted hover:text-ink hover:bg-hover"
              )}
              title={t("Pen (P)")}
            >
              <PenTool size={15} />
            </button>
            <button
              type="button"
              onClick={() => setDrawMode("eraser")}
              className={cn(
                "w-8 h-8 rounded-xl transition-all flex items-center justify-center",
                drawMode === "eraser"
                  ? "bg-hover text-ink ring-1 ring-focus"
                  : "text-muted hover:text-ink hover:bg-hover"
              )}
              title={t("Eraser (E)")}
            >
              <Eraser size={15} />
            </button>

            <span className="w-px h-4 bg-hover mx-1" />

            <div className="flex items-center gap-1.5">
              {CANVAS_COLOR_PALETTE.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setDrawColor(c.hex)}
                  className={cn(
                    "w-5 h-5 rounded-full transition-transform hover:scale-115 relative cursor-pointer",
                    drawColor === c.hex
                      ? "ring-2 ring-focus ring-offset-2 ring-offset-surface scale-110"
                      : ""
                  )}
                  style={{ backgroundColor: c.hex }}
                  title={c.label}
                />
              ))}
            </div>
          </div>
        )}

        {/* Shape Tool Sub-Bar (Matching benchmark shape toolbar) */}
        {tool === "shape" && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-surface border border-line shadow-2xl px-2.5 py-1.5 rounded-2xl z-40 text-xs animate-in fade-in slide-in-from-bottom-2 duration-150 select-none">
            {/* Color picker dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowShapeColorMenu(!showShapeColorMenu)}
                className="flex items-center gap-1 px-2 py-1.5 rounded-xl hover:bg-hover text-muted transition-colors"
                title={t("Pick Shape Color")}
              >
                <span
                  className="w-4 h-4 rounded-full border border-line/20"
                  style={{ backgroundColor: activeShapeColor }}
                />
                <ChevronDown size={11} className="text-muted" />
              </button>
              {showShapeColorMenu && (
                <div className="absolute bottom-full mb-2.5 left-0 p-1.5 rounded-xl bg-surface border border-line shadow-2xl z-50 flex items-center gap-1.5 animate-in fade-in duration-100">
                  {CANVAS_COLOR_PALETTE.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => {
                        setActiveShapeColor(c.hex);
                        setShowShapeColorMenu(false);
                      }}
                      className={cn(
                        "w-5 h-5 rounded-full transition-transform hover:scale-115 cursor-pointer",
                        activeShapeColor === c.hex
                          ? "ring-2 ring-focus ring-offset-2 ring-offset-surface scale-110"
                          : ""
                      )}
                      style={{ backgroundColor: c.hex }}
                      title={c.label}
                    />
                  ))}
                </div>
              )}
            </div>

            <span className="w-px h-4 bg-hover mx-1" />

            {/* Shape Buttons */}
            {(
              [
                "rectangle",
                "circle",
                "diamond",
                "triangle",
                "inverted",
                "oval",
                "star",
              ] as ShapeKind[]
            ).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setActiveShapeKind(kind)}
                className={cn(
                  "p-2 rounded-xl transition-all flex items-center justify-center cursor-pointer",
                  activeShapeKind === kind
                    ? "bg-hover text-ink ring-1 ring-focus"
                    : "text-muted hover:text-ink hover:bg-hover"
                )}
                title={`Shape ${kind}`}
              >
                {kind === "rectangle" && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3" /></svg>
                )}
                {kind === "circle" && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /></svg>
                )}
                {kind === "diamond" && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 22,12 12,22 2,12" /></svg>
                )}
                {kind === "triangle" && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,3 22,21 2,21" /></svg>
                )}
                {kind === "inverted" && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="2,3 22,3 12,21" /></svg>
                )}
                {kind === "oval" && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="6" /></svg>
                )}
                {kind === "star" && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9" /></svg>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Note Tool Sub-Bar (Matching benchmark note tones toolbar) */}
        {tool === "note" && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-surface border border-line shadow-2xl px-2.5 py-1.5 rounded-2xl z-40 text-xs animate-in fade-in slide-in-from-bottom-2 duration-150 select-none">
            <span className="text-[11px] text-muted font-medium px-1">{t("Note tone:")}</span>
            {Object.entries(NOTE_TONE_CONFIG).map(([toneKey, cfg]) => (
              <button
                key={toneKey}
                type="button"
                onClick={() => setActiveNoteTone(toneKey)}
                className={cn(
                  "w-5 h-5 rounded-full transition-transform hover:scale-115 cursor-pointer",
                  activeNoteTone === toneKey
                    ? "ring-2 ring-focus ring-offset-2 ring-offset-surface scale-110"
                    : ""
                )}
                style={{ backgroundColor: cfg.preview }}
                title={cfg.label}
              />
            ))}
          </div>
        )}

        {/* Main Floating Dock: Tools, Shapes, Search, Add Node */}
        <div className="ui-dock-main fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-surface border border-line shadow-2xl px-2.5 py-1.5 rounded-2xl z-40">
          <div className="flex items-center gap-1 pr-1.5 border-r border-line">
            <button
              type="button"
              onClick={() => setTool("select")}
              className={cn(
                "w-8 h-8 rounded-xl transition-colors flex items-center justify-center",
                tool === "select" ? "bg-hover text-ink" : "text-muted hover:text-ink hover:bg-hover"
              )}
              title={t("Pointer / Select (V)")}
            >
              <MousePointer2 size={16} />
            </button>
            <button
              type="button"
              onClick={() => setTool("pan")}
              className={cn(
                "w-8 h-8 rounded-xl transition-colors flex items-center justify-center",
                tool === "pan" ? "bg-hover text-ink" : "text-muted hover:text-ink hover:bg-hover"
              )}
              title={t("Hand / Pan canvas (H)")}
            >
              <Hand size={16} />
            </button>
          </div>

          <div className="flex items-center gap-1 pr-1.5 border-r border-line">
            {/* Draw / Pencil Tool Button with Hover Tooltip */}
            <div className="relative group/drawtip">
              <button
                type="button"
                onClick={() => {
                  setTool(tool === "draw" ? "select" : "draw");
                  setShowAddMenu(false);
                }}
                className={cn(
                  "w-8 h-8 rounded-xl transition-all relative flex items-center justify-center",
                  tool === "draw"
                    ? "bg-hover text-ink ring-1 ring-focus"
                    : "text-muted hover:text-ink hover:bg-hover"
                )}
                title={t("Draw (P)")}
              >
                <DrawArt color={drawColor} eraser={drawMode === "eraser"} />
              </button>
              {/* Tooltip matching benchmark "Draw P" */}
              <div className="absolute -top-9 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-lg bg-surface border border-line text-[11px] text-ink font-medium shadow-xl pointer-events-none whitespace-nowrap opacity-0 group-hover/drawtip:opacity-100 transition-opacity flex items-center gap-1.5 z-50">
                <span>{t("Draw")}</span>
                <span className="text-[10px] text-muted font-mono">{t("P")}</span>
              </div>
            </div>

            {/* Sticky Note Tool Button */}
            <button
              type="button"
              onClick={() => {
                setTool(tool === "note" ? "select" : "note");
                setShowAddMenu(false);
              }}
              className={cn(
                "w-8 h-8 rounded-xl transition-all relative flex items-center justify-center",
                tool === "note"
                  ? "bg-hover text-ink ring-1 ring-focus"
                  : "text-muted hover:text-ink hover:bg-hover"
              )}
              title={t("Sticky Note (N)")}
            >
              <StickyArt tone={NOTE_TONE_CONFIG[activeNoteTone]?.preview || "var(--identity-9)"} />
            </button>

            {/* Shapes Tool Button */}
            <button
              type="button"
              onClick={() => {
                setTool(tool === "shape" ? "select" : "shape");
                setShowAddMenu(false);
              }}
              className={cn(
                "w-8 h-8 rounded-xl transition-all relative flex items-center justify-center",
                tool === "shape"
                  ? "bg-hover text-ink ring-1 ring-focus"
                  : "text-muted hover:text-ink hover:bg-hover"
              )}
              title={t("Shapes (R)")}
            >
              <ShapesArt shape={activeShapeKind} color={activeShapeColor} />
            </button>

            {/* Text Label Tool Button */}
            <button
              type="button"
              onClick={() => handleAddNode("text")}
              className="w-8 h-8 rounded-xl text-muted hover:text-ink hover:bg-hover transition-colors font-serif font-bold text-base leading-none flex items-center justify-center select-none"
              title={t("Add Text Label (T)")}
            >
              {t("T")}</button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowSearchPalette(!showSearchPalette)}
              className={cn(
                "w-8 h-8 rounded-xl transition-colors flex items-center justify-center",
                showSearchPalette ? "bg-hover text-ink" : "text-muted hover:text-ink hover:bg-hover"
              )}
              title={t("Search canvas nodes (Ctrl+F)")}
            >
              <Search size={16} />
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowAddMenu(!showAddMenu);
                  setNodeSearch("");
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent text-accent-fg font-semibold text-xs hover:bg-hover shadow-md transition-all active:scale-95"
              >
                <Plus size={15} />
                <span>{t("Add node")}</span>
              </button>

              {showAddMenu && (
                <div className="absolute bottom-full mb-3 right-0 w-64 rounded-2xl border border-line bg-surface shadow-2xl p-2 z-50 flex flex-col gap-1">
                  <div className="px-2 py-1 border-b border-line flex items-center gap-1.5 mb-1">
                    <Search size={13} className="text-muted" />
                    <input
                      type="text"
                      autoFocus
                      placeholder={t("Search node types...")}
                      value={nodeSearch}
                      onChange={(e) => setNodeSearch(e.target.value)}
                      className="bg-transparent border-none text-xs text-ink placeholder-zinc-500 focus:outline-none w-full"
                    />
                  </div>

                  {(!nodeSearch || "trigger node".includes(nodeSearch.toLowerCase())) && (
                    <button
                      type="button"
                      onClick={() => { handleAddNode("trigger"); setShowAddMenu(false); }}
                      className="w-full px-2.5 py-1.5 rounded-xl text-xs font-medium text-ink hover:bg-hover flex items-center gap-2.5 text-left"
                    >
                      <Zap size={15} className="text-accent fill-accent" />
                      <span>{t("Trigger Node")}</span>
                    </button>
                  )}
                  {(!nodeSearch || "llm step".includes(nodeSearch.toLowerCase())) && (
                    <button
                      type="button"
                      onClick={() => { handleAddNode("llm"); setShowAddMenu(false); }}
                      className="w-full px-2.5 py-1.5 rounded-xl text-xs font-medium text-ink hover:bg-hover flex items-center gap-2.5 text-left"
                    >
                      <Sparkles size={15} className="text-accent" />
                      <span>{t("LLM Step")}</span>
                    </button>
                  )}
                  {(!nodeSearch || "bot step".includes(nodeSearch.toLowerCase())) && (
                    <button
                      type="button"
                      onClick={() => { handleAddNode("agent"); setShowAddMenu(false); }}
                      className="w-full px-2.5 py-1.5 rounded-xl text-xs font-medium text-ink hover:bg-hover flex items-center gap-2.5 text-left"
                    >
                      <Bot size={15} className="text-accent" />
                      <span>{t("Bot Step")}</span>
                    </button>
                  )}
                  {(!nodeSearch || "condition branch".includes(nodeSearch.toLowerCase())) && (
                    <button
                      type="button"
                      onClick={() => { handleAddNode("condition"); setShowAddMenu(false); }}
                      className="w-full px-2.5 py-1.5 rounded-xl text-xs font-medium text-ink hover:bg-hover flex items-center gap-2.5 text-left"
                    >
                      <GitBranch size={15} className="text-accent" />
                      <span>{t("Condition Branch")}</span>
                    </button>
                  )}
                  {(!nodeSearch || "human approval".includes(nodeSearch.toLowerCase())) && (
                    <button
                      type="button"
                      onClick={() => { handleAddNode("approval"); setShowAddMenu(false); }}
                      className="w-full px-2.5 py-1.5 rounded-xl text-xs font-medium text-ink hover:bg-hover flex items-center gap-2.5 text-left"
                    >
                      <ShieldAlert size={15} className="text-danger" />
                      <span>{t("Human Approval")}</span>
                    </button>
                  )}
                  {(!nodeSearch || "orange sticky note".includes(nodeSearch.toLowerCase())) && (
                    <button
                      type="button"
                      onClick={() => { handleAddNode("note", "amber"); setShowAddMenu(false); }}
                      className="w-full px-2.5 py-1.5 rounded-xl text-xs font-medium text-ink hover:bg-hover flex items-center gap-2.5 text-left"
                    >
                      <div className="w-3.5 h-3.5 rounded bg-accent" />
                      <span>{t("Orange Sticky Note")}</span>
                    </button>
                  )}
                  {(!nodeSearch || "white sticky note".includes(nodeSearch.toLowerCase())) && (
                    <button
                      type="button"
                      onClick={() => { handleAddNode("note", "neutral"); setShowAddMenu(false); }}
                      className="w-full px-2.5 py-1.5 rounded-xl text-xs font-medium text-ink hover:bg-hover flex items-center gap-2.5 text-left"
                    >
                      <div className="w-3.5 h-3.5 rounded bg-hover" />
                      <span>{t("White Sticky Note")}</span>
                    </button>
                  )}
                  {(!nodeSearch || "section frame shape group".includes(nodeSearch.toLowerCase())) && (
                    <button
                      type="button"
                      onClick={() => { handleAddNode("section"); setShowAddMenu(false); }}
                      className="w-full px-2.5 py-1.5 rounded-xl text-xs font-medium text-ink hover:bg-hover flex items-center gap-2.5 text-left"
                    >
                      <Layers size={15} className="text-muted" />
                      <span>{t("Section Frame")}</span>
                    </button>
                  )}
                  {(!nodeSearch || "text label annotation".includes(nodeSearch.toLowerCase())) && (
                    <button
                      type="button"
                      onClick={() => { handleAddNode("text"); setShowAddMenu(false); }}
                      className="w-full px-2.5 py-1.5 rounded-xl text-xs font-medium text-ink hover:bg-hover flex items-center gap-2.5 text-left"
                    >
                      <Type size={15} className="text-muted" />
                      <span>{t("Text Label")}</span>
                    </button>
                  )}
                  {(!nodeSearch || "end completion".includes(nodeSearch.toLowerCase())) && (
                    <button
                      type="button"
                      onClick={() => { handleAddNode("end"); setShowAddMenu(false); }}
                      className="w-full px-2.5 py-1.5 rounded-xl text-xs font-medium text-ink hover:bg-hover flex items-center gap-2.5 text-left"
                    >
                      <CheckCircle2 size={15} className="text-success" />
                      <span>{t("End")}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Slide-over Run History Drawer */}
      {historyDrawerOpen && (
        <aside className="fixed top-14 right-0 bottom-0 w-[420px] max-w-full bg-surface border-l border-line shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-200">
          <div className="h-13 border-b border-line px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 font-semibold text-sm text-ink">
              <History size={16} className="text-muted" />
              <span>{t("Workflow Runs (")}{" "}{runs.length})</span>
            </div>
            <button
              type="button"
              onClick={() => setHistoryDrawerOpen(false)}
              className="p-1.5 text-muted hover:text-ink rounded-lg hover:bg-hover"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {runs.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted">
                {t("No runs recorded yet. Click \"Run workflow\" to test!")}</div>
            ) : (
              runs.map((r) => {
                const isSelected = activeRun?.id === r.id;
                return (
                  <div
                    key={r.id}
                    onClick={() => setSelectedRunId(r.id)}
                    className={cn(
                      "rounded-xl border p-3.5 cursor-pointer transition-all flex flex-col gap-2",
                      isSelected
                        ? "border-accent bg-inset shadow-md ring-1 ring-accent/30"
                        : "border-line bg-inset hover:bg-inset hover:border-line"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {r.status === "completed" && <CheckCircle2 size={14} className="text-success" />}
                        {r.status === "running" && (
                          <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                        )}
                        {r.status === "waiting_approval" && (
                          <ShieldAlert size={14} className="text-accent animate-pulse" />
                        )}
                        {(r.status === "failed" || r.status === "cancelled") && (
                          <AlertTriangle size={14} className="text-danger" />
                        )}

                        <span className="text-xs font-semibold text-ink">{t("Run #")}{" "}{r.id}</span>
                      </div>

                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                          r.status === "completed"
                            ? "bg-success text-success border border-success"
                            : r.status === "running"
                            ? "bg-accent text-accent border border-accent"
                            : r.status === "waiting_approval"
                            ? "bg-accent text-accent border border-accent"
                            : "bg-danger text-danger border border-danger"
                        )}
                      >
                        {r.status}
                      </span>
                    </div>

                    <div className="text-[11px] text-muted flex items-center justify-between">
                      <span>{t("Trigger:")}{" "}{r.trigger}</span>
                      <span>{new Date(r.started_at || "").toLocaleTimeString()}</span>
                    </div>

                    {/* Step Execution Timeline */}
                    {isSelected && (
                      <div className="mt-2 pt-3 border-t border-line flex flex-col gap-2.5">
                        <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                          {t("Step Execution Output")}</span>

                        {Object.values(r.step_states || {}).length === 0 ? (
                          <span className="text-xs text-muted italic">{t("No step outputs recorded.")}</span>
                        ) : (
                          Object.values(r.step_states || {}).map((st) => (
                            <div
                              key={st.id}
                              className="rounded-lg bg-inset border border-line p-2.5 flex flex-col gap-1.5"
                            >
                              <div className="flex items-center justify-between text-xs font-medium">
                                <span className="text-ink">{st.name}</span>
                                <span className="text-[10px] text-muted uppercase">{st.status}</span>
                              </div>

                              {st.output ? (
                                <div className="text-xs text-muted bg-inset rounded-md p-2 whitespace-pre-wrap font-sans border border-line leading-relaxed max-h-48 overflow-y-auto">
                                  {st.output}
                                </div>
                              ) : st.result !== undefined ? (
                                <div className="text-xs text-muted">
                                  {t("Result:")}{" "}<span className="font-semibold text-ink">{String(st.result)}</span>
                                </div>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
