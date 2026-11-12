/**
 * Floor Plan PDF
 * Builds an A4 PDF with a to-scale floor plan, numbered furniture list and cost
 * breakdown for the design flow's final layout (step 7). Pure TypeScript with the
 * standard Helvetica fonts, so no native module is required. The output is ASCII,
 * so it can be written to a file as a UTF-8 string.
 *
 * Positions use the planner's room-local frame: x along the room width, z along its
 * length, localPosition is the min corner of the item's rotated footprint. The plan is
 * drawn the way round the room really is (utils/planView), not its mirror image.
 */

import { designItemColor } from '@/utils/designItemColors';
import { planFootprint } from '@/utils/planView';
import type { CustomizedLayoutItem } from '@/types/design-flow';

export interface FloorPlanPdfInput {
  title: string;
  room: { width: number; length: number; height: number };
  items: CustomizedLayoutItem[];
  totalPhp: number;
  budgetPhp?: number;
  roomType?: string;
  style?: string;
  generatedAt?: Date;
}

interface PlanItem {
  number: number;
  name: string;
  left: number; // metres from the room's left wall
  top: number;  // metres from the room's top wall
  width: number;
  length: number;
  height: number;
  color: [number, number, number];
  pricePhp: number;
  rug: boolean;
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

/** Peso amount for the PDF; the standard PDF fonts have no ₱ glyph. */
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

/** Mix a colour towards white, for light fills behind dark labels. */
const lighten = ([r, g, b]: [number, number, number], amount: number): [number, number, number] =>
  [r + (1 - r) * amount, g + (1 - g) * amount, b + (1 - b) * amount];

const num = (value: number) => Number(value.toFixed(2)).toString();

// Approximate Helvetica width for centring and right-aligning short text.
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

