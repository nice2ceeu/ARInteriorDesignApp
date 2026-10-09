import { callApi } from './apiClient';

export interface RoomDetection {
  label: string;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
}

export interface RoomDetectionResult {
  model: string;
  imageWidth: number;
  imageHeight: number;
  detections: RoomDetection[];
  coordinateSpace: 'image-pixels';
  hasMetricDepth: false;
}

export async function detectRoomObjects(imageBase64: string): Promise<RoomDetectionResult> {
  return callApi<RoomDetectionResult>('/ml/detect', {
    method: 'POST', body: { imageBase64, threshold: 0.2 }, timeoutMs: 30000, maxRetries: 0,
  });
}
