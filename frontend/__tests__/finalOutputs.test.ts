import { describe, it, expect } from '@jest/globals';
import * as THREE from 'three';
import { buildFloorPlanPdf, formatPHP } from '../utils/floorPlanPdf';
import { buildGlb, toBase64, encodeUtf8 } from '../utils/glbExport';
import type { DesignProposal } from '../types/ai-design';

const room = { width: 5, length: 4, height: 2.7 };

const furnitureItem = (index: number, price?: number) => ({
  id: `item-${index}`, type: 'chair', category: 'seating', name: `Chair (${index})`,
  dimensions: { width: 0.5, length: 0.5, height: 0.9 },
  position: { x: 0, y: 0, z: 0, rotation: index % 2 ? 90 : 0 },
  properties: { color: '#336699', price }, zIndex: index,
});

const design = (count: number) => ({
  id: 'design-1', title: 'Minimalist Bedroom', roomType: 'Bedroom',
  layout: { furniture: Array.from({ length: count }, (_, i) => furnitureItem(i + 1, i === 0 ? undefined : 1500)) },
  estimatedCost: { low: 4500, mid: 4500, high: 4500 },
}) as unknown as DesignProposal;

describe('floor plan PDF', () => {
  it('produces a valid PDF whose cross-reference table points at each object', () => {
    const pdf = buildFloorPlanPdf({ design: design(4), room, budgetPHP: 30000, generatedAt: new Date('2026-10-10') });
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
    expect(/^[\x00-\x7F]*$/.test(pdf)).toBe(true);

    const xrefStart = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);
    expect(pdf.slice(xrefStart, xrefStart + 4)).toBe('xref');
    const entries = [...pdf.slice(xrefStart).matchAll(/^(\d{10}) 00000 n $/gm)].map(match => Number(match[1]));
    entries.forEach((offset, i) => expect(pdf.startsWith(`${i + 1} 0 obj`, offset)).toBe(true));

    // Two pages: floor plan with summary, then the itemized list
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('(Chair \\(1\\)) Tj');
    expect(pdf).toContain('(PHP 4,500) Tj');
    expect(pdf).toContain('(Remaining) Tj');
    expect(pdf).toContain('(PHP 25,500) Tj');
  });

  it('paginates long furniture lists and flags spending over budget', () => {
    const pdf = buildFloorPlanPdf({ design: design(40), room, budgetPHP: 1000 });
    expect(pdf).toContain('/Count 3');
    expect(pdf).toContain('(Over budget) Tj');
  });

  it('formats peso amounts with thousands separators', () => {
    expect(formatPHP(30000)).toBe('PHP 30,000');
    expect(formatPHP(-1250.4)).toBe('-PHP 1,250');
  });
});

describe('GLB export', () => {
  it('writes a glTF 2.0 binary with world-space positions and materials', () => {
    const group = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    box.position.set(3, 0.5, 0);
    group.add(box, new THREE.LineSegments(new THREE.BufferGeometry()));
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    hidden.visible = false;
    group.add(hidden);

    const glb = buildGlb([group, null]);
    const view = new DataView(glb.buffer);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(glb.length);

    const jsonLength = view.getUint32(12, true);
    const gltf = JSON.parse(Buffer.from(glb.slice(20, 20 + jsonLength)).toString('utf8'));
    expect(gltf.nodes).toHaveLength(1);
    const position = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION];
    expect(position.min).toEqual([2, 0, -0.5]);
    expect(position.max).toEqual([4, 1, 0.5]);
    expect(gltf.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([1, 0, 0, 1]);
    expect(gltf.buffers[0].byteLength).toBe(view.getUint32(20 + jsonLength, true));
  });

  it('refuses to export an empty scene', () => {
    expect(() => buildGlb([new THREE.Group()])).toThrow('no 3D geometry');
  });

  it('encodes UTF-8 and base64 like Node does', () => {
    const text = 'Sofá ₱ ok';
    const bytes = encodeUtf8(text);
    expect(Buffer.from(bytes).toString('utf8')).toBe(text);
    for (const length of [0, 1, 2, 3, 10]) {
      const sample = bytes.slice(0, length);
      expect(toBase64(sample)).toBe(Buffer.from(sample).toString('base64'));
    }
  });
});
