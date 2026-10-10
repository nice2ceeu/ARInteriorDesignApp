import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Renderer } from '../utils/ExpoGLRenderer';
import { WebGLRenderer } from 'three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';

// Records whether the WebGL 1 class was visible when Three.js inspected the context
let mockWebGL1Visible: boolean | undefined;
jest.mock('three', () => ({
  WebGLRenderer: jest.fn().mockImplementation(function (this: { setPixelRatio: unknown }) {
    mockWebGL1Visible = (globalThis as { WebGLRenderingContext?: unknown }).WebGLRenderingContext !== undefined;
    this.setPixelRatio = jest.fn();
  }),
}));

describe('Expo GL renderer adapter', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  // The options object passed to the mocked Three.js renderer
  type CanvasStub = { width: number; height: number; getContext: () => unknown; addEventListener: (...args: unknown[]) => void };
  const rendererOptions = () => jest.mocked(WebGLRenderer).mock.calls[0][0] as unknown as { context?: unknown; alpha?: boolean; canvas: CanvasStub };

  const gl = {
    drawingBufferWidth: 640, drawingBufferHeight: 480,
    createVertexArray: () => ({}), texImage3D: () => {},
  } as unknown as ExpoWebGLRenderingContext;

  it('supplies the native GL context and a canvas without requiring a DOM', () => {
    const renderer = new Renderer({ gl, alpha: true });
    const options = rendererOptions();
    expect(options.context).toBe(gl);
    expect(options.alpha).toBe(true);
    expect(options.canvas.width).toBe(640);
    expect(options.canvas.height).toBe(480);
    expect(options.canvas.getContext()).toBe(gl);
    expect(() => options.canvas.addEventListener('webglcontextlost', () => {})).not.toThrow();
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(1);
  });

  it('preserves a supplied web canvas and pixel ratio', () => {
    const canvas = {} as HTMLCanvasElement;
    const renderer = new Renderer({ gl, canvas, pixelRatio: 2 });
    const options = rendererOptions();
    expect(options.canvas).toBe(canvas);
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(2);
  });

  it('hides the WebGL 1 class while Three.js inspects an Expo WebGL 2 context, then restores it', () => {
    // Expo's native WebGL2RenderingContext inherits from WebGLRenderingContext
    class WebGLRenderingContext {}
    class WebGL2RenderingContext extends WebGLRenderingContext {}
    const scope = globalThis as Record<string, unknown>;
    scope.WebGLRenderingContext = WebGLRenderingContext;
    scope.WebGL2RenderingContext = WebGL2RenderingContext;
    try {
      const nativeGl = Object.assign(new WebGL2RenderingContext(), { drawingBufferWidth: 1, drawingBufferHeight: 1 });
      new Renderer({ gl: nativeGl as unknown as ExpoWebGLRenderingContext });
      expect(mockWebGL1Visible).toBe(false);
      expect(scope.WebGLRenderingContext).toBe(WebGLRenderingContext);
    } finally {
      delete scope.WebGLRenderingContext;
      delete scope.WebGL2RenderingContext;
    }
  });

  it('explains when the device only supports WebGL 1', () => {
    const webGL1Only = { drawingBufferWidth: 1, drawingBufferHeight: 1 } as ExpoWebGLRenderingContext;
    expect(() => new Renderer({ gl: webGL1Only })).toThrow('needs WebGL 2');
    expect(WebGLRenderer).not.toHaveBeenCalled();
  });
});
