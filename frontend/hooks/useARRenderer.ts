import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, AccessibilityInfo, Alert, LayoutChangeEvent } from 'react-native';
import { ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer } from '@/utils/ExpoGLRenderer';
import * as THREE from 'three';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';

import { CONFIG } from '../constants/ar-config';
import { disposeMesh, disposeObjectRecursive, spatialToVector3, vector3ToSpatial } from '../utils/three-utils';
import type { ARInitError, FurnitureMapEntry } from '../types/ar-view';
import { RoomData, SpatialPoint } from '../types/spatial-mapping';
import { arAnchorManager } from '../services/ARAnchorManager';
import { FURNITURE_LIBRARY } from '../constants/furniture-library';
import { alignToFloor, smoothPositionWithRef } from '../utils/three-utils';

/**
 * Error classification and recovery strategy mapping
 */
const AR_ERROR_CLASSIFICATION: Record<string, ARInitError> = {
    'camera-permission-denied': {
        type: 'camera_permission',
        message: 'Camera permission denied',
        recoverable: true,
        retryable: true,
        maxRetries: 3,
        fallbackMode: undefined,
        userMessage: 'Camera permission is required for AR features.',
        recoveryHint: 'Please grant camera permission in device settings.',
    },
    'webgl-context-lost': {
        type: 'webgl_context',
        message: 'WebGL context lost',
        recoverable: true,
        retryable: true,
        maxRetries: 5,
        fallbackMode: 'preview',
        userMessage: 'Graphics context was lost. Recovering...',
        recoveryHint: 'The app will attempt to recover automatically.',
    },
    'webgl-context-failed': {
        type: 'webgl_context',
        message: 'Failed to create WebGL context',
        recoverable: false,
        retryable: true,
        maxRetries: 3,
        fallbackMode: 'preview',
        userMessage: 'Your device may not support advanced graphics features.',
        recoveryHint: 'Try using preview mode or restart the app.',
    },
    'webgl-unsupported': {
        type: 'webgl_unsupported',
        message: 'WebGL not supported',
        recoverable: false,
        retryable: false,
        maxRetries: 0,
        fallbackMode: 'preview',
        userMessage: 'Your device does not support WebGL rendering.',
        recoveryHint: 'AR features are unavailable. Preview mode is available.',
    },
    'renderer-create-failed': {
        type: 'renderer_init',
        message: 'Failed to create renderer',
        recoverable: true,
        retryable: true,
        maxRetries: 3,
        fallbackMode: 'preview',
        userMessage: 'Failed to initialize 3D renderer.',
        recoveryHint: 'The app will retry or switch to preview mode.',
    },
    'invalid_context_dimensions': {
        type: 'renderer_init',
        message: 'Invalid WebGL context dimensions',
        recoverable: true,
        retryable: true,
        maxRetries: 5,
        fallbackMode: undefined,
        userMessage: 'Display configuration error. Retrying...',
        recoveryHint: 'Please wait while the app recovers.',
    },
    'scene-create-failed': {
        type: 'scene_init',
        message: 'Failed to create 3D scene',
        recoverable: true,
        retryable: true,
        maxRetries: 3,
        fallbackMode: 'preview',
        userMessage: 'Failed to initialize 3D scene.',
        recoveryHint: 'The app will attempt to recover.',
    },
    'lighting-init-failed': {
        type: 'lighting_init',
        message: 'Failed to initialize lighting',
        recoverable: true,
        retryable: true,
        maxRetries: 2,
        fallbackMode: undefined,
        userMessage: 'Lighting initialization issue. Continuing with default lighting...',
        recoveryHint: 'The app will use default lighting.',
    },
    'anchor-tracking-lost': {
        type: 'anchor_tracking',
        message: 'AR anchor tracking lost',
        recoverable: true,
        retryable: true,
        maxRetries: 5,
        fallbackMode: 'preview',
        userMessage: 'Lost AR tracking. Attempting to recover...',
        recoveryHint: 'Move your device slowly to help re-establish tracking.',
    },
    'anchor-poor-quality': {
        type: 'anchor_poor_quality',
        message: 'AR anchor quality is poor',
        recoverable: true,
        retryable: true,
        maxRetries: 3,
        fallbackMode: 'preview',
        userMessage: 'AR tracking quality is limited. Some features may not work perfectly.',
        recoveryHint: 'Move to a well-lit area with clear floor surfaces.',
    },
    'anchor-init-failed': {
        type: 'anchor_tracking',
        message: 'Failed to initialize AR anchor',
        recoverable: true,
        retryable: true,
        maxRetries: 5,
        fallbackMode: 'preview',
        userMessage: 'Unable to establish AR anchor. Try moving to a different location.',
        recoveryHint: 'Ensure good lighting and clear floor surfaces.',
    },
    'memory-limit-exceeded': {
        type: 'memory_limit',
        message: 'Memory limit exceeded',
        recoverable: true,
        retryable: true,
        maxRetries: 2,
        fallbackMode: 'minimal',
        userMessage: 'Device memory is limited. Some features may be reduced.',
        recoveryHint: 'Try removing some furniture or restart the app.',
    },
    'texture-load-failed': {
        type: 'texture_loading',
        message: 'Failed to load texture',
        recoverable: true,
        retryable: true,
        maxRetries: 3,
        fallbackMode: undefined,
        userMessage: 'Some textures failed to load. Using fallback materials.',
        recoveryHint: 'The app will continue with default materials.',
    },
    'device-incompatible': {
        type: 'device_incompatible',
        message: 'Device incompatible with AR features',
        recoverable: false,
        retryable: false,
        maxRetries: 0,
        fallbackMode: 'preview',
        userMessage: 'Your device may not fully support AR features.',
        recoveryHint: 'Preview mode is available as an alternative.',
    },
    'unknown-error': {
        type: 'unknown',
        message: 'Unknown initialization error',
        recoverable: true,
        retryable: true,
        maxRetries: 3,
        fallbackMode: 'preview',
        userMessage: 'An unexpected error occurred during initialization.',
        recoveryHint: 'The app will attempt to recover or switch to preview mode.',
    },
};

