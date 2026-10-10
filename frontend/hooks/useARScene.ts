/**
 * AR Scene Hook
 * Manages AR scene initialization, WebGL context, and rendering
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Renderer } from '@/utils/ExpoGLRenderer';
import { ExpoWebGLRenderingContext } from 'expo-gl';
import { AR_CONFIG } from '@/config/arView.config';
import { classifyARError } from '@/utils/arErrorHandling';
import { createDefaultLighting, disposeObjectRecursive } from '@/utils/threejsHelpers';
import type { ARInitError, ARSceneState } from '@/types/ar-view';

interface UseARSceneReturn {
  // State
  sceneState: ARSceneState;
  isInitialized: boolean;
  error: ARInitError | null;
  
  // Refs (for direct access)
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  rendererRef: React.MutableRefObject<Renderer | null>;
  
  // Actions
  initializeScene: (gl: ExpoWebGLRenderingContext) => Promise<boolean>;
  disposeScene: () => void;
  renderFrame: () => void;
  handleContextLost: () => void;
  handleContextRestored: () => void;
}

export function useARScene(): UseARSceneReturn {
  // State
  const [sceneState, setSceneState] = useState<ARSceneState>({
    isInitialized: false,
    hasCamera: false,
    hasWebGL: false,
    hasAnchor: false,
    anchorQuality: 'lost',
    errorState: null,
  });
  const [error, setError] = useState<ARInitError | null>(null);

  // Refs for THREE.js objects
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const glContextRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Initialize scene
  const initializeScene = useCallback(async (gl: ExpoWebGLRenderingContext): Promise<boolean> => {
    try {
      console.log('[ARScene] Initializing scene...');
      
      // Validate context
      if (!gl || gl.drawingBufferWidth <= 0 || gl.drawingBufferHeight <= 0) {
        throw new Error('Invalid WebGL context dimensions');
      }
      
      glContextRef.current = gl;
      
      // Create renderer
      const renderer = new Renderer({ gl });
      renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
      renderer.setPixelRatio(1); // Use 1 for performance
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      rendererRef.current = renderer;
      
      // Create scene
      const scene = new THREE.Scene();
      scene.background = null; // Transparent for AR
      sceneRef.current = scene;
      
      // Create camera
      const aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
      const camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 1000);
      camera.position.set(0, 1.6, 3); // Eye level, slightly back
      camera.lookAt(0, 0, 0);
      cameraRef.current = camera;
      
      // Add default lighting
      const lighting = createDefaultLighting();
      scene.add(lighting);
      
      // Update state
      setSceneState(prev => ({
        ...prev,
        isInitialized: true,
        hasWebGL: true,
        errorState: null,
      }));
      setError(null);
      
      console.log('[ARScene] Scene initialized successfully');
      return true;
      
    } catch (err) {
      console.error('[ARScene] Initialization error:', err);
      const classifiedError = classifyARError(err);
      setError(classifiedError);
      setSceneState(prev => ({
        ...prev,
        isInitialized: false,
        errorState: classifiedError,
      }));
      return false;
    }
  }, []);

  // Dispose scene and cleanup resources
  const disposeScene = useCallback(() => {
    console.log('[ARScene] Disposing scene...');
    
    // Cancel animation frame
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Dispose scene objects
    if (sceneRef.current) {
      sceneRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          disposeObjectRecursive(child);
        }
      });
      sceneRef.current.clear();
      sceneRef.current = null;
    }
    
    // Dispose renderer
    if (rendererRef.current) {
      rendererRef.current.dispose();
      rendererRef.current = null;
    }
    
    cameraRef.current = null;
    glContextRef.current = null;
    
    setSceneState({
      isInitialized: false,
      hasCamera: false,
      hasWebGL: false,
      hasAnchor: false,
      anchorQuality: 'lost',
      errorState: null,
    });
    
    console.log('[ARScene] Scene disposed');
  }, []);

  // Render a single frame
  const renderFrame = useCallback(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) {
      return;
    }
    
    try {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      
      // Required for expo-gl
      if (glContextRef.current) {
        glContextRef.current.endFrameEXP();
      }
    } catch (err) {
      console.warn('[ARScene] Render error:', err);
    }
  }, []);

  // Handle WebGL context lost
  const handleContextLost = useCallback(() => {
    console.warn('[ARScene] WebGL context lost');
    setSceneState(prev => ({
      ...prev,
      hasWebGL: false,
      errorState: classifyARError(new Error('WebGL context lost')),
    }));
  }, []);

  // Handle WebGL context restored
  const handleContextRestored = useCallback(() => {
    console.log('[ARScene] WebGL context restored');
    if (glContextRef.current) {
      initializeScene(glContextRef.current);
    }
  }, [initializeScene]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disposeScene();
    };
  }, [disposeScene]);

  return {
    sceneState,
    isInitialized: sceneState.isInitialized,
    error,
    sceneRef,
    cameraRef,
    rendererRef,
    initializeScene,
    disposeScene,
    renderFrame,
    handleContextLost,
    handleContextRestored,
  };
}

