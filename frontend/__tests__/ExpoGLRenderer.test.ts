import { Renderer } from '../utils/ExpoGLRenderer';
import { WebGLRenderer } from 'three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';

jest.mock('three', () => ({
  WebGLRenderer: jest.fn().mockImplementation(function (this: { setPixelRatio: jest.Mock }) {
    this.setPixelRatio = jest.fn();
  }),
}));

describe('Expo GL renderer adapter', () => {
  beforeEach(() => jest.clearAllMocks());

  const gl = { drawingBufferWidth: 640, drawingBufferHeight: 480 } as ExpoWebGLRenderingContext;

  it('supplies the native GL context and a canvas without requiring a DOM', () => {
    const renderer = new Renderer({ gl, alpha: true });
    const options = (WebGLRenderer as unknown as jest.Mock).mock.calls[0][0];
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
    const options = (WebGLRenderer as unknown as jest.Mock).mock.calls[0][0];
    expect(options.canvas).toBe(canvas);
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(2);
  });
});
