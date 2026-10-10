import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthService, AUTH_TOKEN_KEY } from '../services/AuthService';
import { callApi } from '../services/apiClient';
import { saveProject, loadProject, getAllProjects, finalizeDesign, deleteProject } from '../utils/layout3dStorage';
import { exportAsJSON, exportAsPNG, exportAsPDF, exportAsGLB } from '../utils/layout3dExport';
import type { DesignProposal } from '../types/ai-design';
import { savedItemsService } from '../services/SavedItemsService';
import * as THREE from 'three';
import { GLView } from 'expo-gl';

const mockStorage = new Map<string, string>();
const mockFiles = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  },
}));
jest.mock('../services/apiClient', () => ({ callApi: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///test/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  writeAsStringAsync: jest.fn(async (path: string, content: string) => { mockFiles.set(path, content); }),
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => { mockFiles.set(to, 'copied:' + from); }),
}));
jest.mock('expo-gl', () => ({ GLView: { takeSnapshotAsync: jest.fn(async () => ({ uri: 'file:///cache/snapshot.png' })) } }));

describe('frontend service workflows', () => {
  const dimensions = { width: 5, length: 4, height: 2.7 };
  const design = {
    id: 'workflow-design', title: 'Bedroom',
    layout: { furniture: [{ id: 'desk-1', name: 'Desk', position: { x: 1, z: 1 }, dimensions: { width: 1, length: 0.6, height: 0.75 } }] },
    estimatedCost: { low: 5000, high: 6000 }, colorPalette: ['#ffffff'],
  } as unknown as DesignProposal;

  beforeEach(async () => {
    await savedItemsService.clearAllSavedItems();
    mockStorage.clear(); mockFiles.clear(); jest.clearAllMocks();
  });

  it('signs up, stores the session, logs out, and logs in again', async () => {
    const user = { id: 'user-test', email: 'test@example.com', name: 'Test', createdAt: '2026-10-10' };
    jest.mocked(callApi).mockResolvedValue({ token: 'signed-test-token', user });
    await AuthService.signup(user.email, 'test-password', user.name);
    expect(callApi).toHaveBeenCalledWith('/users/signup', { method: 'POST', body: { email: user.email, password: 'test-password', name: user.name } });
    expect(await AsyncStorage.getItem(AUTH_TOKEN_KEY)).toBe('signed-test-token');
    expect(await AuthService.isLoggedIn()).toBe(true);
    await AuthService.logout();
    expect(await AuthService.isLoggedIn()).toBe(false);
    await AuthService.login(user.email, 'test-password');
    expect(callApi).toHaveBeenLastCalledWith('/users/login', { method: 'POST', body: { email: user.email, password: 'test-password' } });
    expect(await AuthService.isLoggedIn()).toBe(true);
  });

  it('saves, reloads, lists, finalizes, and deletes a design without losing its furniture or estimate', async () => {
    await saveProject(design, dimensions);
    const restored = await loadProject(design.id);
    expect(restored?.furniture).toEqual(design.layout?.furniture);
    expect(restored?.estimatedCost).toEqual(design.estimatedCost);
    expect(restored?.roomDimensions).toEqual(dimensions);
    expect(await getAllProjects()).toHaveLength(1);
    const savedItem = await savedItemsService.getSavedItemById(`layout-project:${design.id}`);
    expect(savedItem).toMatchObject({
      name: design.title, type: 'project',
      metadata: { source: 'layout-3d', design, roomDimensions: dimensions },
    });
    await saveProject(design, dimensions);
    expect(await savedItemsService.getSavedItems()).toHaveLength(1);
    await finalizeDesign(design, dimensions);
    expect(JSON.parse(mockStorage.get('finalized_' + design.id)!)).toMatchObject({ status: 'finalized', roomDimensions: dimensions });
    await deleteProject(design.id);
    expect(await loadProject(design.id)).toBeNull();
    expect(await getAllProjects()).toEqual([]);
    expect(await savedItemsService.getSavedItems()).toEqual([]);
  });

  it('exports JSON data, a PDF floor plan, a binary GLB and a PNG snapshot', async () => {
    const json = await exportAsJSON(design, dimensions);
    expect(JSON.parse(mockFiles.get(json)!)).toMatchObject({ dimensions, furniture: design.layout?.furniture, cost: design.estimatedCost });

    const pdf = await exportAsPDF(design, dimensions, 30000);
    expect(pdf.endsWith('.pdf')).toBe(true);
    const pdfContent = mockFiles.get(pdf)!;
    expect(pdfContent.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfContent).toContain('(Desk) Tj');
    expect(pdfContent.endsWith('%%EOF\n')).toBe(true);

    const furniture = new THREE.Group();
    furniture.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.75, 0.6), new THREE.MeshStandardMaterial({ color: 0x8b4513 })));
    const glb = await exportAsGLB(design, null, furniture);
    expect(glb.endsWith('.glb')).toBe(true);
    const bytes = Buffer.from(mockFiles.get(glb)!, 'base64');
    expect(bytes.toString('ascii', 0, 4)).toBe('glTF');
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);

    await expect(exportAsPNG(design, null)).rejects.toThrow('not ready');
    const gl = {} as Parameters<typeof GLView.takeSnapshotAsync>[0];
    const png = await exportAsPNG(design, gl as never);
    expect(png.endsWith('.png')).toBe(true);
    expect(GLView.takeSnapshotAsync).toHaveBeenCalledWith(gl, { format: 'png' });
    expect(mockFiles.get(png)).toBe('copied:file:///cache/snapshot.png');
  });
});