  dash(on: number | null) {
    this.ops.push(on ? `[${num(on)} ${num(on)}] 0 d` : '[] 0 d');
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

function toPlanItems(items: CustomizedLayoutItem[], roomWidth: number): PlanItem[] {
  return items.map((item, index) => {
    // Quarter turns swap the footprint, matching FloorPlanPreview and AR.
    const foot = planFootprint({ ...item, rotationY: item.rotationY ?? 0 }, roomWidth);
    return {
      number: index + 1,
      name: item.displayName,
      left: foot.left,
      top: foot.top,
      width: foot.width,
      length: foot.depth,
      height: item.height,
      color: hexToRgb(item.tintHex || designItemColor(index, item.category, item.role)),
      pricePhp: Number(item.pricePhp) || 0,
      rug: item.role === 'rug',
    };
  });
}

function drawHeader(page: PageCanvas, input: FloorPlanPdfInput, subtitle: string) {
  const { room } = input;
  page.fillColor([0.1, 0.1, 0.1]);
  page.text(MARGIN, PAGE_HEIGHT - MARGIN - 10, input.title || 'My design', 20, true);
  page.fillColor([0.4, 0.4, 0.4]);
  const area = (room.width * room.length).toFixed(1);
  page.text(MARGIN, PAGE_HEIGHT - MARGIN - 30,
    `${subtitle}  |  ${num(room.width)} m x ${num(room.length)} m x ${num(room.height)} m  |  ${area} sq m`, 10);
}

function drawFloorPlan(page: PageCanvas, items: PlanItem[], room: FloorPlanPdfInput['room']) {
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

  // Rugs first (dashed, light) so furniture sits on top; then footprints numbered to match the list
  page.lineWidth(0.8);
  for (const item of [...items.filter((i) => i.rug), ...items.filter((i) => !i.rug)]) {
    const x = originX + item.left * scale;
    const y = originTop - (item.top + item.length) * scale;
    const w = item.width * scale;
    const h = item.length * scale;
    page.fillColor(lighten(item.color, item.rug ? 0.8 : 0.45));
    page.strokeColor(item.color);
    page.dash(item.rug ? 3 : null);
    page.rect(x, y, w, h, 'both');
    page.dash(null);
    if (item.rug) continue;
    const label = String(item.number);
    page.fillColor([1, 1, 1]);
    page.rect(x + w / 2 - 8, y + h / 2 - 6, 16, 13, 'fill');
    page.fillColor([0.1, 0.1, 0.1]);
    page.text(x + w / 2 - textWidth(label, 9) / 2, y + h / 2 - 3, label, 9, true);
  }

  // Dimension labels
  page.fillColor([0.3, 0.3, 0.3]);
  const widthLabel = `${num(room.width)} m`;
  page.text(originX + planWidth / 2 - textWidth(widthLabel, 9) / 2, originTop - planHeight - 16, widthLabel, 9);
  page.text(originX + planWidth + 6, originTop - planHeight / 2, `${num(room.length)} m`, 9);

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
  const right = PAGE_WIDTH - MARGIN;
  let y = top;
  page.fillColor([0.1, 0.1, 0.1]);
  page.text(MARGIN, y, 'Cost summary', 13, true);
  y -= 20;
  page.text(MARGIN, y, 'Furniture pieces', 10);
  page.textRight(right, y, String(items.filter((i) => !i.rug).length), 10);
  y -= 16;
  page.text(MARGIN, y, 'Estimated total', 10, true);
  page.textRight(right, y, formatPHP(input.totalPhp), 10, true);
  if (input.budgetPhp && input.budgetPhp > 0) {
    const remaining = input.budgetPhp - input.totalPhp;
    y -= 16;
    page.text(MARGIN, y, 'Budget', 10);
    page.textRight(right, y, formatPHP(input.budgetPhp), 10);
    y -= 16;
    page.fillColor(remaining >= 0 ? [0.05, 0.5, 0.25] : [0.75, 0.1, 0.1]);
    page.text(MARGIN, y, remaining >= 0 ? 'Remaining' : 'Over budget', 10, true);
    page.textRight(right, y, formatPHP(Math.abs(remaining)), 10, true);
  }
  return y;
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
    page.textRight(right, y, item.pricePhp > 0 ? formatPHP(item.pricePhp) : '-', 9);
  }
  return y;
}

function assemblePdf(pageContents: string[]): string {
  const objects: string[] = [];
  // 1 catalog, 2 pages, 3 regular font, 4 bold font, then (page, content) pairs
  const pageIds = pageContents.map((_, index) => 5 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageContents.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pageContents.forEach((content, index) => {
    const pageId = pageIds[index];
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] `
      + `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
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
  const items = toPlanItems(input.items, input.room.width);
  const generatedAt = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  const subtitle = [input.roomType, input.style, generatedAt].filter(Boolean).join('  |  ');

  // Page 1: floor plan and cost summary
  const first = new PageCanvas();
  drawHeader(first, input, subtitle);
  const planBottom = drawFloorPlan(first, items, input.room);
  const bottom = drawCostSummary(first, items, input, planBottom - 30);
  first.fillColor([0.45, 0.45, 0.45]);
  first.text(MARGIN, Math.min(bottom - 24, MARGIN + 10),
    'Prices are catalog estimates. Confirm current prices with the store before purchasing.', 8);

  // Following pages: furniture list and cost breakdown
  const pages = [first.toString()];
  for (let start = 0; start < items.length; start += ROWS_PER_PAGE) {
    const page = new PageCanvas();
    drawHeader(page, input, 'Furniture list and cost breakdown');
    let y = drawItemTable(page, items.slice(start, start + ROWS_PER_PAGE), PAGE_HEIGHT - MARGIN - 70);
    if (start + ROWS_PER_PAGE >= items.length) {
      y -= 10;
      page.strokeColor([0.2, 0.2, 0.2]);
      page.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
      y -= 18;
      page.fillColor([0.1, 0.1, 0.1]);
      page.text(MARGIN, y, 'Estimated total', 11, true);
      page.textRight(PAGE_WIDTH - MARGIN, y, formatPHP(input.totalPhp), 11, true);
    }
    pages.push(page.toString());
  }
  return assemblePdf(pages);
}
