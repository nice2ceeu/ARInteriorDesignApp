import { WebGLRenderer, type WebGLRendererParameters } from 'three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';

type RendererOptions = Omit<WebGLRendererParameters, 'context'> & {
  gl: ExpoWebGLRenderingContext;
  pixelRatio?: number;
};

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

    super({ ...options, canvas: nativeCanvas, context: gl });
    this.setPixelRatio(pixelRatio);
  }
}