interface UseARRendererProps {
    isARActive: boolean;
    furnitureMapRef: React.MutableRefObject<Map<string, FurnitureMapEntry>>;
    roomData: RoomData | null;
    isDraggingFurniture: boolean;
    draggedFurnitureId: string | null;
    demoMode?: boolean;
    onSceneReady?: () => void;
    setCameraMode: (mode: 'ar' | 'preview') => void;
    setIsARActive: (active: boolean) => void;
    detectedPlanes: Array<{ id: string; type: 'horizontal' | 'vertical'; center: THREE.Vector3; extent: { width: number; length: number }; confidence: number }>;
    isPlacingFurniture: boolean;
    selectedLibraryItemId: string | null;
}

export const useARRenderer = ({
    isARActive,
    furnitureMapRef,
    roomData,
    isDraggingFurniture,
    draggedFurnitureId,
    demoMode = false,
    onSceneReady,
    setCameraMode,
    setIsARActive,
    detectedPlanes,
    isPlacingFurniture,
    selectedLibraryItemId,
}: UseARRendererProps) => {
    // Refs
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const glContextRef = useRef<ExpoWebGLRenderingContext | null>(null);
    const rootGroupRef = useRef<THREE.Group | null>(null);
    const reticleRef = useRef<THREE.Mesh | null>(null);
    const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
    const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
    const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const frameCountRef = useRef<number>(0);
    const reticlePulseRef = useRef<number>(0);
    const glLayoutRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

    // Reticle and raycasting refs
    const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
    const floorPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
    const previewGhostRef = useRef<THREE.Group | null>(null);
    const reticleWorldPositionRef = useRef<THREE.Vector3 | null>(null);
    const reticleSmoothedPositionRef = useRef<THREE.Vector3 | null>(null);
    const lastReticleUpdateRef = useRef<number>(0);
    const tempVectorRef = useRef<THREE.Vector3>(new THREE.Vector3());
    const lastSelectedItemIdRef = useRef<string | null>(null);

    // State
    const [rendererReady, setRendererReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [initError, setInitError] = useState<ARInitError | null>(null);
    const [retryAttempts, setRetryAttempts] = useState<Map<string, number>>(new Map());
    const [recoveryInProgress, setRecoveryInProgress] = useState(false);

    /**
     * Classify an error and return appropriate error details
     */
    const classifyARError = useCallback((error: Error | unknown): ARInitError => {
        const defaultError = AR_ERROR_CLASSIFICATION['unknown-error'];
        if (error instanceof Error) {
            const message = error.message.toLowerCase();
            if (message.includes('camera')) return AR_ERROR_CLASSIFICATION['camera-permission-denied'];
            if (message.includes('webgl context lost')) return AR_ERROR_CLASSIFICATION['webgl-context-lost'];
            if (message.includes('failed to create webgl context')) return AR_ERROR_CLASSIFICATION['webgl-context-failed'];
            if (message.includes('webgl not supported')) return AR_ERROR_CLASSIFICATION['webgl-unsupported'];
            if (message.includes('renderer')) return AR_ERROR_CLASSIFICATION['renderer-create-failed'];
            if (message.includes('dimensions')) return AR_ERROR_CLASSIFICATION['invalid_context_dimensions'];
            if (message.includes('scene')) return AR_ERROR_CLASSIFICATION['scene-create-failed'];
            if (message.includes('lighting')) return AR_ERROR_CLASSIFICATION['lighting-init-failed'];
            if (message.includes('anchor tracking')) return AR_ERROR_CLASSIFICATION['anchor-tracking-lost'];
            if (message.includes('memory')) return AR_ERROR_CLASSIFICATION['memory-limit-exceeded'];
            if (message.includes('texture')) return AR_ERROR_CLASSIFICATION['texture-load-failed'];
        }
        return defaultError;
    }, []);

    const stopAnimationLoop = useCallback(() => {
        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
    }, []);

    const cleanupAllResources = useCallback(() => {
        console.log('[useARRenderer] Cleaning up all WebGL resources...');
        stopAnimationLoop();

        if (rootGroupRef.current) {
            disposeObjectRecursive(rootGroupRef.current);
            rootGroupRef.current = null;
        }

        if (reticleRef.current) {
            disposeMesh(reticleRef.current);
            reticleRef.current = null;
        }

        if (sceneRef.current) {
            sceneRef.current.clear();
            sceneRef.current = null;
        }

        rendererRef.current?.dispose();
        rendererRef.current = null;
        cameraRef.current = null;
        glContextRef.current = null;
        setRendererReady(false);
    }, [stopAnimationLoop]);

    const enhanceShadows = useCallback(() => {
        if (!isARActive || !keyLightRef.current || !rendererRef.current) return;

        try {
            const simulatedLightIntensity = 0.5 + Math.sin(Date.now() / 50000) * 0.2;
            const lightIntensity = Math.max(0.3, Math.min(1.0, simulatedLightIntensity));

            if (keyLightRef.current) {
                keyLightRef.current.intensity = 0.6 + (lightIntensity - 0.5) * 0.4;
                if (keyLightRef.current.shadow) {
                    keyLightRef.current.shadow.bias = -0.0001 - (1 - lightIntensity) * 0.0002;
                }
            }

            furnitureMapRef.current.forEach(({ mesh }) => {
                mesh.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;

                        if (cameraRef.current && child.material instanceof THREE.MeshStandardMaterial) {
                            const distance = child.getWorldPosition(new THREE.Vector3()).distanceTo(cameraRef.current.position);
                            child.material.shadowSide = distance < 5 ? THREE.FrontSide : THREE.DoubleSide;
                        }
                    }
                });
            });
        } catch (error) {
            console.warn('[useARRenderer] Error enhancing shadows:', error);
        }
    }, [isARActive, furnitureMapRef]);

    /**
     * Update reticle position based on screen center raycasting
     */
    const updateReticleFromScreen = useCallback(() => {
        if (!rendererReady || !cameraRef.current || !reticleRef.current || !glLayoutRef.current.height) return;

        const now = Date.now();
        if (now - lastReticleUpdateRef.current < CONFIG.RETICLE_SMOOTHING_FACTOR * 1000) {
            // Smoothly move towards target if we have one
            if (reticleWorldPositionRef.current && reticleSmoothedPositionRef.current) {
                reticleSmoothedPositionRef.current.lerp(reticleWorldPositionRef.current, CONFIG.POSITION_SMOOTHING_FACTOR);
                reticleRef.current.position.copy(reticleSmoothedPositionRef.current);

                if (previewGhostRef.current && isPlacingFurniture) {
                    previewGhostRef.current.position.copy(reticleSmoothedPositionRef.current);
                }
            }
            return;
        }

        lastReticleUpdateRef.current = now;

        // Raycast from camera center
        raycasterRef.current.setFromCamera(new THREE.Vector2(0, 0), cameraRef.current);

        let hitPoint: THREE.Vector3 | null = null;
        let hitNormal: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

        if (!hitPoint) {
            let bestIntersection: THREE.Vector3 | null = null;
            let bestDistance = Infinity;

            const horizontalPlanes = detectedPlanes.filter(p => p.type === 'horizontal');
            for (const plane of horizontalPlanes) {
                const planeGeometry = new THREE.Plane(
                    new THREE.Vector3(0, 1, 0),
                    -plane.center.y
                );

                const tempIntersection = new THREE.Vector3();
                if (raycasterRef.current.ray.intersectPlane(planeGeometry, tempIntersection)) {
                    const distance = tempIntersection.distanceTo(cameraRef.current.position);
                    const score = distance / (plane.confidence + 0.1);
                    if (score < bestDistance) {
                        bestDistance = score;
                        bestIntersection = tempIntersection.clone();
                    }
                }
            }
            if (bestIntersection) {
                hitPoint = bestIntersection;
            }
        }

        // 3. Fallback to floor plane
        if (!hitPoint) {
            const floorIntersect = new THREE.Vector3();
            if (raycasterRef.current.ray.intersectPlane(floorPlaneRef.current, floorIntersect)) {
                hitPoint = floorIntersect;
            }
        }

        if (hitPoint) {
            // Project to world via anchor manager
            const projected = arAnchorManager.projectToWorld(vector3ToSpatial(hitPoint));
            const worldVector = spatialToVector3(projected);

            // Align to floor
            const alignedPosition = alignToFloor(worldVector);

            if (!reticleSmoothedPositionRef.current) {
                reticleSmoothedPositionRef.current = alignedPosition.clone();
            }
            if (!reticleWorldPositionRef.current) {
                reticleWorldPositionRef.current = alignedPosition.clone();
            }

            reticleWorldPositionRef.current.copy(alignedPosition);

            // Apply smoothing
            reticleSmoothedPositionRef.current = smoothPositionWithRef(
                reticleSmoothedPositionRef.current,
                alignedPosition,
                CONFIG.RETICLE_SMOOTHING_FACTOR
            );

            reticleRef.current.position.set(
                reticleSmoothedPositionRef.current.x,
                reticleSmoothedPositionRef.current.y + 0.01,
                reticleSmoothedPositionRef.current.z
            );
            reticleRef.current.visible = true;

            // Orient reticle to plane normal (fallback to up if not hitting a plane)
            const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hitNormal);
            reticleRef.current.quaternion.slerp(targetQuaternion, 0.2);

            // Update ghost furniture position
            if (previewGhostRef.current && isPlacingFurniture) {
                previewGhostRef.current.position.copy(reticleSmoothedPositionRef.current);
                previewGhostRef.current.visible = true;

                // If the selected item changed, we would update the mesh here
                // For now just keep it visible
            }
        } else {
            reticleRef.current.visible = false;
            if (previewGhostRef.current) previewGhostRef.current.visible = false;
        }
    }, [rendererReady, isPlacingFurniture]);

    const startAnimationLoop = useCallback(() => {
        const renderLoop = () => {
            if (rendererRef.current && sceneRef.current && cameraRef.current && glContextRef.current) {
                frameCountRef.current++;

                // Update reticle if active and not dragging
                if (isARActive && !isDraggingFurniture) {
                    updateReticleFromScreen();
                } else if (reticleRef.current) {
                    reticleRef.current.visible = false;
                }

                // Reticle pulse
                if (reticleRef.current && reticleRef.current.visible && frameCountRef.current % 2 === 0) {
                    reticlePulseRef.current += CONFIG.RETICLE_PULSE_SPEED;
                    const pulseScale = 1 + Math.sin(reticlePulseRef.current) * CONFIG.RETICLE_PULSE_SCALE;

                    if (reticleRef.current.children.length > 0) {
                        const pulseMesh = reticleRef.current.children[0] as THREE.Mesh;
                        if (pulseMesh && pulseMesh.visible) {
                            pulseMesh.scale.set(pulseScale, 1, pulseScale);
                        }
                    }
                }

                enhanceShadows();

                // Lighting
                if (ambientLightRef.current && isARActive) {
                    const timeBasedIntensity = 0.4 + Math.sin(Date.now() / 100000) * 0.1;
                    ambientLightRef.current.intensity = Math.max(0.3, Math.min(0.7, timeBasedIntensity));
                }

                rendererRef.current.render(sceneRef.current, cameraRef.current);
                glContextRef.current.endFrameEXP();
            }
            animationFrameRef.current = requestAnimationFrame(renderLoop);
        };

        renderLoop();
    }, [isARActive, enhanceShadows]);

    const handleErrorRecovery = useCallback((errorInfo: ARInitError, onReady: () => void) => {
        // Basic recovery: cleanup and flag for re-init
        cleanupAllResources();
        onReady();
    }, [cleanupAllResources]);

    const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
        try {
            glContextRef.current = gl;

            // Shim pixelStorei to suppress "parameter not supported" errors
            const originalPixelStorei = gl.pixelStorei.bind(gl);
            gl.pixelStorei = function (...args) {
                const [pname] = args;
                // Suppress UNPACK_FLIP_Y_WEBGL (37440), UNPACK_PREMULTIPLY_ALPHA_WEBGL (37441), UNPACK_COLORSPACE_CONVERSION_WEBGL (37443)
                if (pname === 37440 || pname === 37441 || pname === 37443) return;
                try { originalPixelStorei(...args); } catch (e) { }
            };

            if (gl.canvas) {
                gl.canvas.addEventListener('webglcontextlost', (event: Event) => {
                    event.preventDefault();
                    cleanupAllResources();
                    setError('Graphics context lost. Attempting recovery...');
                    AccessibilityInfo.announceForAccessibility('Graphics context lost. Recovering...');
                });

                gl.canvas.addEventListener('webglcontextrestored', () => {
                    setError(null);
                    AccessibilityInfo.announceForAccessibility('Graphics context restored.');
                    setTimeout(() => onContextCreate(gl), 0);
                });
            }

            const { drawingBufferWidth, drawingBufferHeight } = gl;
            if (drawingBufferWidth === 0 || drawingBufferHeight === 0) {
                throw new Error('Invalid WebGL context dimensions');
            }

            const scene = new THREE.Scene();
            sceneRef.current = scene;

            const camera = new THREE.PerspectiveCamera(65, drawingBufferWidth / drawingBufferHeight, 0.05, 100);
            camera.position.set(0, 1.6, 4);
            camera.lookAt(0, 0, 0);
            cameraRef.current = camera;

            const renderer = new Renderer({ gl });
            renderer.setSize(drawingBufferWidth, drawingBufferHeight);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.2;
            rendererRef.current = renderer;

            // Lighting
            const ambientLight = new THREE.AmbientLight(0xffffff, isARActive ? 0.4 : 0.6);
            scene.add(ambientLight);
            ambientLightRef.current = ambientLight;

            const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
            keyLight.position.set(5, 10, 5);
            keyLight.castShadow = true;
            keyLight.shadow.mapSize.set(1024, 1024);
            keyLight.shadow.camera.near = 0.1;
            keyLight.shadow.camera.far = 50;
            keyLight.shadow.bias = -0.0001;
            keyLight.shadow.normalBias = 0.02;
            scene.add(keyLight);
            keyLightRef.current = keyLight;

            const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
            fillLight.position.set(-5, 6, -5);
            scene.add(fillLight);
            fillLightRef.current = fillLight;

            // Rim light for depth
            const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.4);
            rimLight.position.set(-4, 6, -6);
            rimLight.castShadow = true;
            scene.add(rimLight);

            // Add subtle fog
            scene.fog = new THREE.Fog(0x05070a, 5, 25);

            // Reticle
            const reticleGeometry = new THREE.RingGeometry(0.18, 0.22, 64);
            reticleGeometry.rotateX(-Math.PI / 2);
            const reticleMaterial = new THREE.MeshStandardMaterial({
                color: 0x60a5fa,
                transparent: true,
                opacity: 0.9,
                emissive: 0x3b82f6,
                emissiveIntensity: 0.5,
            });
            const reticleMesh = new THREE.Mesh(reticleGeometry, reticleMaterial);
            reticleMesh.visible = false;
            reticleMesh.position.y = 0.02;
            scene.add(reticleMesh);
            reticleRef.current = reticleMesh;

            const pulseGeometry = new THREE.RingGeometry(0.15, 0.17, 64);
            pulseGeometry.rotateX(-Math.PI / 2);
            const pulseMesh = new THREE.Mesh(pulseGeometry, new THREE.MeshStandardMaterial({
                color: 0x3b82f6,
                transparent: true,
                opacity: 0.6,
                emissive: 0x2563eb,
                emissiveIntensity: 0.8,
            }));
            pulseMesh.position.y = 0.001;
            reticleMesh.add(pulseMesh);

            const centerDotGeometry = new THREE.CircleGeometry(0.03, 16);
            centerDotGeometry.rotateX(-Math.PI / 2);
            const centerDot = new THREE.Mesh(centerDotGeometry, new THREE.MeshStandardMaterial({
                color: 0xffffff,
                emissive: 0x60a5fa,
                emissiveIntensity: 1.0,
            }));
            centerDot.position.y = 0.002;
            reticleMesh.add(centerDot);

            const rootGroup = new THREE.Group();
            rootGroupRef.current = rootGroup;
            scene.add(rootGroup);

            // Preview ghost group
            const previewGhost = new THREE.Group();
            previewGhost.visible = false;
            previewGhostRef.current = previewGhost;
            scene.add(previewGhost);

            setRendererReady(true);
            startAnimationLoop();
            setError(null);
            setInitError(null);
            onSceneReady?.();
        } catch (err) {
            console.error('[useARRenderer] Error initializing:', err);
            const errorInfo = classifyARError(err);
            setInitError(errorInfo);
            setError(errorInfo.userMessage);
        }
    }, [isARActive, startAnimationLoop, cleanupAllResources, classifyARError, onSceneReady]);

    const handleCanvasLayout = useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        glLayoutRef.current = { width, height };
        if (cameraRef.current && rendererRef.current && height > 0) {
            cameraRef.current.aspect = width / height;
            cameraRef.current.updateProjectionMatrix();
            rendererRef.current.setSize(
                glContextRef.current?.drawingBufferWidth ?? width,
                glContextRef.current?.drawingBufferHeight ?? height,
                false
            );
        }
    }, []);

    useEffect(() => {
        return () => cleanupAllResources();
    }, [cleanupAllResources]);

    return {
        onContextCreate,
        handleCanvasLayout,
        rendererReady,
        error,
        initError,
        sceneRef,
        cameraRef,
        rendererRef,
        rootGroupRef,
        reticleRef,
        glLayoutRef,
        recoveryInProgress,
        previewGhostRef,
        reticleWorldPositionRef,
        reticleSmoothedPositionRef,
        updateReticleFromScreen,
    };
};
