/**
 * Floor Plan PDF
 * Builds a PDF document (A4) with a to-scale floor plan, furniture list and
 * cost breakdown. Pure TypeScript with the standard Helvetica fonts, so no
 * native module is required. Output is ASCII and can be written as a UTF-8 string.
 */

import type { DesignProposal } from '@/types/ai-design';
import type { RoomDimensions } from '@/types/layout-3d';

export interface FloorPlanPdfInput {
  design: DesignProposal;
  room: RoomDimensions;
  budgetPHP?: number;
  generatedAt?: Date;
}

interface PlanItem {
  number: number;
  name: string;
  left: number; // meters from the room's left wall
  top: number;  // meters from the room's top wall
  width: number;
  length: number;
  height: number;
  color: [number, number, number];
  pricePHP?: number;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const ROWS_PER_PAGE = 32;

/** Escapes text for a PDF string literal; non-ASCII characters become '?'. */
function pdfText(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export function formatPHP(amount: number): string {
  const rounded = Math.round(amount);
  const digits = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded < 0 ? '-' : ''}PHP ${digits}`;
}

function hexToRgb(hex: string | undefined): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!match) return [0.6, 0.6, 0.6];
  const value = parseInt(match[1], 16);
  return [(value >> 16) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

const num = (value: number) => Number(value.toFixed(2)).toString();

// Approximate Helvetica width for right-aligning short text.
const textWidth = (text: string, size: number) => text.length * size * 0.52;

class PageCanvas {
  private ops: string[] = [];

  text(x: number, y: number, value: string, size = 10, bold = false) {
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${num(x)} ${num(y)} Td (${pdfText(value)}) Tj ET`);
  }

  textRight(right: number, y: number, value: string, size = 10, bold = false) {
    this.text(right - textWidth(value, size), y, value, size, bold);
  }

  fillColor([r, g, b]: [number, number, number]) {
    this.ops.push(`${num(r)} ${num(g)} ${num(b)} rg`);
  }

  strokeColor([r, g, b]: [number, number, number]) {
    this.ops.push(`${num(r)} ${num(g)} ${num(b)} RG`);
  }

  lineWidth(width: number) {
    this.ops.push(`${num(width)} w`);
  }

  rect(x: number, y: number, width: number, height: number, mode: 'stroke' | 'fill' | 'both') {
    this.ops.push(`${num(x)} ${num(y)} ${num(width)} ${num(height)} re ${mode === 'stroke' ? 'S' : mode === 'fill' ? 'f' : 'B'}`);
  }

  line(x1: number, y1: number, x2: number, y2: number) {
    this.ops.push(`${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
  }

  toString() {
    return this.ops.join('\n');
  }
}

function toPlanItems(design: DesignProposal, room: RoomDimensions): PlanItem[] {
  return (design.layout?.furniture ?? []).map((item, index) => {
    // Positions are room-centered; quarter turns swap the footprint.
    const turned = Math.abs(Math.round((item.position?.rotation ?? 0) / 90)) % 2 === 1;
    const width = turned ? item.dimensions.length : item.dimensions.width;
    const length = turned ? item.dimensions.width : item.dimensions.length;
    return {
      number: index + 1,
      name: item.name,
      left: (item.position?.x ?? 0) + room.width / 2 - width / 2,
      top: (item.position?.z ?? 0) + room.length / 2 - length / 2,
      width,
      length,
      height: item.dimensions.height,
      color: hexToRgb(item.properties?.color),
      pricePHP: Number.isFinite(item.properties?.price) ? item.properties.price : undefined,
    };
  });
}

function drawHeader(page: PageCanvas, input: FloorPlanPdfInput, subtitle: string) {
  const { design, room } = input;
  page.fillColor([0.1, 0.1, 0.1]);
  page.text(MARGIN, PAGE_HEIGHT - MARGIN - 10, design.title || 'Room design', 20, true);
  page.fillColor([0.4, 0.4, 0.4]);
  const area = (room.width * room.length).toFixed(1);
  page.text(MARGIN, PAGE_HEIGHT - MARGIN - 30,
    `${subtitle}  |  ${room.width} m x ${room.length} m x ${room.height} m  |  ${area} sq m`, 10);
}

function drawFloorPlan(page: PageCanvas, items: PlanItem[], room: RoomDimensions) {
  const areaTop = PAGE_HEIGHT - MARGIN - 70;
  const areaWidth = PAGE_WIDTH - MARGIN * 2;
  const areaHeight = 420;
  const scale = Math.min(areaWidth / room.width, (areaHeight - 30) / room.length);
  const planWidth = room.width * scale;
  const planHeight = room.length * scale;
  const originX = MARGIN + (areaWidth - planWidth) / 2;
  const originTop = areaTop - 10;

  // Room outline
  page.fillColor([0.97, 0.97, 0.97]);
  page.strokeColor([0.15, 0.15, 0.15]);
  page.lineWidth(2.5);
  page.rect(originX, originTop - planHeight, planWidth, planHeight, 'both');

  // Furniture footprints, numbered to match the list
  page.lineWidth(0.8);
  for (const item of items) {
    const x = originX + item.left * scale;
    const y = originTop - (item.top + item.length) * scale;
    page.fillColor(item.color);
    page.strokeColor([0.2, 0.2, 0.2]);
    page.rect(x, y, item.width * scale, item.length * scale, 'both');
    const label = String(item.number);
    page.fillColor([1, 1, 1]);
    page.rect(x + (item.width * scale) / 2 - 8, y + (item.length * scale) / 2 - 6, 16, 13, 'fill');
    page.fillColor([0.1, 0.1, 0.1]);
    page.text(x + (item.width * scale) / 2 - textWidth(label, 9) / 2, y + (item.length * scale) / 2 - 3, label, 9, true);
  }

  // Dimension labels
  page.fillColor([0.3, 0.3, 0.3]);
  const widthLabel = `${room.width} m`;
  page.text(originX + planWidth / 2 - textWidth(widthLabel, 9) / 2, originTop - planHeight - 16, widthLabel, 9);
  page.text(originX + planWidth + 6, originTop - planHeight / 2, `${room.length} m`, 9);

  // Scale bar (1 m)
  const barY = originTop - planHeight - 34;
  page.strokeColor([0.2, 0.2, 0.2]);
  page.lineWidth(1.5);
  page.line(originX, barY, originX + scale, barY);
  page.line(originX, barY - 3, originX, barY + 3);
  page.line(originX + scale, barY - 3, originX + scale, barY + 3);
  page.text(originX + scale + 6, barY - 3, '1 m', 8);

  return barY;
}

function drawCostSummary(page: PageCanvas, items: PlanItem[], input: FloorPlanPdfInput, top: number) {
  const total = input.design.estimatedCost?.mid ?? items.reduce((sum, item) => sum + (item.pricePHP ?? 0), 0);
  const right = PAGE_WIDTH - MARGIN;
  let y = top;
  page.fillColor([0.1, 0.1, 0.1]);
  page.text(MARGIN, y, 'Cost summary', 13, true);
  y -= 20;
  page.text(MARGIN, y, `Furniture items`, 10);
  page.textRight(right, y, String(items.length), 10);
  y -= 16;
  page.text(MARGIN, y, 'Estimated total', 10, true);
  page.textRight(right, y, formatPHP(total), 10, true);
  if (input.budgetPHP && input.budgetPHP > 0) {
    const remaining = input.budgetPHP - total;
    y -= 16;
    page.text(MARGIN, y, 'Budget', 10);
    page.textRight(right, y, formatPHP(input.budgetPHP), 10);
    y -= 16;
    page.fillColor(remaining >= 0 ? [0.05, 0.5, 0.25] : [0.75, 0.1, 0.1]);
    page.text(MARGIN, y, remaining >= 0 ? 'Remaining' : 'Over budget', 10, true);
    page.textRight(right, y, formatPHP(Math.abs(remaining)), 10, true);
  }
  return { total, bottom: y };
}

function drawItemTable(page: PageCanvas, rows: PlanItem[], top: number) {
  const right = PAGE_WIDTH - MARGIN;
  const columns = { number: MARGIN, name: MARGIN + 24, size: MARGIN + 250 };
  let y = top;
  page.fillColor([0.1, 0.1, 0.1]);
  page.text(columns.number, y, '#', 9, true);
  page.text(columns.name, y, 'Item', 9, true);
  page.text(columns.size, y, 'Size W x D x H (m)', 9, true);
  page.textRight(right, y, 'Price', 9, true);
  y -= 6;
  page.strokeColor([0.75, 0.75, 0.75]);
  page.lineWidth(0.5);
  page.line(MARGIN, y, right, y);
  for (const item of rows) {
    y -= 16;
    page.fillColor(item.color);
    page.rect(columns.number, y - 1, 8, 8, 'fill');
    page.fillColor([0.1, 0.1, 0.1]);
    page.text(columns.number + 11, y, String(item.number), 9);
    page.text(columns.name, y, item.name.length > 38 ? `${item.name.slice(0, 37)}...` : item.name, 9);
    page.text(columns.size, y, `${num(item.width)} x ${num(item.length)} x ${num(item.height)}`, 9);
    page.textRight(right, y, item.pricePHP === undefined ? '-' : formatPHP(item.pricePHP), 9);
  }
  return y;
}

function assemblePdf(pageContents: string[]): string {
  const objects: string[] = [];
  const pageCount = pageContents.length;
  // 1 catalog, 2 pages, 3 regular font, 4 bold font, then (page, content) pairs
  const pageIds = pageContents.map((_, index) => 5 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pageContents.forEach((content, index) => {
    const pageId = pageIds[index];
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let output = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = output.length;
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return output;
}

export function buildFloorPlanPdf(input: FloorPlanPdfInput): string {
  const items = toPlanItems(input.design, input.room);
  const generatedAt = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  const subtitle = [input.design.roomType, generatedAt].filter(Boolean).join('  |  ');

  // Page 1: floor plan and cost summary
  const first = new PageCanvas();
  drawHeader(first, input, subtitle);
  const planBottom = drawFloorPlan(first, items, input.room);
  const { total, bottom } = drawCostSummary(first, items, input, planBottom - 30);
  first.fillColor([0.45, 0.45, 0.45]);
  first.text(MARGIN, Math.min(bottom - 24, MARGIN + 10),
    'Prices are catalog estimates. Confirm current supplier quotations before purchasing.', 8);

  // Following pages: furniture list and cost breakdown
  const pages = [first.toString()];
  for (let start = 0; start < items.length; start += ROWS_PER_PAGE) {
    const page = new PageCanvas();
    drawHeader(page, input, 'Furniture list and cost breakdown');
    const rows = items.slice(start, start + ROWS_PER_PAGE);
    let y = drawItemTable(page, rows, PAGE_HEIGHT - MARGIN - 70);
    if (start + ROWS_PER_PAGE >= items.length) {
      y -= 10;
      page.strokeColor([0.2, 0.2, 0.2]);
      page.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
      y -= 18;
      page.fillColor([0.1, 0.1, 0.1]);
      page.text(MARGIN, y, 'Estimated total', 11, true);
      page.textRight(PAGE_WIDTH - MARGIN, y, formatPHP(total), 11, true);
    }
    pages.push(page.toString());
  }
  return assemblePdf(pages);
}
