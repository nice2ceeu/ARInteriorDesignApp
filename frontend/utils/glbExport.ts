/**
 * GLB Export
 * Writes Three.js meshes to a binary glTF 2.0 (.glb) file. World transforms are
 * baked into vertex positions, and each mesh keeps its base color and opacity.
 * Lines, grids and invisible objects are skipped.
 */

import * as THREE from 'three';

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

interface Accessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: 'VEC3' | 'SCALAR';
  min?: number[];
  max?: number[];
}

export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
  }
  return new Uint8Array(bytes);
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    output += BASE64[(triple >> 18) & 63] + BASE64[(triple >> 12) & 63];
    output += i + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : '=';
    output += i + 2 < bytes.length ? BASE64[triple & 63] : '=';
  }
  return output;
}

const padTo4 = (length: number) => (4 - (length % 4)) % 4;

export function buildGlb(roots: (THREE.Object3D | null | undefined)[]): Uint8Array {
  const binaryParts: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: { buffer: 0; byteOffset: number; byteLength: number; target: number }[] = [];
  const accessors: Accessor[] = [];
  const materials: object[] = [];
  const meshes: object[] = [];
  const nodes: object[] = [];
  const materialIndex = new Map<string, number>();

  const addView = (data: Float32Array | Uint32Array, target: number) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
    binaryParts.push(bytes);
    byteLength += bytes.length;
    const padding = padTo4(bytes.length);
    if (padding) {
      binaryParts.push(new Uint8Array(padding));
      byteLength += padding;
    }
    return bufferViews.length - 1;
  };

  const addMaterial = (material: THREE.Material) => {
    const color = (material as THREE.MeshStandardMaterial).color ?? new THREE.Color(0.8, 0.8, 0.8);
    const opacity = material.transparent ? material.opacity : 1;
    const key = `${color.getHexString()}-${opacity}`;
    if (!materialIndex.has(key)) {
      materials.push({
        pbrMetallicRoughness: { baseColorFactor: [color.r, color.g, color.b, opacity], metallicFactor: 0, roughnessFactor: 0.8 },
        ...(opacity < 1 ? { alphaMode: 'BLEND' } : {}),
        doubleSided: material.side === THREE.DoubleSide,
      });
      materialIndex.set(key, materials.length - 1);
    }
    return materialIndex.get(key)!;
  };

  for (const root of roots) {
    if (!root) continue;
    root.updateMatrixWorld(true);
    root.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const position = object.geometry?.attributes?.position;
      if (!position || position.count === 0) return;

      const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
      const positions = new Float32Array(position.count * 3);
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      const vertex = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
        const coords = [vertex.x, vertex.y, vertex.z];
        coords.forEach((value, axis) => {
          positions[i * 3 + axis] = value;
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        });
      }

      const attributes: Record<string, number> = {};
      accessors.push({ bufferView: addView(positions, ARRAY_BUFFER), componentType: FLOAT, count: position.count, type: 'VEC3', min, max });
      attributes.POSITION = accessors.length - 1;

      const normal = object.geometry.attributes.normal;
      if (normal && normal.count === position.count) {
        const normals = new Float32Array(normal.count * 3);
        const n = new THREE.Vector3();
        for (let i = 0; i < normal.count; i++) {
          n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
          normals.set([n.x, n.y, n.z], i * 3);
        }
        accessors.push({ bufferView: addView(normals, ARRAY_BUFFER), componentType: FLOAT, count: normal.count, type: 'VEC3' });
        attributes.NORMAL = accessors.length - 1;
      }

      const index = object.geometry.index;
      const indices = index
        ? Uint32Array.from({ length: index.count }, (_, i) => index.getX(i))
        : Uint32Array.from({ length: position.count }, (_, i) => i);
      accessors.push({ bufferView: addView(indices, ELEMENT_ARRAY_BUFFER), componentType: UNSIGNED_INT, count: indices.length, type: 'SCALAR' });

      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      meshes.push({
        primitives: [{ attributes, indices: accessors.length - 1, ...(material ? { material: addMaterial(material) } : {}) }],
      });
      nodes.push({ mesh: meshes.length - 1, name: object.userData.furnitureName || object.name || `object-${nodes.length}` });
    });
  }

  if (!nodes.length) throw new Error('There is no 3D geometry to export');

  const gltf = {
    asset: { version: '2.0', generator: 'AR Interior Design App' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };

  const json = encodeUtf8(JSON.stringify(gltf));
  const jsonPadding = padTo4(json.length);
  const jsonChunkLength = json.length + jsonPadding;
  const totalLength = 12 + 8 + jsonChunkLength + 8 + byteLength;

  const glb = new Uint8Array(totalLength);
  const view = new DataView(glb.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonChunkLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  glb.set(json, 20);
  glb.fill(0x20, 20 + json.length, 20 + jsonChunkLength); // JSON chunk pads with spaces
  let offset = 20 + jsonChunkLength;
  view.setUint32(offset, byteLength, true);
  view.setUint32(offset + 4, CHUNK_BIN, true);
  offset += 8;
  for (const part of binaryParts) {
    glb.set(part, offset);
    offset += part.length;
  }
  return glb;
}
