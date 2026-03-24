// map.ts - функции карты
import Cytoscape from 'cytoscape';

// ==================== Глобальные переменные ====================
let cy: Cytoscape | null = null;
let linkModal: any | null = null;
let linkMode: boolean = false;
let sourceNode: Cytoscape.NodeSingular | null = null;
let dragTimeouts: Record<string, NodeJS.Timeout> = {}; // для одиночных узлов
let groupBatchTimeout: NodeJS.Timeout | null = null; // для группового сохранения
let currentMode: 'pan' | 'select' = 'pan';
let bgImageWidth: number | null = null;
let bgImageHeight: number | null = null;
let viewportTimeout: NodeJS.Timeout | null = null;
let pendingFit: boolean = false;
let elementsLoaded: boolean = false;
let backgroundLoaded: boolean = false;
let groupDragTimeout: NodeJS.Timeout | null = null;
let copyTimer: NodeJS.Timeout | null = null;

// Placeholder: Add more type-definitions for functions and similar conversions.
