import { WebGLRenderer, type WebGLRendererParameters } from 'three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';

type RendererOptions = Omit<WebGLRendererParameters, 'context'> & {
  gl: ExpoWebGLRenderingContext;
  pixelRatio?: number;
};

// Expo GL installs these classes globally on native; browsers provide their own.
type WebGLGlobals = {
  WebGLRenderingContext?: unknown;
  WebGL2RenderingContext?: { new (): unknown; prototype: unknown };
};

/** True when the context exposes the WebGL 2 API (OpenGL ES 3). */
export function isWebGL2Context(gl: ExpoWebGLRenderingContext): boolean {
  const scope = globalThis as unknown as WebGLGlobals;
  if (typeof scope.WebGL2RenderingContext === 'function' && gl instanceof scope.WebGL2RenderingContext) {
    return true;
  }
  return typeof gl.createVertexArray === 'function' && typeof gl.texImage3D === 'function';
}

/** Connect Three.js to Expo GL without browser polyfills or a DOM canvas. */
export class Renderer extends WebGLRenderer {
  constructor({ gl, canvas, pixelRatio = 1, ...options }: RendererOptions) {
    const nativeCanvas = canvas ?? ({
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
      clientWidth: gl.drawingBufferWidth,
      clientHeight: gl.drawingBufferHeight,
      style: {},
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      getContext: () => gl,
    } as unknown as HTMLCanvasElement);

    if (!isWebGL2Context(gl)) {
      throw new Error('3D view needs WebGL 2 (OpenGL ES 3.0), which this device does not support.');
    }

    // Expo's native WebGL2RenderingContext inherits from WebGLRenderingContext, so
    // Three.js (r163+) misreads it as WebGL 1 and throws. Hide the WebGL 1 class
    // only while Three.js inspects the context.
    const scope = globalThis as unknown as WebGLGlobals;
    const webGL1Class = scope.WebGLRenderingContext;
    const hideWebGL1 = webGL1Class !== undefined;
    if (hideWebGL1) scope.WebGLRenderingContext = undefined;
    try {
      super({ ...options, canvas: nativeCanvas, context: gl });
    } finally {
      if (hideWebGL1) scope.WebGLRenderingContext = webGL1Class;
    }
    this.setPixelRatio(pixelRatio);
  }
}
