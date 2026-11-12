/**
 * Persists confirmed AR room measurements to MongoDB via the backend.
 */

import { callApi } from './apiClient';
import type {
  RoomMeasurementListResponse,
  RoomMeasurementRecord,
  RoomMeasurementResponse,
  SaveRoomMeasurementInput,
  UpdateRoomMeasurementInput,
} from '@/types/room-measurement';

export class RoomMeasurementService {
  static async save(input: SaveRoomMeasurementInput): Promise<RoomMeasurementRecord> {
    const response = await callApi<RoomMeasurementResponse>('/room-measurements', {
      method: 'POST',
      body: input,
      // A scan is too much work to lose to a slow server: at the 15 s default the app gave up on a
      // save the server finished a minute later, and the design went ahead without the room
      // (2026-11-12).
      timeoutMs: 60000,
    });
    return response.measurement;
  }

  static async getAll(projectId?: string): Promise<RoomMeasurementRecord[]> {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const response = await callApi<RoomMeasurementListResponse>(`/room-measurements${query}`);
    return response.measurements ?? [];
  }

  static async getById(id: string): Promise<RoomMeasurementRecord | null> {
    const response = await callApi<RoomMeasurementResponse>(
      `/room-measurements/${encodeURIComponent(id)}`,
    );
    return response.measurement ?? null;
  }

  static async updateName(id: string, name: string): Promise<RoomMeasurementRecord> {
    return this.update(id, { name });
  }

  static async update(
    id: string,
    input: UpdateRoomMeasurementInput,
  ): Promise<RoomMeasurementRecord> {
    const response = await callApi<RoomMeasurementResponse>(
      `/room-measurements/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: input,
      },
    );
    return response.measurement;
  }

  /** Attach a Unity Export 3D .glb (and optional Projects id) to a saved room. */
  static async linkExport(
    id: string,
    input: {
      projectId?: string;
      exportPath: string;
      exportFileName?: string;
      exportByteLength?: number;
      exportFurnitureCount?: number;
    },
  ): Promise<RoomMeasurementRecord> {
    return this.update(id, {
      projectId: input.projectId,
      exportPath: input.exportPath,
      exportFileName: input.exportFileName,
      exportByteLength: input.exportByteLength,
      exportFurnitureCount: input.exportFurnitureCount,
      exportedAt: new Date().toISOString(),
    });
  }

  static async delete(id: string): Promise<void> {
    await callApi<{ success: boolean; id: string }>(
      `/room-measurements/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }
}
